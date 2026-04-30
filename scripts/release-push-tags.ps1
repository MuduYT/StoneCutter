param(
  [string] $Remote = 'origin'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

git push --follow-tags $Remote
if ($LASTEXITCODE -ne 0) {
  throw "git push --follow-tags $Remote failed."
}

Write-Host "Pushed branch and tags to $Remote"
