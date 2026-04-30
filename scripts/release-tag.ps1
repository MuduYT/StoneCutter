param(
  [string] $Version
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Get-CurrentVersion {
  $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  return [string] $package.version
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = Get-CurrentVersion
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version '$Version' is not a valid semver string."
}

$tag = "v$Version"

git rev-parse --verify --quiet "refs/tags/$tag" | Out-Null
if ($LASTEXITCODE -eq 0) {
  throw "Git tag '$tag' already exists."
}

git tag -a $tag -m "StoneCutter $tag"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create git tag '$tag'."
}

Write-Host "Created git tag $tag"
