Param(
  [string]$Schema = "public"
)

Write-Host "=== Dev DB reset starting ==="

$envPath = Join-Path $PSScriptRoot ".." ".env"
if (-Not (Test-Path $envPath)) {
  Write-Error "Missing .env next to apps/api"
  exit 1
}

$envContent = Get-Content $envPath | Where-Object { $_ -match "=" }
foreach ($line in $envContent) {
  $parts = $line -split "=",2
  if ($parts.Length -eq 2 -and -not [string]::IsNullOrWhiteSpace($parts[0])) {
    $name = $parts[0].Trim()
    $value = $parts[1].Trim('"').Trim()
    if (-not [string]::IsNullOrWhiteSpace($name) -and -not $env:$name) {
      $env:$name = $value
    }
  }
}

$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) {
  Write-Error "DATABASE_URL not found in .env"
  exit 1
}

Write-Host "DATABASE_URL detected"

function Invoke-Step($label, $command) {
  Write-Host "---- $label"
  & cmd /c $command
  if ($LASTEXITCODE -ne 0) {
    Write-Error "$label failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
  }
}

# Drop schema/data via migrate reset (non-interactive)
Invoke-Step "Reset schema" "npx prisma migrate reset --force --schema prisma/schema.prisma"

# Apply fresh migration and generate client
Invoke-Step "Generate init migration" "npx prisma migrate dev --name init_clean --schema prisma/schema.prisma"
Invoke-Step "Prisma generate" "npx prisma generate --schema prisma/schema.prisma"

# Seed
if (Test-Path ".\prisma\seed.ts") {
  Invoke-Step "Prisma seed" "npm run db:seed"
} else {
  Write-Host "Seed script not found; skipping"
}

Write-Host "=== Dev DB reset completed ==="
