<#
.SYNOPSIS
    SylvieGalGame 本地运维脚本（开发、校验、打包、冒烟测试与产物管理）。

.DESCRIPTION
    以 galgame-monorepo 为工作目录，封装常用 pnpm 命令，负责环境检查、内容校验、
    桌面端打包、NSIS 安装包生成、打包产物冒烟测试，以及本地存档清理与产物目录打开。

    web 操作用浏览器预览同一套播放器（Vite HMR，端口 5175），便于快速调试 UI 与剧本；
    正式交付仍以 Electron 打包产物为准。

    docker:* 操作使用根目录 scripts/docker-compose.yml，把 apps/web 构建为 Nginx 静态镜像
    并运行；容器无状态，存档保存在访问者浏览器的 IndexedDB / localStorage 中。
    加 -GameContent 会叠加 scripts/docker-compose.game.yml，把本地内容包挂载进容器。

    脚本会自动清除当前会话中的 ELECTRON_RUN_AS_NODE 环境变量，避免 Electron 被
    误当成 Node 运行时启动（表现为 "bad option"）。

.PARAMETER Action
    要执行的操作，默认 status：
      status        查看环境、内容包、构建产物与存档状态
      doctor        检查 Node / pnpm / 依赖 / 内容包是否就绪（缺失即报错）
      dev           构建共享包并启动 Electron 开发模式
      web           启动 Web 预览（浏览器调试，Vite HMR，端口 5175）
      docker:up     构建 Web 镜像并启动容器（默认 http://localhost:8080）
      docker:down   停止并移除 Web 容器
      docker:restart 重启 Web 容器并等待健康检查
      docker:build  仅重新构建 Web 镜像
      docker:logs   查看 Web 容器日志
      docker:status 查看 Web 容器状态与访问地址
      build         Turbo 构建全部包（含 Web 预览）
      package       生成免安装目录（apps/electron/out/SylvieGalGame-win32-x64/）
      make          生成 NSIS 安装包（apps/electron/out/make/）
      smoke         启动已打包应用，自动验证 UI 并截图（需先 package）
      verify        依次执行 lint、typecheck、test、validate
      lint          全仓 ESLint 检查
      test          运行引擎单元测试
      typecheck     全仓 TypeScript 检查
      validate      加载真实剧本、跑通全部分支并检查资源与脚本警告
      assets        重新生成占位图片 / 音频 / 图标
      clean         清理 dist、.vite、out 等构建产物（需确认）
      reset-saves   删除本地存档、已读标记与设置（需确认）
      output        在资源管理器中打开打包产物目录

.PARAMETER Force
    clean / reset-saves 跳过二次确认；docker:build 禁用构建缓存。

.PARAMETER Follow
    docker:logs 是否持续跟踪输出。

.PARAMETER Tail
    docker:logs 显示的最后行数，默认 100。

.PARAMETER TimeoutSeconds
    docker:up / docker:restart 等待健康检查的秒数，默认 60。

.PARAMETER NoWait
    docker:up / docker:restart 启动后不等待健康检查。

.PARAMETER ExePath
    smoke 操作要启动的 exe 路径；默认使用 apps/electron/out 下的打包产物。

.PARAMETER GameContent
    docker:* 操作额外加载 scripts/docker-compose.game.yml，把本地内容包只读挂载进
    Nginx；修改剧情 / 素材后刷新页面即可生效，不需要重建镜像。

.EXAMPLE
    pwsh ./manage.ps1 status

.EXAMPLE
    pwsh ./manage.ps1 dev

.EXAMPLE
    pwsh ./manage.ps1 web

.EXAMPLE
    pwsh ./manage.ps1 docker:up

.EXAMPLE
    pwsh ./manage.ps1 docker:up -NoWait

.EXAMPLE
    pwsh ./manage.ps1 docker:up -GameContent

.EXAMPLE
    pwsh ./manage.ps1 docker:build -Force

.EXAMPLE
    pwsh ./manage.ps1 docker:logs -Follow

.EXAMPLE
    pwsh ./manage.ps1 docker:status

.EXAMPLE
    pwsh ./manage.ps1 package

.EXAMPLE
    pwsh ./manage.ps1 make

.EXAMPLE
    pwsh ./manage.ps1 verify

.EXAMPLE
    pwsh ./manage.ps1 lint

.EXAMPLE
    pwsh ./manage.ps1 smoke

