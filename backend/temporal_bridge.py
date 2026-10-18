"""Best-effort client bridge for optional durable Temporal workflows."""
from __future__ import annotations
import asyncio
import os
import threading

def _run_async(factory):
    async def execute():
        from temporalio.client import Client
        client = await Client.connect(os.getenv("SCAMTRACE_TEMPORAL_ADDRESS", "127.0.0.1:7233"))
        await factory(client)
    try:
        asyncio.run(execute())
    except Exception:
        # The SQLite workflow remains available if Temporal is stopped or not installed.
        pass

def start_intervention(intervention_id: str, case_id: str) -> None:
    if not os.getenv("SCAMTRACE_TEMPORAL_ADDRESS"):
        return
    async def start(client):
        from temporalio.client import WorkflowIDReusePolicy
        from streaming.temporal.worker import InterventionWorkflow
        await client.start_workflow(
            InterventionWorkflow.run, intervention_id, case_id,
            id=f"scamtrace-intervention-{intervention_id}",
            task_queue="scamtrace-interventions",
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
        )
    threading.Thread(target=_run_async, args=(start,), daemon=True).start()

def signal_intervention(intervention_id: str, outcome: str) -> None:
    if not os.getenv("SCAMTRACE_TEMPORAL_ADDRESS"):
        return
    async def signal(client):
        handle = client.get_workflow_handle(f"scamtrace-intervention-{intervention_id}")
        await handle.signal("institution_response", outcome)
    threading.Thread(target=_run_async, args=(signal,), daemon=True).start()
