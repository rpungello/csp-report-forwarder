'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractReport } = require('../index');

test('extractReport unwraps csp-report envelope', () => {
  const payload = { 'csp-report': { 'document-uri': 'https://example.com' } };

  assert.deepEqual(extractReport(payload), { 'document-uri': 'https://example.com' });
});

test('extractReport returns payload when no envelope exists', () => {
  const payload = { reportOnly: true };

  assert.deepEqual(extractReport(payload), payload);
});
