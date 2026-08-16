$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-RequiredEnvironment([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required launcher release environment value is missing: $Name"
  }
  return $value.Trim()
}

function Assert-Sha256([string]$Value, [string]$Label) {
  if ($Value -notmatch "^[a-fA-F0-9]{64}$") {
    throw "$Label must be a SHA-256 value."
  }
}

function Assert-TrustedFile(
  [string]$FilePath,
  [string]$ExpectedSha256,
  [string]$Label
) {
  if (-not [IO.Path]::IsPathFullyQualified($FilePath)) {
    throw "$Label path must be absolute."
  }
  Assert-Sha256 $ExpectedSha256 "$Label hash"
  $item = Get-Item -LiteralPath $FilePath -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "$Label must be a regular, non-reparse file: $FilePath"
  }
  $actual = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
  if ($actual -ine $ExpectedSha256) {
    throw "$Label hash does not match the reviewed toolchain."
  }
  return $item.FullName
}

function Get-ReviewedTreeDigest([string]$RootPath) {
  $rootItem = Get-Item -LiteralPath $RootPath -Force
  if (-not $rootItem.PSIsContainer -or
      ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Reviewed npm root must be a regular directory."
  }
  $root = $rootItem.FullName.TrimEnd("\")
  $files = [Collections.Generic.List[string]]::new()
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reviewed npm tree contains a reparse point: $($entry.FullName)"
      }
      if ($entry.PSIsContainer) {
        $pending.Push($entry.FullName)
      } else {
        $files.Add($entry.FullName)
      }
    }
  }
  $ordered = $files.ToArray()
  [Array]::Sort($ordered, [StringComparer]::Ordinal)
  $manifest = [Text.StringBuilder]::new()
  foreach ($file in $ordered) {
    $relative = $file.Substring($root.Length + 1).Replace("\", "/")
    $length = (Get-Item -LiteralPath $file -Force).Length
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$manifest.Append($relative).Append([char]0).Append($length).
      Append([char]0).Append($hash).Append("`n")
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($manifest.ToString())
    $digest = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  return @{ FileCount = $ordered.Length; Sha256 = $digest }
}

function Invoke-External([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Launcher release command failed with exit code ${LASTEXITCODE}: $Executable"
  }
}

$releaseAction = Read-RequiredEnvironment "ARENZYRA_LAUNCHER_RELEASE_ACTION"
if ($releaseAction -notin @("verify", "stage")) {
  throw "ARENZYRA_LAUNCHER_RELEASE_ACTION must be verify or stage."
}
$reviewedCommit = (Read-RequiredEnvironment "ARENZYRA_REVIEWED_ROOT_COMMIT").ToLowerInvariant()
if ($reviewedCommit -notmatch "^[a-f0-9]{40}$") {
  throw "ARENZYRA_REVIEWED_ROOT_COMMIT must be one full commit."
}
$sourceRoot = Read-RequiredEnvironment "ARENZYRA_RELEASE_SOURCE_ROOT"
$outerGitPath = Read-RequiredEnvironment "ARENZYRA_TRUSTED_GIT_PATH"
$outerGitSha256 = Read-RequiredEnvironment "ARENZYRA_TRUSTED_GIT_SHA256"
$stageRoot = [Environment]::GetEnvironmentVariable(
  "ARENZYRA_LAUNCHER_STAGING_ROOT",
  "Process"
)

foreach ($name in @(
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "CSC_LINK",
  "CSC_NAME",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD"
)) {
  [Environment]::SetEnvironmentVariable($name, $null, "Process")
}
foreach ($entry in Get-ChildItem Env:) {
  if ($entry.Name -match "^GIT_" -or $entry.Name -match "^npm_config_") {
    [Environment]::SetEnvironmentVariable($entry.Name, $null, "Process")
  }
}
$env:GIT_CONFIG_NOSYSTEM = "1"
$env:GIT_CONFIG_GLOBAL = "NUL"
$env:GIT_NO_REPLACE_OBJECTS = "1"
$env:GIT_OPTIONAL_LOCKS = "0"

$outerGitPath = Assert-TrustedFile $outerGitPath $outerGitSha256 "Outer Git"
$toolchainText = & $outerGitPath `
  -c core.fsmonitor=false `
  -c core.hooksPath=NUL `
  -C $sourceRoot `
  show "${reviewedCommit}:apps/desktop/release/release-toolchain.json"
if ($LASTEXITCODE -ne 0) {
  throw "Could not load the reviewed launcher toolchain policy."
}
$toolchain = ($toolchainText -join "`n") | ConvertFrom-Json
$windowsTools = $toolchain.windowsRelease
if ($toolchain.schemaVersion -ne 1 -or $null -eq $windowsTools) {
  throw "Reviewed launcher toolchain policy is incomplete."
}
if ($windowsTools.git.path -ine $outerGitPath -or
    $windowsTools.git.sha256 -ine $outerGitSha256) {
  throw "Outer Git identity differs from the reviewed launcher policy."
}

$gitPath = Assert-TrustedFile $windowsTools.git.path $windowsTools.git.sha256 "Git"
$nodePath = Assert-TrustedFile $windowsTools.node.path $windowsTools.node.sha256 "Node"
$powerShellPath = Assert-TrustedFile `
  $windowsTools.powershell.path `
  $windowsTools.powershell.sha256 `
  "Windows PowerShell"
$npmCliPath = Assert-TrustedFile `
  $windowsTools.npm.cliPath `
  (Get-FileHash -LiteralPath $windowsTools.npm.cliPath -Algorithm SHA256).Hash `
  "npm CLI"
$npmTree = Get-ReviewedTreeDigest $windowsTools.npm.rootPath
if ($npmTree.FileCount -ne $windowsTools.npm.treeFileCount -or
    $npmTree.Sha256 -ine $windowsTools.npm.treeSha256) {
  throw "Installed npm tree differs from the reviewed launcher policy."
}

$gitVersion = (& $gitPath --version) -replace "^git version\s+", ""
$nodeVersion = (& $nodePath --version).TrimStart("v")
$npmVersion = (& $nodePath $npmCliPath --version)
$powerShellVersion = (& $powerShellPath -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()')
if ($gitVersion -ne $windowsTools.git.version -or
    $nodeVersion -ne $windowsTools.node.version -or
    $npmVersion -ne $windowsTools.npm.version -or
    $powerShellVersion -ne $windowsTools.powershell.version) {
  throw "Installed launcher tool versions differ from the reviewed policy."
}

if (-not [IO.Path]::IsPathFullyQualified($sourceRoot) -or
    -not (Test-Path -LiteralPath (Join-Path $sourceRoot ".git"))) {
  throw "Launcher release source root must be an absolute Git checkout."
}
if ($releaseAction -eq "stage" -and
    ([string]::IsNullOrWhiteSpace($stageRoot) -or
     -not [IO.Path]::IsPathFullyQualified($stageRoot))) {
  throw "ARENZYRA_LAUNCHER_STAGING_ROOT must be absolute for staging."
}
$buildParent = Join-Path $env:ProgramData "Arenzyra\launcher-release-builds"
New-Item -ItemType Directory -Path $buildParent -Force | Out-Null
$buildParentItem = Get-Item -LiteralPath $buildParent -Force
if (-not $buildParentItem.PSIsContainer -or
    ($buildParentItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw "Launcher release build root must be a regular directory."
}
$checkoutRoot = Join-Path $buildParent ("checkout-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $checkoutRoot | Out-Null

$env:PATH = (@(
  (Split-Path -Parent $nodePath),
  (Split-Path -Parent $gitPath),
  "$env:SystemRoot\System32",
  "$env:SystemRoot"
) -join ";")

Invoke-External $gitPath @("-c", "core.hooksPath=NUL", "init", $checkoutRoot)
Invoke-External $gitPath @(
  "-c", "core.hooksPath=NUL",
  "-C", $checkoutRoot,
  "fetch", "--no-tags", "--depth=1", $sourceRoot, $reviewedCommit
)
Invoke-External $gitPath @(
  "-c", "core.hooksPath=NUL",
  "-C", $checkoutRoot,
  "checkout", "--detach", $reviewedCommit
)

Push-Location $checkoutRoot
try {
  Invoke-External $gitPath @(
    "-c", "core.hooksPath=NUL",
    "-C", $checkoutRoot,
    "fsck", "--full", "--no-dangling"
  )
  Invoke-External $nodePath @(
    $npmCliPath,
    "ci", "--include=dev", "--no-audit", "--no-fund"
  )
  Invoke-External $nodePath @(
    $npmCliPath,
    "--prefix", "apps/desktop", "run", "build:electron"
  )

  $attestation = @{
    schemaVersion = 1
    reviewedCommit = $reviewedCommit
    checkoutRoot = $checkoutRoot
    gitPath = $gitPath
    gitSha256 = $windowsTools.git.sha256
    nodeSha256 = $windowsTools.node.sha256
  } | ConvertTo-Json -Compress
  $env:ARENZYRA_LAUNCHER_RELEASE_ATTESTATION = $attestation
  if ($releaseAction -eq "stage") {
    $env:ARENZYRA_LAUNCHER_STAGING_ROOT = $stageRoot
  } else {
    [Environment]::SetEnvironmentVariable(
      "ARENZYRA_LAUNCHER_STAGING_ROOT",
      $null,
      "Process"
    )
  }
  Invoke-External $nodePath @(
    (Join-Path $checkoutRoot "scripts\run-reviewed-launcher-release.cjs"),
    $releaseAction
  )
} finally {
  Pop-Location
}

Write-Output "Reviewed launcher checkout retained for audit: $checkoutRoot"
