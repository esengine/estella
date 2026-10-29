param(
    [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
    [string]$SourceBundle = 'D:\tmp\blender-human-base-v1.4.1\source\human-base-meshes-bundle-v1.4.1\human_base_meshes_bundle.blend',
    [string]$SkillsRoot = "$env:USERPROFILE\.codex\skills",
    [string]$PlotModules = 'D:\tmp\qinglan-face-plot'
)
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath $SourceBundle)) { throw "Missing source bundle: $SourceBundle" }
$env:BLENDER_HUMAN_BASE_BUNDLE=$SourceBundle
$env:SCENARIO_SKILLS_ROOT=$SkillsRoot
foreach ($stage in @('build_face.py','verify_review.py')) {
    & $Blender --background --factory-startup --python-exit-code 1 --python (Join-Path $PSScriptRoot $stage)
    if ($LASTEXITCODE -ne 0) { throw "Blender stage failed: $stage" }
}
if (Test-Path -LiteralPath $PlotModules) { $env:PYTHONPATH=$PlotModules }
python (Join-Path $PSScriptRoot 'compose_review.py')
if ($LASTEXITCODE -ne 0) { throw 'Review sheet generation failed' }