.EXAMPLE
    pwsh ./manage.ps1 clean -Force

.EXAMPLE
    pwsh ./manage.ps1 reset-saves
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet(
        'status', 'doctor', 'dev', 'web', 'build', 'package', 'make', 'smoke',
        'verify', 'lint', 'test', 'typecheck', 'validate', 'assets',
        'clean', 'reset-saves', 'output',
        'docker:up', 'docker:down', 'docker:restart', 'docker:build',
        'docker:logs', 'docker:status'
    )]
    [string]$Action = 'status',

    [switch]$Force,

    [switch]$Follow,

    [ValidateRange(10, 1000)]
    [int]$Tail = 100,

    [ValidateRange(5, 600)]
    [int]$TimeoutSeconds = 60,

    [switch]$NoWait,

    [switch]$GameContent,

    [string]$ExePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 统一以 UTF-8 输出，避免中文在重定向/管道中乱码
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptRoot = $PSScriptRoot
$MonorepoRoot = Join-Path $ScriptRoot 'galgame-monorepo'
$ComposeFile = Join-Path $ScriptRoot 'scripts/docker-compose.yml'
$ComposeGameFile = Join-Path $ScriptRoot 'scripts/docker-compose.game.yml'
$MountGameContent = [bool]$GameContent
$WebContainerName = 'sylvie-web'
$GameRoot = Join-Path $MonorepoRoot 'packages/game-content/game'
$OutputRoot = Join-Path $MonorepoRoot 'apps/electron/out'
$PackagedExe = Join-Path $OutputRoot 'SylvieGalGame-win32-x64/SylvieGalGame.exe'
$InstallerDir = Join-Path $OutputRoot 'make'
$StorageFile = Join-Path $env:APPDATA 'SylvieGalGame/game-storage.json'

function Remove-ElectronNodeMode {
    # 某些终端/IDE 会导出 ELECTRON_RUN_AS_NODE=1，Electron 将退化为 Node 运行时。
    if ($null -ne $env:ELECTRON_RUN_AS_NODE) {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        Write-Host '已清除 ELECTRON_RUN_AS_NODE，Electron 将以桌面模式启动。' -ForegroundColor DarkGray
    }
}

function Assert-DockerPrerequisites {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw '未找到 docker 命令，请先安装并启动 Docker Desktop。'
    }

    if (-not (Test-Path -LiteralPath $ComposeFile)) {
        throw "未找到 compose 文件：$ComposeFile"
    }

    if ($MountGameContent -and -not (Test-Path -LiteralPath $ComposeGameFile)) {
        throw "未找到内容挂载覆盖文件：$ComposeGameFile"
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw '当前 docker 不支持 compose v2，请升级 Docker Desktop。'
    }
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory)]
        [string[]]$ComposeArgs
    )

    $composeFiles = @('--file', $ComposeFile)
    if ($MountGameContent) {
        $composeFiles += @('--file', $ComposeGameFile)
    }
    & docker compose @composeFiles @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($ComposeArgs -join ' ') 执行失败（退出码 $LASTEXITCODE）。"
    }
}

function Get-ContainerHealth {
    param(
        [Parameter(Mandatory)]
        [string]$ContainerName
    )

    $result = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ContainerName 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    return ($result | Select-Object -First 1)
}

function Get-WebUrl {
    $mapping = & docker compose --file $ComposeFile port web 80 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $mapping) {
        return 'http://localhost:8080'
    }

    $port = (($mapping | Select-Object -First 1).Trim() -split ':')[-1]
    return "http://localhost:$port"
}

function Wait-WebHealthy {
    if ($NoWait) {
        Write-Host '已跳过健康检查等待。' -ForegroundColor DarkGray
        return
    }

    Write-Host "等待 Web 容器就绪（最长 ${TimeoutSeconds}s）..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $status = Get-ContainerHealth -ContainerName $WebContainerName

        switch ($status) {
            'healthy' {
                Write-Host 'Web 容器已就绪。' -ForegroundColor Green
                return
            }
            'unhealthy' {
                throw "Web 容器健康检查失败，请执行：pwsh ./manage.ps1 docker:logs -Follow"
            }
            default {
                Start-Sleep -Seconds 2
            }
        }
    }

    throw "等待 Web 容器就绪超时（${TimeoutSeconds}s），请执行：pwsh ./manage.ps1 docker:logs -Follow"
}

