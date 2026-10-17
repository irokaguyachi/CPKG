// 브라우저 레벨 공식·본 문학 기록(src/js/core/profileLevel.js, components/profileStats.js) 검증.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function storage(throws) {
  const data = {};
  const guard = () => { if (throws) throw new Error('blocked'); };
  return {
    getItem: k => { guard(); return k in data ? data[k] : null; },
    setItem: (k, v) => { guard(); data[k] = String(v); },
    removeItem: k => { guard(); delete data[k]; }, data
  };
}

const CODE = 'ABCDEFGH12345678WXYZ';
function load({ code = CODE, profile = { id: 'abcdefghijkl' }, fetch, throwingStorage = false } = {}) {
  const window = {};
  window.window = window;
  window.BookmarkLibrary = { getPersonalCode: () => code };
  window.ProfileStore = { mine: () => profile };
  window.localStorage = storage(throwingStorage);
  const calls = [];
  const context = {
    window, console, Date,
    localStorage: window.localStorage,
    fetch: (url, options) => { calls.push({ url, options }); return fetch(url, options); }
  };
  for (const file of ['src/js/core/profileLevel.js', 'src/js/components/profileStats.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  return { window, calls };
}
const okRes = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const tick = () => new Promise(r => setImmediate(r));

test('ProfileLevel boundaries', () => {
  const { window } = load({ fetch: () => okRes({}) });
  const L = window.ProfileLevel;
  const lv = xp => L.fromStats({ viewed: xp, saved: 0, voted: 0, bumped: 0 }).level;
  assert.equal(lv(0), 1);
  assert.equal(lv(9), 1);
  assert.equal(lv(10), 2);
  assert.equal(lv(29), 2);
  assert.equal(lv(30), 3);
  const s = { viewed: 130, saved: 42, voted: 20, bumped: 5 };
  assert.equal(L.xp(s), 299);
  const r = L.fromStats(s);
  assert.equal(r.level, 8);
  assert.equal(r.xp, 299);
  assert.equal(r.levelStart, 280);
  assert.equal(r.nextStart, 360);
  assert.equal(L.xp({ viewed: -3, saved: 'x' }), 0);
  assert.equal(L.xp(null), 0);
});

test('noteView posts once per work and remembers it', async () => {
  const { window, calls } = load({ fetch: () => okRes({ ok: true, counted: true }) });
  window.ProfileStats.noteView('novel', 123);
  window.ProfileStats.noteView('novel', 123);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/profile/view');
  assert.deepEqual(JSON.parse(calls[0].options.body), { personalCode: CODE, type: 'novel', id: 123 });
  const stored = window.localStorage.data['chokaguya_profile_views:abcdefghijkl'];
  assert.deepEqual(JSON.parse(stored), ['novel:123']);
  assert.ok(!JSON.stringify(window.localStorage.data).includes(CODE));
});

test('noteView remembers by profile id, so a recreated profile sends again', async () => {
  const profile = { id: 'abcdefghijkl' };
  const { window, calls } = load({ profile, fetch: () => okRes({ ok: true, counted: true }) });
  window.ProfileStats.noteView('novel', 123);
  await tick();
  // 프로필을 지우고 다시 만들면 ID 가 바뀐다
  profile.id = 'mnopqrstuvwx';
  window.ProfileStats.noteView('novel', 123);
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(window.localStorage.data['chokaguya_profile_views:mnopqrstuvwx']), ['novel:123']);
  assert.ok(!Object.keys(window.localStorage.data).some(k => k.includes(CODE.slice(0, 8))));
});

test('noteView sends nothing for a profile without a valid id', () => {
  const a = load({ profile: { id: '' }, fetch: () => okRes({}) });
  a.window.ProfileStats.noteView('novel', 1);
  assert.equal(a.calls.length, 0);
});

test('noteView forgets a work the daily cap refused, and remembers other answers', async () => {
  const answers = [{ ok: true, counted: false, capped: true }, { ok: true, counted: true }, { ok: true, counted: false }];
  let n = 0;
  const { window, calls } = load({ fetch: () => okRes(answers[n++]) });
  const stored = () => JSON.parse(window.localStorage.data['chokaguya_profile_views:abcdefghijkl'] || '[]');
  window.ProfileStats.noteView('novel', 1);
  await tick(); await tick();
  assert.deepEqual(stored(), []);
  // capped 였던 작품은 다시 보낸다
  window.ProfileStats.noteView('novel', 1);
  await tick(); await tick();
  assert.deepEqual(stored(), ['novel:1']);
  // counted:false(이미 셌다·프로필 없음)는 기억한다
  window.ProfileStats.noteView('novel', 2);
  await tick(); await tick();
  assert.deepEqual(stored(), ['novel:1', 'novel:2']);
  window.ProfileStats.noteView('novel', 1);
  window.ProfileStats.noteView('novel', 2);
  await tick();
  assert.equal(calls.length, 3);
});

test('level text uses the card ink colour, the bar keeps the profile colour', () => {
  const css = fs.readFileSync(path.join(root, 'src/css/components/profile.css'), 'utf8');
  const rule = sel => {
    const at = css.indexOf(sel + ' {');
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('.profile-card-level'), /color: var\(--card-ink/);
  assert.doesNotMatch(rule('.profile-card-level'), /--profile-color/);
  assert.match(rule('.profile-card-xp-fill'), /background: var\(--profile-color/);
});

test('noteView keeps only the most recent 2000 keys', async () => {
  const { window } = load({ fetch: () => okRes({}) });
  const keys = [];
  for (let i = 0; i < 2000; i++) keys.push('novel:' + i);
  window.localStorage.setItem('chokaguya_profile_views:abcdefghijkl', JSON.stringify(keys));
  window.ProfileStats.noteView('novel', 5000);
  const list = JSON.parse(window.localStorage.data['chokaguya_profile_views:abcdefghijkl']);
  assert.equal(list.length, 2000);
  assert.equal(list[0], 'novel:1');
  assert.equal(list[1999], 'novel:5000');
});

test('noteView sends nothing without a login or a profile', () => {
  const a = load({ code: null, fetch: () => okRes({}) });
  a.window.ProfileStats.noteView('novel', 1);
  assert.equal(a.calls.length, 0);
  const b = load({ profile: null, fetch: () => okRes({}) });
  b.window.ProfileStats.noteView('novel', 1);
  assert.equal(b.calls.length, 0);
});

test('noteView ignores bad arguments', () => {
  const { window, calls } = load({ fetch: () => okRes({}) });
  window.ProfileStats.noteView('', 1);
  window.ProfileStats.noteView('novel', null);
  window.ProfileStats.noteView('novel', -1);
  assert.equal(calls.length, 0);
});

test('noteView still works when localStorage throws', async () => {
  const { window, calls } = load({ throwingStorage: true, fetch: () => okRes({}) });
  assert.doesNotThrow(() => window.ProfileStats.noteView('novel', 7));
  await tick();
  assert.equal(calls.length, 1);
});

test('noteView failure does not throw and allows a retry', async () => {
  let n = 0;
  const { window, calls } = load({ fetch: () => (++n === 1 ? Promise.reject(new Error('net')) : okRes({})) });
  window.ProfileStats.noteView('novel', 9);
  await tick();
  window.ProfileStats.noteView('novel', 9);
  await tick();
  assert.equal(calls.length, 2);
});

test('fetch caches for 60s and returns null on failure', async () => {
  const stats = { viewed: 1, saved: 2, voted: 3, bumped: 4 };
  const { window, calls } = load({ fetch: () => okRes(stats) });
  const first = await window.ProfileStats.fetch('abcdefghijkl');
  assert.equal(JSON.stringify(first), JSON.stringify(stats));
  assert.equal(calls[0].url, '/profile/stats?id=abcdefghijkl');
  await window.ProfileStats.fetch('abcdefghijkl');
  assert.equal(calls.length, 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 61000;
  try {
    await window.ProfileStats.fetch('abcdefghijkl');
  } finally { Date.now = realNow; }
  assert.equal(calls.length, 2);

  const bad = load({ fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) });
  assert.equal(await bad.window.ProfileStats.fetch('abcdefghijkl'), null);
  const down = load({ fetch: () => Promise.reject(new Error('net')) });
  assert.equal(await down.window.ProfileStats.fetch('abcdefghijkl'), null);
});

// ---- 프로필 카드 스탯 영역(components/profileCard.js) ----
const CATALOG = JSON.parse(fs.readFileSync(path.join(root, 'src/data/config/ProfileIcons.json'), 'utf8'));
function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(), children: [], attributes: {}, textContent: '', className: '', parent: null,
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    appendChild(child) { child.parent = el; el.children.push(child); return child; },
    remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); el.parent = null; },
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return k in el.attributes ? el.attributes[k] : null; },
    addEventListener() {},
    get classList() {
      const list = () => el.className.split(/\s+/).filter(Boolean);
      return {
        add: (...n) => { el.className = [...new Set([...list(), ...n])].join(' '); },
        remove: (...n) => { el.className = list().filter(x => !n.includes(x)).join(' '); },
        contains: n => list().includes(n)
      };
    }
  };
  return el;
}
const hasClass = (el, c) => el.className.split(/\s+/).includes(c);
const findAll = (el, pred) => [].concat(pred(el) ? [el] : [], ...el.children.map(c => findAll(c, pred)));
const byClass = (el, c) => findAll(el, n => hasClass(n, c));
const textOf = el => (el.textContent || '') + el.children.map(textOf).join('');

