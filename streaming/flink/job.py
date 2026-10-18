"""Flink SQL streaming detector for short, high fan-out transaction bursts."""
import os
import time
from pyflink.table import EnvironmentSettings, TableEnvironment

settings = EnvironmentSettings.in_streaming_mode()
table_env = TableEnvironment.create(settings)
table_env.get_config().set("parallelism.default", "1")
bootstrap = os.getenv("SCAMTRACE_KAFKA_BOOTSTRAP", "redpanda:9092")

table_env.execute_sql(f"""
CREATE TABLE tx (
  id STRING, ts STRING, event_time_ms BIGINT, sender STRING, receiver STRING, amount DOUBLE,
  currency STRING, rail STRING, source_bank STRING, dest_bank STRING,
  status STRING, received_at STRING,
  event_time AS TO_TIMESTAMP_LTZ(event_time_ms, 3),
  WATERMARK FOR event_time AS event_time - INTERVAL '10' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'scamtrace.transactions',
  'properties.bootstrap.servers' = '{bootstrap}',
  'properties.group.id' = 'scamtrace-flink-detector',
  'scan.startup.mode' = 'earliest-offset',
  'format' = 'json', 'json.ignore-parse-errors' = 'true'
)
""")
table_env.execute_sql(f"""
CREATE TABLE alerts (
  window_start TIMESTAMP_LTZ(3), window_end TIMESTAMP_LTZ(3), sender STRING,
  transaction_count BIGINT, distinct_recipients BIGINT, amount_total DOUBLE,
  rule_id STRING, explanation STRING
) WITH (
  'connector' = 'kafka', 'topic' = 'scamtrace.alerts',
  'properties.bootstrap.servers' = '{bootstrap}',
  'key.format' = 'raw', 'key.fields' = 'sender',
  'value.format' = 'json'
)
""")
table_env.execute_sql("""
INSERT INTO alerts
SELECT window_start, window_end, sender, COUNT(*), COUNT(DISTINCT receiver),
       SUM(amount), 'RAPID_FAN_OUT',
       'Four or more transfers to at least three recipients in a one-minute event-time window'
FROM TABLE(TUMBLE(TABLE tx, DESCRIPTOR(event_time), INTERVAL '1' MINUTE))
WHERE status <> 'SIMULATED_PREVENTED'
GROUP BY window_start, window_end, sender
HAVING COUNT(*) >= 4 AND COUNT(DISTINCT receiver) >= 3
""").wait()
