// 공식 태그 덮어쓰기의 브라우저 쪽(src/js/config/cdnConfig.js) 검증.
// cdnConfig.js 를 vm 에서 window 하나로 실행하고 fetch 만 흉내 낸다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const novel = (id, tags) => ({ name: 'n' + id, tags, posts: [{ id }] });

function loadConfig(files, overrides, tagConfig) {
  const calls = [];
  const window = {};
  window.window = window;
  if (tagConfig) window.TagConfig = tagConfig;
  window.fetch = async url => {
    calls.push(url);
    const pathname = url.split('?')[0];
    if (pathname === '/tags/official') {
      if (overrides instanceof Error) throw overrides;
      return { ok: true, json: async () => overrides };
    }
    const name = pathname.split('/').pop();
    if (!(name in files)) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => JSON.parse(JSON.stringify(files[name])) };
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/config/cdnConfig.js'), 'utf8'), {
    window, fetch: window.fetch, console
  });
  return { window, calls };
}

const FILES = {
  'Novel.json': [novel(1, ['일상']), novel(2, ['로맨스'])],
  'Translation.json': [novel(3, ['감동'])],
  'Series.json': [novel(4, ['장편'])],
  'HOF.json': [novel(5, ['명예관'])],
  'Official.json': [novel(6, [])],
  'Lookup.json': { novel: { 1: novel(1, ['일상']), 2: novel(2, ['로맨스']) }, series: { 4: { name: 's', posts: [{ id: 4 }] } } },
  'Recent.json': { totals: { novel: 2 }, novels: [novel(1, ['일상'])] }
};
const OVERRIDES = { v: 1, items: { 'novel:1': ['슬픔', '새태그'], 'translation:3': [], 'series:4': ['단편'], 'hof:5': ['대회'], 'official:6': ['공식'] } };

test('every page data shape gets the overridden tags', async () => {
  const { window } = loadConfig(FILES, OVERRIDES);
  const get = name => window.fetchPageData('../data/pageData/' + name);
  const novels = await get('Novel.json');
  assert.deepEqual(novels.map(e => e.tags), [['슬픔', '새태그'], ['로맨스']]);
  assert.deepEqual((await get('Translation.json'))[0].tags, [], 'an empty override removes every tag');
  assert.deepEqual((await get('Series.json'))[0].tags, ['단편']);
  assert.deepEqual((await get('HOF.json'))[0].tags, ['대회']);
  assert.deepEqual((await get('Official.json'))[0].tags, ['공식']);
  const lookup = await get('Lookup.json');
  assert.deepEqual(lookup.novel[1].tags, ['슬픔', '새태그']);
  assert.deepEqual(lookup.novel[2].tags, ['로맨스']);
  assert.deepEqual(lookup.series[4].tags, ['단편']);
  assert.deepEqual((await get('Recent.json')).novels[0].tags, ['슬픔', '새태그']);
});

test('fetchJsonCached applies overrides once and other data is untouched', async () => {
  const files = { ...FILES, 'Tip.json': ['tip'] };
  const { window, calls } = loadConfig(files, OVERRIDES);
  const a = await window.fetchJsonCached('../data/pageData/Novel.json');
  const b = await window.fetchJsonCached('../data/pageData/Novel.json');
  assert.equal(a, b);
  assert.deepEqual(a[0].tags, ['슬픔', '새태그']);
  await window.fetchPageData('../data/pageData/Series.json');
  assert.deepEqual(await window.fetchJsonCached('../data/config/Tip.json'), ['tip']);
  assert.equal(calls.filter(u => u.startsWith('/tags/official')).length, 1, 'overrides are fetched once per page');
});

test('a failed overrides request falls back to the original tags', async () => {
  for (const overrides of [new Error('offline'), { v: 1 }, null]) {
    const { window } = loadConfig(FILES, overrides);
    assert.deepEqual((await window.fetchPageData('../data/pageData/Novel.json'))[0].tags, ['일상']);
  }
});

// ---- 태그 정의(v2 파일의 tags·renames) ----
test('renames apply to every page data shape and remove duplicates', async () => {
  const v2 = { v: 2, items: { 'novel:1': ['A', 'B'] }, tags: null, renames: { A: 'B', 로맨스: '사랑' } };
  const { window } = loadConfig(FILES, v2);
  // 바뀐 tags 배열은 vm 안에서 새로 만들어지므로 JSON 으로 옮겨 비교한다.
  const get = async name => JSON.parse(JSON.stringify(await window.fetchPageData('../data/pageData/' + name)));
  assert.deepEqual((await get('Novel.json')).map(e => e.tags), [['B'], ['사랑']]);
  const lookup = await get('Lookup.json');
  assert.deepEqual(lookup.novel[1].tags, ['B']);
  assert.deepEqual(lookup.novel[2].tags, ['사랑']);
  assert.deepEqual((await get('Recent.json')).novels[0].tags, ['B']);
});

test('the user tag catalog follows votable definitions', async () => {
  const files = { ...FILES, 'UserTagCatalog.json': ['일상'] };
  const tags = [{ name: '슬픔', emoji: '💧', color: null, votable: true }, { name: '감동', emoji: '🥹', color: null, votable: false }];
  let { window } = loadConfig(files, { v: 2, items: {}, tags, renames: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(await window.fetchJsonCached('../data/pageData/UserTagCatalog.json'))), ['슬픔']);
  ({ window } = loadConfig(files, { v: 2, items: {}, tags: null, renames: {} }));
  assert.deepEqual(await window.fetchJsonCached('../data/pageData/UserTagCatalog.json'), ['일상']);
});

test('definitions reach TagConfig once, even if it loads later', async () => {
  const defs = { tags: [{ name: '슬픔', emoji: '💧', color: null, votable: true }], renames: { A: 'B' } };
  const seen = [];
  let { window } = loadConfig(FILES, { v: 2, items: {}, ...defs }, { applyDefinitions: d => seen.push(d) });
  await window.fetchPageData('../data/pageData/Novel.json');
  await window.fetchPageData('../data/pageData/Series.json');
  assert.equal(seen.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), defs);
  ({ window } = loadConfig(FILES, { v: 2, items: {}, ...defs }));
  await window.fetchPageData('../data/pageData/Novel.json');
  assert.deepEqual(JSON.parse(JSON.stringify(window.__tagDefinitions)), defs);
  ({ window } = loadConfig(FILES, OVERRIDES));
  await window.fetchPageData('../data/pageData/Novel.json');
  assert.equal(window.__tagDefinitions, undefined);
});
