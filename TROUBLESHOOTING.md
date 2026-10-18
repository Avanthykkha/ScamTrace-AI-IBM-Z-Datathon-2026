# Windows local troubleshooting

## `start.ps1` reports Python or Node.js is missing

Install Python 3.11+ and Node.js 20.19+ or 22.12+, close PowerShell, and open a new window. Check `python --version` and `node --version`. The app uses `.venv` for Python packages and does not install them globally.

## Backend dependency install or import fails

Run:

```powershell
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe -m pip check
```

If package installation fails, keep the pip error output and check network/proxy settings. Do not delete `.venv` until the error is understood; recreating it is safe if it has become corrupted.

## Port 8000 or 5173 is already in use

Run `./start.ps1 -Stop` for processes owned by this launcher's process record. If an unrelated process owns a port, identify it before stopping it. Do not terminate a PID just because the port is busy. The backend URL is `http://127.0.0.1:8000`; Vite serves the UI at `http://127.0.0.1:5173` and proxies `/api` to the backend.

## App page loads but API is offline

Check these separately:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:5173/api/health
```

The second request checks frontend-to-backend proxying. Review `logs/backend-error.log`, `logs/backend.log`, `logs/frontend-error.log`, and `logs/frontend.log`. The launcher writes errors there and shows recent error logs if readiness times out.

## Database is locked or old cases remain

SQLite files live under `data/` unless `SCAMTRACE_DB` overrides the path. Stop the simulator before a controlled run. `./scripts/run-scenarios.ps1` pauses the feed and resets the synthetic DB between cases; reset deletes demo cases, transactions, requests, and intervention audit history. Do not remove `data/.scamtrace_linkage_key` if you need stable tokens across an existing local dataset.

OneDrive synchronization can delay SQLite file access. If a reproducible lock occurs, stop the app and use a local non-synced project/database path before retrying. Keep backups before manually moving database files.

## Tests or benchmark fail

Run the failing command directly and keep its exit code/output. Use `./scripts/verify-local.ps1 -SkipNpmCi` only when `node_modules` already matches `package-lock.json`; omit the switch for a clean frontend install. The benchmark writes `reports/benchmark.json` from fresh seeded fixture executions. It is a small synthetic functional check, not a fraud-accuracy claim.

## Investigator report is not using the deterministic fallback

The local fallback needs no API key. If `/api/health` reports a configured language-model endpoint, inspect `.env` privately and clear `SCAMTRACE_LLM_URL`, `SCAMTRACE_LLM_MODEL`, `SCAMTRACE_API_KEY`, and `SCAMTRACE_AGENT_URL` for the no-key demo. Never paste secret values into issue reports or logs.

## Credentials and secrets

`.env` is ignored by Git. `.env.example` contains blank credential fields. Run `./.venv/Scripts/python.exe scripts/check-secrets.py` to check common embedded token/key formats without printing matched values. The scanner is a guardrail, not a full secret-management or repository-history audit. If the working directory has no Git metadata, tracked/committed status cannot be confirmed.
