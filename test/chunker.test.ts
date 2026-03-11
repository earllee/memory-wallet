import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkText } from '../src/chunker';

describe('chunkText', () => {
  it('returns a single chunk for short content', () => {
    const result = chunkText('This is a short note about grocery shopping.');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], 'This is a short note about grocery shopping.');
  });

  it('splits long content on paragraph boundaries', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i + 1}. ${'This is filler text to make the paragraph longer. '.repeat(5)}`
    );
    const content = paragraphs.join('\n\n');
    const result = chunkText(content);

    assert.ok(result.length > 1, `Expected multiple chunks, got ${result.length}`);
    for (const chunk of result) {
      assert.ok(chunk.length > 0, 'Chunk should not be empty');
    }
  });

  it('merges small trailing chunk with previous', () => {
    // First paragraph large enough to stand alone (>500 chars)
    const large = 'A'.repeat(600);
    // Second paragraph too small to be its own chunk (<500 chars)
    const small = 'B'.repeat(100);
    const content = `${large}\n\n${small}`;
    const result = chunkText(content);

    assert.strictEqual(result.length, 1, 'Small trailing chunk should merge with previous');
    assert.ok(result[0].includes('B'.repeat(100)));
  });

  it('returns empty array for empty input', () => {
    const result = chunkText('');
    assert.strictEqual(result.length, 0);
  });

  it('handles content at MIN_CHUNK_SIZE boundary', () => {
    // Single block of exactly 500 chars (MIN_CHUNK_SIZE)
    const atMin = 'x'.repeat(500);
    const result = chunkText(atMin);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].length, 500);
  });

  it('handles content at MAX_CHUNK_SIZE boundary', () => {
    // Single block of exactly 1200 chars (MAX_CHUNK_SIZE)
    const atMax = 'x'.repeat(1200);
    const result = chunkText(atMax);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].length, 1200);
  });
});
