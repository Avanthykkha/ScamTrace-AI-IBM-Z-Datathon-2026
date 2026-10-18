# ScamTrace AI
### Explainable Fund-Flow Investigation with Privacy-Aware Data Sharing

**Team:** Latent Space  
**Challenge:** Wildcard — Beyond the Obvious

ScamTrace AI is a local cyber-defense prototype that transforms synthetic payment events into explainable investigation cases. It detects suspicious transaction patterns, traces related transfers, links findings to supporting evidence, and records simulated institutional responses.

Rather than examining transactions in isolation, ScamTrace AI demonstrates how related fund movements can be reconstructed while limiting the information exposed to a separate correlation component.

> **Important:** This is a synthetic-data demonstration. It does not connect to real banks or payment networks and cannot freeze, block, or recover real funds.

---

## 1. The Problem

Suspicious funds can move through multiple accounts and institutions in a short period. Money may be split, rapidly dispersed, routed through intermediaries, and eventually consolidated.

Each institution may see only part of the transaction trail. Sharing complete financial records to reconstruct that trail can introduce additional privacy, security, and governance risks.

The challenge is to connect related activity, explain why it warrants investigation, and limit unnecessary data exposure.

## 2. Our Approach

ScamTrace AI demonstrates an automated **event-to-investigation workflow** using fictional accounts, institutions, and payment events.

The prototype combines deterministic detection rules, graph-based transaction tracing, evidence-backed cases, and policy-controlled data projection.

### Key capabilities

- **Pattern detection:** Identifies configured transaction patterns, including rapid dispersal, splitting, convergence, and multi-hop transfers.
- **Fund-flow tracing:** Reconstructs relationships between linked synthetic transfers using a transaction graph.
- **Explainable investigations:** Connects findings to rule identifiers and supporting transaction references.
- **Policy-controlled sharing:** Projects an explicit allow-list of pseudonymous transaction signals into a separate correlation store.
- **Evidence requests:** Demonstrates case-linked requests and simulated institutional review decisions.
- **Auditable workflows:** Records fictional response transitions and associated audit metadata.
- **Local-first operation:** Runs the core demonstration without a paid AI service or external financial-system integration.

A rapid or high-value transfer is not, by itself, proof of fraud. Findings are investigative signals that require appropriate review.

---

## 3. How It Works

The local prototype follows this workflow:

1. **Ingest:** Synthetic payment events enter the local application.
2. **Store:** Transfer records are persisted in institution-scoped SQLite ledgers.
3. **Detect:** Deterministic rolling-window and graph-based rules identify configured patterns.
4. **Correlate:** An explicit disclosure policy selects permitted signals for a separate correlation component.
5. **Investigate:** Related transfers are reconstructed into fund-flow paths.
6. **Build evidence:** Findings are recorded as cases containing rule identifiers, supporting transaction IDs, timestamps, severity, and observed-versus-inferred notes.
7. **Record responses:** The application demonstrates simulated review and intervention workflows.

The default application uses a lightweight local architecture. Optional streaming, temporal-graph, workflow, and investigation-service integrations are provided separately and should not be assumed to be running.

---

## 4. Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Backend | Python, FastAPI | API endpoints, detection, and workflow logic |
| Persistence | SQLite | Local transaction, correlation, case, and audit stores |
| Graph analysis | NetworkX | Transaction relationships and fund-flow paths |
| Frontend | React, TypeScript, Vite | Interactive investigation console |
| Testing | pytest | Backend and workflow tests |
| Evaluation | Python benchmark scripts | Repeatable synthetic-scenario evaluation |
| Optional integrations | Redpanda, Apache Flink, PostgreSQL/Apache AGE, Temporal | Streaming, temporal graph storage, and workflow demonstrations |

The core prototype does not require an external AI API. Its default report-generation path uses a local structured fallback. An optional OpenAI-compatible endpoint can be configured separately.

---

## 5. Privacy-Aware Design

ScamTrace AI explores how transaction relationships could be investigated without routinely exposing complete institution-local records to a shared correlation component.

The prototype uses:

- An explicit field allow-list for disclosure.
- Separate institution-scoped ledger files and a correlation database.
- Pseudonymous linkage tokens for correlating related events.
- Case-linked evidence-request workflows.
- Configurable reviewer authorization and audit metadata.

### What this design does—and does not—guarantee

These mechanisms demonstrate an architectural approach to controlled data sharing; they do **not** establish production-grade privacy or anonymity.

HMAC-based linkage tokens are pseudonyms, not anonymous data. They can still reveal relationships, frequency, timing, amounts, and institution-level patterns. The local stores also run under the same application and operating-system identity, so they do not provide true isolation between independent institutions.

