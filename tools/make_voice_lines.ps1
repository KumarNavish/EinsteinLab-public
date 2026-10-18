# Generates Einstein's voice lines with Windows' built-in offline speech engine (System.Speech).
# 1. In Unity: MRDemo > 3a. Export Lines for TTS   (writes tools/voice_lines.txt from the Inspector text)
# 2. Right-click this file > Run with PowerShell    (or: powershell -ExecutionPolicy Bypass -File make_voice_lines.ps1)
# 3. In Unity: MRDemo > 3b. Assign Voice Lines      (drops Assets/Audio/Voice/Line01..NN.wav into the script)
#
# A German voice reading English gives the accent. Windows ships "Microsoft Hedda"/"Stefan"/"Katja" with the
# German language pack (Settings > Time & Language > Language > Add German > Speech). Without one, David/Mark is used.

param(
    [string]$Voice = "",            # e.g. "Microsoft Stefan"; empty = auto (German if available)
    [int]$Rate = -1,                # -10..10; Einstein is not in a hurry
    [string]$Lines = "$PSScriptRoot\voice_lines.txt",
    [string]$Out = "$PSScriptRoot\..\Assets\Audio\Voice"
)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

$installed = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
Write-Host "Installed voices:"; $installed | ForEach-Object { Write-Host ("  {0}  ({1})" -f $_.Name, $_.Culture) }

if ($Voice -eq "") {
    $pick = $installed | Where-Object { $_.Culture.Name -like "de-*" -and $_.Gender -eq "Male" } | Select-Object -First 1
    if (-not $pick) { $pick = $installed | Where-Object { $_.Culture.Name -like "de-*" } | Select-Object -First 1 }
    if (-not $pick) { $pick = $installed | Where-Object { $_.Gender -eq "Male" } | Select-Object -First 1 }
    if (-not $pick) { $pick = $installed | Select-Object -First 1 }
    $Voice = $pick.Name
}
Write-Host "Using voice: $Voice"
$synth.SelectVoice($Voice)
$synth.Rate = $Rate

if (-not (Test-Path $Lines)) { Write-Error "No $Lines - run MRDemo > 3a. Export Lines for TTS in Unity first."; exit 1 }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$i = 0
foreach ($text in Get-Content $Lines -Encoding UTF8) {
    if ($text.Trim() -eq "") { continue }
    $i++
    $file = Join-Path $Out ("Line{0:D2}.wav" -f $i)
    $synth.SetOutputToWaveFile($file)
    $synth.Speak($text)
    $synth.SetOutputToNull()
    Write-Host ("Line{0:D2}.wav  <- {1}" -f $i, $text.Substring(0, [Math]::Min(60, $text.Length)))
}
$synth.Dispose()
Write-Host "Done: $i clips in $Out. Now run MRDemo > 3b. Assign Voice Lines in Unity."
