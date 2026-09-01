import assert from 'node:assert/strict';

const { cleanForSpeech } = await import('../dist-electron/speech.js');
const original = '**First item**\n\n2. `Second item`\n- Third item\n\nA [link](https://example.com).';
const cleaned = cleanForSpeech(original);

assert.equal(cleaned, 'First item First, Second item Third item A [link](https://example.com).');
assert.equal(original, '**First item**\n\n2. `Second item`\n- Third item\n\nA [link](https://example.com).');
assert.equal(cleanForSpeech(''), '');

console.log('Speech sanitizer tests passed');
