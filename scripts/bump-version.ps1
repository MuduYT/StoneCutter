param(
  [string] $Version,
  [ValidateSet('patch', 'minor', 'major')]
  [string] $Increment
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Get-CurrentVersion {
  $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  return [string] $package.version
}

function Get-NextVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Current,
    [Parameter(Mandatory = $true)]
    [ValidateSet('patch', 'minor', 'major')]
    [string] $Kind
  )

  if ($Current -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$') {
    throw "Version '$Current' is not a valid semver string."
  }

  $major = [int] $Matches[1]
  $minor = [int] $Matches[2]
  $patch = [int] $Matches[3]

  switch ($Kind) {
    'patch' { $patch += 1 }
    'minor' { $minor += 1; $patch = 0 }
    'major' { $major += 1; $minor = 0; $patch = 0 }
  }

  return "$major.$minor.$patch"
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  if ([string]::IsNullOrWhiteSpace($Increment)) {
    throw 'Pass either -Version or -Increment.'
  }
  $Version = Get-NextVersion -Current (Get-CurrentVersion) -Kind $Increment
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version '$Version' is not a valid semver string."
}

$files = @(
  'package.json',
  'package-lock.json',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json'
)

foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw "Missing file: $file"
  }
}

function Replace-Version {
  param(
    [string] $Path,
    [string] $Pattern,
    [string] $Replacement
  )

  $content = Get-Content -LiteralPath $Path -Raw
  if ($content -notmatch $Pattern) {
    throw "Could not find version pattern in $Path"
  }
  $updated = [regex]::Replace($content, $Pattern, $Replacement, 1)
  Set-Content -LiteralPath $Path -Value $updated -NoNewline
}

Replace-Version -Path 'package.json' -Pattern '"version":\s*"[^"]+"' -Replacement "`"version`": `"$Version`""
Replace-Version -Path 'package-lock.json' -Pattern '"version":\s*"[^"]+"' -Replacement "`"version`": `"$Version`""
Replace-Version -Path 'src-tauri/Cargo.toml' -Pattern '(?m)^version\s*=\s*"[^"]+"' -Replacement "version = `"$Version`""
Replace-Version -Path 'src-tauri/tauri.conf.json' -Pattern '"version":\s*"[^"]+"' -Replacement "`"version`": `"$Version`""

$changelogPath = 'CHANGELOG.md'
$changelog = Get-Content -LiteralPath $changelogPath -Raw
$today = Get-Date -Format 'yyyy-MM-dd'
$header = "## $today - Release $Version"
if ($changelog -notmatch [regex]::Escape($header)) {
  $entry = @"

$header

### Release
- Version bump auf $Version.
"@
  $changelog = $changelog -replace "^# StoneCutter Update Log\r?\n", "# StoneCutter Update Log`r`n$entry`r`n"
  Set-Content -LiteralPath $changelogPath -Value $changelog -NoNewline
}

Write-Host "Bumped release version to $Version"
