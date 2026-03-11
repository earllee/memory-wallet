import { describe, it } from 'node:test';
import assert from 'node:assert';
import { escapeFtsQuery } from '../src/search';

describe('escapeFtsQuery', () => {
  it('individually quotes multi-word queries', () => {
    const result = escapeFtsQuery('hello world');
    assert.strictEqual(result, '"hello" "world"');
  });

  it('strips double-quote characters', () => {
    const result = escapeFtsQuery('hello "world" test');
    assert.strictEqual(result, '"hello" "world" "test"');
  });

  it('returns empty string for empty input', () => {
    const result = escapeFtsQuery('');
    assert.strictEqual(result, '');
  });

  it('returns empty string for whitespace-only input', () => {
    const result = escapeFtsQuery('   ');
    assert.strictEqual(result, '');
  });

  it('handles single word', () => {
    const result = escapeFtsQuery('hello');
    assert.strictEqual(result, '"hello"');
  });

  it('handles extra whitespace between words', () => {
    const result = escapeFtsQuery('  hello   world  ');
    assert.strictEqual(result, '"hello" "world"');
  });
});
