// 브라우저 프로필 부품(src/js/components/profileStore.js, profileCard.js) 검증.
// 두 파일을 vm 에서 window 하나로 실행하고, DOM 은 쓰는 만큼만 흉내 낸다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(root, 'src/data/config/ProfileIcons.json'), 'utf8'));

function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(), children: [], attributes: {}, listeners: {}, textContent: '', className: '',
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    get classList() {
      const self = this;
      const list = () => self.className.split(/\s+/).filter(Boolean);
      return {
        add: (...names) => { self.className = [...new Set([...list(), ...names])].join(' '); },
        remove: (...names) => { self.className = list().filter(n => !names.includes(n)).join(' '); },
        contains: name => list().includes(name),
        toggle: (name, on) => { if (on === undefined ? !list().includes(name) : on) self.classList.add(name); else self.classList.remove(name); }
      };
    }
  };
  return el;
}
const allText = el => (el.textContent || '') + el.children.map(allText).join('');
const find = (el, pred) => pred(el) ? el : el.children.map(c => find(c, pred)).find(Boolean) || null;

function storage() {
  const data = {};
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, data };
}

function loadProfiles({ code = null, fetch } = {}) {
  const window = new EventTarget();
  const state = { code };
  window.window = window;
  window.I18n = { t: (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)) };
  window.BookmarkLibrary = { getPersonalCode: () => state.code, isLoggedIn: () => !!state.code };
  window.localStorage = storage();
  const document = { createElement: fakeElement, body: fakeElement('body') };
  const calls = [];
  const context = {
    window, document, console, CustomEvent, localStorage: window.localStorage,
    fetch: (url, options) => { calls.push({ url, options }); return fetch(url, options); }
  };
  for (const file of ['src/js/components/profileStore.js', 'src/js/components/profileCard.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  const setCode = (next) => {
    state.code = next;
    window.dispatchEvent(new CustomEvent('chokaguya:auth-change', { detail: { loggedIn: !!next } }));
  };
  return { window, calls, setCode };
}

const jsonRes = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const PROFILE = { id: 'abcdefghijkl', nickname: '카구야', icon: 'fushi-nyam', color: 'rose', bio: '안녕' };

test('badge renders nickname and avatar color', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  const badge = window.ProfileCard.badge(PROFILE, CATALOG);
  assert.equal(badge.tagName, 'BUTTON');
  assert.equal(badge.getAttribute('data-profile-id'), PROFILE.id);
  assert.ok(allText(badge).includes('카구야'));
  const avatar = find(badge, el => el.className.split(' ').includes('profile-avatar'));
  assert.ok(avatar);
  assert.equal(avatar.style.props['--profile-color'], '#e0306e');
  const img = find(avatar, el => el.tagName === 'IMG');
  assert.equal(img.src, '/offlineSrc/loadingLogo/후시 냠냠.gif');
});

test('badge for a missing profile says unknown user', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  const badge = window.ProfileCard.badge(null, CATALOG);
  assert.equal(badge.tagName, 'SPAN');
  assert.ok(badge.className.split(' ').includes('is-unknown'));
  assert.equal(allText(badge), '알 수 없는 유저');
});

test('card shows nickname and bio', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  const card = window.ProfileCard.card(PROFILE, CATALOG);
  assert.ok(card.className.split(' ').includes('profile-card'));
  assert.ok(allText(card).includes('카구야'));
  assert.ok(allText(card).includes('안녕'));
});

test('fetchMany batches requests in the same tick', async () => {
  const { window, calls } = loadProfiles({ fetch: () => jsonRes({ profiles: { a: { ...PROFILE, id: 'a' } } }) });
  const [first, second] = await Promise.all([window.ProfileStore.fetchMany(['a']), window.ProfileStore.fetchMany(['b', 'a'])]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/profiles?ids=a,b');
  assert.equal(first.a.nickname, '카구야');
  assert.equal(second.b, null);
  await window.ProfileStore.fetchMany(['a', 'b']);
  assert.equal(calls.length, 1, 'cached ids are not fetched again');
});

test('fetchMany splits more than fifty ids', async () => {
  const { window, calls } = loadProfiles({ fetch: () => jsonRes({ profiles: {} }) });
  const ids = Array.from({ length: 120 }, (_, i) => 'p' + i);
  await window.ProfileStore.fetchMany(ids);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.url.split('ids=')[1].split(',').length <= 50));
});

test('logout drops a late loadMine response', async () => {
  let release;
  const { window, setCode } = loadProfiles({
    code: null,
    fetch: () => new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ profile: PROFILE }) }); })
  });
  setCode('personal_code_0001');
  setCode(null);
  release();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(window.ProfileStore.mine(), null);
});

