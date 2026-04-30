param(
  [switch] $Strict
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Get-VersionFromJsonFile {
  param([string] $Path)
  return [string] ((Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json).version)
}

function Get-VersionFromToml {
  param([string] $Path)
  $match = Select-String -LiteralPath $Path -Pattern '^\s*version\s*=\s*"([^"]+)"' | Select-Object -First 1
  if (-not $match) { return $null }
  return $match.Matches[0].Groups[1].Value
}

function Test-Command {
  param([string] $Name)
  return [bool] (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-RustTool {
  param([string] $Name)
  $exe = Join-Path $env:USERPROFILE ".cargo\\bin\\$Name.exe"
  if (Test-Path -LiteralPath $exe) {
    return $true
  }
  return Test-Command $Name
}

$versions = [ordered]@{
  package = Get-VersionFromJsonFile 'package.json'
  cargo = Get-VersionFromToml 'src-tauri/Cargo.toml'
  tauri = Get-VersionFromJsonFile 'src-tauri/tauri.conf.json'
}

$issues = New-Object System.Collections.Generic.List[string]

Write-Host 'Version check:'
foreach ($entry in $versions.GetEnumerator()) {
  Write-Host "  $($entry.Key): $($entry.Value)"
}

if (($versions.Values | Select-Object -Unique).Count -ne 1) {
  $issues.Add('Versions are not aligned across package.json, Cargo.toml, and tauri.conf.json.')
}

Write-Host ''
Write-Host 'Tool check:'
$tools = @('git', 'npm.cmd')
foreach ($tool in $tools) {
  $ok = Test-Command $tool
  Write-Host ("  {0}: {1}" -f $tool, ($(if ($ok) { 'ok' } else { 'missing' })))
  if (-not $ok) {
    $issues.Add("Missing tool: $tool")
  }
}

$rustCargoOk = Test-RustTool 'cargo'
$rustcOk = Test-RustTool 'rustc'
Write-Host ("  cargo: {0}" -f ($(if ($rustCargoOk) { 'ok' } else { 'missing' })))
Write-Host ("  rustc: {0}" -f ($(if ($rustcOk) { 'ok' } else { 'missing' })))
if (-not $rustCargoOk) { $issues.Add('Missing tool: cargo') }
if (-not $rustcOk) { $issues.Add('Missing tool: rustc') }

$ffmpegOk = Test-Command 'ffmpeg'
Write-Host ("  ffmpeg: {0}" -f ($(if ($ffmpegOk) { 'ok' } else { 'missing (runtime export only)' })))

Write-Host ''
Write-Host 'Git status:'
$status = git status --short
if ($LASTEXITCODE -ne 0) {
  throw 'git status failed.'
}
if ($status) {
  Write-Host $status
  $issues.Add('Working tree is not clean.')
} else {
  Write-Host '  clean'
}

Write-Host ''
if ($issues.Count -eq 0) {
  Write-Host 'Precheck passed.'
  return
}

Write-Host 'Precheck failed:'
foreach ($issue in $issues) {
  Write-Host "  - $issue"
}

if ($Strict) {
  throw 'Precheck failed.'
}

exit 1
