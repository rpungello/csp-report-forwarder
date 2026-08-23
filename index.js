'use strict';

const express = require('express');
const { createClient } = require('@clickhouse/client');

// ---- Config (all overridable via environment variables) ----
const PORT = process.env.PORT || 8080;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';
const CLICKHOUSE_TABLE = process.env.CLICKHOUSE_TABLE || 'csp_reports';
// Max request body size accepted (reports are small, but keep a sane cap)
const BODY_LIMIT = process.env.BODY_LIMIT || '256kb';

const client = createClient({
  url: CLICKHOUSE_URL,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DATABASE,
});

const app = express();

// Browsers send CSP reports with these content types depending on
// which reporting mechanism is in use (legacy report-uri vs. the
// newer Reporting API). Accept all of them as JSON.
app.use(
  express.json({
    type: [
      'application/json',
      'application/csp-report',
      'application/reports+json',
    ],
    limit: BODY_LIMIT,
  })
);

function normalizeReports(body, req) {
  const now = new Date();
  const userAgent = req.get('user-agent') || '';
  const remoteAddr = req.ip || '';

  // Newer Reporting API sends an array of report objects, each with a
  // "body" field. Legacy report-uri sends a single object with a
  // top-level "csp-report" key.
  const items = Array.isArray(body) ? body : [body];

  return items.map((item) => {
    const report = item && item.body ? item.body : item && item['csp-report'] ? item['csp-report'] : item || {};

    return {
      received_at: now.toISOString().replace('T', ' ').replace('Z', ''),
      document_uri: report.documentURL || report['document-uri'] || '',
      referrer: report.referrer || report['referrer'] || '',
      violated_directive: report.effectiveDirective || report['violated-directive'] || '',
      effective_directive: report.effectiveDirective || report['effective-directive'] || '',
      original_policy: report.originalPolicy || report['original-policy'] || '',
      disposition: report.disposition || '',
      blocked_uri: report.blockedURL || report['blocked-uri'] || '',
      line_number: Number(report.lineNumber || report['line-number'] || 0),
      column_number: Number(report.columnNumber || report['column-number'] || 0),
      source_file: report.sourceFile || report['source-file'] || '',
      status_code: Number(report.statusCode || report['status-code'] || 0),
      script_sample: report.sample || report['script-sample'] || '',
      user_agent: userAgent,
      remote_addr: remoteAddr,
      raw: JSON.stringify(item),
    };
  });
}

app.post('/csp-report', async (req, res) => {
  try {
    if (!req.body || (Array.isArray(req.body) && req.body.length === 0)) {
      return res.status(204).end();
    }

    const rows = normalizeReports(req.body, req);

    await client.insert({
      table: CLICKHOUSE_TABLE,
      values: rows,
      format: 'JSONEachRow',
    });

    // Browsers don't care about the response body for report endpoints.
    return res.status(204).end();
  } catch (err) {
    console.error('Failed to forward CSP report to ClickHouse:', err);
    return res.status(500).json({ error: 'failed to store report' });
  }
});

app.get('/healthz', async (_req, res) => {
  try {
    await client.ping();
    return res.status(200).send('ok');
  } catch (err) {
    return res.status(503).send('clickhouse unreachable');
  }
});

app.listen(PORT, () => {
  console.log(`csp-report-forwarder listening on port ${PORT}`);
  console.log(`forwarding reports to ${CLICKHOUSE_URL} -> ${CLICKHOUSE_DATABASE}.${CLICKHOUSE_TABLE}`);
});
