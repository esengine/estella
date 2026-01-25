# ESEngine Documentation Build Script (Windows PowerShell)
# Usage: .\build.ps1 [dev|build|all]

param(
    [string]$Command = "all"
)

$ErrorActionPreference = "Stop"
$DocsRoot = $PSScriptRoot

function Write-Header {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Build-Doxygen {
    Write-Header "Building Doxygen API Documentation"

    Push-Location $DocsRoot
    try {
        if (!(Get-Command doxygen -ErrorAction SilentlyContinue)) {
            Write-Host "ERROR: Doxygen not found. Please install it first." -ForegroundColor Red
            Write-Host "  Windows: choco install doxygen.install" -ForegroundColor Yellow
            Write-Host "  Or download from: https://www.doxygen.nl/download.html" -ForegroundColor Yellow
            exit 1
        }

        doxygen Doxyfile

        Write-Host "Doxygen build complete: docs/api/html/" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

function Build-Astro {
    Write-Header "Building Astro Documentation Site"

    Push-Location "$DocsRoot\astro"
    try {
        if (!(Test-Path "node_modules")) {
            Write-Host "Installing dependencies..." -ForegroundColor Yellow
            npm install
        }

        npm run build

        Write-Host "Astro build complete: docs/astro/dist/" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

function Sync-ApiDocs {
    Write-Host "Syncing Doxygen API docs to Astro public..." -ForegroundColor Yellow

    $ApiSource = "$DocsRoot\api\html"
    $ApiDest = "$DocsRoot\astro\public\api\html"

    if (Test-Path $ApiSource) {
        New-Item -ItemType Directory -Force -Path "$DocsRoot\astro\public\api" | Out-Null
        Copy-Item -Recurse -Force "$ApiSource\*" $ApiDest
        Write-Host "API docs synced." -ForegroundColor Green
    } else {
        Write-Host "No API docs found. Run '.\build.ps1 doxygen' first." -ForegroundColor Yellow
    }
}

function Start-Dev {
    Write-Header "Starting Astro Dev Server"

    # Sync API docs before starting dev server
    Sync-ApiDocs

    Push-Location "$DocsRoot\astro"
    try {
        if (!(Test-Path "node_modules")) {
            Write-Host "Installing dependencies..." -ForegroundColor Yellow
            npm install
        }

        Write-Host "Starting dev server at http://localhost:4321" -ForegroundColor Green
        npm run dev
    }
    finally {
        Pop-Location
    }
}

function Merge-Output {
    Write-Header "Merging Documentation Output"

    $OutputDir = "$DocsRoot\dist"

    # Clean output directory
    if (Test-Path $OutputDir) {
        Remove-Item -Recurse -Force $OutputDir
    }
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

    # Copy Astro output
    if (Test-Path "$DocsRoot\astro\dist") {
        Copy-Item -Recurse "$DocsRoot\astro\dist\*" $OutputDir
    }

    # Copy Doxygen output
    if (Test-Path "$DocsRoot\api\html") {
        New-Item -ItemType Directory -Force -Path "$OutputDir\api\html" | Out-Null
        Copy-Item -Recurse "$DocsRoot\api\html\*" "$OutputDir\api\html\"
    }

    Write-Host "Documentation merged to: docs/dist/" -ForegroundColor Green
}

# Main
switch ($Command.ToLower()) {
    "dev" {
        Start-Dev
    }
    "doxygen" {
        Build-Doxygen
    }
    "astro" {
        Build-Astro
    }
    "build" {
        Build-Doxygen
        Build-Astro
        Merge-Output
    }
    "all" {
        Build-Doxygen
        Build-Astro
        Merge-Output
    }
    default {
        Write-Host "Usage: .\build.ps1 [command]" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Commands:" -ForegroundColor Yellow
        Write-Host "  dev      Start Astro dev server"
        Write-Host "  doxygen  Build only Doxygen API docs"
        Write-Host "  astro    Build only Astro site"
        Write-Host "  build    Build everything"
        Write-Host "  all      Build everything (default)"
    }
}
