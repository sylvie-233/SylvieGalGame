<#
.SYNOPSIS
    SylvieGalGame 本地运维脚本（开发、校验、打包、冒烟测试与产物管理）。

.DESCRIPTION
    以 galgame-monorepo 为工作目录，封装常用 pnpm 命令，负责环境检查、内容校验、
    桌面端打包、NSIS 安装包生成、打包产物冒烟测试，以及本地存档清理与产物目录打开。

    脚本会自动清除当前会话中的 ELECTRON_RUN_AS_NODE 环境变量，避免 Electron 被
    误当成 Node 运行时启动（表现为 "bad option"）。

.PARAMETER Action
    要执行的操作，默认 status：
      status        查看环境、内容包、构建产物与存档状态
      doctor        检查 Node / pnpm / 依赖 / 内容包是否就绪（缺失即报错）
      dev           构建共享包并启动 Electron 开发模式
      build         Turbo 构建全部包
      package       生成免安装目录（apps/electron/out/SylvieGalGame-win32-x64/）
      make          生成 NSIS 安装包（apps/electron/out/make/）
      smoke         启动已打包应用，自动验证 UI 并截图（需先 package）
      verify        依次执行 typecheck、test、validate
      test          运行引擎单元测试
      typecheck     全仓 TypeScript 检查
      validate      加载真实剧本、跑通全部分支并检查资源与脚本警告
      assets        重新生成占位图片 / 音频 / 图标
      clean         清理 dist、.vite、out 等构建产物（需确认）
      reset-saves   删除本地存档、已读标记与设置（需确认）
      output        在资源管理器中打开打包产物目录

.PARAMETER Force
    clean / reset-saves 跳过二次确认。

.PARAMETER ExePath
    smoke 操作要启动的 exe 路径；默认使用 apps/electron/out 下的打包产物。

.EXAMPLE
    pwsh ./manage.ps1 status

.EXAMPLE
    pwsh ./manage.ps1 dev

.EXAMPLE
    pwsh ./manage.ps1 package

.EXAMPLE
    pwsh ./manage.ps1 make

.EXAMPLE
    pwsh ./manage.ps1 verify

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
        'status', 'doctor', 'dev', 'build', 'package', 'make', 'smoke',
        'verify', 'test', 'typecheck', 'validate', 'assets',
        'clean', 'reset-saves', 'output'
    )]
    [string]$Action = 'status',

    [switch]$Force,

    [string]$ExePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 统一以 UTF-8 输出，避免中文在重定向/管道中乱码
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptRoot = $PSScriptRoot
$MonorepoRoot = Join-Path $ScriptRoot 'galgame-monorepo'
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
    Write-Host '环境' -ForegroundColor Cyan
    Write-Host "  Node    $node"
    Write-Host "  pnpm    $pnpm"
    Write-Host "  仓库    $MonorepoRoot $(if (Test-Path -LiteralPath $MonorepoRoot) { '（存在）' } else { '（缺失）' })"

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
    Write-Host ''
    Write-Host '构建产物' -ForegroundColor Cyan
    Write-ArtifactStatus -Label '引擎' -Path $engineDist
    Write-ArtifactStatus -Label '播放器' -Path $playerDist
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
            Invoke-Pnpm -PnpmArgs @('typecheck')
            Invoke-Pnpm -PnpmArgs @('test')
            Invoke-Pnpm -PnpmArgs @('validate')
            Write-Host '校验全部通过：typecheck / test / validate。' -ForegroundColor Green
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
