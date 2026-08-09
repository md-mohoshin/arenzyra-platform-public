param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($message) { Write-Host "[STEP] $message" }
function Write-Ok($message) { Write-Host "[OK] $message" }
function Fail($message) { Write-Host "[FAIL] $message"; exit 1 }

function Require-Path($targetPath, $label) {
    if (-not (Test-Path -LiteralPath $targetPath)) {
        Fail "$label missing ($targetPath)"
    }
    Write-Ok "$label exists"
}

function Require-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Fail "Required command is unavailable: $name"
    }
    Write-Ok "$name is available"
}

function Test-NodeRuntime($appDir, $label, $environmentFile, $buildArtifacts) {
    Require-Path $appDir $label
    Require-Path (Join-Path $appDir "package.json") "$label package.json"
    Require-Path (Join-Path $appDir "node_modules") "$label dependencies"
    if ($environmentFile) {
        Require-Path (Join-Path $appDir $environmentFile) "$label environment"
    }
    foreach ($artifact in $buildArtifacts) {
        Require-Path (Join-Path $appDir $artifact) "$label runtime artifact"
    }
}

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$resolvedRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

Write-Step "Read-only readiness check for $resolvedRoot"
Require-Command "node"
Require-Command "npm"
Require-Path (Join-Path $resolvedRoot "apps") "Apps directory"

Test-NodeRuntime (Join-Path $resolvedRoot "apps\api") "API" ".env" @("dist\main.js")
$webDir = Join-Path $resolvedRoot "apps\arenzyra-web"
Test-NodeRuntime $webDir "Arenzyra Web" ".env.local" @()
$artifactPolicy = Join-Path $PSScriptRoot "health-artifact-policy.cjs"
Require-Path $artifactPolicy "Web artifact policy"
& node $artifactPolicy $webDir ".next-build"
if ($LASTEXITCODE -ne 0) { Fail "Arenzyra Web active runtime artifact is missing" }
Write-Ok "Arenzyra Web .next-build runtime artifact exists"
Test-NodeRuntime (Join-Path $resolvedRoot "apps\discord-bot") "Discord Bot" ".env" @("dist\bot.js")

$mediaDir = Join-Path $resolvedRoot "apps\media-ai-service"
Require-Path $mediaDir "Media AI Service"
Require-Path (Join-Path $mediaDir "main.py") "Media AI entrypoint"
Require-Path (Join-Path $mediaDir "requirements.txt") "Media AI requirements"
$pythonCandidates = @(
    (Join-Path $mediaDir ".venv\Scripts\python.exe"),
    (Join-Path $mediaDir ".venv\bin\python")
)
$python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $python) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) { $python = $pythonCommand.Source }
}
if (-not $python) { Fail "Media AI Python runtime not found" }
Write-Ok "Media AI Python runtime available ($python)"

Write-Host "Arenzyra READ-ONLY READINESS: ALL GOOD"
