// test/cost-estimate.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { estimateCostUsd, formatCostUsd } = require('../src/core/cost-estimate');

test('one-minute voice note costs roughly 1.3 cents', () => {
  const oneMinuteBytes = 120 * 1024;
  const cost = estimateCostUsd(oneMinuteBytes, 1);
  // inbound 0.005 + outbound 0.005 + 1 min * 0.003
  assert.ok(Math.abs(cost - 0.013) < 0.0005, `got ${cost}`);
});

test('longer audio and more parts cost more', () => {
  const short = estimateCostUsd(120 * 1024, 1);
  const longAudio = estimateCostUsd(3 * 120 * 1024, 1);
  const multiPart = estimateCostUsd(120 * 1024, 3);
  assert.ok(longAudio > short);
  assert.ok(multiPart > short);
});

test('tiny/missing audio still charges the floor', () => {
  // 0.25-minute floor + two Twilio messages
  const cost = estimateCostUsd(0, 1);
  assert.ok(cost >= 0.01, `got ${cost}`);
});

test('formatting never shows less than one cent', () => {
  assert.strictEqual(formatCostUsd(0.0001), '$0.01');
  assert.strictEqual(formatCostUsd(0.013), '$0.01');
  assert.strictEqual(formatCostUsd(0.024), '$0.02');
  assert.strictEqual(formatCostUsd(0.5), '$0.50');
});
