// test/localization.test.js
// Invariants over languages.json and the phone-prefix map. These catch
// the two classes of bug found in July 2026: languages mapped from phone
// prefixes without translations (silent per-message OpenAI fallback
// cost), and translations present but unreachable from the map.
const { test } = require('node:test');
const assert = require('node:assert');

const translations = require('../src/helpers/languages.json');
const { getUserLanguage, detectCountryCode, exceedsWordLimit } = require('../src/helpers/localization');

test('every language block has exactly the same keys as en', () => {
  const enKeys = Object.keys(translations.en).sort();
  for (const [lang, block] of Object.entries(translations)) {
    assert.deepStrictEqual(
      Object.keys(block).sort(),
      enKeys,
      `language "${lang}" has mismatched keys`
    );
  }
});

test('no message string is empty', () => {
  for (const [lang, block] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(block)) {
      assert.ok(typeof value === 'string' && value.length > 0, `${lang}.${key} is empty`);
    }
  }
});

test('supportFooter carries both cost placeholders in every language', () => {
  for (const [lang, block] of Object.entries(translations)) {
    assert.ok(block.supportFooter.includes('{cost}'), `${lang}.supportFooter missing {cost}`);
    assert.ok(block.supportFooter.includes('{monthly}'), `${lang}.supportFooter missing {monthly}`);
  }
});

test('strings with links keep them in every language', () => {
  for (const [key, enValue] of Object.entries(translations.en)) {
    for (const url of ['https://revolut.me/magicfranci']) {
      if (!enValue.includes(url)) continue;
      for (const lang of Object.keys(translations)) {
        assert.ok(
          translations[lang][key].includes(url),
          `${lang}.${key} lost the link ${url}`
        );
      }
    }
  }
});

test('every mapped phone prefix resolves to a language with translations', () => {
  // Walk the map through its public API by probing known prefixes plus
  // every language returned for any 1-3 digit prefix.
  for (let code = 1; code <= 999; code++) {
    const lang = getUserLanguage(`whatsapp:+${code}5551234567`);
    assert.ok(
      translations[lang.code],
      `prefix +${code} maps to "${lang.code}" which has no translations (would trigger a live OpenAI call per message)`
    );
  }
});

test('specific prefix routing', () => {
  const cases = [
    ['whatsapp:+393331234567', 'it'],
    ['whatsapp:+380671234567', 'uk'],   // was unreachable before 2026-07-11
    ['whatsapp:+905321234567', 'tr'],   // was unreachable before 2026-07-11
    ['whatsapp:+351911234567', 'pt'],
    ['whatsapp:+8613912345678', 'zh'],
    ['whatsapp:+919812345678', 'hi'],
    ['whatsapp:+81901234567', 'ja'],
    ['whatsapp:+447753980466', 'en'],
    ['+15551234567', 'en'],
    [null, 'en'],                        // missing number falls back to default
  ];
  for (const [phone, expected] of cases) {
    assert.strictEqual(getUserLanguage(phone).code, expected, `${phone} should map to ${expected}`);
  }
});

test('detectCountryCode strips whatsapp: prefix and plus sign', () => {
  assert.strictEqual(detectCountryCode('whatsapp:+393331234567'), '39');
  assert.strictEqual(detectCountryCode('+393331234567'), '39');
  assert.strictEqual(detectCountryCode('393331234567'), '39');
  assert.strictEqual(detectCountryCode(undefined), 'default');
});

test('exceedsWordLimit', () => {
  assert.strictEqual(exceedsWordLimit('one two three', 5), false);
  assert.strictEqual(exceedsWordLimit('a '.repeat(151).trim(), 150), true);
  assert.strictEqual(exceedsWordLimit('', 150), false);
  assert.strictEqual(exceedsWordLimit(null, 150), false);
});
