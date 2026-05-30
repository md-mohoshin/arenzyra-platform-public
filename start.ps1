$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$backendPath = Join-Path $root "apps\api"
if (-not (Test-Path $backendPath)) {
    Write-Host "Backend folder missing: apps\api"
    exit 1
}

Write-Host "Starting backend (npm run start:dev) in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location `"$backendPath`"; npm run start:dev"

Start-Sleep -Seconds 5

$frontendPath = Join-Path $root "apps\arenzyra-web"
if (-not (Test-Path $frontendPath)) {
    Write-Host "Frontend folder missing: apps\arenzyra-web"
    exit 1
}

Write-Host "Starting frontend (npm run dev) in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location `"$frontendPath`"; npm run dev"

Write-Host "Backend and frontend launch initiated."
