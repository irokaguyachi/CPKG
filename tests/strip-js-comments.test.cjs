const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const acorn = require('acorn');
const { stripJsComments } = require('../scripts/strip-js-comments.cjs');

test('build removes actual comments while preserving literals and execution', () => {
  const source = [
    '/*! preserved-looking header */',
    'const url = "https://example.com/*keep*/"; // remove',
    'const pattern = /https?:\\/\\//;',
    'const template = `/*keep*/ ${1 /* remove */ + 2}`;',
    'function value() { return /* newline matters',
    '*/ 42; }',
    'globalThis.result = [url, pattern.test(url), template, value(), 1 +/*gap*/+ 2];',
    '//# sourceMappingURL=private.map',
  ].join('\n');
  const output = stripJsComments(source);
  const comments = [];
  acorn.parse(output, { ecmaVersion: 'latest', onComment: comments });
  assert.equal(comments.length, 0);
  const before = {};
  const after = {};
  vm.runInNewContext(source, before);
  vm.runInNewContext(output, after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result));
  assert.ok(output.includes('https://example.com/*keep*/'));
  assert.ok(!output.includes('private.map'));
});

test('invalid JavaScript fails comment stripping', () => {
  assert.throws(() => stripJsComments('const broken = ;'));
});
