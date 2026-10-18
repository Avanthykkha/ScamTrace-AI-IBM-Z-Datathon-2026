# Local demonstration checklist

## Before the demo

1. Open PowerShell in the project folder.
2. Run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` if scripts are blocked.
3. Run `./scripts/verify-local.ps1` to install/check backend packages, build the UI, run tests, refresh the benchmark, and scan source files for common credential formats.
4. Run `./start.ps1` and wait for its ready message. Open `http://localhost:5173`; `http://localhost:5173/api/health` confirms the frontend proxy reaches FastAPI.
5. Keep the generated `.env` credentials empty for the deterministic no-key report. No API token is needed for the basic case demonstration.

## Investigator walkthrough

1. In **Overview**, replay **Cross-bank transaction chain** or **Fast onward transfers**.
2. Open the resulting case. Follow the chronological timeline and select a transaction ID to see its stored fields. In the graph, select an edge for its transaction record or a node for the account dossier.
3. Compare the policy-shared signal fields with the institution-local fields. To demonstrate controlled sharing, submit an evidence request with configured investigator authorization, then approve or deny it using the participating institution reviewer token. Load approved evidence using investigator authorization.
4. Review benign alternatives, missing evidence, and the suggested verification steps. Treat the detection as an alert, not confirmed fraud.
5. Inspect the intervention state and audit history. A `SIMULATED_HOLD` or `SIMULATED_PREVENTED` state is a local fixture outcome; no real transfer was stopped.

## Repeatable verification

With the local app running, execute:

```powershell
./scripts/run-scenarios.ps1
```

The script pauses the background synthetic feed, resets between each scenario, checks ordinary activity, rapid dispersal, collection, cross-bank chaining, benign high activity, late detection, fund tracing, no-key reports, intervention outcomes, and fixed-seed reset/replay. It writes the actual run results to `reports/local-demo-verification.json` and leaves the final rapid-dispersal case available for inspection. The feed remains paused until restarted in the app or with `Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/simulator/start`.

Every institution, account, transaction, and intervention in the demo is synthetic. The app is not connected to banks or payment rails and cannot freeze or recover real money.
