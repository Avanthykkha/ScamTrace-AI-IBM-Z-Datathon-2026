"""Optional Redpanda transport for synthetic transaction events.

The local SQLite path remains authoritative for the desktop demo. When
SCAMTRACE_KAFKA_BOOTSTRAP is configured, each accepted event is also published
to the Redpanda/Kafka topic for independent stream processing.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from typing import Any

_lock = threading.Lock()
_producer = None
_error = ""
_consumer_thread = None
_consumer_stop = threading.Event()


def publish_transaction(event: dict[str, Any]) -> bool:
    global _producer, _error
    brokers = os.getenv("SCAMTRACE_KAFKA_BOOTSTRAP", "").strip()
    if not brokers:
        return False
    try:
        with _lock:
            if _producer is None:
                from kafka import KafkaProducer
                _producer = KafkaProducer(
                    bootstrap_servers=[x.strip() for x in brokers.split(",") if x.strip()],
                    value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                    key_serializer=lambda value: value.encode("utf-8"),
                    retries=2,
                    request_timeout_ms=1500,
                    max_block_ms=1500,
                )
            producer = _producer
        payload = dict(event)
        payload["event_time_ms"] = int(datetime.fromisoformat(str(event["ts"]).replace("Z", "+00:00")).timestamp() * 1000)
        producer.send(
            os.getenv("SCAMTRACE_KAFKA_TRANSACTIONS_TOPIC", "scamtrace.transactions"),
            key=str(event["id"]),
            value=payload,
        )
        producer.flush(timeout=2)
        _error = ""
        return True
    except Exception as exc:  # optional infrastructure must not stop local ingest
        _error = f"{type(exc).__name__}: {exc}"
        return False


def status() -> dict[str, Any]:
    configured = bool(os.getenv("SCAMTRACE_KAFKA_BOOTSTRAP", "").strip())
    return {
        "configured": configured,
        "connected": bool(_producer is not None and not _error),
        "bootstrap": os.getenv("SCAMTRACE_KAFKA_BOOTSTRAP", "") if configured else None,
        "topic": os.getenv("SCAMTRACE_KAFKA_TRANSACTIONS_TOPIC", "scamtrace.transactions"),
        "last_error": _error or None,
        "alerts_topic": os.getenv("SCAMTRACE_KAFKA_ALERTS_TOPIC", "scamtrace.alerts"),
    }


def close() -> None:
    global _producer
    _consumer_stop.set()
    with _lock:
        if _producer is not None:
            try:
                _producer.close(timeout=1)
            except Exception:
                pass
            _producer = None


def start_alert_consumer(on_alert) -> None:
    """Consume Flink findings into the application's durable alert inbox."""
    global _consumer_thread
    if not os.getenv("SCAMTRACE_KAFKA_BOOTSTRAP", "").strip():
        return
    with _lock:
        if _consumer_thread and _consumer_thread.is_alive():
            return
        _consumer_stop.clear()
        _consumer_thread = threading.Thread(target=_consume_alerts, args=(on_alert,), daemon=True, name="scamtrace-flink-alerts")
        _consumer_thread.start()


def _consume_alerts(on_alert) -> None:
    while not _consumer_stop.is_set():
        consumer = None
        try:
            from kafka import KafkaConsumer
            consumer = KafkaConsumer(
                os.getenv("SCAMTRACE_KAFKA_ALERTS_TOPIC", "scamtrace.alerts"),
                bootstrap_servers=[x.strip() for x in os.getenv("SCAMTRACE_KAFKA_BOOTSTRAP", "").split(",") if x.strip()],
                value_deserializer=lambda raw: json.loads(raw.decode("utf-8")),
                group_id="scamtrace-api-alert-inbox",
                auto_offset_reset="earliest",
                consumer_timeout_ms=1000,
                request_timeout_ms=3000,
                api_version_auto_timeout_ms=3000,
            )
            for message in consumer:
                if _consumer_stop.is_set():
                    break
                on_alert(message.value)
        except Exception:
            _consumer_stop.wait(3)
        finally:
            if consumer is not None:
                try:
                    consumer.close(autocommit=False)
                except Exception:
                    pass