The prototype does not implement secure multiparty computation, differential privacy, homomorphic encryption, or cryptographic anonymity. It also lacks production-grade key management, encrypted database and backup storage, tamper-evident auditing, and a complete retention and deletion framework.

Production deployment would require independent institutional services, authenticated and authorized communication, managed keys, encryption, hardened access controls, security review, and appropriate legal and governance arrangements.

---

## 6. IBM Z / LinuxONE Relevance

IBM Z/LinuxONE is a potential enterprise Linux hosting environment for workloads that must operate within established financial-institution security, identity, and operational frameworks.

ScamTrace AI's architecture provides a starting point for evaluating transaction-event ingestion, policy-controlled signal projection, explainable detection, graph-based investigation, and auditable workflows in such an environment.

However, **the main application has not been deployed or verified on IBM Z/LinuxONE**. Its Python dependencies, native packages, optional container images, and complete service stack have not been validated on Linux `s390x`.

The repository contains an initial platform compatibility assessment and a proposed verification plan. These describe work required for a future deployment, not completed deployment results.

### Proposed validation steps

1. Provision an authorized IBM Z/LinuxONE Linux environment and record its architecture and software versions.
2. Install and verify the Python dependencies on the target architecture.
3. Build and test the frontend using a supported toolchain.
4. Verify every optional container image and native dependency for the target platform.
5. Run the test suite and synthetic end-to-end scenarios.
6. Record reproducible results, compatibility issues, and workload benchmarks.

No IBM-specific acceleration, service integration, or performance improvement is claimed by this prototype.

---

## 7. Run Locally on Windows

### Prerequisites

Install:

