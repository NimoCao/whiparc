# Builds the Whiparc CLI Windows installer (whiparc-setup-windows-amd64.exe)
# on a local Windows dev machine, without needing CI. Requires NSIS
# (makensis) on PATH — install it with either:
#
#   winget install --id NSIS.NSIS
#   choco install nsis
#
# Usage (from the repo root):
#   ./installers/windows/build-local.ps1
#   ./installers/windows/build-local.ps1 -Version 1.2.3

param(
    [string]$Version = "0.0.0-dev"
)

$ErrorActionPreference = "Stop"

$makensis = Get-Command makensis -ErrorAction SilentlyContinue
if (-not $makensis) {
    Write-Host "makensis not found on PATH. Install NSIS first: choco install nsis" -ForegroundColor Red
    exit 1
}

$repoRoot = Resolve-Path "$PSScriptRoot/../.."
$binaryPath = Join-Path $repoRoot "whiparc-windows-amd64.exe"

# VERSIONINFO needs a strict X.X.X.X number: strip any prerelease/build suffix.
$versionCore = ($Version -split '[-+]')[0]
$versionNumeric = "$versionCore.0"

Write-Host "Building whiparc-windows-amd64.exe (version $Version)..."
Push-Location (Join-Path $repoRoot "apps/cli")
try {
    # Embeds the Whiparc icon + version info (same step CI runs); go build
    # links the generated .syso automatically.
    go run github.com/tc-hib/go-winres@v0.3.3 make --arch amd64 --product-version $Version --file-version $versionNumeric
    go build -ldflags="-s -w -X main.version=$Version" -o $binaryPath .
} finally {
    Remove-Item "rsrc_windows_amd64.syso" -ErrorAction SilentlyContinue
    Pop-Location
}

Write-Host "Building installer with NSIS..."
& makensis "/DVERSION=$Version" "/DVERSION_NUMERIC=$versionNumeric" "/DSOURCE_BINARY=$binaryPath" (Join-Path $repoRoot "installers/windows/whiparc.nsi")

Remove-Item $binaryPath -ErrorAction SilentlyContinue

# NSIS writes OutFile relative to the .nsi script's own directory, not this
# script's cwd — so the compiled installer lands in installers/windows/,
# not the repo root. Move it to the repo root to match what the CI workflow
# produces and what this script's own final message below claims.
$builtInstaller = Join-Path $repoRoot "installers/windows/whiparc-setup-windows-amd64.exe"
$finalPath = Join-Path $repoRoot "whiparc-setup-windows-amd64.exe"
Move-Item -Force $builtInstaller $finalPath

Write-Host "Built whiparc-setup-windows-amd64.exe" -ForegroundColor Green
