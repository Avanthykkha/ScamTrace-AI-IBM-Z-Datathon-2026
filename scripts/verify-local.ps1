param([switch]$SkipNpmCi)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) { throw 'Project Python environment is missing. Run .\start.ps1 once to create it, then rerun verification.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm was not found. Install the README-supported Node.js version and reopen PowerShell.' }

Push-Location $root
try {
    $launcherRecord = Join-Path $root '.run\processes.json'
    if (Test-Path $launcherRecord) {
        Write-Host 'Stopping launcher-managed servers before replacing frontend dependencies...'
        & (Join-Path $root 'start.ps1') -Stop
        if (-not $?) { throw 'Could not stop launcher-managed services before npm ci.' }
    }

    Write-Host '1/7 Installing/verifying backend requirements...'
    & $python -m pip install -r (Join-Path $root 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "pip install exited with code $LASTEXITCODE." }
    & $python -m pip check
    if ($LASTEXITCODE -ne 0) { throw "pip check exited with code $LASTEXITCODE." }

    Write-Host '2/7 Installing/verifying frontend requirements...'
    if (-not $SkipNpmCi) {
        # Use a workspace-local cache: Windows security/indexing can lock the shared user cache.
        $env:npm_config_cache = Join-Path $root '.run\npm-cache'
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci exited with code $LASTEXITCODE." }
    } else {
        if (-not (Test-Path (Join-Path $root 'node_modules\vite\bin\vite.js'))) { throw 'Vite is missing; rerun without -SkipNpmCi.' }
        Write-Host 'Skipped npm ci by request; existing lockfile installation will be built.'
    }

    Write-Host '3/7 Building frontend assets...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build exited with code $LASTEXITCODE." }

    Write-Host '4/7 Initializing and checking SQLite...'
    & $python (Join-Path $root 'scripts\check-db.py')
    if ($LASTEXITCODE -ne 0) { throw "Database initialization/persistence check exited with code $LASTEXITCODE." }
    $database = & $python -c 'from backend.main import DB; print(DB)'
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $database)) { throw "Expected persistent database was not created at $database." }

    Write-Host '5/7 Running full automated test suite...'
    & $python -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw "pytest exited with code $LASTEXITCODE." }

    Write-Host '6/7 Regenerating benchmark from seeded scenario executions...'
    & $python (Join-Path $root 'scripts\benchmark.py')
    if ($LASTEXITCODE -ne 0) { throw "benchmark.py exited with code $LASTEXITCODE." }
    $benchmark = Get-Content -Raw -LiteralPath (Join-Path $root 'reports\benchmark.json') | ConvertFrom-Json
    if (-not $benchmark.measured_at_utc -or @($benchmark.scenarios).Count -lt 1) { throw 'Benchmark output is missing a measurement timestamp or scenario results.' }
    Write-Host "Benchmark timestamp: $($benchmark.measured_at_utc); scenarios: $(@($benchmark.scenarios).Count)"

    Write-Host '7/7 Scanning source for common embedded credential formats...'
    & $python (Join-Path $root 'scripts\check-secrets.py')
    if ($LASTEXITCODE -ne 0) { throw "Credential scan exited with code $LASTEXITCODE." }
    Write-Host 'Local verification checks completed.' -ForegroundColor Green
} finally {
    Pop-Location
}
