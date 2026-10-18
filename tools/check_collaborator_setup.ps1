# Read-only checks for a downloaded checkout. Does not inspect either credential file.
# Run from the project root: powershell -NoProfile -File .\tools\check_collaborator_setup.ps1
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$problems = New-Object System.Collections.Generic.List[string]
$required = @(
    'ProjectSettings/ProjectVersion.txt',
    'Packages/manifest.json',
    'Packages/packages-lock.json',
    'Packages/com.hecomi.ulipsync/package.json',
    'Packages/com.hecomi.ulipsync/Runtime/uLipSync.cs',
    'Packages/com.hecomi.ulipsync/LICENSE.md',
    'Assets/Scenes/SampleScene.unity',
    'Assets/Albert Einstein_blender.fbx',
    'Assets/Animation/Einstein.controller',
    'Assets/Animation/Einstein_Talk.anim',
    'Assets/Animation/Einstein_Neutral.anim',
    'Assets/Animation/Einstein_WalkAway.anim',
    'Assets/LipSync/EinsteinLiveProfile.asset'
)
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative) -PathType Leaf)) {
        $problems.Add("Missing required file: $relative")
    }
}
foreach ($i in 1..6) {
    foreach ($extension in @('wav', 'json')) {
        $relative = 'Assets/Audio/Voice/Line{0:D2}.{1}' -f $i, $extension
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative) -PathType Leaf)) {
            $problems.Add("Missing prerecorded speech file: $relative")
        }
    }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $problems.Add('Git is not available. Install Git and Git LFS, then clone and run git lfs pull.')
} elseif (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
    $problems.Add('This looks like a ZIP download. Use a Git clone so all Git LFS assets can be fetched.')
} else {
    & git -C $projectRoot lfs version
    if ($LASTEXITCODE -ne 0) {
        $problems.Add('Git LFS is unavailable. Install it, run git lfs install, then git lfs pull.')
    } else {
        $lfsFiles = @(& git -C $projectRoot lfs ls-files)
        if ($LASTEXITCODE -ne 0) {
            $problems.Add('Could not inspect Git LFS files. Check Git ownership/access and try again.')
        } else {
            $pointers = @($lfsFiles | Where-Object { $_ -match '^[0-9a-f]+ - ' })
            foreach ($pointer in $pointers) { $problems.Add("LFS object not materialized: $pointer") }
        }
    }
}
$rhubarb = Join-Path $projectRoot 'tools/rhubarb/rhubarb.exe'
$dictionary = Join-Path $projectRoot 'tools/rhubarb/res/sphinx/cmudict-en-us.dict'
if (-not (Test-Path -LiteralPath $rhubarb) -or -not (Test-Path -LiteralPath $dictionary)) {
    Write-Warning 'Rhubarb executable/model data missing. Existing recordings still play; regeneration needs the complete Rhubarb distribution.'
}
if ($problems.Count -gt 0) {
    $problems | ForEach-Object { Write-Output "FAIL: $_" }
    exit 1
}
Write-Output 'PASS: required project files and local Git LFS objects are present.'
Write-Output 'Use Unity 2022.3.50f1. Open SampleScene; no generation scripts are needed for prerecorded playback.'
Write-Output 'Live TTS additionally requires local ElevenLabs configuration; credential files were not inspected.'
Write-Output 'This checks local file availability, not remote LFS uploads, Unity compilation, or headset operation.'
