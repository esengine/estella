param(
    [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
    [Parameter(Mandatory = $true)][string]$BlenderSkillsRoot,
    [string]$GeometryLibraries = 'D:\tmp\qinglan-blender-python',
    [switch]$SkipReviewRenders
)
$ErrorActionPreference = 'Stop'
$env:BLENDER_SKILLS_ROOT = (Resolve-Path -LiteralPath $BlenderSkillsRoot).Path
$env:QINGLAN_SKIP_PREVIEW = '1'
$env:QINGLAN_GEOMETRY_LIBS = (Resolve-Path -LiteralPath $GeometryLibraries).Path
$stages = @('01_body.py','02_probe.py','03_character.py','04_details.py','05_materials.py','10_hair_contact.py','06_verify_export.py')
if (-not $SkipReviewRenders) { $stages += @('07_render.py','09_human_review.py','11_topology_review.py') }
$stages += '08_roundtrip.py'
foreach ($stage in $stages) {
    & $Blender --background --factory-startup --python-exit-code 1 --python (Join-Path $PSScriptRoot $stage)
    if ($LASTEXITCODE -ne 0) { throw "Blender stage failed: $stage ($LASTEXITCODE)" }
}
