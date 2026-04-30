param(
  [ValidateSet('patch', 'minor', 'major')]
  [string] $Increment = 'patch'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

Write-Host 'Running precheck...'
& .\scripts\release-precheck.ps1 -Strict

Write-Host "Bumping version ($Increment)..."
& .\scripts\bump-version.ps1 -Increment $Increment

Write-Host 'Running tests...'
npm.cmd test
if ($LASTEXITCODE -ne 0) {
  throw 'Tests failed.'
}

Write-Host 'Running lint...'
npm.cmd run lint
if ($LASTEXITCODE -ne 0) {
  throw 'Lint failed.'
}

Write-Host 'Building installer...'
& .\scripts\build-installer.ps1

Write-Host 'Creating release commit...'
& .\scripts\release-commit.ps1

Write-Host 'Creating git tag...'
& .\scripts\release-tag.ps1
