$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Assert-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Resolve-RustTool {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  $candidate = Join-Path $env:USERPROFILE ".cargo\\bin\\$Name.exe"
  if (Test-Path -LiteralPath $candidate) {
    return $candidate
  }

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Command,
    [Parameter(Mandatory = $true)]
    [string[]] $Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command '$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
  }
}

Assert-Command -Name 'npm.cmd'

$cargoPath = Resolve-RustTool -Name 'cargo'
if (-not $cargoPath) {
  throw "Required command 'cargo' was not found in PATH or in $env:USERPROFILE\.cargo\bin."
}

$rustcPath = Resolve-RustTool -Name 'rustc'
if (-not $rustcPath) {
  throw "Required command 'rustc' was not found in PATH or in $env:USERPROFILE\.cargo\bin."
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
  Write-Host 'Installing Node dependencies...'
  Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('install')
}

Write-Host 'Running tests...'
Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('test')

Write-Host 'Running lint...'
Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('run', 'lint')

Write-Host 'Building Windows installer...'
Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('run', 'installer:win')

Write-Host ''
Write-Host 'Done.'
Write-Host 'Installer output: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/'
