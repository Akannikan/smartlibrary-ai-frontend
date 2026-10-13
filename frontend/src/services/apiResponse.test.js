import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApiResponse } from './apiResponse.js';

test('returns valid JSON from a successful API response', async () => {
  const result = await parseApiResponse(new Response(
    JSON.stringify({ success: true, extractedText: 'A book title' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));

  assert.deepEqual(result, { success: true, extractedText: 'A book title' });
});

test('uses the API error message for a JSON error response', async () => {
  await assert.rejects(
    parseApiResponse(new Response(
      JSON.stringify({ message: 'Image is too large.' }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    )),
    { status: 413, message: 'Image is too large.' },
  );
});

test('turns an HTML gateway error into a helpful temporary-server message', async () => {
  await assert.rejects(
    parseApiResponse(new Response(
      '<!DOCTYPE html><title>Bad Gateway</title>',
      { status: 502, headers: { 'Content-Type': 'text/html' } },
    )),
    { status: 502, message: /temporarily unavailable \(HTTP 502\)/ },
  );
});

test('rejects unexpected HTML from a successful status without leaking parser errors', async () => {
  await assert.rejects(
    parseApiResponse(new Response(
      '<!DOCTYPE html><title>Frontend page</title>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )),
    { status: 200, message: /unexpected response/ },
  );
});
