"""Optional PostgreSQL/Apache AGE mirror for timestamped transfer edges."""
from __future__ import annotations
import json
import os
from typing import Any

_last_error = ""

def persist_transfer(event: dict[str, Any]) -> bool:
    global _last_error
    dsn = os.getenv("SCAMTRACE_POSTGRES_DSN", "").strip()
    if not dsn:
        return False
    try:
        import psycopg
        with psycopg.connect(dsn, connect_timeout=2) as conn:
            conn.execute(
                "INSERT INTO transaction_events(transaction_id,event_time,sender,receiver,amount,payload) "
                "VALUES (%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT(transaction_id) DO NOTHING",
                (event["id"], event["ts"], event["sender"], event["receiver"], event["amount"], json.dumps(event)),
            )
            # AGE stores an event-time edge as well as the relational record.
            # IDs are JSON-escaped before they enter the Cypher expression.
            def literal(value: str) -> str:
                return json.dumps(str(value), ensure_ascii=True)
            cypher = (
                f"MERGE (s:Account {{id: {literal(event['sender'])}}}) "
                f"MERGE (r:Account {{id: {literal(event['receiver'])}}}) "
                f"CREATE (s)-[:TRANSFER {{transaction_id: {literal(event['id'])}, "
                f"amount: {float(event['amount'])}, event_time: {literal(event['ts'])}}}]->(r)"
            )
            conn.execute("LOAD 'age'")
            conn.execute('SET search_path = ag_catalog, "$user", public')
            conn.execute("SELECT * FROM cypher('scamtrace', %s) AS (created agtype)", (cypher,))
        _last_error = ""
        return True
    except Exception as exc:
        _last_error = f"{type(exc).__name__}: {exc}"
        return False

def status() -> dict[str, Any]:
    configured = bool(os.getenv("SCAMTRACE_POSTGRES_DSN", "").strip())
    return {"configured": configured, "enabled": configured and not _last_error, "last_error": _last_error or None}

def read_transfers(sender: str | None = None, since: str | None = None, until: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    dsn = os.getenv("SCAMTRACE_POSTGRES_DSN", "").strip()
    if not dsn:
        raise RuntimeError("SCAMTRACE_POSTGRES_DSN is not configured")
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(dsn, connect_timeout=3, row_factory=dict_row) as conn:
        rows = conn.execute(
            "SELECT transaction_id,event_time,sender,receiver,amount,payload "
            "FROM transaction_events WHERE (%s IS NULL OR sender=%s) "
            "AND (%s IS NULL OR event_time >= %s::timestamptz) "
            "AND (%s IS NULL OR event_time <= %s::timestamptz) "
            "ORDER BY event_time DESC LIMIT %s",
            (sender, sender, since, since, until, until, max(1, min(limit, 500))),
        ).fetchall()
    return [dict(row) for row in rows]
