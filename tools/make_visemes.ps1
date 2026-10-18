# Generates phoneme lip-sync cue tracks (LineNN.json) for the voice clips with Rhubarb Lip Sync.
# Run this whenever the WAVs change, then MRDemo > 3b. Assign Voice Lines in Unity.
#
# One-time: download Rhubarb for Windows from https://github.com/DanielSWolf/rhubarb-lip-sync/releases
# (Rhubarb-Lip-Sync-1.14.0-Windows.zip), unzip it, and point -Rhubarb at rhubarb.exe (or put it in tools\rhubarb\).

param(
    [string]$Rhubarb = "$PSScriptRoot\rhubarb\rhubarb.exe",
    [string]$Lines = "$PSScriptRoot\voice_lines.txt",
    [string]$Voice = "$PSScriptRoot\..\Assets\Audio\Voice"
)

if (-not (Test-Path $Rhubarb)) { Write-Error "rhubarb.exe not found at $Rhubarb"; exit 1 }
if (-not (Test-Path $Lines)) { Write-Error "No $Lines - run MRDemo > 3a. Export Lines for TTS first."; exit 1 }

$i = 0
foreach ($text in Get-Content $Lines -Encoding UTF8) {
    if ($text.Trim() -eq "") { continue }
    $i++
    $name = "Line{0:D2}" -f $i
    $wav = Join-Path $Voice "$name.wav"
    if (-not (Test-Path $wav)) { Write-Warning "$wav missing, skipped"; continue }
    $dialog = Join-Path $env:TEMP "$name.txt"
    [IO.File]::WriteAllText($dialog, $text)
    # -d: the spoken text improves phoneme recognition a lot. --extendedShapes GHX: use F/V, L and rest shapes.
    & $Rhubarb -f json -d $dialog --extendedShapes GHX -o (Join-Path $Voice "$name.json") $wav
    Write-Host "$name.json"
}
Write-Host "Done. Now run MRDemo > 3b. Assign Voice Lines in Unity."
