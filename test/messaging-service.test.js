// test/messaging-service.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  splitLongMessage,
  sendMessages,
  waitUntilDispatched
} = require('../src/services/messaging-service');

// A fake TwilioClientWrapper that records the order parts are submitted in
// and simulates Twilio's status lifecycle: a message starts 'queued' and
// only advances to 'sent' after `dispatchAfter` status polls. This lets us
// prove sendMessages waits for part N to leave the queue before part N+1.
function makeFakeWrapper({ testMode = false, dispatchAfter = 1, statusOverride } = {}) {
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
      return n >= dispatchAfter ? 'sent' : 'queued';
    }
  };
}

test('splitLongMessage keeps short messages as a single part', () => {
  assert.deepStrictEqual(splitLongMessage('hello'), ['hello']);
  assert.deepStrictEqual(splitLongMessage(''), ['']);
});

test('splitLongMessage splits long messages into ordered contiguous parts', () => {
  const msg = 'abcdefghij'.repeat(400); // 4000 chars
  const parts = splitLongMessage(msg, 1500);
  assert.strictEqual(parts.length, 3);
  // Parts must reconstruct the original in order (no reordering/loss).
  assert.strictEqual(parts.join(''), msg);
  assert.ok(parts[0].length === 1500 && parts[1].length === 1500);
});

test('waitUntilDispatched returns once status leaves the queue', async () => {
  const wrapper = makeFakeWrapper({ dispatchAfter: 3 });
  const status = await waitUntilDispatched(wrapper, 'SM-x', { attempts: 8, intervalMs: 0 });
  assert.strictEqual(status, 'sent');
  // Polled exactly until it flipped to 'sent' (queued, queued, sent).
  assert.strictEqual(wrapper.statusPolls.length, 3);
});

test('waitUntilDispatched fails open when status never advances', async () => {
  const wrapper = makeFakeWrapper({ statusOverride: 'queued' });
  const status = await waitUntilDispatched(wrapper, 'SM-x', { attempts: 4, intervalMs: 0 });
  assert.strictEqual(status, null);       // gave up rather than blocking forever
  assert.strictEqual(wrapper.statusPolls.length, 4);
});

test('waitUntilDispatched fails open when status is unreadable', async () => {
  const wrapper = makeFakeWrapper({ statusOverride: null });
  const status = await waitUntilDispatched(wrapper, 'SM-x', { attempts: 4, intervalMs: 0 });
  assert.strictEqual(status, null);
  assert.strictEqual(wrapper.statusPolls.length, 1); // null short-circuits immediately
});

test('sendMessages submits parts in order', async () => {
  const wrapper = makeFakeWrapper();
  await sendMessages(wrapper, ['part-1', 'part-2', 'part-3'], '+to', '+from');
  assert.deepStrictEqual(wrapper.sent, ['part-1', 'part-2', 'part-3']);
});

test('sendMessages waits for each part to be dispatched before sending the next', async () => {
  const wrapper = makeFakeWrapper({ dispatchAfter: 1 });
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
