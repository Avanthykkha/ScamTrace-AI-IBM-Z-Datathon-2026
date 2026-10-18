"""Synthetic bank-local ledgers and a minimized cross-bank event projection.

This is an architectural demo only. Its shared HMAC key is deliberately a
synthetic fixture key; it is not a production privacy or key-management design.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from backend.disclosure import load_policy, permitted_signal

INSTITUTIONS = (
    "Aster Bank",
    "Bluepeak Finance",
    "Cedar Payments",
    "Northstar Credit",
    "Tideway Bank",
)

def _linkage_key() -> bytes:
    configured = os.getenv("SCAMTRACE_LINKAGE_SECRET")
    if configured:
        return configured.encode("utf-8")
    path = Path(os.getenv("SCAMTRACE_DATA_DIR", "data")) / ".scamtrace_linkage_key"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return path.read_bytes()
    except FileNotFoundError:
        key = secrets.token_bytes(32)
        try:
            with path.open("xb") as stream:
                stream.write(key)
        except FileExistsError:
            return path.read_bytes()
        return key


def account_token(account_id: str) -> str:
    """Return a stable demo pseudonym; equality is intentionally linkable."""
    key = _linkage_key()
    digest = hmac.new(key, account_id.encode("utf-8"), hashlib.sha256).hexdigest()[:20]
    return f"ACCT-{digest}"


def is_account_token(value: str) -> bool:
    return bool(re.fullmatch(r"ACCT-[0-9a-f]{20}", str(value)))


def shared_event(event: dict[str, Any]) -> dict[str, Any]:
    """Fields available to the shared detector; raw account labels stay local."""
    projected = {
        "id": event["id"],
        "ts": event["ts"],
        "sender": account_token(str(event["sender"])),
        "receiver": account_token(str(event["receiver"])),
        "amount": event["amount"],
        "currency": event["currency"],
        "rail": event["rail"],
        "source_bank": event["source_bank"],
        "dest_bank": event["dest_bank"],
        "status": event["status"],
        "received_at": event["received_at"],
        "detection_ms": event.get("detection_ms", 0),
    }
    policy=load_policy()
    return permitted_signal(projected,recipient=policy["recipient"],purpose=policy["purpose"])


def _ledger_path(root: Path, institution: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", institution.lower()).strip("-")
    directory = root / "institutions"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{slug}.db"


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=20)
    conn.execute("""CREATE TABLE IF NOT EXISTS local_events (
        transaction_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('OUT','IN')),
        local_account_id TEXT NOT NULL,
        counterparty_token TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        rail TEXT NOT NULL,
        status TEXT NOT NULL,
        event_time TEXT NOT NULL,
        scenario_label TEXT,
        PRIMARY KEY(transaction_id, direction)
    )""")
    return conn

@contextmanager
def _ledger(path: Path):
    conn = _connect(path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def persist_local_sides(event: dict[str, Any], root: Path) -> None:
    """Write each side only to that participant's local ledger."""
    source, destination = str(event["source_bank"]), str(event["dest_bank"])
    if source not in INSTITUTIONS or destination not in INSTITUTIONS:
        raise ValueError("Unknown synthetic institution")
    sides = [
        (source, "OUT", str(event["sender"]), account_token(str(event["receiver"]))),
        (destination, "IN", str(event["receiver"]), account_token(str(event["sender"]))),
    ]
    for institution, direction, local_account, counterparty in sides:
        with _ledger(_ledger_path(root, institution)) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO local_events VALUES(?,?,?,?,?,?,?,?,?,?)",
                (event["id"], direction, local_account, counterparty, event["amount"],
                 event["currency"], event["rail"], event["status"], event["ts"],
                 event.get("scenario") or None),
            )


def migrate_local_sides(events: list[dict[str, Any]], root: Path) -> None:
    """Backfill a prior monolithic demo DB using one connection per ledger."""
    connections = {name: _connect(_ledger_path(root, name)) for name in INSTITUTIONS}
    try:
        for event in events:
            source, destination = str(event["source_bank"]), str(event["dest_bank"])
            if source not in connections or destination not in connections:
                continue
            sides = (
                (source, "OUT", str(event["sender"]), account_token(str(event["receiver"]))),
                (destination, "IN", str(event["receiver"]), account_token(str(event["sender"]))),
            )
            for institution, direction, local_account, counterparty in sides:
                connections[institution].execute(
                    "INSERT OR IGNORE INTO local_events VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (event["id"], direction, local_account, counterparty, event["amount"],
                     event["currency"], event["rail"], event["status"], event["ts"],
                     event.get("scenario") or None),
                )
        for conn in connections.values():
            conn.commit()
    finally:
        for conn in connections.values():
            conn.close()


def status(root: Path) -> dict[str, Any]:
    """Show participant ledgers and the exact synthetic shared-field boundary."""
    institutions = []
    for name in INSTITUTIONS:
        path = _ledger_path(root, name)
        count = 0
        if path.exists():
            with _ledger(path) as conn:
                count = conn.execute("SELECT COUNT(*) FROM local_events").fetchone()[0]
        institutions.append({"name": name, "local_event_sides": count, "ledger": path.name})
    return {
        "mode": "synthetic-local-federation",
        "institutions": institutions,
        "local_fields": load_policy()["local_only_fields"],
        "shared_fields": load_policy()["signal_fields"],
        "privacy_note": "Stable HMAC pseudonyms are linkable and can expose repeated activity. They are not anonymous. The generated local key is demonstration key management only, not production key protection.",
    }


def clear_ledgers(root: Path) -> None:
    """Clear synthetic local ledgers as part of the demo reset operation."""
    for name in INSTITUTIONS:
        path = _ledger_path(root, name)
        if path.exists():
            with _ledger(path) as conn:
                conn.execute("DELETE FROM local_events")
