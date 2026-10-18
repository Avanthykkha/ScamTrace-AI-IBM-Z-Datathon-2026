param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runDir = Join-Path $root '.run'
$logDir = Join-Path $root 'logs'
$pidFile = Join-Path $runDir 'processes.json'

function Stop-ScamTrace {
    if (-not (Test-Path $pidFile)) { Write-Host 'No ScamTrace launcher process record found.'; return }
    $record = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
    $processIds = @($record.backend, $record.backendListener, $record.frontend) | Sort-Object -Unique
    foreach ($id in $processIds) {
        if ($id) {
            $process = Get-Process | Where-Object { $_.Id -eq [int]$id } | Select-Object -First 1
            if ($process) {
                try {
                    Stop-Process -Id $process.Id -ErrorAction Stop
                    Write-Host "Stopped launcher process $($process.Id) ($($process.ProcessName))."
                } catch {
                    Write-Error "Could not stop launcher process $($process.Id): $($_.Exception.Message)"
                    throw
                }
            } else {
                Write-Host "Launcher process $id was already stopped."
            }
        }
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction Stop
    Write-Host 'ScamTrace AI processes stopped.'
}

if ($Stop) { Stop-ScamTrace; exit 0 }

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $pythonCmd) { Write-Error 'Python was not found. Install Python 3.11 or newer, then reopen PowerShell.'; exit 1 }
if (-not $nodeCmd) { Write-Error 'Node.js was not found. Install Node.js 20 or newer, then reopen PowerShell.'; exit 1 }
$pythonVersion = & $pythonCmd.Source -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])'
if ([int]$pythonVersion -lt 311) { Write-Error "Python $pythonVersion was found; Python 3.11 or newer is required."; exit 1 }
$nodeVersion = & $nodeCmd.Source --version
$nodeVersion = $nodeVersion.TrimStart('v')
$nodeParsed = [version]$nodeVersion
$nodeOk = ($nodeParsed.Major -eq 20 -and $nodeParsed.Minor -ge 19) -or ($nodeParsed.Major -ge 22 -and ($nodeParsed.Major -gt 22 -or $nodeParsed.Minor -ge 12))
if (-not $nodeOk) { Write-Error "Node.js $nodeVersion was found; Node.js 20.19+ or 22.12+ is required."; exit 1 }

New-Item -ItemType Directory -Force -Path $runDir, $logDir | Out-Null
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Host 'Creating the project-local Python environment...'
    & $pythonCmd.Source -m venv (Join-Path $root '.venv')
    if ($LASTEXITCODE -ne 0) { Write-Error 'Could not create .venv. Check the Python installation.'; exit 1 }
}
$dependencyCheck = & $venvPython -c 'import fastapi,uvicorn,networkx,pydantic,dotenv' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Backend dependency import check failed; installing requirements. Import diagnostic:'
    $dependencyCheck | ForEach-Object { Write-Host $_ }
    Write-Host 'Installing backend packages into .venv (no global packages will be changed)...'
    & $venvPython -m pip install -r (Join-Path $root 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { Write-Error 'Backend dependency installation failed. See the pip error above.'; exit 1 }
    & $venvPython -m pip check
    if ($LASTEXITCODE -ne 0) { Write-Error 'Backend dependencies are inconsistent after installation.'; exit 1 }
}
if (-not (Test-Path (Join-Path $root 'node_modules\vite\bin\vite.js'))) {
    Write-Host 'Installing frontend packages from package-lock.json...'
    Push-Location $root
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { Write-Error 'npm ci failed.'; exit 1 } } finally { Pop-Location }
}

# Importing the API module initializes SQLite and seeds the synthetic background records.
Push-Location $root
try { & $venvPython -c 'from backend.main import init; init(); print(1)'; if ($LASTEXITCODE -ne 0) { Write-Error 'Database initialization failed.'; exit 1 } } finally { Pop-Location }

if (Test-Path $pidFile) { Stop-ScamTrace }
foreach ($port in @(8000,5173)) {
    $listener = netstat -ano | Select-String -Pattern "127\.0\.0\.1:$port\s+.*LISTENING\s+(\d+)" | Select-Object -First 1
    if ($listener) {
        $portPid = $listener.Matches[0].Groups[1].Value
        Write-Error "Port $port is already in use by PID $portPid. Stop that process and rerun .\start.ps1."
        exit 1
    }
}
$backendOut = Join-Path $logDir 'backend.log'; $backendErr = Join-Path $logDir 'backend-error.log'
$frontendOut = Join-Path $logDir 'frontend.log'; $frontendErr = Join-Path $logDir 'frontend-error.log'
$backend = Start-Process -FilePath $venvPython -ArgumentList @('-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
$frontend = Start-Process -FilePath $nodeCmd.Source -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
@{ backend=$backend.Id; frontend=$frontend.Id } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8

$ready = $false
$lastReadyError = ''
for ($i=0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 750
    try {
        $api = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 2
        $web = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2
        if ($api.StatusCode -eq 200 -and $web.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        $lastReadyError = $_.Exception.Message
        if ($backend.HasExited -or $frontend.HasExited) { break }
    }
}
if (-not $ready) {
    Write-Host "Startup did not complete. Last readiness error: $lastReadyError" -ForegroundColor Red
    Write-Host 'Recent backend log:' -ForegroundColor Red
    if (Test-Path $backendErr) { Get-Content $backendErr -Tail 30 }
    Write-Host 'Recent frontend log:' -ForegroundColor Red
    if (Test-Path $frontendErr) { Get-Content $frontendErr -Tail 30 }
    Stop-ScamTrace
    exit 1
}
$backendListener = $null
$listenerLine = netstat -ano | Select-String -Pattern '127\.0\.0\.1:8000\s+0\.0\.0\.0:0\s+LISTENING\s+(\d+)' | Select-Object -First 1
if ($listenerLine) { $backendListener = [int]$listenerLine.Matches[0].Groups[1].Value }
if (-not $backendListener) { Write-Error 'The API health check passed, but its listener PID could not be tracked.'; Stop-ScamTrace; exit 1 }
@{ backend=$backend.Id; backendListener=$backendListener; frontend=$frontend.Id } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8
Write-Host ''
Write-Host 'ScamTrace AI is ready (synthetic data only).' -ForegroundColor Green
Write-Host 'Application: http://localhost:5173'
Write-Host 'API docs:    http://localhost:8000/docs'
Write-Host 'Health:      http://localhost:8000/api/health'
Write-Host 'Stop both processes with: .\start.ps1 -Stop'
Write-Host "Logs: $logDir"
