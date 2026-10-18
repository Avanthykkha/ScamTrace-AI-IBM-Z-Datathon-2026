param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$compose = Get-Command docker -ErrorAction SilentlyContinue
if (-not $compose) { throw 'Docker CLI was not found. Install Docker Desktop, then run .\scripts\start-advanced.ps1 again.' }
& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose is unavailable. Update Docker Desktop and try again.' }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  if ($Stop) {
    & docker compose -f docker-compose.advanced.yml --profile advanced down
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the advanced services.' }
    Write-Host 'ScamTrace advanced services stopped.'
    exit 0
  }
  & docker compose -f docker-compose.advanced.yml --profile advanced up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Advanced services did not start. Review Docker output above.' }
  Write-Host 'ScamTrace advanced services are starting.' -ForegroundColor Green
  Write-Host 'Redpanda Kafka: localhost:19092 | Flink UI: http://localhost:8082 | Temporal: localhost:7233'
  Write-Host 'Postgres AGE: localhost:5433 | Grafana: http://localhost:3000 (configure SCAMTRACE_GRAFANA_PASSWORD locally)'
  Write-Host 'Set SCAMTRACE_KAFKA_BOOTSTRAP=127.0.0.1:19092 and SCAMTRACE_TEMPORAL_ADDRESS=127.0.0.1:7233 in .env, then restart .\start.ps1.'
  Write-Host 'Enable the AGE mirror with SCAMTRACE_POSTGRES_DSN=postgresql://scamtrace:scamtrace-local@127.0.0.1:5433/scamtrace.'
} finally { Pop-Location }
