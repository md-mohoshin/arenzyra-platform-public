param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiPath  = Join-Path $repoRoot 'apps/api'
if (-not (Test-Path $apiPath)) {
  Write-Error "API path not found at $apiPath"
  exit 1
}

Push-Location $apiPath
try {
  Write-Host "==> Using API path $apiPath"

  $migrationsPath = Join-Path $apiPath 'prisma/migrations'
  $schemaArg = '--schema'
  $schemaPath = 'prisma/schema.prisma'

  $hasMigrations = Test-Path (Join-Path $migrationsPath '*')
  if ($hasMigrations) {
    Write-Host "==> Dropping and reapplying database via prisma migrate reset"
    npx prisma migrate reset --force --schema $schemaPath
  } else {
    Write-Host "==> No migrations found; creating fresh init_clean migration"
    npx prisma migrate dev --name init_clean --schema $schemaPath
  }

  Write-Host "==> Generating Prisma Client"
  npx prisma generate --schema $schemaPath

  $seedTs = Join-Path $apiPath 'prisma/seed.ts'
  if (Test-Path $seedTs) {
    Write-Host "==> Running database seed"
    npm run db:seed | Write-Host
  } else {
    Write-Host "==> Seed file not found; skipping seed"
  }

  Write-Host "==> Dev reset complete"
}
finally {
  Pop-Location
}
