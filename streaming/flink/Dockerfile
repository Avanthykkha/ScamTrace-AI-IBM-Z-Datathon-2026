FROM flink:1.20.1-scala_2.12-java17
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip wget && rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/bin/python3 /usr/local/bin/python && \
    pip3 install --break-system-packages apache-flink==1.20.1 && \
    mkdir -p /opt/flink/lib && wget -q -O /opt/flink/lib/flink-sql-connector-kafka-3.3.0-1.20.jar https://repo1.maven.org/maven2/org/apache/flink/flink-sql-connector-kafka/3.3.0-1.20/flink-sql-connector-kafka-3.3.0-1.20.jar
USER flink
