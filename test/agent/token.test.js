import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToken, tokenMatches } from '../../agent/lib/token.js';

test('createToken returns a long url-safe random string', () => {
  const a = createToken();
  const b = createToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('tokenMatches accepts only the exact token', () => {
  const token = createToken();
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(token, token + 'x'), false);
  assert.equal(tokenMatches(token, token.slice(1)), false);
  assert.equal(tokenMatches(token, token.toUpperCase()), false);
});

test('tokenMatches rejects empty, oversized and non-string values', () => {
  const token = createToken();
  assert.equal(tokenMatches(token, ''), false);
  assert.equal(tokenMatches(token, 'a'.repeat(1000)), false);
  assert.equal(tokenMatches(token, undefined), false);
  assert.equal(tokenMatches(token, ['x']), false);
  assert.equal(tokenMatches(undefined, token), false);
});
