// test/messaging-service.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  splitLongMessage,
  sendMessages,
  waitUntilDelivered
} = require('../src/services/messaging-service');

// A fake TwilioClientWrapper that records the order parts are submitted in
// and simulates Twilio's status lifecycle: a message starts 'queued',
// shows 'sent' while in flight, and reaches 'delivered' after
// `deliverAfter` status polls. This lets us prove sendMessages waits for
// part N to reach the device before part N+1 goes out.
function makeFakeWrapper({ testMode = false, deliverAfter = 1, statusOverride } = {}) {
  const sent = [];       // bodies in submission order
  const statusPolls = []; // sids polled, in order
  const pollCounts = new Map();
  let seq = 0;

  return {
    testMode,
    hasCredentials: !testMode,
    sent,
    statusPolls,
    async sendMessage(options) {
      sent.push(options.body);
      const sid = `SM-${seq++}`;
      pollCounts.set(sid, 0);
      return { sid, status: 'queued' };
    },
    async getMessageStatus(sid) {
      statusPolls.push(sid);
      if (statusOverride !== undefined) return statusOverride;
      const n = (pollCounts.get(sid) || 0) + 1;
      pollCounts.set(sid, n);
      return n >= deliverAfter ? 'delivered' : 'sent';
    }
  };
}

test('splitLongMessage keeps short messages as a single unprefixed part', () => {
  assert.deepStrictEqual(splitLongMessage('hello'), ['hello']);
  assert.deepStrictEqual(splitLongMessage(''), ['']);
  const exactly = 'x'.repeat(1500);
  assert.deepStrictEqual(splitLongMessage(exactly), [exactly]);
});

test('splitLongMessage numbers parts and splits on word boundaries', () => {
  const msg = 'word '.repeat(800).trim(); // 3999 chars of words
  const parts = splitLongMessage(msg, 1500);
  assert.ok(parts.length >= 3, `expected >=3 parts, got ${parts.length}`);
  parts.forEach((part, i) => {
    assert.ok(part.startsWith(`[${i + 1}/${parts.length}] `), `part ${i} carries its [i/n] prefix: ${part.slice(0, 12)}`);
    assert.ok(part.length <= 1500, `part ${i} within the WhatsApp budget`);
    // Word-boundary split: no part starts or ends mid-word.
    const body = part.replace(/^\[\d+\/\d+\] /, '');
    assert.ok(/^word/.test(body), `part ${i} starts at a word boundary`);
  });
  // Stripping prefixes and joining reconstructs the original exactly.
  const rejoined = parts.map((p) => p.replace(/^\[\d+\/\d+\] /, '')).join('');
  assert.strictEqual(rejoined, msg);
});

test('splitLongMessage hard-cuts a single unbroken token rather than exceeding the budget', () => {
  const msg = 'x'.repeat(4000);
  const parts = splitLongMessage(msg, 1500);
  parts.forEach((part) => assert.ok(part.length <= 1500));
  const rejoined = parts.map((p) => p.replace(/^\[\d+\/\d+\] /, '')).join('');
  assert.strictEqual(rejoined, msg);
});

test('waitUntilDelivered returns once the part reaches the device', async () => {
  const wrapper = makeFakeWrapper({ deliverAfter: 3 });
  const status = await waitUntilDelivered(wrapper, 'SM-x', { attempts: 10, intervalMs: 0 });
  assert.strictEqual(status, 'delivered');
  // Polled exactly until delivery (sent, sent, delivered).
  assert.strictEqual(wrapper.statusPolls.length, 3);
});

test('waitUntilDelivered is NOT satisfied by mere sent (handed to Meta)', async () => {
  const wrapper = makeFakeWrapper({ statusOverride: 'sent' });
  const status = await waitUntilDelivered(wrapper, 'SM-x', { attempts: 4, intervalMs: 0 });
  assert.strictEqual(status, null);       // budget expired, fail-open
  assert.strictEqual(wrapper.statusPolls.length, 4);
});

test('waitUntilDelivered stops early on terminal failure states', async () => {
  const wrapper = makeFakeWrapper({ statusOverride: 'undelivered' });
  const status = await waitUntilDelivered(wrapper, 'SM-x', { attempts: 4, intervalMs: 0 });
  assert.strictEqual(status, 'undelivered'); // waiting longer cannot help
  assert.strictEqual(wrapper.statusPolls.length, 1);
});

test('waitUntilDelivered fails open when status is unreadable', async () => {
  const wrapper = makeFakeWrapper({ statusOverride: null });
  const status = await waitUntilDelivered(wrapper, 'SM-x', { attempts: 4, intervalMs: 0 });
  assert.strictEqual(status, null);
  assert.strictEqual(wrapper.statusPolls.length, 1); // null short-circuits immediately
});

test('sendMessages submits parts in order', async () => {
  const wrapper = makeFakeWrapper();
  await sendMessages(wrapper, ['part-1', 'part-2', 'part-3'], '+to', '+from');
  assert.deepStrictEqual(wrapper.sent, ['part-1', 'part-2', 'part-3']);
});

test('sendMessages waits for each part to be delivered before sending the next', async () => {
  const wrapper = makeFakeWrapper({ deliverAfter: 1 });
  await sendMessages(wrapper, ['a', 'b', 'c'], '+to', '+from');
  // Two boundaries (after a, after b) => at least one poll each; last part
  // is never polled (nothing follows it).
  assert.ok(wrapper.statusPolls.length >= 2);
  // Every poll targets the part that was just sent, before the next goes out.
  assert.deepStrictEqual(wrapper.statusPolls, ['SM-0', 'SM-1']);
});

test('sendMessages never polls status in test mode', async () => {
  const wrapper = makeFakeWrapper({ testMode: true });
  await sendMessages(wrapper, ['a', 'b'], '+to', '+from');
  assert.deepStrictEqual(wrapper.sent, ['a', 'b']);
  assert.strictEqual(wrapper.statusPolls.length, 0);
});

test('sendMessages does not poll for a single-part message', async () => {
  const wrapper = makeFakeWrapper();
  await sendMessages(wrapper, ['only'], '+to', '+from');
  assert.strictEqual(wrapper.statusPolls.length, 0);
});

test('sendMessages propagates send failures', async () => {
  const wrapper = makeFakeWrapper();
  wrapper.sendMessage = async () => { throw new Error('twilio down'); };
  await assert.rejects(
    () => sendMessages(wrapper, ['a', 'b'], '+to', '+from'),
    /twilio down/
  );
});
