'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { extractReport, parseRequestBody } = require('../index');

function createMockRequest(chunks) {
  const req = new EventEmitter();
  req.destroy = () => {
    req.destroyed = true;
  };

  process.nextTick(() => {
    for (const chunk of chunks) {
      req.emit('data', Buffer.from(chunk));
    }
    req.emit('end');
  });

  return req;
}

test('extractReport unwraps csp-report envelope', () => {
  const payload = { 'csp-report': { 'document-uri': 'https://example.com' } };

  assert.deepEqual(extractReport(payload), { 'document-uri': 'https://example.com' });
});

test('extractReport returns payload when no envelope exists', () => {
  const payload = { reportOnly: true };

  assert.deepEqual(extractReport(payload), payload);
});

test('parseRequestBody parses valid JSON', async () => {
  const req = createMockRequest(['{"ok":true}']);

  await assert.doesNotReject(() => parseRequestBody(req));
});

test('parseRequestBody rejects invalid JSON', async () => {
  const req = createMockRequest(['{']);

  await assert.rejects(parseRequestBody(req), /Invalid JSON body/);
});

test('parseRequestBody rejects empty body', async () => {
  const req = createMockRequest([]);

  await assert.rejects(parseRequestBody(req), /Request body is empty/);
});

test('parseRequestBody rejects oversized body', async () => {
  const req = createMockRequest(['a'.repeat(1024 * 1024 + 1)]);

  await assert.rejects(parseRequestBody(req), /Request body too large/);
});
