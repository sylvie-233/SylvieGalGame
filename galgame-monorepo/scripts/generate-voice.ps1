# 生成占位语音：使用 Windows 内置中文语音合成，输出短促的气声 / 应答。
# 这些文件只是氛围占位；替换为正式配音时保持文件名不变即可。
param(
    [string]$VoiceName = 'Microsoft Huihui Desktop'
)

Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$voiceDir = Join-Path $root 'packages/game-content/game/audio/voice'
$null = New-Item -ItemType Directory -Force -Path $voiceDir

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SelectVoice($VoiceName)
} catch {
    Write-Warning "未找到语音 $VoiceName，使用系统默认语音。"
}
$synth.Volume = 65

# 文本、语速、音高：用极短的“嗯 / 呼吸”维持角色存在感，不朗读完整台词。
$lines = @(
    @{ File = 'sylvie_01.wav'; Text = '嗯……'; Rate = -15; Pitch = 8 },
    @{ File = 'sylvie_02.wav'; Text = '……嗯……'; Rate = -25; Pitch = 0 },
    @{ File = 'sylvie_03.wav'; Text = '嗯。'; Rate = -5; Pitch = 10 },
    @{ File = 'sylvie_04.wav'; Text = '……嗯。'; Rate = -12; Pitch = 5 },
    @{ File = 'sylvie_05.wav'; Text = '嗯……'; Rate = -30; Pitch = -5 },
    @{ File = 'narrator_01.wav'; Text = '嗯……'; Rate = -28; Pitch = -18 },
    @{ File = 'narrator_02.wav'; Text = '嗯……'; Rate = -32; Pitch = -20 }
)

foreach ($line in $lines) {
    $path = Join-Path $voiceDir $line.File
    $ssml = @"
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <prosody rate="$($line.Rate)%" pitch="$($line.Pitch)%">$($line.Text)</prosody>
</speak>
"@
    $synth.SetOutputToWaveFile($path)
    $synth.SpeakSsml($ssml)
    $synth.SetOutputToNull()
    Write-Host "  · $path"
}

$synth.Dispose()
Write-Host '语音占位生成完成。'
