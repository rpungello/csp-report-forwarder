'use strict';

const http = require('node:http');

const DEFAULT_MAX_BODY_SIZE_BYTES = 1024 * 1024;
const parsedMaxBodySize = Number(process.env.MAX_BODY_SIZE_BYTES);
const MAX_BODY_SIZE_BYTES =
  Number.isFinite(parsedMaxBodySize) && parsedMaxBodySize > 0
    ? parsedMaxBodySize
    : DEFAULT_MAX_BODY_SIZE_BYTES;
const REPORT_PATH = process.env.REPORT_PATH || '/csp-report';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
const CLICKHOUSE_INSERT_QUERY =
  process.env.CLICKHOUSE_INSERT_QUERY ||
  'INSERT INTO csp_reports (received_at, report_json) FORMAT JSONEachRow';
const DEFAULT_CLICKHOUSE_TIMEOUT_MS = 5000;
const parsedClickhouseTimeoutMs = Number(process.env.CLICKHOUSE_TIMEOUT_MS);
const CLICKHOUSE_TIMEOUT_MS =
  Number.isFinite(parsedClickhouseTimeoutMs) && parsedClickhouseTimeoutMs > 0
    ? parsedClickhouseTimeoutMs
    : DEFAULT_CLICKHOUSE_TIMEOUT_MS;
const PORT = Number(process.env.PORT || 3000);

class BadRequestError extends Error {}
class UpstreamError extends Error {}

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
    const chunks = [];
    let bytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) {
        return;
      }

      bytes += chunk.length;
      if (bytes > MAX_BODY_SIZE_BYTES) {
        aborted = true;
        reject(new BadRequestError('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) {
        return;
      }

      const body = Buffer.concat(chunks).toString('utf8');
      if (!body) {
        reject(new BadRequestError('Request body is empty'));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new BadRequestError('Invalid JSON body'));
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

function formatDateTime64(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

async function forwardToClickHouse(report) {
  const row = {
    received_at: formatDateTime64(new Date()),
    report_json: JSON.stringify(report)
  };

  const url = `${CLICKHOUSE_URL.replace(/\/$/, '')}/`;

  const headers = {
    'X-ClickHouse-Query': CLICKHOUSE_INSERT_QUERY
  };
  const authorizationHeader = getAuthorizationHeader();
  if (authorizationHeader) {
    headers.Authorization = authorizationHeader;
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: `${JSON.stringify(row)}\n`,
      signal: AbortSignal.timeout(CLICKHOUSE_TIMEOUT_MS)
    });
  } catch (error) {
    console.error('ClickHouse request failed:', error);
    throw new UpstreamError('Upstream ClickHouse request failed');
  }

  if (!response.ok) {
    const message = await response.text();
    const sanitizedMessage = message.slice(0, 500);
    console.error(`ClickHouse insert failed (${response.status}): ${sanitizedMessage}`);
    throw new UpstreamError('Upstream ClickHouse request failed');
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
    if (requestPath !== REPORT_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const payload = await parseRequestBody(req);
      const report = extractReport(payload);
      await forwardToClickHouse(report);

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
    } catch (error) {
      const statusCode = error instanceof BadRequestError ? 400 : 502;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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
  parseRequestBody,
  MAX_BODY_SIZE_BYTES
};
