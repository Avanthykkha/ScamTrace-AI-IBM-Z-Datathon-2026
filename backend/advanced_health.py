"""Short-timeout probes for the optional local infrastructure shown in the UI."""
from __future__ import annotations
import json
import os
import socket
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen

def _http(url: str) -> tuple[bool, dict | None]:
    try:
        with urlopen(url, timeout=.35) as response:
            raw = response.read(16384)
        try:
            payload = json.loads(raw)
        except Exception:
            payload = None
        return True, payload if isinstance(payload, dict) else None
    except Exception:
        return False, None

def _tcp(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=.35):
            return True
    except OSError:
        return False

def _agent_health() -> dict:
    configured = bool(os.getenv('SCAMTRACE_AGENT_URL', '').strip())
    if not configured:
        return {'configured': False, 'connected': False, 'state': 'Not configured', 'model_ready': False}
    parsed = urlsplit(os.getenv('SCAMTRACE_AGENT_URL', '').strip())
    if parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1', '::1'}:
        return {'configured': True, 'connected': False, 'state': 'Unsupported endpoint', 'model_ready': False}
    health_url = urlunsplit((parsed.scheme, parsed.netloc, '/health', '', ''))
    connected, body = _http(health_url)
    return {
        'configured': True,
        'connected': connected,
        'state': 'Connected' if connected and body and body.get('status') == 'ready' else ('Connected · local fallback' if connected else 'Configured · offline'),
        'model_ready': bool(connected and body and body.get('status') == 'ready'),
        'model': body.get('model') if body else None,
    }

def _graph_health() -> dict:
    dsn = os.getenv('SCAMTRACE_POSTGRES_DSN', '').strip()
    if not dsn:
        return {'configured': False, 'connected': False, 'state': 'Not configured', 'records': 0}
    try:
        import psycopg
        with psycopg.connect(dsn, connect_timeout=1) as conn:
            count = conn.execute('SELECT COUNT(*) FROM transaction_events').fetchone()[0]
        return {'configured': True, 'connected': True, 'state': 'Connected', 'records': count}
    except Exception as exc:
        return {'configured': True, 'connected': False, 'state': 'Configured · offline', 'records': 0, 'error': type(exc).__name__}

def snapshot(event_bus: dict, flink_alerts: int) -> dict:
    """Probe configured local endpoints concurrently so the dashboard says what is live."""
    configured_brokers = bool(os.getenv('SCAMTRACE_KAFKA_BOOTSTRAP', '').strip())
    checks = {
        'redpanda': lambda: _http('http://127.0.0.1:19644/v1/status/ready')[0],
        'flink': lambda: _http('http://127.0.0.1:8082/overview')[0],
        'temporal': lambda: _tcp('127.0.0.1', 7233),
        'prometheus': lambda: _http('http://127.0.0.1:9090/-/healthy')[0],
        'grafana': lambda: _http('http://127.0.0.1:3000/api/health')[0],
        'otel': lambda: _http('http://127.0.0.1:13133/')[0],
        'agent': _agent_health,
        'graph': _graph_health,
    }
    results = {}
    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        futures = {key: pool.submit(check) for key, check in checks.items()}
        for key, future in futures.items():
            try:
                results[key] = future.result(timeout=1.2)
            except Exception:
                results[key] = False if key in {'redpanda','flink','temporal','prometheus','grafana','otel'} else {}
    if event_bus.get('connected'):
        event_bus_state = 'Connected'
    elif not configured_brokers:
        event_bus_state = 'Not configured'
    elif results['redpanda']:
        event_bus_state = 'Running · waiting for first event'
    else:
        event_bus_state = 'Configured · offline'
    return {
        'event_bus': {**event_bus, 'state': event_bus_state, 'broker_connected': bool(results['redpanda'])},
        'flink': {'configured': configured_brokers, 'connected': bool(results['flink']), 'state': 'Running' if results['flink'] else ('Configured · offline' if configured_brokers else 'Not configured'), 'alerts': flink_alerts},
        'agent_sandbox': results['agent'],
        'temporal': {'configured': bool(os.getenv('SCAMTRACE_TEMPORAL_ADDRESS')), 'connected': bool(results['temporal']), 'state': 'Connected' if results['temporal'] else ('Configured · offline' if os.getenv('SCAMTRACE_TEMPORAL_ADDRESS') else 'Not configured')},
        'temporal_graph': results['graph'],
        'monitoring': {
            'prometheus': {'connected': bool(results['prometheus']), 'state': 'Running' if results['prometheus'] else 'Not running'},
            'grafana': {'connected': bool(results['grafana']), 'state': 'Running' if results['grafana'] else 'Not running'},
            'otel': {'connected': bool(results['otel']), 'state': 'Running' if results['otel'] else 'Not running'},
        },
    }
