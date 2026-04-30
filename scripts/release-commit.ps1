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

$message = "chore(release): v$Version"
$paths = @(
  'package.json',
  'package-lock.json',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'CHANGELOG.md',
  'README.md'
)

git add -- $paths
if ($LASTEXITCODE -ne 0) {
  throw 'git add failed.'
}

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'No staged changes to commit.'
  return
}

git commit -m $message
if ($LASTEXITCODE -ne 0) {
  throw 'git commit failed.'
}

Write-Host "Created release commit: $message"