function Assert-NodePrerequisites {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw '未找到 pnpm 命令，请安装 Node.js 后执行 corepack enable（或 npm install -g pnpm）。'
    }

    if (-not (Test-Path -LiteralPath (Join-Path $MonorepoRoot 'package.json'))) {
        throw "未找到 monorepo 目录：$MonorepoRoot"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $MonorepoRoot 'node_modules'))) {
        throw '未安装依赖，请先执行：cd galgame-monorepo; pnpm install'
    }

    $nodeVersion = [version]((& node --version).TrimStart('v'))
    if ($nodeVersion.Major -lt 20) {
        throw "Node.js 版本过低（当前 $nodeVersion），请升级到 20.11 或更高版本。"
    }
}

function Invoke-Pnpm {
    param(
        [Parameter(Mandatory)]
        [string[]]$PnpmArgs
    )

    Push-Location $MonorepoRoot
    $previousPreference = $ErrorActionPreference
    try {
        # 构建工具会往 stderr 写进度信息，临时放宽避免被当成终止错误
        $ErrorActionPreference = 'Continue'
        & pnpm @PnpmArgs
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "pnpm $($PnpmArgs -join ' ') 执行失败（退出码 $exitCode）。"
    }
}

function Invoke-NodeScript {
    param(
        [Parameter(Mandatory)]
        [string[]]$NodeArgs
    )

    Push-Location $MonorepoRoot
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & node @NodeArgs
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "node $($NodeArgs -join ' ') 执行失败（退出码 $exitCode）。"
    }
}

function Get-FileSizeText {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $bytes = (Get-Item -LiteralPath $Path).Length
    if ($bytes -ge 1GB) { return '{0:N2} GB' -f ($bytes / 1GB) }
    if ($bytes -ge 1MB) { return '{0:N1} MB' -f ($bytes / 1MB) }
    return '{0:N0} KB' -f ($bytes / 1KB)
}

function Get-ContentStats {
    if (-not (Test-Path -LiteralPath $GameRoot)) {
        return $null
    }

    return [pscustomobject]@{
        Scenes = @(Get-ChildItem -LiteralPath (Join-Path $GameRoot 'scripts/scenes') -Filter '*.yaml' -ErrorAction SilentlyContinue).Count
        Images = @(Get-ChildItem -LiteralPath (Join-Path $GameRoot 'images') -Recurse -File -ErrorAction SilentlyContinue).Count
        Audio  = @(Get-ChildItem -LiteralPath (Join-Path $GameRoot 'audio') -Recurse -File -ErrorAction SilentlyContinue).Count
    }
}

function Write-ArtifactStatus {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        $size = Get-FileSizeText -Path $Path
        Write-Host "  $Label  $Path（$size）" -ForegroundColor Green
    }
    else {
        Write-Host "  $Label  尚未生成" -ForegroundColor Yellow
    }
}

