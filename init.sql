-- Run this once against your ClickHouse instance before starting the
-- forwarder. Adjust the database name to match CLICKHOUSE_DATABASE.

CREATE TABLE IF NOT EXISTS default.csp_reports
(
    received_at        DateTime DEFAULT now(),
    document_uri        String,
    referrer             String,
    violated_directive  String,
    effective_directive String,
    original_policy      String,
    disposition          String,
    blocked_uri          String,
    line_number          UInt32,
    column_number        UInt32,
    source_file           String,
    status_code           UInt16,
    script_sample         String,
    user_agent             String,
    remote_addr            String,
    raw                     String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(received_at)
ORDER BY (received_at, document_uri)
TTL received_at + INTERVAL 90 DAY;
