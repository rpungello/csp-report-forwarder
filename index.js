'use strict';

const http = require('node:http');

const MAX_BODY_SIZE_BYTES = Number(process.env.MAX_BODY_SIZE_BYTES || 1024 * 1024);
const REPORT_PATH = process.env.REPORT_PATH || '/csp-report';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
const CLICKHOUSE_INSERT_QUERY =
  process.env.CLICKHOUSE_INSERT_QUERY ||
  'INSERT INTO csp_reports (received_at, report_json) FORMAT JSONEachRow';
const PORT = Number(process.env.PORT || 3000);

function extractReport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'csp-report') &&
    payload['csp-report'] &&
    typeof payload['csp-report'] === 'object'
  ) {
    return payload['csp-report'];
  }

  return payload;
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_SIZE_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body) {
        reject(new Error('Request body is empty'));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function getAuthorizationHeader() {
  if (process.env.CLICKHOUSE_USER && process.env.CLICKHOUSE_PASSWORD) {
    return `Basic ${Buffer.from(
      `${process.env.CLICKHOUSE_USER}:${process.env.CLICKHOUSE_PASSWORD}`
    ).toString('base64')}`;
  }

  return undefined;
}

async function forwardToClickHouse(report) {
  const row = {
    received_at: new Date().toISOString(),
    report_json: JSON.stringify(report)
  };

  const url = `${CLICKHOUSE_URL.replace(/\/$/, '')}/?query=${encodeURIComponent(
    CLICKHOUSE_INSERT_QUERY
  )}`;

  const headers = {
    'Content-Type': 'application/json'
  };
  const authorizationHeader = getAuthorizationHeader();
  if (authorizationHeader) {
    headers.Authorization = authorizationHeader;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: `${JSON.stringify(row)}\n`
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ClickHouse insert failed (${response.status}): ${message}`);
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== REPORT_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      const payload = await parseRequestBody(req);
      const report = extractReport(payload);
      await forwardToClickHouse(report);

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      );
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    process.stdout.write(
      `CSP report forwarder listening on port ${PORT}, path ${REPORT_PATH}\n`
    );
  });
}

module.exports = {
  createServer,
  extractReport,
  parseRequestBody
};
