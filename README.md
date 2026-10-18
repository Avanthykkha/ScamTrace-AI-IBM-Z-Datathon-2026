# ScamTrace AI

ScamTrace AI is a local cyber-defense demonstration that ingests synthetic payment events, detects explainable patterns, traces related transfers, creates evidence-backed investigation cases, and records fictional institution responses. It uses fictional accounts and institutions. **It does not connect to real banks or payment rails and cannot freeze or recover real funds.**

## Why this prototype

Investigators need to understand how fast money can move through linked accounts and what evidence supports a review. This project demonstrates an automated event-to-case workflow without requiring a victim report, bank integration, or paid AI service. Each finding includes its supporting synthetic transaction IDs and uncertainty; a rapid or high-value transfer alone is not treated as proof of fraud.

## Windows quick start

Install [Python 3.11+](https://www.python.org/downloads/windows/) and [Node.js 20.19+ or 22.12+](https://nodejs.org/). From PowerShell, open this project folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start.ps1
```

The launcher creates a project-local `.venv`, installs Python packages into it if needed, runs `npm ci` if frontend packages are missing, initializes the SQLite database, starts both local servers, checks their health, and prints their addresses. It does not install software globally. Startup errors are printed and written to `logs/`.

- App: http://localhost:5173
- API docs: http://localhost:8000/docs
- Health: http://localhost:8000/api/health

Stop both launcher-managed processes with:

```powershell
.\start.ps1 -Stop
```

If ports 8000 or 5173 are occupied by another application, the launcher reports the conflict and exits. Stop that app or use the manual commands below with alternate ports and update `vite.config.ts` accordingly.

## Manual setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci
```

In two PowerShell windows (from the project folder):

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

# Terminal 2
npm run dev -- --host 127.0.0.1
```

Press Ctrl+C in each terminal to stop the manual servers. Copy `.env.example` to `.env` to adjust the database location or deterministic detector thresholds. No API key is needed. By default reports use the local structured fallback. To opt into an OpenAI-compatible chat-completions service, configure `SCAMTRACE_LLM_URL`, `SCAMTRACE_LLM_MODEL`, and (if required by that provider) `SCAMTRACE_API_KEY`. The URL must use HTTPS, except a local provider may use HTTP on `localhost`/`127.0.0.1`. Redirects are rejected. The app contacts only that explicitly configured endpoint, validates the returned schema and evidence references, and falls back locally on errors.

## Project layout

```text
backend/main.py       FastAPI routes, SQLite persistence, simulator, detector, graph, reports, workflow
backend/advanced_stream.py Optional Redpanda publisher and Flink alert consumer
backend/federation.py Synthetic institution-local ledgers and linkage tokens
backend/disclosure.py Explicit allow-list projection into the correlation service
backend/correlation.py Correlation component that rejects non-exact signal schemas
backend/temporal_graph.py Optional PostgreSQL/Apache AGE event-time graph mirror
backend/temporal_bridge.py Optional Temporal workflow client bridge
streaming/            Flink job, Temporal worker, AGE schema, and monitoring config
docker-compose.advanced.yml Optional Redpanda, Flink, PostgreSQL AGE, Temporal, OTel, Prometheus, Grafana stack
src/App.tsx           React operations console connected to API endpoints
src/style.css         Dark operations-center interface
tests/test_api.py     Backend, detection, persistence, idempotency, workflow, and fallback tests
scripts/benchmark.py  Runs controlled fixtures and calculates sample metrics
reports/benchmark.json Executed benchmark output used by the UI
scripts/verify-local.ps1 Installs dependencies, builds, tests, benchmarks, and scans source
scripts/run-scenarios.ps1 Replays isolated synthetic scenarios through the local API
scripts/check-secrets.py Scans source without printing matched credential values
reports/local-demo-verification.json Actual local API scenario verification record
start.ps1             Windows-local setup, launch, readiness check, and stop command
DEMO.md               Short local investor walkthrough checklist
TROUBLESHOOTING.md    Windows startup, database, dependency, and API help
ARCHITECTURE.mmd      Mermaid data-flow diagram
```

## Architecture and data flow

The simulator writes each transfer side to an institution-scoped SQLite ledger under `data/institutions/`. These are logical participant stores managed by one local process, not independent bank services. The correlation projection is kept in a separate `data/correlation.db`; cases, evidence-request metadata, and audit history remain in `data/scamtrace.db`. `config/disclosure-policy.json` controls the exact signal field allow-list, recipient and purpose, local-only fields, and evidence-request fields and purpose. The policy is applied before insertion to the correlation store and before publication to optional stream/graph connectors. `GET /api/federation` exposes the policy and field boundary; `GET /api/disclosures/history` exposes audit metadata without returning institution-local evidence.

Signal payload includes transaction reference, event/receipt timestamps, linkage tokens, amount/currency, rail/status, and fictional source/destination institutions. It excludes local account labels and scenario labels. A separate case-linked investigator request requires a `SCAMTRACE_INVESTIGATOR_TOKEN`, a participating institution reviewer requires `SCAMTRACE_INSTITUTION_REVIEW_TOKEN`, and the configured credentials are compared server-side. Approved responses include only requested allow-listed fields. Keep both credentials in the runtime environment; none is embedded in source. When no linkage secret is configured, a random 256-bit key is written to the ignored runtime file `data/.scamtrace_linkage_key`; `SCAMTRACE_LINKAGE_SECRET` may be configured for stable tokens across deployments. Existing tokens depend on their original key.

To use a separately maintained policy file, set `SCAMTRACE_DISCLOSURE_POLICY` to its filesystem path before starting the API. Policy changes affect subsequent signal disclosures and evidence requests; validate policy edits before deployment.

### Prototype threat model and limits

This is a synthetic demonstration; do not load real account or transaction data. Stable HMAC linkage tokens are pseudonyms, not anonymity: they expose equality, frequency, timing, institution, and amount patterns and may be reidentified with outside context. Separate SQLite files and institution-scoped access helpers are application-level architectural controls on one machine, under one process/OS identity; they are not process isolation or a secure bank-to-bank network. A local operator with filesystem access can read every ledger and both configured credentials. The prototype does not encrypt databases or backups, provide key custody/rotation, enforce institution-specific network identities, provide tamper-evident audit, establish legal authority/consent, or include retention/deletion controls. It implements no secure multiparty computation, differential privacy, homomorphic encryption, or cryptographic anonymity. Production use would require independent institution services, authenticated mutually authorized transport, managed keys, encrypted storage, hardened identity/authorization, immutable audit, security review, and governance. It has not been verified on IBM Z/LinuxONE.

The ingestion path invokes deterministic rolling-window and graph rules. A new finding creates a case with rule IDs, exact evidence transaction IDs, detection time, severity, and observed-versus-inferred notes. The graph is built from persisted pseudonymous transaction records and preserves parallel transfers. A schema-validated report is generated locally and persisted. High-severity findings can trigger a simulated review request with persisted audit transitions.

See [ARCHITECTURE.mmd](ARCHITECTURE.mmd) for the diagram. The default launcher still uses the lightweight SQLite path. The advanced stack adds a Redpanda event topic, a Flink one-minute fan-out detector and alert topic, a PostgreSQL/AGE temporal-edge mirror, and a Temporal intervention timeout workflow. Existing deterministic detection remains active locally so the app works without infrastructure.

## Optional advanced stack

Docker Desktop is required for these extra services. Start the base app once so it initializes `data/scamtrace.db`, then start the infrastructure:

```powershell
.\scripts\start-advanced.ps1
```

Enable integrations in `.env`, install the optional API connectors, and restart the base app:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-advanced.txt
.\start.ps1
```

Set these values in `.env`:

```dotenv
SCAMTRACE_KAFKA_BOOTSTRAP=127.0.0.1:19092
SCAMTRACE_TEMPORAL_ADDRESS=127.0.0.1:7233
SCAMTRACE_POSTGRES_PASSWORD=
SCAMTRACE_POSTGRES_DSN=
SCAMTRACE_GRAFANA_PASSWORD=

SCAMTRACE_AGENT_URL=http://127.0.0.1:8010/investigate
OPENAI_API_KEY=your-key-for-the-isolated-agent-container
```

Set the optional stack credentials and PostgreSQL DSN only in your ignored local .env; the base SQLite demo does not require them. Do not commit populated credential values.

The API publishes each newly ingested synthetic event to `scamtrace.transactions`; Flink groups events by sender and event-time minute, then emits a `RAPID_FAN_OUT` alert after four transfers to three or more recipients. The API consumes those findings into `/api/stream/alerts`. Apache AGE stores timestamped `TRANSFER` edges, available through `/api/graph/temporal?sender=...&since=...&until=...`. Temporal tracks simulated intervention responses and expires unanswered requests after two minutes. The isolated investigation container has no tools, database credentials, or project mounts; it receives only a bounded evidence payload and returns schema-checked specialist findings. The API checks evidence IDs and preserves the deterministic timeline and detector reasons. Model use requires an API key and may incur provider charges; without a key, reports use the local fallback. `/api/health` reports optional connector state. All advanced services are opt-in; local detection and the SQLite UI continue to work when they are stopped.

The advanced stack exposes Redpanda Kafka at `localhost:19092`, Flink UI at `http://localhost:8082`, Temporal at `localhost:7233`, PostgreSQL/AGE at `localhost:5433`, the isolated investigation service at `localhost:8010`, Prometheus at `http://localhost:9090`, and Grafana at `http://localhost:3000`. Configure the Grafana login password locally with SCAMTRACE_GRAFANA_PASSWORD before starting the optional stack. Stop the services with `.\scripts\start-advanced.ps1 -Stop`. This demo configuration is for a local synthetic environment, not internet exposure.

## IBM Z / LinuxONE deployment readiness

### What is implemented today

This repository is a Windows-local synthetic prototype. The default application is one FastAPI process with SQLite persistence, deterministic Python rules, NetworkX graph construction, and a React/Vite frontend. Institution ledgers and the correlation database are separate files and access paths, but run under the same process and operating-system identity. The frontend calls this application's HTTP API. There is no bank/payment-rail connector, IBM service connector, or deployment artifact verified on an IBM Z or LinuxONE host.

The optional Compose stack is a local integration/demo topology, not a production reference deployment. It contains source/configuration for Kafka-compatible publishing, a Flink job, PostgreSQL/AGE mirroring, Temporal workflow handling, an investigation service, and metrics dashboards. These are optional integrations; presence of source or an image tag does not establish runtime compatibility, production readiness, or successful operation on `s390x`.

### Platform compatibility assessment

| Component | Evidence in this repository | LinuxONE / IBM Z assessment |
|---|---|---|
| React, TypeScript, Vite UI | `src/`, `package.json`; browser UI calls FastAPI | Browser code is platform-independent. A Node build is needed only to build assets; deploy built static assets or a supported web server. Node build/runtime availability for the chosen target image is unverified here. |
| FastAPI API and Python rules | `backend/main.py`, `backend/disclosure.py`, `backend/correlation.py`; `requirements.txt` | Python application code is not tied to x86 APIs. Actual Python runtime, wheels, `uvicorn[standard]` native extras, and every resolved dependency must be installed and tested on Linux `s390x`. No such test was run. |
| SQLite local stores | Python standard-library SQLite use in backend | No IBM-specific dependency; suitable for a local demo. SQLite files on one host do not provide institution isolation, high availability, or shared-cluster coordination. Production persistence and backup/failover design are not implemented. |
| NetworkX graph | `requirements.txt`, detector/graph code in `backend/main.py` | Python-level dependency; target install and representative workload are unverified on `s390x`. This is an in-process prototype graph, not a distributed graph service. |
| Cross-bank disclosure/correlation | `backend/federation.py`, `backend/disclosure.py`, `backend/correlation.py` | Application-level allow-list logic is platform-independent. Institution services, identity federation, secure transport, key custody, governance, and production audit are not implemented. |
| Redpanda/Kafka, Flink, Postgres/AGE, Temporal | `backend/advanced_stream.py`, `backend/temporal_graph.py`, `backend/temporal_bridge.py`, `streaming/`, `docker-compose.advanced.yml` | Connectors speak standard client protocols, but server images, Java/Python runtimes, AGE extension builds, and native dependencies must each support the target architecture. The Compose file has no `platform: linux/s390x` declarations or target verification. Compatibility and end-to-end operation are unverified. |
| PowerShell launcher and package scripts | `start.ps1`, `scripts/*.ps1` | Windows-specific. They do not deploy to Linux. Linux service startup, readiness, shutdown, and operations packaging must be supplied separately; the local Windows demo remains available. |
| IBM-specific integration | Repository source review | None implemented or verified: no CICS, IBM MQ, Db2, z/OS Connect, RACF, or IBM deployment automation integration. LinuxONE/IBM Z here means Linux on IBM Z (`s390x`), not z/OS. |

The source-level portability assessment is not a compatibility certification. Do not infer target support from pure-Python source, a container tag, or operation on Windows/x86. Check actual package wheels, container manifests, extensions, and vendor support for the exact versions.

### Proposed deployment shape

The right-hand side of [ARCHITECTURE.mmd](ARCHITECTURE.mmd) is a proposal, not a deployed system. Each participating institution would keep its transaction system and local records under its own operational and authorization boundary. A local gateway would project only policy-approved signals to a separately operated correlation service. That service would correlate, detect, reconstruct graph paths, and return evidence requests through an authenticated, audited workflow. An intervention adapter would remain a simulated response until a participating institution establishes authority, API, and approval process. Evaluation would use isolated synthetic data and keep scenario labels out of detector inputs.

LinuxONE/IBM Z could be considered as an enterprise Linux hosting environment where it fits an institution's existing transaction, identity, security, and operations estate. Those are architectural fit considerations, not measured ScamTrace performance or privacy benefits. The platform does not by itself make rules faster, findings more accurate, or shared data more private. Those outcomes require workload measurements and independently reviewed controls.

### Deployment requirements and verification plan

No IBM Z/LinuxONE system was available in this session. The execution environment was Windows, and `docker` was not found on the shell path. No target build, deployment, compatibility test, or performance test was performed. The local Windows quick-start remains the intended demonstration path and does not require Docker.

Before claiming a target deployment, an operator would need to:

1. Provision an authorized Linux on IBM Z/LinuxONE test host or LPAR, record the Linux distribution/version and `uname -m` result (`s390x` expected), and identify supported Python, Node/build, Java, and container-engine versions.
2. Create a clean target environment and install `requirements.txt`; resolve every dependency for that exact Python/Linux `s390x` combination. Record `pip check`, import/startup results, and full test/benchmark results on that host. Build the frontend with a supported Node toolchain or transfer reviewed static build artifacts.
3. For optional containers, inspect registry manifests for every exact image/tag and confirm `linux/s390x`, or build and maintain the image from source. This includes Redpanda, Flink base/runtime and Kafka connector, PostgreSQL plus AGE extension, Temporal services, the agent image, and monitoring images. Confirm Java/Python packages and native libraries. The current Compose file does not perform these checks.
4. Replace the local demo topology with separate institution services, durable transport, service identities, mutual TLS, authorization, managed secrets/keys, network segmentation, encrypted persistent storage/backups, retention, tamper-resistant audit, monitoring, recovery, upgrades, and capacity/failover testing. Keep credentials outside source and images.
5. Configure persistent storage, health/readiness checks, restart policy, resource limits, and a supported Linux service/container orchestrator. Run synthetic end-to-end disclosure, evidence-request, detection, graph, intervention-audit, regression, and recovery tests. Do not connect real records or intervention APIs until separately authorized and reviewed.
6. Record the exact host environment, image digests, dependency lock state, commands, logs, test outcomes, and limitations. Only then describe the tested scope as IBM Z/LinuxONE verified.

### Verified integrations

Verified at source/configuration level: the local React-to-FastAPI HTTP path, SQLite persistence, deterministic Python detection/graph path, synthetic institution-scoped stores and policy projection, and synthetic evaluation workflow are part of the application. Optional source/configuration exists for Kafka-compatible event publishing, Flink alerts, PostgreSQL/AGE transfer mirroring, Temporal workflows, and an isolated investigation service. This review does not claim those optional services were running. No IBM product integration, IBM Z/LinuxONE deployment, or `s390x` compatibility result is verified.

## Run the demo

The dashboard includes **Overview**, **Tracked accounts**, **Investigations**, **Fund flow**, **Response center**, **Data sharing**, and **Evaluation**. The synthetic event feed starts with the backend by default. Run the repeatable walkthrough in [DEMO.md](DEMO.md), or verify every scenario against the running local API with `./scripts/run-scenarios.ps1`. That script stops the background feed, resets between fixtures, records observed API results in `reports/local-demo-verification.json`, and leaves a final fixed-seed rapid-transfer case available. Reset/replay deletes existing local demo cases, transactions, requests, and audit history.

Investigators can open transaction records from the timeline or graph and can submit evidence requests from a case page. Requests require configured investigator authorization and a participating-institution reviewer decision. Tokens are held only in component memory. No external API key is required for the deterministic report fallback.

## Local verification and troubleshooting

Run the reproducible Windows checks from PowerShell:

```powershell
./scripts/verify-local.ps1
./start.ps1
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:5173/api/health
./scripts/run-scenarios.ps1
./start.ps1 -Stop
```

`verify-local.ps1` installs/checks Python dependencies, runs `npm ci` and the production build, initializes and queries SQLite, runs the full pytest suite, regenerates the synthetic benchmark, and checks source files for common embedded credential formats. It does not launch the servers. `start.ps1` starts and checks both local services; the second health request verifies Vite-to-FastAPI proxying. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for port, dependency, SQLite, and report issues.

The APIs include `GET /api/federation`, `GET /api/transactions`, `GET /api/disclosures/history`, `POST /api/evidence-requests`, `POST /api/evidence-requests/{id}/decision`, and authenticated `GET /api/evidence-requests/{id}`. The central transaction API returns only the correlation projection; it does not expose institution-local evidence responses.

## API reference

FastAPI publishes interactive OpenAPI documentation at `/docs`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend, stream, database, and event-count status |
| GET | `/api/federation` | Synthetic institutions, local ledger counts, and shared/local data boundary |
| GET | `/api/transactions` | List/filter events by rail, institution, status, and amount |
| GET | `/api/transactions/{id}` | Transaction detail |
| GET | `/api/accounts/tracked` | Unique synthetic account labels linked to cases or Flink alerts |
| GET | `/api/accounts/{account_id}` | Account-level totals, related case history, and recent transfers |
| POST | `/api/transactions` | Ingest a synthetic event; caller-provided `id` makes retries idempotent |
| GET | `/api/cases`, `/api/cases/{id}` | Investigation queue and case/report evidence |
| GET | `/api/cases/{id}/evidence` | Evidence package and validated fallback report |
| GET | `/api/graph?case_id=...` | Observed account graph and bounded path sample |
| POST | `/api/simulator/start`, `/stop`, `/speed`, `/ordinary`, `/reset` | Simulator controls |
| POST | `/api/scenarios/run` | Run a synthetic fixture; optional integer `seed` reproduces its event IDs, event times, amounts, institution route, and rails |
| GET | `/api/interventions`, `/api/audit` | Fictional requests and transition history |
| POST | `/api/interventions/{id}/response` | Select a fictional response outcome |
| POST | `/api/interventions/{id}/retry` | Retry an eligible rejected/expired request once per transition |
| GET | `/api/evaluation` | Generated benchmark metrics and fixture outcomes |
| GET | `/api/stream/alerts` | Findings emitted by the optional Flink pipeline |
| GET | `/api/graph/temporal` | Timestamp-filtered transfer edges in optional Postgres/AGE storage |

## Tests and benchmark

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm run build
.\.venv\Scripts\python.exe scripts/benchmark.py
```

`scripts/benchmark.py` reads `reports/scenario-manifest.json`, uses its fixed seeds, and runs each fixture against isolated temporary case, correlation, and institution-local stores. The manifest is never sent to the detector. Evaluation unit is one scenario: positive detection means at least one persisted case contains one of that scenario's generated transaction references. The report calculates confusion counts and metrics from observed outcomes. Detection latency (case detection time minus latest supporting-event receipt), per-event processing (including persistence, detector work and local workflow recording), total detector evaluation, and whole scenario execution are measured separately. Timing is local and machine-dependent.

Run `./scripts/verify-local.ps1` to execute dependency checks, production UI build, SQLite initialization/query, the full test suite, a fresh benchmark, and the local source credential scan in one ordered PowerShell command. The benchmark report is generated by fresh seeded detector executions; it is not a record of pytest cases passing.

The five hand-authored fixtures cover rapid dispersal, collection, a four-institution chain, delayed batch detection, and benign high activity. The generated `reports/benchmark.json` is a small functional regression result, not accuracy evidence: it says nothing about real-world precision/recall, calibration, adversarial evasion, institution-specific practices, or customer context.

Regenerate the shareable project archive with:

```powershell
.\scripts\package.ps1
```

## Security, limitations, and future deployment

- Every account, bank, transaction, status response, and scenario is synthetic. There is no payment-network adapter.
- Both provider and fallback reports are Pydantic-validated. A configured provider receives only case reasons and structured transaction evidence; it receives no scenario ground truth. Returned transaction IDs and timestamps are checked against stored evidence.
- The investigation agent has no shell, filesystem, or database tools. It makes no network call unless the operator explicitly configures one model endpoint; external endpoints require HTTPS, redirects are rejected, and provider failures fall back to the local report.
- The workflow does not affect funds. `SIMULATED_PREVENTED` only marks later fixture events as blocked in a controlled local scenario.
- Rules use timing, graph structure, and configurable thresholds. There is no verified account-owner data, calibrated risk model, trained baseline, or real-world validation.
- Before production use, add authenticated and authorized institution adapters, encryption and access controls, privacy/legal review, retention controls, independent model/rule validation, observability, resilient queues, and a human-approved institution workflow. A production system would need institution and regulator agreements before handling any non-synthetic data.
