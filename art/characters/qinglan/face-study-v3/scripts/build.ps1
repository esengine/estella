param(
    [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
    [string]$SkillsRoot = $env:BLENDER_SKILLS_ROOT,
    [string]$Python = 'python',
    [string]$PlotModules = ''
)
$ErrorActionPreference = 'Stop'
if (-not $SkillsRoot) { throw 'Provide -SkillsRoot pointing to the blender-skills checkout.' }
$env:BLENDER_SKILLS_ROOT = $SkillsRoot
if ($PlotModules) { $env:PYTHONPATH = $PlotModules + [IO.Path]::PathSeparator + $env:PYTHONPATH }
foreach ($scriptName in @('prepare_head.py', 'fit_cage.py', 'render_head.py', 'verify_and_wire.py')) {
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    & $Blender --background --factory-startup --python-exit-code 1 --python $scriptPath -- all eyes
    if ($LASTEXITCODE -ne 0) { throw "Blender failed: $scriptName" }
}
foreach ($scriptName in @('inspect_loops.py', 'compare_views.py')) {
    & $Python (Join-Path $PSScriptRoot $scriptName)
    if ($LASTEXITCODE -ne 0) { throw "Review figure failed: $scriptName" }
}
