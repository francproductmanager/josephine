// test/cost-estimate.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { countWords, estimateNoteShareUsd, formatCostUsd, MONTHLY_DISPLAY } = require('../src/core/cost-estimate');

test('very short notes sit at the floor (~$0.01-0.02)', () => {
  assert.ok(estimateNoteShareUsd(0) >= 0.01);
  assert.ok(estimateNoteShareUsd(10) < 0.03);
});

test('share grows monotonically with word count', () => {
  const points = [10, 50, 100, 190, 300, 400].map(estimateNoteShareUsd);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i] > points[i - 1], `share must grow: ${points[i - 1]} -> ${points[i]}`);
  }
});

test('sample points match the documented curve', () => {
  assert.strictEqual(formatCostUsd(estimateNoteShareUsd(100)), '$0.10');
  assert.strictEqual(formatCostUsd(estimateNoteShareUsd(190)), '$0.19');
  assert.strictEqual(formatCostUsd(estimateNoteShareUsd(300)), '$0.29');
});

test('long notes cap at $0.39', () => {
  assert.strictEqual(estimateNoteShareUsd(400), 0.39);
  assert.strictEqual(estimateNoteShareUsd(5000), 0.39);
});

test('countWords matches localization word-splitting semantics', () => {
  assert.strictEqual(countWords('one two three'), 3);
  assert.strictEqual(countWords('  padded   spaces  here '), 3);
  assert.strictEqual(countWords(''), 0);
  assert.strictEqual(countWords(null), 0);
});

test('formatting is two-decimal USD with a one-cent floor', () => {
  assert.strictEqual(formatCostUsd(0.0001), '$0.01');
  assert.strictEqual(formatCostUsd(0.19), '$0.19');
  assert.strictEqual(formatCostUsd(0.39), '$0.39');
});

test('monthly display figure', () => {
  assert.strictEqual(MONTHLY_DISPLAY, '$12');
});
