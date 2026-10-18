"""Local correlation-service boundary for allow-listed synthetic signals.

This is a service component inside the FastAPI process, backed by a database
separate from case metadata and institution-local ledgers. It is not a remote
or independently isolated financial institution service.
"""
from typing import Any

from backend.disclosure import load_policy

def persist_signal(connection, signal: dict[str, Any]) -> bool:
    fields = load_policy()["signal_fields"]
    if set(signal) != set(fields):
        raise ValueError("Correlation service accepts only the exact approved signal schema")
    cur = connection.execute(
        "INSERT OR IGNORE INTO correlation_store.transactions "
        "(id,ts,sender,receiver,amount,currency,rail,source_bank,dest_bank,status,received_at,detection_ms) "
        "VALUES(:id,:ts,:sender,:receiver,:amount,:currency,:rail,:source_bank,:dest_bank,:status,:received_at,:detection_ms)",
        signal,
    )
    return cur.rowcount > 0