- [Python 3.11 or later](https://www.python.org/downloads/windows/)
- [Node.js 20.19+ or 22.12+](https://nodejs.org/)

Open PowerShell in the project directory and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start.ps1
```

The launcher creates a project-local virtual environment, installs required dependencies when necessary, initializes the SQLite database, starts the backend and frontend, and checks service readiness.

It does not install Python packages globally.

### Local endpoints

| Service | Address |
|---|---|
| Application | http://localhost:5173 |
| API documentation | http://localhost:8000/docs |
| Backend health | http://localhost:8000/api/health |

Stop the launcher-managed processes with:

```powershell
.\start.ps1 -Stop
```

If a required port is already occupied, stop the conflicting application before restarting ScamTrace AI.

### Manual setup

If you prefer to start the services separately:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci
```

In the first PowerShell window:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In the second window:

```powershell
npm run dev -- --host 127.0.0.1
```

Press `Ctrl+C` in each terminal to stop the manually started services.

---

## 8. Project Structure

```text
backend/
  main.py               API, persistence, detection, graph, and workflows
  federation.py         Synthetic institution-scoped ledgers
  disclosure.py         Disclosure policy and allow-list projection
  correlation.py        Correlation component and schema validation
  advanced_stream.py    Optional streaming integration
  temporal_graph.py     Optional PostgreSQL/AGE graph integration
  temporal_bridge.py    Optional Temporal workflow integration

src/
  App.tsx               React investigation console
  style.css             Interface styling

tests/
  test_api.py           Backend and workflow tests

scripts/
  benchmark.py          Synthetic-scenario evaluation
  verify-local.ps1      Local verification workflow
  run-scenarios.ps1     Repeatable synthetic scenarios
  check-secrets.py      Source credential-pattern scan
  package.ps1           Project archive generation

streaming/              Optional streaming and workflow configuration
config/                 Disclosure-policy configuration
reports/                Benchmark and verification outputs
DEMO.md                 Demonstration walkthrough
ARCHITECTURE.mmd        Architecture diagram
TROUBLESHOOTING.md      Setup and troubleshooting guide
start.ps1               Windows-local launcher
```

---

## 9. Demonstration

The application includes the following dashboard sections:

- **Overview:** Summary of local activity and findings.
- **Tracked accounts:** Synthetic accounts associated with cases or alerts.
- **Investigations:** Case queue and supporting evidence.
- **Fund flow:** Graph-based visualization of related transfers.
- **Response center:** Simulated institutional responses.
- **Data sharing:** Disclosure policies and sharing boundaries.
- **Evaluation:** Results from synthetic scenarios.

For a guided walkthrough, see [`DEMO.md`](DEMO.md).

To run the repeatable synthetic scenarios:

```powershell
.\scripts\run-scenarios.ps1
```

**Warning:** Resetting or replaying scenarios deletes existing local demonstration transactions, cases, requests, and audit history. Use this only with the synthetic demonstration database.

---

## 10. Testing and Evaluation

Run the backend tests:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Build the frontend:

```powershell
npm run build
```

Generate a fresh synthetic benchmark:

```powershell
.\.venv\Scripts\python.exe scripts/benchmark.py
```

For the ordered local verification workflow:

```powershell
.\scripts\verify-local.ps1
```

The verification script checks dependencies, builds the frontend, initializes and queries SQLite, runs the test suite, regenerates the benchmark, and scans source files for common embedded-credential patterns.

### Interpreting the results

The benchmark uses five hand-authored synthetic scenarios covering rapid dispersal, collection, a multi-institution chain, delayed batch detection, and benign high activity.

Its metrics describe performance against those specific fixtures. They do not establish real-world fraud-detection accuracy, calibrated risk scores, generalization to unseen transactions, resilience to adversarial evasion, or operational effectiveness in a financial institution.

Execution timings are environment-dependent and should not be interpreted as IBM Z/LinuxONE performance measurements.

---

## 11. API Overview

FastAPI provides interactive documentation at `/docs`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Service and database health |
| GET | `/api/federation` | Synthetic institutions and disclosure boundaries |
| GET | `/api/transactions` | List and filter transactions |
| GET | `/api/transactions/{id}` | Retrieve transaction details |
| POST | `/api/transactions` | Ingest a synthetic event |
| GET | `/api/cases` | List investigation cases |
| GET | `/api/cases/{id}` | Retrieve a case and its evidence |
| GET | `/api/cases/{id}/evidence` | Retrieve the evidence package |
| GET | `/api/graph?case_id=...` | Retrieve a case-linked transaction graph |
| GET | `/api/disclosures/history` | Inspect disclosure audit metadata |
| POST | `/api/evidence-requests` | Create an evidence request |
| GET | `/api/interventions` | Inspect simulated interventions |
| GET | `/api/audit` | Review workflow history |
| GET | `/api/evaluation` | Retrieve synthetic evaluation results |

Additional endpoints support account views, simulator controls, scenario execution, evidence-request decisions, streaming alerts, and optional temporal-graph queries.

Consult `/docs` on a running instance for the current schemas and endpoint details.

---

## 12. Optional Advanced Stack

The repository includes optional configuration for:

- Redpanda-compatible event streaming.
- Apache Flink stream processing.
- PostgreSQL with Apache AGE for temporal graph storage.
- Temporal workflow handling.
- An isolated investigation service.
- Prometheus and Grafana monitoring.

These components extend the local demonstration with possible streaming, graph, workflow, and observability patterns.

Their source code and configuration are not proof of successful end-to-end operation. The default application does not require these services, and their compatibility with Linux `s390x` has not been verified.

Docker Desktop is required for the documented local advanced-stack setup. See the repository's advanced-stack scripts and configuration before attempting to start these services.

Keep optional-service credentials in an ignored local environment file. Never commit populated credentials or expose the local demonstration services to the public internet.

---

## 13. Limitations and Future Work

ScamTrace AI is an investigation prototype, not a production fraud-prevention platform.

Current limitations include:

- Synthetic accounts, institutions, and transactions only.
- No live banking or payment-rail integrations.
- No real fund-freezing or recovery capability.
- No independently validated real-world detection accuracy.
- No production-grade inter-institution security or privacy guarantees.
- No verified IBM Z/LinuxONE deployment.
- No verified compatibility results for the complete optional infrastructure stack.

Future work includes target-platform validation, independent detector evaluation, stronger identity and authorization controls, managed key infrastructure, encrypted storage, resilient event processing, tamper-resistant auditing, and institution-approved response workflows.

Any use with real financial data would require appropriate authorization, privacy and legal review, independent security assessment, and institution-specific operational controls.

---

## 14. Open-Source Resources

- **ScamTrace AI:** [Project repository](https://github.com/Avanthykkha/ScamTrace-AI-IBM-Z-Datathon-2026)
- [FastAPI](https://github.com/fastapi/fastapi)
- [React](https://github.com/facebook/react)
- [TypeScript](https://github.com/microsoft/TypeScript)
- [Vite](https://github.com/vitejs/vite)
- [NetworkX](https://github.com/networkx/networkx)
- [pytest](https://github.com/pytest-dev/pytest)
- [SQLite](https://www.sqlite.org/)
- [Python](https://github.com/python/cpython)

---

## Team Latent Space

**ScamTrace AI — connect the evidence, explain the suspicious patterns, and limit unnecessary exposure of sensitive information.**
