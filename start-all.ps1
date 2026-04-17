Write-Host ""
Write-Host "=== STARTING Arenzyra SYSTEM ==="
Write-Host ""

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# ---------------- BACKEND ----------------
$backendPath = Join-Path $root "apps\api"
if (!(Test-Path $backendPath)) {
    Write-Host "ERROR: apps\api folder not found"
    exit
}

Write-Host "Starting Backend..."
Start-Process powershell -ArgumentList `
  "-NoExit", `
  "-Command Set-Location `"$backendPath`"; npm run start:dev"

Start-Sleep -Seconds 5

# ---------------- SHADOW API ----------------
$shadowPath = Join-Path $root "shadow_api"
if (Test-Path $shadowPath) {
    Write-Host "Starting Shadow API..."
    Start-Process powershell -ArgumentList `
      "-NoExit", `
      "-Command Set-Location `"$shadowPath`"; py shadow_receiver.py"
} else {
    Write-Host "Skipping Shadow API: shadow_api folder not found"
}

Start-Sleep -Seconds 3

# ---------------- FRONTEND ----------------
$frontendPath = Join-Path $root "apps\arenzyra-web"
if (!(Test-Path $frontendPath)) {
    Write-Host "ERROR: apps\arenzyra-web folder not found"
    exit
}

Write-Host "Starting Frontend..."
Start-Process powershell -ArgumentList `
  "-NoExit", `
  "-Command Set-Location `"$frontendPath`"; npm run dev"

Write-Host ""
Write-Host "Arenzyra SYSTEM STARTED"
Write-Host "Backend   : http://localhost:3000"
Write-Host "Frontend  : http://localhost:3001"
Write-Host "Shadow API: optional, only started when shadow_api exists"
Write-Host ""