function Show-Status {
    Write-Host ''
    Write-Host 'SylvieGalGame · 午后的回声' -ForegroundColor Cyan
    Write-Host 'YAML 驱动的视觉小说播放器（Electron + React + TypeScript）' -ForegroundColor DarkGray
    Write-Host ''

    $node = if (Get-Command node -ErrorAction SilentlyContinue) { (& node --version).Trim() } else { '未安装' }
    $pnpm = if (Get-Command pnpm -ErrorAction SilentlyContinue) { (& pnpm --version).Trim() } else { '未安装' }
    $docker = if (Get-Command docker -ErrorAction SilentlyContinue) { (& docker --version).Trim() } else { '未安装（Web 容器功能不可用）' }
    Write-Host '环境' -ForegroundColor Cyan
    Write-Host "  Node    $node"
    Write-Host "  pnpm    $pnpm"
    Write-Host "  Docker  $docker"
    Write-Host "  仓库    $MonorepoRoot $(if (Test-Path -LiteralPath $MonorepoRoot) { '（存在）' } else { '（缺失）' })"
    Write-Host "  Compose $ComposeFile $(if (Test-Path -LiteralPath $ComposeFile) { '（存在）' } else { '（缺失）' })"

    if ($null -ne $env:ELECTRON_RUN_AS_NODE) {
        Write-Host '  ELECTRON_RUN_AS_NODE 已设置；manage.ps1 会在启动应用前自动清除。' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '内容包' -ForegroundColor Cyan
    if (Test-Path -LiteralPath $GameRoot) {
        $stats = Get-ContentStats
        Write-Host "  $GameRoot" -ForegroundColor DarkGray
        Write-Host "  场景 $($stats.Scenes) 个 · 图片 $($stats.Images) 个 · 音频 $($stats.Audio) 个"
    }
    else {
        Write-Host "  未找到内容包：$GameRoot" -ForegroundColor Red
    }

    $engineDist = Join-Path $MonorepoRoot 'packages/engine-core/dist/index.js'
    $playerDist = Join-Path $MonorepoRoot 'packages/player/dist/index.js'
    $minigamesDist = Join-Path $MonorepoRoot 'packages/minigames/dist/index.js'
    $webDist = Join-Path $MonorepoRoot 'apps/web/dist/index.html'
    Write-Host ''
    Write-Host '构建产物' -ForegroundColor Cyan
    Write-ArtifactStatus -Label '引擎' -Path $engineDist
    Write-ArtifactStatus -Label '播放器' -Path $playerDist
    Write-ArtifactStatus -Label '小游戏' -Path $minigamesDist
    Write-ArtifactStatus -Label 'Web 预览' -Path $webDist
    Write-ArtifactStatus -Label '免安装版' -Path $PackagedExe

    $installer = Get-ChildItem -LiteralPath $InstallerDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($installer) {
        Write-Host "  安装包  $($installer.FullName)（$(Get-FileSizeText -Path $installer.FullName)）" -ForegroundColor Green
    }
    else {
        Write-Host '  安装包  尚未生成' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '本地存档' -ForegroundColor Cyan
    if (Test-Path -LiteralPath $StorageFile) {
        Write-Host "  $StorageFile（$(Get-FileSizeText -Path $StorageFile)）"
    }
    else {
        Write-Host '  尚无存档（首次运行游戏后生成）' -ForegroundColor DarkGray
    }
    Write-Host ''
}

function Assert-Environment {
    Assert-NodePrerequisites

    if (-not (Test-Path -LiteralPath (Join-Path $GameRoot 'scripts/game.yaml'))) {
        throw "内容包缺少清单文件：$(Join-Path $GameRoot 'scripts/game.yaml')"
    }

    Write-Host '环境检查通过：Node / pnpm / 依赖 / 内容包均已就绪。' -ForegroundColor Green
}

function Confirm-Destructive {
    param([Parameter(Mandatory)][string]$Message)

    if ($Force) { return }

    $answer = Read-Host "$Message 输入 YES 继续"
    if ($answer -ne 'YES') {
        Write-Host '已取消。' -ForegroundColor Yellow
        exit 0
    }
}

function Invoke-Smoke {
    $nodeVersion = [version]((& node --version).TrimStart('v'))
    if ($nodeVersion.Major -lt 22) {
        throw "smoke 需要 Node.js 22+（依赖内置 WebSocket），当前为 $nodeVersion。"
    }

    if ($ExePath) {
        if (-not (Test-Path -LiteralPath $ExePath)) {
            throw "指定的 exe 不存在：$ExePath"
        }
        $resolved = (Resolve-Path -LiteralPath $ExePath).Path
        Invoke-NodeScript -NodeArgs @('scripts/smoke-app.mjs', $resolved)
        return
    }

    if (-not (Test-Path -LiteralPath $PackagedExe)) {
        throw '未找到打包产物，请先执行：pwsh ./manage.ps1 package'
    }

    Invoke-Pnpm -PnpmArgs @('smoke')
}

try {
    switch ($Action) {
        'status' {
            Show-Status
            exit 0
        }

        'doctor' {
            Assert-Environment
            Show-Status
            exit 0
        }

        'dev' {
            Assert-NodePrerequisites
            Remove-ElectronNodeMode
            Invoke-Pnpm -PnpmArgs @('dev')
        }

        'web' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('dev:web')
        }

        'docker:up' {
            Assert-DockerPrerequisites
            Invoke-Compose -ComposeArgs @('up', '-d', '--build', 'web')
            Wait-WebHealthy
            Write-Host "Web 容器已启动：$(Get-WebUrl)" -ForegroundColor Green
        }

        'docker:down' {
            Assert-DockerPrerequisites
            Invoke-Compose -ComposeArgs @('down')
            Write-Host 'Web 容器已停止并移除。' -ForegroundColor Green
        }

        'docker:restart' {
            Assert-DockerPrerequisites
            Invoke-Compose -ComposeArgs @('restart', 'web')
            Wait-WebHealthy
            Write-Host "Web 容器已重启：$(Get-WebUrl)" -ForegroundColor Green
        }

        'docker:build' {
            Assert-DockerPrerequisites
            $buildArgs = @('build')
            if ($Force) { $buildArgs += '--no-cache' }
            $buildArgs += 'web'
            Invoke-Compose -ComposeArgs $buildArgs
            Write-Host 'Web 镜像构建完成：sylvie-web:local' -ForegroundColor Green
        }

        'docker:logs' {
            Assert-DockerPrerequisites
            $logArgs = @('logs', '--tail', "$Tail")
            if ($Follow) { $logArgs += '-f' }
            $logArgs += 'web'
            Invoke-Compose -ComposeArgs $logArgs
        }

        'docker:status' {
            Assert-DockerPrerequisites
            Invoke-Compose -ComposeArgs @('ps')

            $health = Get-ContainerHealth -ContainerName $WebContainerName

            if ($null -eq $health) {
                Write-Host "Web 容器（$WebContainerName）尚未创建，执行 docker:up 启动。" -ForegroundColor Yellow
                exit 0
            }

            $color = if ($health -eq 'healthy' -or $health -eq 'running') {
                'Green'
            }
            elseif ($health -eq 'unhealthy') {
                'Red'
            }
            else {
                'Yellow'
            }
            Write-Host "Web 容器（$WebContainerName）状态：$health" -ForegroundColor $color

            if ($health -eq 'healthy' -or $health -eq 'running') {
                Write-Host "访问地址：$(Get-WebUrl)" -ForegroundColor Cyan
            }
        }

        'build' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('build')
            Write-Host "构建完成：$(Join-Path $MonorepoRoot 'packages')" -ForegroundColor Green
        }

        'package' {
            Assert-NodePrerequisites
            Remove-ElectronNodeMode
            Invoke-Pnpm -PnpmArgs @('package')
            Write-Host "免安装版输出：$(Split-Path -Parent $PackagedExe)" -ForegroundColor Green
        }

        'make' {
            Assert-NodePrerequisites
            Remove-ElectronNodeMode
            Invoke-Pnpm -PnpmArgs @('make')
            Write-Host "安装包输出：$InstallerDir" -ForegroundColor Green
        }

        'smoke' {
            Assert-NodePrerequisites
            Remove-ElectronNodeMode
            Invoke-Smoke
            Write-Host "截图输出：$(Join-Path $MonorepoRoot 'scripts/.smoke')" -ForegroundColor Green
        }

        'verify' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('lint')
            Invoke-Pnpm -PnpmArgs @('typecheck')
            Invoke-Pnpm -PnpmArgs @('test')
            Invoke-Pnpm -PnpmArgs @('validate')
            Write-Host '校验全部通过：lint / typecheck / test / validate。' -ForegroundColor Green
        }

        'lint' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('lint')
        }

        'test' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('test')
        }

        'typecheck' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('typecheck')
        }

        'validate' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('validate')
        }

        'assets' {
            Assert-NodePrerequisites
            Invoke-Pnpm -PnpmArgs @('assets')
            Write-Host '占位资源已重新生成。' -ForegroundColor Green
        }

        'clean' {
            Assert-NodePrerequisites
            Confirm-Destructive -Message '将删除 dist、.vite、out 等构建产物（源码与内容包不受影响）。'
            Invoke-Pnpm -PnpmArgs @('clean')
            Write-Host '构建产物已清理。' -ForegroundColor Green
        }

        'reset-saves' {
            if (-not (Test-Path -LiteralPath $StorageFile)) {
                Write-Host '没有可清理的本地存档。' -ForegroundColor Yellow
                exit 0
            }

            Confirm-Destructive -Message '将删除本地存档、已读标记与设置（不可恢复）。'
            Remove-Item -LiteralPath $StorageFile -Force
            Write-Host "已删除：$StorageFile" -ForegroundColor Green
        }

        'output' {
            $target = if (Test-Path -LiteralPath $InstallerDir) {
                $InstallerDir
            }
            elseif (Test-Path -LiteralPath $OutputRoot) {
                $OutputRoot
            }
            else {
                throw '尚未生成任何打包产物，请先执行：pwsh ./manage.ps1 package'
            }
            Start-Process -FilePath 'explorer.exe' -ArgumentList $target
        }
    }
}
catch {
    Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
