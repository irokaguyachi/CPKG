// 태그 정의 적용(src/js/config/tagConfig.js 의 applyDefinitions) 검증.
// tagConfig.js 를 vm 에서 window 하나로 실행한다. document 는 필요할 때만 흉내 낸다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

function fakeDocument() {
  const byId = {};
  const head = { children: [], appendChild(el) { this.children.push(el); if (el.id) byId[el.id] = el; } };
  return {
    head,
    getElementById: id => byId[id] || null,
    createElement: tag => ({ tagName: tag, id: '', textContent: '' })
  };
}

function loadTagConfig(window = {}) {
  window.window = window;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/config/tagConfig.js'), 'utf8'), {
    window, document: window.document, console
  });
  return window;
}

test('definitions reorder tags and set emoji in place', () => {
  const { TagConfig } = loadTagConfig();
  const order = TagConfig.TAG_ORDER;
  TagConfig.applyDefinitions({ tags: [
    { name: '로맨스', emoji: '💘', color: null, votable: true },
    { name: '새 태그', emoji: '✨', color: null, votable: false }
  ], renames: { A: 'B' } });
  assert.equal(TagConfig.TAG_ORDER, order, 'the same array is reordered in place');
  assert.deepEqual(plain(order.slice(0, 2)), ['로맨스', '새 태그']);
  assert.equal(TagConfig.TAG_EMOJI['새 태그'], '✨');
  assert.equal(TagConfig.TAG_EMOJI['로맨스'], '💘');
  assert.equal(TagConfig.TAG_EMOJI['일상'], '☀️', 'built-in emoji stay for tags without a definition');
  assert.deepEqual(plain(TagConfig.sortTags(['일상', '새 태그', '로맨스'])), ['로맨스', '새 태그', '일상']);
  assert.equal(TagConfig.BUILTIN.order[0], '짧문');
  assert.equal(TagConfig.BUILTIN.emoji['로맨스'], '💖');
  assert.deepEqual(plain(TagConfig.renames), { A: 'B' });
});

test('generated colors cover light, dark and quoted names', () => {
  const { TagConfig } = loadTagConfig();
  const css = TagConfig.definitionCss([
    { name: '새 "태그"', emoji: '✨', color: '#6688cc', votable: false },
    { name: '일상', emoji: '☀️', color: null, votable: true }
  ]);
  assert.match(css, /\[data-tag="새 \\"태그\\""\] \{ --tag-bg: #edf1f9; \}/);
  assert.match(css, /\[data-theme="dark"\] \[data-tag="새 \\"태그\\""\] \{[^}]*--tag-bg: rgba\(102, 136, 204, 0\.22\)/);
  assert.match(css, /--tag-border: rgba\(102, 136, 204, 0\.35\)/);
  assert.doesNotMatch(css, /일상/, 'tags without a color keep the stylesheet colors');
  TagConfig.applyDefinitions({ tags: [{ name: '새 "태그"', emoji: '✨', color: '#6688cc', votable: false }], renames: {} });
  assert.equal(TagConfig.glowColor('새 "태그"'), '102, 136, 204');
  assert.equal(TagConfig.glowColor('일상'), null);
});

test('pending definitions are applied on load', () => {
  const defs = { tags: [{ name: '새 태그', emoji: '✨', color: '#6688cc', votable: false }], renames: {} };
  const document = fakeDocument();
  const { TagConfig } = loadTagConfig({ __tagDefinitions: defs, document });
  assert.equal(TagConfig.TAG_EMOJI['새 태그'], '✨');
  assert.equal(document.head.children.length, 1);
  assert.equal(document.head.children[0].id, 'tag-defs-style');
  assert.match(document.head.children[0].textContent, /새 태그/);
  TagConfig.applyDefinitions(defs);
  assert.equal(document.head.children.length, 1, 'the style element is reused');
});

// 리뷰 #1: 정의만 있고 색이 없는 태그(이모티콘·새 태그)가 존재하지 않는 CSS 변수를
// 가리키면 모달 배경·표지 선언이 통째로 무효가 된다.
test('glow values only point at stylesheet variables that exist', () => {
  const document = fakeDocument();
  document.createElement = () => ({ setAttribute() {}, appendChild() {}, className: '', textContent: '' });
  const { TagConfig } = loadTagConfig({ document });
  TagConfig.applyDefinitions({ tags: [
    { name: '일상', emoji: '☀️', color: null, votable: true },
    { name: '이모티콘', emoji: '🏷️', color: null, votable: false },
    { name: '새 태그', emoji: '✨', color: null, votable: false },
    { name: '파랑', emoji: '🔵', color: '#6688cc', votable: false }
  ], renames: {} });
  assert.equal(TagConfig.glowValue('일상'), 'var(--tag-glow-일상, var(--tag-glow-default))');
  assert.equal(TagConfig.glowValue('이모티콘'), 'var(--tag-glow-default)');
  assert.equal(TagConfig.glowValue('새 태그'), 'var(--tag-glow-default)');
  assert.equal(TagConfig.glowValue('파랑'), '102, 136, 204');
  const props = {};
  const el = { style: { setProperty: (k, v) => { props[k] = v; } }, classList: { add() {} }, appendChild() {} };
  TagConfig.applyTextCover(el, { tags: ['새 태그'], text: false });
  assert.equal(props['--cover-color'], 'var(--tag-glow-default)');
});
