$ErrorActionPreference = "Stop"

function Write-Step($message) {
    Write-Host "[STEP] $message"
}

function Write-Ok($message) {
    Write-Host "[OK] $message"
}

function Write-Warn($message) {
    Write-Host "[WARN] $message"
}

function Fail($message) {
    Write-Host "[FAIL] $message"
    exit 1
}

function Require-Path($path, $label) {
    if (-not (Test-Path $path)) {
        Fail "$label missing ($path)"
    }
    Write-Ok "$label exists"
}

function Resolve-RepoRoot {
    if ($PSScriptRoot) {
        $scriptDir = $PSScriptRoot
    }
    elseif ($PSCommandPath) {
        $scriptDir = Split-Path -Parent $PSCommandPath
    }
    else {
        return (Get-Location).Path
    }

    if ((Split-Path -Leaf $scriptDir) -eq "infra") {
        return (Split-Path -Parent $scriptDir)
    }
    return (Get-Location).Path
}

function Resolve-Python($baseDir, $candidates) {
    foreach ($candidate in $candidates) {
        $fullPath = Join-Path $baseDir $candidate
        if (Test-Path $fullPath) {
            return $fullPath
        }
    }

    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        return "py"
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return "python"
    }

    return $null
}

function Assert-EnvFile($baseDir, $relativePath, $label) {
    $fullPath = Join-Path $baseDir $relativePath
    if (-not (Test-Path $fullPath)) {
        Fail "$label missing ($relativePath)"
    }
    Write-Ok "$label exists"
}

function Ensure-NodeDependencies($appDir, $label) {
    if (Test-Path (Join-Path $appDir "node_modules")) {
        Write-Ok "$label dependencies directory exists"
        return
    }

    Write-Step "$label dependencies missing; running npm install"
    Push-Location $appDir
    npm install
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "$label npm install failed"
    }
    Pop-Location
    Write-Ok "$label dependencies installed"
}

function Invoke-NpmScript($appDir, $label, $scriptName) {
    Write-Step "$label running npm run $scriptName"
    Push-Location $appDir
    npm run $scriptName
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "$label npm run $scriptName failed"
    }
    Pop-Location
    Write-Ok "$label npm run $scriptName passed"
}

function Test-NodeApp($appDir, $label, $envFiles, $scripts) {
    Require-Path $appDir $label
    Require-Path (Join-Path $appDir "package.json") "$label package.json"

    foreach ($envFile in $envFiles) {
        Assert-EnvFile $appDir $envFile "$label environment file"
    }

    Ensure-NodeDependencies $appDir $label

    foreach ($script in $scripts) {
        Invoke-NpmScript $appDir $label $script
    }
}

function Test-Api($repoRoot) {
    $apiDir = Join-Path $repoRoot "apps\api"
    Test-NodeApp $apiDir "API" @(".env") @()

    Write-Step "API validating Prisma schema"
    Push-Location $apiDir
    npx prisma validate
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "API Prisma schema validation failed"
    }
    Pop-Location
    Write-Ok "API Prisma schema is valid"

    Invoke-NpmScript $apiDir "API" "build"
}

function Test-Web($repoRoot) {
    $webDir = Join-Path $repoRoot "apps\arenzyra-web"
    Test-NodeApp $webDir "Arenzyra Web" @(".env.local") @("build")
}

function Test-MatchState($repoRoot) {
    $matchDir = Join-Path $repoRoot "apps\match-state-service"
    Test-NodeApp $matchDir "Match State Service" @(".env") @("build")
}

function Test-DiscordBot($repoRoot) {
    $botDir = Join-Path $repoRoot "apps\discord-bot"
    Test-NodeApp $botDir "Discord Bot" @(".env") @("build")
}

function Test-Overlay($repoRoot) {
    $overlayDir = Join-Path $repoRoot "apps\overlay-server"
    Test-NodeApp $overlayDir "Overlay Server" @() @()
}

function Test-ShadowApi($repoRoot) {
    $shadowDir = Join-Path $repoRoot "apps\shadow_api"
    Require-Path $shadowDir "Shadow API"
    Require-Path (Join-Path $shadowDir "shadow_receiver.py") "Shadow API entrypoint"

    $python = Resolve-Python $shadowDir @(
        "venv\Scripts\python.exe",
        "Scripts\python.exe",
        "venv/bin/python"
    )

    if (-not $python) {
        Fail "Shadow API Python runtime not found"
    }

    Write-Ok "Shadow API Python runtime available ($python)"

    Push-Location $shadowDir
    Write-Step "Shadow API validating Python imports"
    & $python -c "import flask, requests"
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "Shadow API Python imports failed"
    }
    Write-Ok "Shadow API imports passed"

    Write-Step "Shadow API compiling shadow_receiver.py"
    & $python -m py_compile shadow_receiver.py
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "Shadow API py_compile failed"
    }
    Pop-Location
    Write-Ok "Shadow API syntax check passed"
}

function Test-MediaAi($repoRoot) {
    $mediaDir = Join-Path $repoRoot "apps\media-ai-service"
    Require-Path $mediaDir "Media AI Service"
    Require-Path (Join-Path $mediaDir "main.py") "Media AI entrypoint"
    Require-Path (Join-Path $mediaDir "requirements.txt") "Media AI requirements"

    $python = Resolve-Python $mediaDir @(
        ".venv\Scripts\python.exe",
        ".venv/bin/python"
    )

    if (-not $python) {
        Fail "Media AI Python runtime not found"
    }

    Write-Ok "Media AI Python runtime available ($python)"

    Push-Location $mediaDir
    Write-Step "Media AI validating Python imports"
    & $python -c "import fastapi, uvicorn, PIL, rembg"
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "Media AI Python imports failed"
    }
    Write-Ok "Media AI imports passed"

    Write-Step "Media AI compiling main.py"
    & $python -m py_compile main.py
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Fail "Media AI py_compile failed"
    }
    Pop-Location
    Write-Ok "Media AI syntax check passed"
}

$repoRoot = Resolve-RepoRoot
Set-Location -Path $repoRoot

Write-Step "Using repository root $repoRoot"
Require-Path (Join-Path $repoRoot "apps") "Apps directory"

Test-Api $repoRoot
Test-ShadowApi $repoRoot
Test-MatchState $repoRoot
Test-DiscordBot $repoRoot
Test-Overlay $repoRoot
Test-MediaAi $repoRoot
Test-Web $repoRoot

Write-Host "Arenzyra HEALTH: ALL GOOD"
