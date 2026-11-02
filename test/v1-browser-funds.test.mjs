import test from 'node:test';
import assert from 'node:assert/strict';
import { runBankBrowserFunds, BankBrowserFundsError, readFields } from '../tools/v1-browser-funds.mjs';

const credentials = Object.fromEntries(['customer', 'collection', 'operator'].map(role => [role, { token: 'synthetic-' + role, csrf: 'synthetic-csrf-' + role }]));
const node = (tagName, textContent = '', children = []) => ({ tagName, textContent, children, firstElementChild: children[0] });
const field = (key, value) => [node('DT', key), node('DD', '', [value])];
test('rendered fields preserve nested precise decimal, integer and escaped text', () => {
  const tree = node('DL', '', [...field('amount', node('DL', '', field('minorUnits', node('SPAN', '9999999999999999999999')))),
    ...field('slots', node('UL', '', [node('LI', '', [node('SPAN', '9007199254740993')])])),
    ...field('shares', node('SPAN', '80.0000')), ...field('text', node('SPAN', '<script>&')), ...field('absent', node('SPAN', 'none'))]);
  assert.deepEqual(JSON.parse(JSON.stringify(readFields(tree))), { amount: { minorUnits: '9999999999999999999999' },
    slots: ['9007199254740993'], shares: '80.0000', text: '<script>&', absent: 'none' });
});
test('rendered fields reject duplicate keys and malformed object pairs', () => {
  assert.throws(() => readFields(node('DL', '', [...field('same', node('SPAN', '1')), ...field('same', node('SPAN', '2'))])));
  assert.throws(() => readFields(node('DL', '', [node('DT', 'missing')])));
  assert.throws(() => readFields(node('SCRIPT', 'unexpected')));
});
for (const [name, change] of [
  ['non-synthetic use', { synthetic: false }],
  ['shared port', { baseURL: 'http://127.0.0.1:9000' }],
  ['remote host', { baseURL: 'http://example.com:8123' }],
  ['URL credentials', { baseURL: 'http://user:private@127.0.0.1:8123' }],
  ['unknown mode', { mode: 'force-refund' }],
  ['missing credentials', { credentials: {} }],
]) {
  test('browser funds rejects ' + name + ' before opening a browser', async () => {
    let opened = false;
    await assert.rejects(runBankBrowserFunds({ synthetic: true, baseURL: 'http://127.0.0.1:8123', mode: 'initial', credentials,
      browser: { newContext() { opened = true; throw new Error('must not open'); } }, ...change }), error => {
      assert.ok(error instanceof BankBrowserFundsError);
      assert.equal(error.report.failureAt, 'configuration');
      assert.equal(JSON.stringify(error).includes('private'), false);
      return true;
    });
    assert.equal(opened, false);
  });
}
test('browser funds closes a created context and redacts underlying failure', async () => {
  let closed = false;
  await assert.rejects(runBankBrowserFunds({ synthetic: true, baseURL: 'http://127.0.0.1:8123', mode: 'initial', credentials,
    browser: { async newContext() { return { setDefaultTimeout() {}, async newPage() { throw new Error('private-browser-stack'); }, async close() { closed = true; } }; } } }), error => {
    assert.equal(JSON.stringify(error).includes('private-browser-stack'), false);
    return true;
  });
  assert.equal(closed, true);
});
