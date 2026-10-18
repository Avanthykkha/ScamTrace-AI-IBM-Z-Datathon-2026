#!/bin/sh
set -eu
until /opt/flink/bin/flink run -m flink-jobmanager:8081 -py /opt/scamtrace/streaming/flink/job.py; do
  echo 'Flink job submission failed; retrying in 5 seconds.'
  sleep 5
done
