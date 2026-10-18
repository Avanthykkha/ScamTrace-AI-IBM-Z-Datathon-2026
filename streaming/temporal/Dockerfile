FROM python:3.12-slim
WORKDIR /opt/scamtrace
COPY requirements-advanced.txt /tmp/requirements.txt
RUN pip install --no-cache-dir "temporalio>=1.7,<2"
COPY backend /opt/scamtrace/backend
COPY streaming /opt/scamtrace/streaming
CMD ["python", "-m", "streaming.temporal.worker"]
