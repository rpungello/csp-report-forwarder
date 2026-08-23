# csp-report-forwarder

Simple Node.js service that receives Content-Security-Policy reports and forwards them to ClickHouse.

## Run locally

```bash
npm install
npm run forward
```

By default, the service listens on `http://0.0.0.0:3000/csp-report`.

### Environment variables

- `PORT` (default: `3000`)
- `REPORT_PATH` (default: `/csp-report`)
- `MAX_BODY_SIZE_BYTES` (default: `1048576`)
- `CLICKHOUSE_URL` (default: `http://localhost:8123`)
- `CLICKHOUSE_INSERT_QUERY` (default: `INSERT INTO csp_reports (received_at, report_json) FORMAT JSONEachRow`)
- `CLICKHOUSE_TIMEOUT_MS` (default: `5000`)
- `CLICKHOUSE_USER` (optional)
- `CLICKHOUSE_PASSWORD` (optional)

### Example ClickHouse table

```sql
CREATE TABLE csp_reports (
  received_at DateTime64(3),
  report_json String
) ENGINE = MergeTree
ORDER BY received_at;
```

## Docker

Build image:

```bash
docker build -t csp-report-forwarder .
```

Run container:

```bash
docker run --rm \
  -p 3000:3000 \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  csp-report-forwarder
```

## Example request

```bash
curl -X POST http://localhost:3000/csp-report \
  -H 'Content-Type: application/csp-report' \
  -d '{"csp-report":{"document-uri":"https://example.com"}}'
```
