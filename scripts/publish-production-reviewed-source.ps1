#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Package", "Transfer", "Activate", "SelfTest")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$BundleDirectory,

  [string]$ReleaseId,
  [string]$RootRepository,
  [string]$ApiRepository,
  [string]$WebRepository,
  [string]$CurrentRootCommit,
  [string]$CurrentApiCommit,
  [string]$CurrentWebCommit,
  [string]$TargetRootCommit,
  [string]$TargetApiCommit,
  [string]$TargetWebCommit,

  [string]$ProductionHost,
  [string]$IdentityFile,
  [string]$KnownHostsFile,

  [string]$GitExecutable = "C:\Program Files\Git\cmd\git.exe",
  [string]$BashExecutable = "C:\Program Files\Git\bin\bash.exe",
  [string]$TarExecutable = "C:\Windows\System32\tar.exe",
  [string]$SshExecutable = "C:\Windows\System32\OpenSSH\ssh.exe",
  [string]$SftpExecutable = "C:\Windows\System32\OpenSSH\sftp.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$CompatibilityRootCommit = "4d18a9ad56d738e2992d0ca7564c4f8d553865a8"
$CompatibilityApiCommit = "428ca9d6dd20c065314a1787f5de92bc4f9d8646"
$CompatibilityWebCommit = "2ee104f6fcc22ef0b37a5c1f8b0b42df2ad076aa"
$SafeRemotePath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false, $true)

function Stop-SourcePublish {
  param([string]$Message)
  throw "REVIEWED SOURCE PUBLISH BLOCKED: $Message"
}

function Assert-CanonicalCommit {
  param([string]$Value, [string]$Label)
  if ($Value -notmatch "^[0-9a-f]{40}$") {
    Stop-SourcePublish "$Label commit is missing or invalid."
  }
}

function Assert-CanonicalHash {
  param([string]$Value, [string]$Label)
  if ($Value -notmatch "^[0-9a-f]{64}$") {
    Stop-SourcePublish "$Label SHA-256 is missing or invalid."
  }
}

function Assert-CompatibilityInputs {
  param([string]$RootCommit, [string]$ApiCommit, [string]$WebCommit)
  if ($RootCommit -ceq $CompatibilityRootCommit -and (
    $ApiCommit -cne $CompatibilityApiCommit -or
    $WebCommit -cne $CompatibilityWebCommit
  )) {
    Stop-SourcePublish "the one-time compatibility Root requires its exact production API/Web commits."
  }
}

function Resolve-ExactFile {
  param([string]$Path, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    Stop-SourcePublish "$Label path is required."
  }
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not [IO.File]::Exists($resolved)) {
    Stop-SourcePublish "$Label file is unavailable: $resolved"
  }
  $attributes = [IO.File]::GetAttributes($resolved)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-SourcePublish "$Label file must not be a reparse point: $resolved"
  }
  return $resolved
}

