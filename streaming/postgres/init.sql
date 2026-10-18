CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT create_graph('scamtrace');

CREATE TABLE IF NOT EXISTS transaction_events (
    transaction_id text PRIMARY KEY,
    event_time timestamptz NOT NULL,
    sender text NOT NULL,
    receiver text NOT NULL,
    amount numeric(18,2) NOT NULL,
    payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS transaction_events_sender_time ON transaction_events(sender, event_time DESC);
CREATE INDEX IF NOT EXISTS transaction_events_receiver_time ON transaction_events(receiver, event_time DESC);
