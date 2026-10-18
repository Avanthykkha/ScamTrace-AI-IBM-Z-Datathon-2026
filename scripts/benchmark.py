"""Execute seeded synthetic scenarios and save measured, scenario-level metrics."""
from __future__ import annotations

import json
import os
import statistics
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
MANIFEST = json.loads((ROOT / "reports" / "scenario-manifest.json").read_text(encoding="utf-8"))

with tempfile.TemporaryDirectory(prefix="scamtrace-eval-") as temp_root:
    temp = Path(temp_root)
    os.environ["SCAMTRACE_DB"] = str(temp / "case-audit.db")
    os.environ["SCAMTRACE_CORRELATION_DB"] = str(temp / "correlation.db")
    os.environ["SCAMTRACE_DATA_DIR"] = str(temp / "data")
    os.environ.pop("SCAMTRACE_LINKAGE_SECRET", None)

    import backend.main as app
    from fastapi.testclient import TestClient

    app.DB = temp / "case-audit.db"
    app.CORRELATION_DB = temp / "correlation.db"
    app.init()
    app.STREAM["running"] = False
    client = TestClient(app.app)
    scenario_results = []
    latencies = []
    event_durations = []
    detector_durations = []
    execution_durations = []

    for spec in MANIFEST["scenarios"]:
        reset = client.post("/api/simulator/reset")
        reset.raise_for_status()
        response = client.post("/api/scenarios/run", json={"scenario": spec["id"], "seed": spec["seed"]})
        response.raise_for_status()
        run = response.json()
        refs = set(run["transaction_ids"])
        cases = client.get("/api/cases").json()
        matching = [case for case in cases if refs.intersection(case["tx_ids"])]
        detected = bool(matching)
        tx_rows = {row["id"]: row for row in client.get("/api/transactions", params={"limit": 500}).json()}

        case_delays = []
        for case in matching:
            supporting = [tx_rows[ref] for ref in case["tx_ids"] if ref in refs and ref in tx_rows]
            receipt_times = [datetime.fromisoformat(row["received_at"]) for row in supporting if row.get("received_at")]
            detection_time = case.get("detection_ts") or case.get("created_at")
            if receipt_times and detection_time:
                delta = (datetime.fromisoformat(detection_time) - max(receipt_times)).total_seconds() * 1000
                if delta >= 0:
                    case_delays.append(delta)
        detected_latency = round(min(case_delays), 3) if case_delays else None
        if detected_latency is not None:
            latencies.append(detected_latency)

        timings = run["timings"]
        event_durations.append(timings["event_processing_ms"]["mean"])
        detector_durations.append(timings["detector_evaluation_ms_total"])
        execution_durations.append(timings["scenario_execution_ms"])
        scenario_results.append({
            "scenario": spec["id"],
            "seed": spec["seed"],
            "ground_truth": spec["ground_truth"],
            "detected": detected,
            "transaction_ids": sorted(refs),
            "case_ids": sorted(case["id"] for case in matching),
            "case_count": len(matching),
            "transaction_count": len(refs),
            "detection_mode": run["detection_mode"],
            "detection_latency_ms": detected_latency,
            "event_processing_ms": timings["event_processing_ms"],
            "detector_evaluation_ms_total": timings["detector_evaluation_ms_total"],
            "scenario_execution_ms": timings["scenario_execution_ms"],
            "settled_transfers": run["settled"],
            "simulated_prevented_transfers": run["simulated_prevented"],
            "late_detection": run["late_detection"],
        })

    tp = sum(row["ground_truth"] == "suspicious" and row["detected"] for row in scenario_results)
    fp = sum(row["ground_truth"] == "benign" and row["detected"] for row in scenario_results)
    tn = sum(row["ground_truth"] == "benign" and not row["detected"] for row in scenario_results)
    fn = sum(row["ground_truth"] == "suspicious" and not row["detected"] for row in scenario_results)
    report = {
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "generated_by": "scripts/benchmark.py executing /api/simulator/reset and /api/scenarios/run in isolated temporary databases",
        "execution_command": "python scripts/benchmark.py",
        "evaluation_unit": MANIFEST["evaluation_unit"],
        "classification_rule": MANIFEST["classification_rule"],
        "evaluation": "Scenario-level functional benchmark on generated synthetic fixtures. Ground truth is maintained in a separate manifest and joined by the evaluator; scenario labels are not passed to the detector.",
        "confusion_counts": {"true_positives": tp, "false_positives": fp, "true_negatives": tn, "false_negatives": fn},
        "metrics": {
            "precision": round(tp / (tp + fp), 4) if tp + fp else None,
            "recall": round(tp / (tp + fn), 4) if tp + fn else None,
            "false_positive_rate": round(fp / (fp + tn), 4) if fp + tn else None,
        },
        "latency_summary_ms": {
            "definition": "Detection latency is case detection timestamp minus the latest received_at timestamp among supporting scenario events. Event processing includes persistence and online detector work. Scenario execution measures the full scenario endpoint separately.",
            "detection_latency_mean": round(statistics.mean(latencies), 3) if latencies else None,
            "event_processing_mean_per_scenario": round(statistics.mean(event_durations), 3) if event_durations else None,
            "detector_evaluation_total_mean_per_scenario": round(statistics.mean(detector_durations), 3) if detector_durations else None,
            "scenario_execution_mean": round(statistics.mean(execution_durations), 3) if execution_durations else None,
        },
        "scenarios": scenario_results,
        "limitations": [
            "Five hand-authored synthetic scenarios are a functional regression sample, not a statistical accuracy estimate.",
            "The evaluator's ground-truth manifest describes only these fixtures; scenario labels are not available to the detector query or signal schema.",
            "Synthetic institutions, accounts, timings, and intervention effects do not represent real payment systems or adversarial behavior.",
            "Processing timings are local machine measurements and vary by hardware and load; scenario execution is reported separately.",
            "No real-world dataset, account ownership context, calibration, or independent validation is present.",
        ],
    }

output = ROOT / "reports" / "benchmark.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