function Resolve-ExactDirectory {
  param([string]$Path, [string]$Label, [switch]$MustExist)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    Stop-SourcePublish "$Label path is required."
  }
  $resolved = [IO.Path]::GetFullPath($Path)
  if ($MustExist) {
    if (-not [IO.Directory]::Exists($resolved)) {
      Stop-SourcePublish "$Label directory is unavailable: $resolved"
    }
    $attributes = [IO.File]::GetAttributes($resolved)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      Stop-SourcePublish "$Label directory must not be a reparse point: $resolved"
    }
  }
  return $resolved.TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function ConvertTo-NativeArgument {
  param([string]$Value)
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes += 1
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes))
      $backslashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) {
    [void]$builder.Append(('\' * ($backslashes * 2)))
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Invoke-SanitizedProcess {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [byte[]]$StandardInputBytes,
    [int[]]$AllowedExitCodes = @(0)
  )
  $program = Resolve-ExactFile $Executable "executable"
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $program
  $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = $Utf8NoBom
  $start.StandardErrorEncoding = $Utf8NoBom
  $start.EnvironmentVariables.Clear()
  foreach ($name in @("SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "ProgramFiles", "ProgramFiles(x86)", "ProgramData")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrEmpty($value)) { $start.EnvironmentVariables[$name] = $value }
  }
  $start.EnvironmentVariables["PATH"] = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
  $start.EnvironmentVariables["GIT_CONFIG_NOSYSTEM"] = "1"
  $start.EnvironmentVariables["GIT_CONFIG_GLOBAL"] = "NUL"
  $start.EnvironmentVariables["GIT_NO_REPLACE_OBJECTS"] = "1"
  $start.EnvironmentVariables["GIT_OPTIONAL_LOCKS"] = "0"

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { Stop-SourcePublish "failed to start $program." }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if ($null -ne $StandardInputBytes -and $StandardInputBytes.Length -gt 0) {
    # Binary BaseStream writes are deliberate. A PowerShell string pipeline can
    # rewrite LF as CRLF and must never transport a production shell payload.
    $process.StandardInput.BaseStream.Write($StandardInputBytes, 0, $StandardInputBytes.Length)
  }
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  if ($AllowedExitCodes -notcontains $process.ExitCode) {
    $detail = $stderr.Trim()
    if ([string]::IsNullOrEmpty($detail)) { $detail = $stdout.Trim() }
    $suffix = "."
    if (-not [string]::IsNullOrEmpty($detail)) { $suffix = ": $detail" }
    Stop-SourcePublish "$program exited $($process.ExitCode)$suffix"
  }
  return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $stdout; StdErr = $stderr }
}

function Invoke-ReviewedGit {
  param(
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0),
    [byte[]]$StandardInputBytes
  )
  $gitArguments = @(
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=NUL"
  ) + $Arguments
  return Invoke-SanitizedProcess -Executable $GitExecutable -Arguments $gitArguments `
    -AllowedExitCodes $AllowedExitCodes -StandardInputBytes $StandardInputBytes
}

function Assert-Repository {
  param(
    [string]$Repository,
    [string]$CurrentCommit,
    [string]$TargetCommit,
    [string]$Label
  )
  $path = Resolve-ExactDirectory $Repository "$Label repository" -MustExist
  Assert-CanonicalCommit $CurrentCommit "current $Label"
  Assert-CanonicalCommit $TargetCommit "target $Label"
  $top = (Invoke-ReviewedGit @("-C", $path, "rev-parse", "--show-toplevel")).StdOut.Trim()
  if ([IO.Path]::GetFullPath($top).TrimEnd([IO.Path]::DirectorySeparatorChar) -ine $path) {
    Stop-SourcePublish "$Label repository top level is not exact."
  }
  $head = (Invoke-ReviewedGit @("-C", $path, "rev-parse", "--verify", "HEAD^{commit}")).StdOut.Trim()
  if ($head -cne $TargetCommit) { Stop-SourcePublish "$Label HEAD is not the exact target commit." }
  $status = (Invoke-ReviewedGit @(
    "-C", $path, "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"
  )).StdOut
  if (-not [string]::IsNullOrEmpty($status)) { Stop-SourcePublish "$Label repository is not clean." }
  $replacements = (Invoke-ReviewedGit @(
    "-C", $path, "for-each-ref", "--format=%(refname)", "refs/replace"
  )).StdOut
  if (-not [string]::IsNullOrEmpty($replacements)) { Stop-SourcePublish "$Label replacement refs exist." }
  foreach ($gitPathName in @("info/grafts", "objects/info/alternates", "objects/info/http-alternates")) {
    $gitPath = (Invoke-ReviewedGit @("-C", $path, "rev-parse", "--git-path", $gitPathName)).StdOut.Trim()
    if ([IO.Path]::IsPathRooted($gitPath)) {
      $resolvedGitPath = [IO.Path]::GetFullPath($gitPath)
    }
    else {
      $resolvedGitPath = [IO.Path]::GetFullPath((Join-Path $path $gitPath))
    }
    if ([IO.File]::Exists($resolvedGitPath)) {
      Stop-SourcePublish "$Label Git substitution metadata exists."
    }
  }
  $resolvedCurrent = (Invoke-ReviewedGit @(
    "-C", $path, "rev-parse", "--verify", "${CurrentCommit}^{commit}"
  )).StdOut.Trim()
  if ($resolvedCurrent -cne $CurrentCommit) { Stop-SourcePublish "$Label current commit is unavailable." }
  $ancestry = Invoke-ReviewedGit @(
    "-C", $path, "merge-base", "--is-ancestor", $CurrentCommit, $TargetCommit
  ) -AllowedExitCodes @(0, 1)
  if ($ancestry.ExitCode -ne 0) {
    Stop-SourcePublish "$Label target does not contain the current production history."
  }
  return $path
}

function Assert-PublisherAtTarget {
  param([string]$RootRepositoryPath, [string]$TargetCommit)
  $publisherPath = Resolve-ExactFile $PSCommandPath "source publisher"
  $expectedPath = [IO.Path]::GetFullPath(
    (Join-Path $RootRepositoryPath "scripts\publish-production-reviewed-source.ps1")
  )
  if ($publisherPath -ine $expectedPath) {
    Stop-SourcePublish "remote actions require the publisher from the exact target Root checkout."
  }
  $publisherText = $Utf8NoBom.GetString([IO.File]::ReadAllBytes($publisherPath))
  $publisherBlobBytes = ConvertTo-LfUtf8 $publisherText
  $worktreeBlob = (Invoke-ReviewedGit `
    @("-C", $RootRepositoryPath, "hash-object", "--stdin") `
    -StandardInputBytes $publisherBlobBytes).StdOut.Trim()
  $commitBlob = (Invoke-ReviewedGit @(
    "-C", $RootRepositoryPath, "rev-parse", "${TargetCommit}:scripts/publish-production-reviewed-source.ps1"
  )).StdOut.Trim()
  if ($worktreeBlob -cne $commitBlob) {
    Stop-SourcePublish "source publisher bytes differ from the target Root commit."
  }
}

function Get-Sha256 {
  param([string]$Path)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  }
  finally { $stream.Dispose() }
}

function Get-BytesSha256 {
  param([byte[]]$Bytes)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally { $algorithm.Dispose() }
}

function New-RepositoryArchive {
  param([string]$Repository, [string]$TargetCommit, [string]$Name, [string]$Bundle)
  $repositories = Join-Path $Bundle "repositories"
  if (-not [IO.Directory]::Exists($repositories)) { [void][IO.Directory]::CreateDirectory($repositories) }
  $bare = Join-Path $repositories "$Name.git"
  if ([IO.Directory]::Exists($bare) -or [IO.File]::Exists($bare)) {
    Stop-SourcePublish "$Name bare repository target already exists."
  }
  [void](Invoke-ReviewedGit @("init", "--bare", $bare))
  [void](Invoke-ReviewedGit @(
    "-c", "protocol.file.allow=always", "-C", $bare, "fetch", "--no-tags", "--force",
    $Repository, "${TargetCommit}:refs/heads/reviewed"
  ))
  [void](Invoke-ReviewedGit @("-C", $bare, "symbolic-ref", "HEAD", "refs/heads/reviewed"))
  [void](Invoke-ReviewedGit @("-C", $bare, "fsck", "--strict", "--no-reflogs"))
  $resolved = (Invoke-ReviewedGit @("-C", $bare, "rev-parse", "--verify", "${TargetCommit}^{commit}")).StdOut.Trim()
  if ($resolved -cne $TargetCommit) { Stop-SourcePublish "$Name archive repository lost the target commit." }

  $archive = Join-Path $Bundle "$Name.git.tar"
  [void](Invoke-SanitizedProcess -Executable $TarExecutable -Arguments @(
    "-cf", $archive, "-C", $bare, "."
  ))
  $item = Get-Item -LiteralPath $archive
  if ($item.Length -le 0 -or $item.Length -gt 1073741824) {
    Stop-SourcePublish "$Name repository archive has an invalid size."
  }
  return [ordered]@{
    fileName = "$Name.git.tar"
    sha256 = Get-Sha256 $archive
    sizeBytes = [int64]$item.Length
  }
}

function Write-Descriptor {
  param([object]$Value, [string]$Path)
  $json = ($Value | ConvertTo-Json -Depth 8).Replace("`r`n", "`n") + "`n"
  [IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
}

function Assert-PropertySet {
  param([object]$Value, [string[]]$Expected, [string]$Label)
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (($actual -join "`n") -cne ($wanted -join "`n")) {
    Stop-SourcePublish "$Label has an unsupported property set."
  }
}

function Read-Descriptor {
  $bundle = Resolve-ExactDirectory $BundleDirectory "bundle" -MustExist
  $path = Resolve-ExactFile (Join-Path $bundle "source-transfer.json") "source descriptor"
  $descriptor = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($path)) | ConvertFrom-Json
  Assert-PropertySet $descriptor @("schemaVersion", "releaseId", "repositories", "current", "target", "archives") "source descriptor"
  if ($descriptor.schemaVersion -ne 1) { Stop-SourcePublish "source descriptor schema is unsupported." }
  if ([string]$descriptor.releaseId -notmatch "^[a-zA-Z0-9._-]{8,128}$") { Stop-SourcePublish "descriptor release ID is invalid." }
  Assert-PropertySet $descriptor.repositories @("root", "api", "web") "repository paths"
  Assert-PropertySet $descriptor.current @("root", "api", "web") "current commits"
  Assert-PropertySet $descriptor.target @("root", "api", "web") "target commits"
  Assert-PropertySet $descriptor.archives @("root", "api", "web") "archive records"
  foreach ($component in @("root", "api", "web")) {
    Assert-CanonicalCommit ([string]$descriptor.current.$component) "current $component"
    Assert-CanonicalCommit ([string]$descriptor.target.$component) "target $component"
    $archive = $descriptor.archives.$component
    Assert-PropertySet $archive @("fileName", "sha256", "sizeBytes") "$component archive"
    if ([string]$archive.fileName -cne "$component.git.tar") { Stop-SourcePublish "$component archive name is invalid." }
    Assert-CanonicalHash ([string]$archive.sha256) "$component archive"
    $archivePath = Resolve-ExactFile (Join-Path $bundle ([string]$archive.fileName)) "$component archive"
    $item = Get-Item -LiteralPath $archivePath
    if ($item.Length -ne [int64]$archive.sizeBytes -or $item.Length -le 0 -or $item.Length -gt 1073741824) {
      Stop-SourcePublish "$component archive size differs from its descriptor."
    }
    if ((Get-Sha256 $archivePath) -cne [string]$archive.sha256) {
      Stop-SourcePublish "$component archive hash differs from its descriptor."
    }
  }
  return $descriptor
}

function Assert-RemoteAccess {
  if ($ProductionHost -notmatch '^root@[a-zA-Z0-9.-]+$') {
    Stop-SourcePublish "production host must be an explicit root@hostname or root@IPv4 target."
  }
  $script:ResolvedIdentity = Resolve-ExactFile $IdentityFile "SSH identity"
  $script:ResolvedKnownHosts = Resolve-ExactFile $KnownHostsFile "SSH known_hosts"
  $script:ResolvedSsh = Resolve-ExactFile $SshExecutable "SSH executable"
  $script:ResolvedSftp = Resolve-ExactFile $SftpExecutable "SFTP executable"
}

function Get-OpenSshOptions {
  return @(
    "-F", "NUL",
    "-o", "BatchMode=yes",
    "-o", "CheckHostIP=yes",
    "-o", "ClearAllForwardings=yes",
    "-o", "ConnectionAttempts=1",
    "-o", "ConnectTimeout=10",
    "-o", "ForwardAgent=no",
    "-o", "GlobalKnownHostsFile=NUL",
    "-o", "IdentitiesOnly=yes",
    "-o", "PermitLocalCommand=no",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "UserKnownHostsFile=$ResolvedKnownHosts",
    "-i", $ResolvedIdentity
  )
}

function ConvertTo-LfUtf8 {
  param([string]$Text)
  $normalized = $Text.Replace("`r`n", "`n")
  if ($normalized.Contains("`r")) { Stop-SourcePublish "remote payload contains a noncanonical carriage return." }
  if (-not $normalized.EndsWith("`n")) { $normalized += "`n" }
  return $Utf8NoBom.GetBytes($normalized)
}

function New-RemotePayloadCommand {
  param(
    [byte[]]$Payload,
    [string[]]$PayloadArguments = @(),
    [string]$TemporaryPattern = "/run/arenzyra-source-entry.XXXXXXXX"
  )
  if ($TemporaryPattern -notmatch '^/(?:run|tmp)/arenzyra-source-entry\.X{8}$') {
    Stop-SourcePublish "remote payload temporary pattern is invalid."
  }
  if ($null -eq $Payload -or $Payload.Length -le 0 -or $Payload.Length -gt 16384) {
    Stop-SourcePublish "remote payload size is outside the reviewed command-line bound."
  }
  if ([Array]::IndexOf($Payload, [byte]13) -ge 0) {
    Stop-SourcePublish "remote payload contains a carriage return."
  }
  foreach ($argument in $PayloadArguments) {
    if ($argument -notmatch '^[a-zA-Z0-9._-]+$') {
      Stop-SourcePublish "a remote payload argument is outside the closed character set."
    }
  }
  $encoded = [Convert]::ToBase64String($Payload)
  $payloadHash = Get-BytesSha256 $Payload
  $remoteCommand = @(
    "/usr/bin/env -i PATH=$SafeRemotePath HOME=/root LC_ALL=C",
    "/bin/bash --noprofile --norc -ceu",
    "'umask 077; f=`$(/usr/bin/mktemp $TemporaryPattern); trap `"/usr/bin/rm -f -- `$f`" EXIT; /usr/bin/printf %s `"`$1`" | /usr/bin/base64 -d > `"`$f`"; actual=`$(/usr/bin/sha256sum `"`$f`" ); actual=`${actual%% *}; [ `"`$actual`" = `"`$2`" ]; shift 2; /usr/bin/env -i PATH=$SafeRemotePath HOME=/root LC_ALL=C /bin/bash --noprofile --norc `"`$f`" `"`$@`"'",
    "arenzyra-source-entry", $encoded, $payloadHash
  ) + $PayloadArguments
  return [pscustomobject]@{
    Command = $remoteCommand -join ' '
    PayloadHash = $payloadHash
  }
}

function Invoke-RemotePayload {
  param([byte[]]$Payload, [string[]]$PayloadArguments = @())
  $transport = New-RemotePayloadCommand $Payload $PayloadArguments
  $sshArguments = @(
    "-T"
  ) + (Get-OpenSshOptions) + @($ProductionHost, $transport.Command)
  $result = Invoke-SanitizedProcess -Executable $ResolvedSsh -Arguments $sshArguments
  if (-not [string]::IsNullOrWhiteSpace($result.StdOut)) { Write-Output $result.StdOut.TrimEnd() }
}

function Invoke-TransportSelfTest {
  $payload = ConvertTo-LfUtf8 @'
set -Eeuo pipefail
[ "$#" -eq 11 ]
[ "$1" = 'source-self-test-01' ]
[ "$2" = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ]
[ "$5" = 'dddddddddddddddddddddddddddddddddddddddd' ]
[[ "${10}" =~ ^i{64}$ ]]
[[ "${11}" =~ ^j{64}$ ]]
printf 'SOURCE_TRANSPORT_SELF_TEST_OK args=%s\n' "$#"
'@
  $payloadBlob = (Invoke-ReviewedGit `
    @("hash-object", "--stdin") `
    -StandardInputBytes $payload).StdOut.Trim()
  if ($payloadBlob -notmatch "^[0-9a-f]{40}$") {
    Stop-SourcePublish "local exact-byte Git payload parser returned an invalid blob."
  }
  # This is the one-time bridge's complete activation argument shape: release,
  # current/target Root/API/Web commits, three archive hashes, and bridge hash.
  $arguments = @(
    "source-self-test-01",
    ("a" * 40), ("b" * 40), ("c" * 40),
    ("d" * 40), ("e" * 40), ("f" * 40),
    ("g" * 64), ("h" * 64), ("i" * 64), ("j" * 64)
  )
  $transport = New-RemotePayloadCommand $payload $arguments "/tmp/arenzyra-source-entry.XXXXXXXX"
  $bash = Resolve-ExactFile $BashExecutable "Git Bash executable"
  $result = Invoke-SanitizedProcess -Executable $bash -Arguments @(
    "--noprofile", "--norc", "-c", $transport.Command
  )
  if ($result.StdOut.Trim() -cne "SOURCE_TRANSPORT_SELF_TEST_OK args=11") {
    Stop-SourcePublish "local SSH-equivalent payload parser returned an unexpected result."
  }
  Write-Output "REVIEWED SOURCE TRANSPORT SELF-TEST PASSED sha256=$($transport.PayloadHash)"
}

function Invoke-Package {
  if ($ReleaseId -notmatch "^[a-zA-Z0-9._-]{8,128}$") { Stop-SourcePublish "release ID is invalid." }
  $bundle = Resolve-ExactDirectory $BundleDirectory "bundle"
  [void](Resolve-ExactDirectory ([IO.Path]::GetDirectoryName($bundle)) "bundle parent" -MustExist)
  if ([IO.Directory]::Exists($bundle) -or [IO.File]::Exists($bundle)) {
    Stop-SourcePublish "bundle target already exists; source bundles are no-overwrite."
  }
  Assert-CompatibilityInputs $CurrentRootCommit $CurrentApiCommit $CurrentWebCommit
  $root = Assert-Repository $RootRepository $CurrentRootCommit $TargetRootCommit "Root"
  $api = Assert-Repository $ApiRepository $CurrentApiCommit $TargetApiCommit "API"
  $web = Assert-Repository $WebRepository $CurrentWebCommit $TargetWebCommit "Web"
  [void](New-Item -ItemType Directory -Path $bundle -ErrorAction Stop)
  $archives = [ordered]@{
    root = New-RepositoryArchive $root $TargetRootCommit "root" $bundle
    api = New-RepositoryArchive $api $TargetApiCommit "api" $bundle
    web = New-RepositoryArchive $web $TargetWebCommit "web" $bundle
  }
  $descriptor = [ordered]@{
    schemaVersion = 1
    releaseId = $ReleaseId
    repositories = [ordered]@{ root = $root; api = $api; web = $web }
    current = [ordered]@{ root = $CurrentRootCommit; api = $CurrentApiCommit; web = $CurrentWebCommit }
    target = [ordered]@{ root = $TargetRootCommit; api = $TargetApiCommit; web = $TargetWebCommit }
    archives = $archives
  }
  Write-Descriptor $descriptor (Join-Path $bundle "source-transfer.json")
  Write-Output "REVIEWED SOURCE PACKAGE COMPLETE bundle=$bundle release=$ReleaseId"
  foreach ($component in @("root", "api", "web")) {
    Write-Output "SOURCE_ARCHIVE component=$component sha256=$($archives[$component].sha256) bytes=$($archives[$component].sizeBytes)"
  }
}

function Invoke-Transfer {
  $descriptor = Read-Descriptor
  Assert-RemoteAccess
  $release = [string]$descriptor.releaseId
  Assert-CompatibilityInputs ([string]$descriptor.current.root) ([string]$descriptor.current.api) ([string]$descriptor.current.web)
  $root = Assert-Repository ([string]$descriptor.repositories.root) ([string]$descriptor.current.root) ([string]$descriptor.target.root) "Root"
  [void](Assert-Repository ([string]$descriptor.repositories.api) ([string]$descriptor.current.api) ([string]$descriptor.target.api) "API")
  [void](Assert-Repository ([string]$descriptor.repositories.web) ([string]$descriptor.current.web) ([string]$descriptor.target.web) "Web")
  Assert-PublisherAtTarget $root ([string]$descriptor.target.root)

  $preflight = @'
set -Eeuo pipefail
parent=/opt/arenzyra-release-incoming
incoming="$parent/@@RELEASE@@"
[ "$(id -u)" -eq 0 ]
[ -d /opt ] && [ ! -L /opt ] && [ "$(/usr/bin/realpath -e -- /opt)" = /opt ]
opt_mode="$(/usr/bin/stat -c %a -- /opt)"
[[ "$opt_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$opt_mode & 8#022) == 0 ))
[ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(/usr/bin/realpath -e -- "$parent")" = "$parent" ]
[ "$(/usr/bin/stat -c '%u:%g:%a' -- "$parent")" = '0:0:700' ]
[ ! -e "$incoming" ] && [ ! -L "$incoming" ]
printf 'REVIEWED SOURCE STAGING PREFLIGHT VERIFIED: %s\n' "$incoming"
'@.Replace("@@RELEASE@@", $release)
  Invoke-RemotePayload (ConvertTo-LfUtf8 $preflight)

  $bundle = Resolve-ExactDirectory $BundleDirectory "bundle" -MustExist
  $sftpLines = New-Object Collections.Generic.List[string]
  $sftpLines.Add("mkdir /opt/arenzyra-release-incoming/$release")
  $sftpLines.Add("chmod 0700 /opt/arenzyra-release-incoming/$release")
  foreach ($component in @("root", "api", "web")) {
    $archive = Resolve-ExactFile (Join-Path $bundle "$component.git.tar") "$component archive"
    $sftpPath = $archive.Replace('\', '/')
    if ($sftpPath.Contains('"') -or $sftpPath.Contains("`r") -or $sftpPath.Contains("`n")) {
      Stop-SourcePublish "$component archive path cannot be represented safely in an SFTP batch."
    }
    $sftpLines.Add("put `"$sftpPath`" /opt/arenzyra-release-incoming/$release/$component.git.tar")
    $sftpLines.Add("chmod 0600 /opt/arenzyra-release-incoming/$release/$component.git.tar")
  }
  $sftpBatch = ConvertTo-LfUtf8 (($sftpLines -join "`n") + "`n")
  $sftpArguments = @("-b", "-") + (Get-OpenSshOptions) + @($ProductionHost)
  [void](Invoke-SanitizedProcess -Executable $ResolvedSftp -Arguments $sftpArguments -StandardInputBytes $sftpBatch)

  $rootHash = [string]$descriptor.archives.root.sha256
  $apiHash = [string]$descriptor.archives.api.sha256
  $webHash = [string]$descriptor.archives.web.sha256
  $verify = @'
set -Eeuo pipefail
umask 077
incoming=/opt/arenzyra-release-incoming/@@RELEASE@@
[ "$(id -u)" -eq 0 ]
[ -d "$incoming" ] && [ ! -L "$incoming" ] && [ "$(/usr/bin/realpath -e -- "$incoming")" = "$incoming" ]
[ "$(/usr/bin/stat -c '%u:%g:%a' -- "$incoming")" = '0:0:700' ]
if /usr/bin/findmnt -rn -o TARGET | /usr/bin/awk -v path="$incoming" '$0 == path || index($0, path "/") == 1 { found=1 } END { exit !found }'; then
  exit 75
fi
names="$(/usr/bin/find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | /usr/bin/sort)"
[ "$names" = $'api.git.tar\nroot.git.tar\nweb.git.tar' ]
for file in "$incoming/root.git.tar" "$incoming/api.git.tar" "$incoming/web.git.tar"; do
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(/usr/bin/stat -c %h -- "$file")" = 1 ]
  size="$(/usr/bin/stat -c %s -- "$file")"
  [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && [ "$size" -le 1073741824 ]
  [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$file")" = '0:0:600:1' ]
done
/usr/bin/printf '%s  %s\n' '@@ROOT_HASH@@' "$incoming/root.git.tar" | /usr/bin/sha256sum -c - >/dev/null
/usr/bin/printf '%s  %s\n' '@@API_HASH@@' "$incoming/api.git.tar" | /usr/bin/sha256sum -c - >/dev/null
/usr/bin/printf '%s  %s\n' '@@WEB_HASH@@' "$incoming/web.git.tar" | /usr/bin/sha256sum -c - >/dev/null
printf 'REVIEWED SOURCE TRANSFER VERIFIED: %s\n' "$incoming"
'@.Replace("@@RELEASE@@", $release).Replace("@@ROOT_HASH@@", $rootHash).Replace("@@API_HASH@@", $apiHash).Replace("@@WEB_HASH@@", $webHash)
  Invoke-RemotePayload (ConvertTo-LfUtf8 $verify)
}

function Invoke-Activate {
  $descriptor = Read-Descriptor
  Assert-RemoteAccess
  $release = [string]$descriptor.releaseId
  $currentRoot = [string]$descriptor.current.root
  $currentApi = [string]$descriptor.current.api
  $currentWeb = [string]$descriptor.current.web
  $targetRoot = [string]$descriptor.target.root
  $targetApi = [string]$descriptor.target.api
  $targetWeb = [string]$descriptor.target.web
  $rootHash = [string]$descriptor.archives.root.sha256
  $apiHash = [string]$descriptor.archives.api.sha256
  $webHash = [string]$descriptor.archives.web.sha256
  Assert-CompatibilityInputs $currentRoot $currentApi $currentWeb

  $root = Assert-Repository ([string]$descriptor.repositories.root) $currentRoot $targetRoot "Root"
  [void](Assert-Repository ([string]$descriptor.repositories.api) $currentApi $targetApi "API")
  [void](Assert-Repository ([string]$descriptor.repositories.web) $currentWeb $targetWeb "Web")
  Assert-PublisherAtTarget $root $targetRoot

  if ($currentRoot -ceq $CompatibilityRootCommit) {
    $bridge = Resolve-ExactFile (Join-Path $root "scripts\activate-production-reviewed-checkout-4d18-bridge.sh") "compatibility bridge"
    $payload = [IO.File]::ReadAllBytes($bridge)
    if ([Array]::IndexOf($payload, [byte]13) -ge 0) {
      Stop-SourcePublish "compatibility bridge contains CR bytes; only committed LF bytes may execute."
    }
    $worktreeBlob = (Invoke-ReviewedGit `
      @("-C", $root, "hash-object", "--stdin") `
      -StandardInputBytes $payload).StdOut.Trim()
    $commitBlob = (Invoke-ReviewedGit @(
      "-C", $root, "rev-parse", "${targetRoot}:scripts/activate-production-reviewed-checkout-4d18-bridge.sh"
    )).StdOut.Trim()
    if ($worktreeBlob -cne $commitBlob) { Stop-SourcePublish "compatibility bridge differs from the target Root commit." }
    $bridgeHash = Get-BytesSha256 $payload
    Invoke-RemotePayload $payload @(
      $release, $currentRoot, $currentApi, $currentWeb,
      $targetRoot, $targetApi, $targetWeb, $rootHash, $apiHash, $webHash, $bridgeHash
    )
    return
  }

  $activate = @'
set -Eeuo pipefail
set -o pipefail
umask 077
safe_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /opt/arenzyra
source="$(/usr/bin/env -i PATH="$safe_path" HOME=/root LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -C /opt/arenzyra show '@@CURRENT_ROOT@@:scripts/production-reviewed-entrypoint.sh')"
[ -n "$source" ]
/usr/bin/printf '%s\n' "$source" | /usr/bin/env -i PATH="$safe_path" HOME=/root LC_ALL=C ARENZYRA_REVIEWED_ROOT_COMMIT='@@CURRENT_ROOT@@' ARENZYRA_REVIEWED_API_COMMIT='@@CURRENT_API@@' ARENZYRA_REVIEWED_WEB_COMMIT='@@CURRENT_WEB@@' /bin/bash --noprofile --norc -s -- source-activate '@@RELEASE@@' '@@TARGET_ROOT@@' '@@TARGET_API@@' '@@TARGET_WEB@@' '@@ROOT_HASH@@' '@@API_HASH@@' '@@WEB_HASH@@'
'@
  $activate = $activate.Replace("@@CURRENT_ROOT@@", $currentRoot).Replace("@@CURRENT_API@@", $currentApi).Replace("@@CURRENT_WEB@@", $currentWeb)
  $activate = $activate.Replace("@@RELEASE@@", $release).Replace("@@TARGET_ROOT@@", $targetRoot).Replace("@@TARGET_API@@", $targetApi).Replace("@@TARGET_WEB@@", $targetWeb)
  $activate = $activate.Replace("@@ROOT_HASH@@", $rootHash).Replace("@@API_HASH@@", $apiHash).Replace("@@WEB_HASH@@", $webHash)
  Invoke-RemotePayload (ConvertTo-LfUtf8 $activate)
}

try {
  $GitExecutable = Resolve-ExactFile $GitExecutable "Git executable"
  switch ($Action) {
    "Package" {
      $TarExecutable = Resolve-ExactFile $TarExecutable "tar executable"
      Invoke-Package
    }
    "Transfer" { Invoke-Transfer }
    "Activate" { Invoke-Activate }
    "SelfTest" { Invoke-TransportSelfTest }
  }
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 75
}
