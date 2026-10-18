"""Durable intervention lifecycle worker for the optional Temporal stack."""
from datetime import timedelta
from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker

@workflow.defn
class InterventionWorkflow:
    def __init__(self):
        self.response: str | None = None

    @workflow.signal
    def institution_response(self, outcome: str) -> None:
        self.response = outcome

    @workflow.run
    async def run(self, intervention_id: str, case_id: str) -> str:
        try:
            await workflow.wait_condition(lambda: self.response is not None, timeout=timedelta(minutes=2))
            return await workflow.execute_activity(
                record_outcome, intervention_id, case_id, self.response,
                start_to_close_timeout=timedelta(seconds=15),
            )
        except TimeoutError:
            return await workflow.execute_activity(
                record_outcome, intervention_id, case_id, "EXPIRED",
                start_to_close_timeout=timedelta(seconds=15),
            )

@activity.defn
def record_outcome(intervention_id: str, case_id: str, outcome: str) -> str:
    # The worker and local API share the project data volume. Updates are
    # idempotent so a Temporal activity retry cannot duplicate a transition.
    import os, sqlite3
    db = os.getenv("SCAMTRACE_DB", "/opt/scamtrace/data/scamtrace.db")
    conn = sqlite3.connect(db, timeout=20)
    try:
        row = conn.execute("SELECT status FROM interventions WHERE id=? AND case_id=?", (intervention_id, case_id)).fetchone()
        if not row or row[0] not in ("REVIEW_REQUESTED", "PENDING"):
            return row[0] if row else "MISSING"
        if outcome not in ("ACKNOWLEDGED", "PENDING", "REJECTED", "SIMULATED_HOLD", "EXPIRED"):
            outcome = "PENDING"
        conn.execute("UPDATE interventions SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (outcome, intervention_id))
        conn.execute(
            "INSERT INTO audit(intervention_id,ts,from_state,to_state,detail) VALUES(?,CURRENT_TIMESTAMP,?,?,?)",
            (intervention_id, row[0], outcome, "Temporal durable workflow recorded simulated institution response"),
        )
        conn.commit()
        return outcome
    finally:
        conn.close()

async def main():
    import asyncio
    address = os.getenv("SCAMTRACE_TEMPORAL_ADDRESS", "temporal:7233")
    client = await Client.connect(address)
    worker = Worker(client, task_queue="scamtrace-interventions", workflows=[InterventionWorkflow], activities=[record_outcome])
    await worker.run()

if __name__ == "__main__":
    import asyncio, os
    asyncio.run(main())