test('mine is cached so page loads do not hit the auth limiter', async () => {
  const first = loadProfiles({ code: null, fetch: () => jsonRes({ profile: PROFILE }) });
  first.setCode('personal_code_0001');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(first.window.ProfileStore.mine().nickname, '카구야');
  // 같은 브라우저(localStorage)에서 다음 페이지를 연 상황
  const window = new EventTarget();
  window.window = window;
  window.I18n = { t: s => s };
  window.BookmarkLibrary = { getPersonalCode: () => 'personal_code_0001', isLoggedIn: () => true };
  window.localStorage = first.window.localStorage;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/components/profileStore.js'), 'utf8'), {
    window, console, CustomEvent, localStorage: window.localStorage,
    fetch: url => { calls.push(url); return jsonRes({ profile: PROFILE }); }
  });
  assert.equal(window.ProfileStore.mine().nickname, '카구야', 'cached profile is available synchronously');
  assert.equal(calls.length, 0, 'fresh cache skips /profile/me');
});

const PROFILE_UI_STRINGS = [
  '프로필', '프로필 편집', '프로필 만들기', '로그인하면 프로필을 만들 수 있어요',
  '만든 뒤의 태그 투표·끌올·공개 북마크·랭킹 활동에 이 프로필이 표시돼요',
  '알 수 없는 유저', '닉네임', '아이콘', '색', '자기소개', '저장', '저장했어요', '프로필 삭제',
  '프로필을 삭제할까요? 지금 닉네임은 다른 사람이 쓸 수 있게 돼요.', '불러오는 중…',
  '이미 쓰이는 닉네임이에요', '쓸 수 없는 단어가 들어 있어요', '쓸 수 없는 닉네임 형식이에요',
  '닉네임은 1~12자로 정해 주세요', '자기소개는 40자까지 쓸 수 있어요', '{date}부터 닉네임을 바꿀 수 있어요',
  '계정을 찾지 못했어요. 다시 로그인해 주세요', '잠시 후 다시 시도해 주세요',
  '익명 {n}명', '아직 투표한 사람이 없어요', '끌올', '만든 사람', '투표한 사람 보기'
];

test('voterList shows badges and anonymous count', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  const list = window.ProfileCard.voterList(['a', 'gone'], 2, { a: { ...PROFILE, id: 'a' }, gone: null }, CATALOG);
  assert.ok(list.className.split(' ').includes('profile-voters'));
  const badges = [];
  (function walk(el) { if (String(el.className).split(' ').includes('profile-badge') && el.tagName === 'BUTTON') badges.push(el); el.children.forEach(walk); })(list);
  assert.equal(badges.length, 1);
  assert.ok(allText(list).includes('익명 3명'));
});

test('voterList without anyone says no voters', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  assert.equal(allText(window.ProfileCard.voterList([], 0, {}, CATALOG)), '아직 투표한 사람이 없어요');
});

test('nameCell falls back to text', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  const text = window.ProfileCard.nameCell(null, '직접입력', CATALOG);
  assert.equal(text.tagName, 'SPAN');
  assert.equal(allText(text), '직접입력');
  const chip = window.ProfileCard.nameCell(PROFILE, '무시', CATALOG);
  assert.equal(chip.tagName, 'BUTTON');
  assert.ok(allText(chip).includes('카구야'));
});

test('profile error codes map to readable messages', () => {
  const { window } = loadProfiles({ fetch: () => jsonRes({}) });
  const msg = window.ProfileStore.errorMessage;
  assert.equal(msg('nickname taken'), '이미 쓰이는 닉네임이에요');
  assert.equal(msg('banned word'), '쓸 수 없는 단어가 들어 있어요');
  assert.equal(msg('reserved nickname'), '쓸 수 없는 닉네임 형식이에요');
  assert.equal(msg('invalid nickname'), '닉네임은 1~12자로 정해 주세요');
  assert.equal(msg('invalid bio'), '자기소개는 40자까지 쓸 수 있어요');
  assert.equal(msg('account not found'), '계정을 찾지 못했어요. 다시 로그인해 주세요');
  assert.equal(msg('something else'), '잠시 후 다시 시도해 주세요');
  assert.equal(msg('network'), '잠시 후 다시 시도해 주세요');
  const cooldown = msg('nickname cooldown', Date.parse('2026-10-15T12:00:00+09:00'));
  assert.match(cooldown, /10월 15일부터 닉네임을 바꿀 수 있어요/);
});

test('profile UI strings have English and Japanese translations', () => {
  for (const lang of ['English', 'Japanese']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'src/data/i18n', lang + '.json'), 'utf8'));
    for (const key of PROFILE_UI_STRINGS) assert.ok(dict[key], `${lang}: ${key}`);
    assert.ok(dict['{date}부터 닉네임을 바꿀 수 있어요'].includes('{date}'));
  }
});
