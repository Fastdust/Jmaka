param(
  [string]$Configuration = "Release",
  [string]$Rid = "linux-x64"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $RepoRoot "src\Jmaka.Api\Jmaka.Api.csproj"
$OutDir = Join-Path $RepoRoot "artifacts\publish\$Rid"
$TarPath = Join-Path $RepoRoot "artifacts\jmaka-$Rid.tar.gz"

New-Item -ItemType Directory -Force -Path (Split-Path $OutDir) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $TarPath) | Out-Null

# Publish framework-dependent for linux
& dotnet publish $Project -c $Configuration -r $Rid --self-contained false -o $OutDir

# Pack
if (Test-Path $TarPath) { Remove-Item -Force $TarPath }

# tar is available on most modern Windows; if not, install it or pack via zip.
& tar -C $OutDir -czf $TarPath .

Write-Host "Created: $TarPath"