function loadCard(statsFetch) {
  const window = {};
  window.window = window;
  window.I18n = { t: (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)) };
  window.ProfileStore = { colorHex: () => '#e0306e', iconFile: () => null };
  const context = { window, document: { createElement: fakeElement }, console };
  for (const file of ['src/js/core/profileLevel.js', 'src/js/components/profileCard.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  const calls = [];
  window.ProfileStats = { fetch: id => { calls.push(id); return statsFetch(id); } };
  return { window, calls };
}
const P = { id: 'abcdefghijkl', nickname: '카구야', icon: 'x', color: 'rose', bio: '' };

test('card fills level, bar and four stats in order', async () => {
  const { window, calls } = loadCard(() => Promise.resolve({ viewed: 130, saved: 42, voted: 20, bumped: 5 }));
  const card = window.ProfileCard.card(P, CATALOG);
  const area = byClass(card, 'profile-card-stats')[0];
  assert.ok(area);
  assert.ok(hasClass(area, 'is-loading'));
  await tick();
  assert.deepEqual(calls, ['abcdefghijkl']);
  assert.ok(!hasClass(area, 'is-loading'));
  assert.equal(textOf(byClass(area, 'profile-card-level')[0]), 'Lv.8');
  const xp = byClass(area, 'profile-card-xp')[0];
  assert.ok(textOf(xp).includes('299/360'));
  const fill = byClass(xp, 'profile-card-xp-fill')[0];
  assert.equal(fill.style.width, '23.75%'); // (299-280)/(360-280)
  const nums = byClass(area, 'profile-card-stat').map(n => textOf(byClass(n, 'profile-card-stat-num')[0]));
  assert.deepEqual(nums, ['130', '42', '20', '5']);
  const names = byClass(area, 'profile-card-stat').map(n => textOf(byClass(n, 'profile-card-stat-name')[0]));
  assert.deepEqual(names, ['본 문학 수', '저장 수', '태그 투표 수', '끌올 수']);
});

test('card removes the stats area when stats fail', async () => {
  const { window } = loadCard(() => Promise.resolve(null));
  const card = window.ProfileCard.card(P, CATALOG);
  assert.equal(byClass(card, 'profile-card-stats').length, 1);
  await tick();
  assert.equal(byClass(card, 'profile-card-stats').length, 0);
});

test('card without a profile or without an id has no stats area and no request', () => {
  const { window, calls } = loadCard(() => Promise.resolve(null));
  assert.equal(byClass(window.ProfileCard.card(null, CATALOG), 'profile-card-stats').length, 0);
  assert.equal(byClass(window.ProfileCard.card({ nickname: '초안' }, CATALOG), 'profile-card-stats').length, 0);
  // 설정창 편집기가 실제로 넘기는 초안 모양(profileEditor.js: id: '')
  assert.equal(byClass(window.ProfileCard.card({ id: '', nickname: '초안', icon: 'x', color: 'rose', bio: '' }, CATALOG), 'profile-card-stats').length, 0);
  assert.equal(byClass(window.ProfileCard.card({ id: 'short', nickname: '초안' }, CATALOG), 'profile-card-stats').length, 0);
  assert.equal(calls.length, 0);
});

test('card survives a late stats response on a detached node', async () => {
  let resolve;
  const { window } = loadCard(() => new Promise(r => { resolve = r; }));
  const card = window.ProfileCard.card(P, CATALOG);
  const area = byClass(card, 'profile-card-stats')[0];
  area.remove();
  resolve({ viewed: 1, saved: 0, voted: 0, bumped: 0 });
  await tick();
  assert.equal(textOf(byClass(area, 'profile-card-level')[0]), 'Lv.1');
});

test('new stats strings exist in English and Japanese', () => {
  const keys = ['Lv.{n}', '본 문학 수', '저장 수', '태그 투표 수', '끌올 수'];
  for (const lang of ['English', 'Japanese']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'src/data/i18n/' + lang + '.json'), 'utf8'));
    for (const k of keys) assert.ok(typeof dict[k] === 'string' && dict[k], lang + ' missing ' + k);
  }
  const en = JSON.parse(fs.readFileSync(path.join(root, 'src/data/i18n/English.json'), 'utf8'));
  assert.deepEqual(['본 문학 수', '저장 수', '태그 투표 수', '끌올 수'].map(k => en[k]), ['Viewed', 'Saved', 'Tag votes', 'Bumps']);
});
