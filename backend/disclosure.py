"""Explicit allow-list for synthetic cross-institution disclosures."""
import json
import os
from pathlib import Path
from typing import Any

POLICY_FILE = Path(__file__).resolve().parents[1] / "config" / "disclosure-policy.json"

def load_policy() -> dict[str, Any]:
    return json.loads(Path(os.getenv("SCAMTRACE_DISCLOSURE_POLICY", str(POLICY_FILE))).read_text(encoding="utf-8"))

def permitted_signal(event: dict[str, Any], requested: list[str] | None = None, recipient: str | None = None, purpose: str | None = None) -> dict[str, Any]:
    policy = load_policy()
    if recipient is not None and recipient not in policy.get("signal_recipients", [policy["recipient"]]):
        raise ValueError("Signal policy prohibits this recipient")
    if purpose is not None and purpose != policy["purpose"]:
        raise ValueError("Signal policy prohibits this purpose")
    fields = requested if requested is not None else policy["signal_fields"]
    prohibited = sorted(set(fields) - set(policy["signal_fields"]))
    if prohibited:
        raise ValueError("Signal policy prohibits fields: " + ", ".join(prohibited))
    if not set(fields) <= event.keys():
        raise ValueError("Signal is missing policy-approved fields")
    # Exact allow-list projection; no event extras can cross this boundary.
    return {key: event[key] for key in policy["signal_fields"] if key in fields}
