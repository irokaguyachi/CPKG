// 삭제된 계정 410 처리(userData.js·bookmarkLibrary.js·profileStore.js) 검증.
// 실제 소스 세 개를 vm 의 window 하나에 올리고 fetch·localStorage 만 흉내 낸다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function storage() {
  const data = {};
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, data };
}

const CODE = 'ABCDEFGHJKMNPQRSTUVW';
const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function load({ fetch, order = ['bookmarkLibrary', 'userData', 'profileStore'] } = {}) {
  const window = new EventTarget();
  window.window = window;
  window.I18n = { t: (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)) };
  window.localStorage = storage();
  window.sessionStorage = storage();
  window.alerts = [];
  window.alert = msg => { window.alerts.push(msg); };
  window.confirm = () => true;
  window.localStorage.setItem('chokaguya_personal_code', CODE);
  const calls = [];
  const context = {
    window, console, CustomEvent, localStorage: window.localStorage, crypto: { getRandomValues: a => a },
    document: { readyState: 'complete' },
    fetch: (url, options) => { calls.push({ url, options }); return fetch(url, options); }
  };
  const files = { bookmarkLibrary: 'src/js/core/bookmarkLibrary.js', userData: 'src/js/core/userData.js', profileStore: 'src/js/components/profileStore.js' };
  for (const name of order) vm.runInNewContext(fs.readFileSync(path.join(root, files[name]), 'utf8'), context);
  return { window, calls };
}

const stillLoggedIn = w => w.localStorage.getItem('chokaguya_personal_code') !== null;
const DELETED = { error: 'account deleted' };

test('handleAccountDeleted logs out and alerts once', () => {
  const { window } = load({ fetch: () => reply(200, {}) });
  window.UserData.handleAccountDeleted();
  assert.equal(stillLoggedIn(window), false);
  window.localStorage.setItem('chokaguya_personal_code', CODE);
  window.UserData.handleAccountDeleted();
  assert.equal(stillLoggedIn(window), false);
  assert.equal(window.alerts.length, 1);
  assert.equal(window.alerts[0], '삭제된 계정이라 로그아웃됐어요.');
});

test('isAccountDeletedBody only matches the deleted error', () => {
  const { window } = load({ fetch: () => reply(200, {}) });
  assert.equal(window.UserData.isAccountDeletedBody(DELETED), true);
  assert.equal(window.UserData.isAccountDeletedBody({ error: 'hidden' }), false);
  assert.equal(window.UserData.isAccountDeletedBody(null), false);
});

test('sync 410 account deleted logs out instead of re-signing up', async () => {
  const { window, calls } = load({ fetch: url => url === '/user/sync' ? reply(410, DELETED) : reply(200, {}) });
  window.Bookmarks = { getRawStore: () => ({ bookmarks: [], deletedBookmarks: [] }) };
  await window.UserData.saveToServer();
  assert.equal(calls.some(c => c.url === '/user/signup'), false);
  assert.equal(stillLoggedIn(window), false);
  assert.equal(window.alerts.length, 1);
});

test('sync 404 then signup 410 logs out', async () => {
  const { window, calls } = load({
    fetch: url => url === '/user/sync' ? reply(404, { error: 'account not found' }) : reply(410, DELETED)
  });
  window.Bookmarks = { getRawStore: () => ({ bookmarks: [], deletedBookmarks: [] }) };
  await window.UserData.saveToServer();
  assert.equal(calls.filter(c => c.url === '/user/signup').length, 1);
  assert.equal(calls.filter(c => c.url === '/user/sync').length, 1, 'no retry after logout');
  assert.equal(stillLoggedIn(window), false);
});

test('hidden library 410 does not log out', async () => {
  const { window } = load({ fetch: () => reply(410, { error: 'hidden' }) });
  await assert.rejects(window.BookmarkLibrary.update('abc', { name: 'x' }), err => err.status === 410);
  assert.equal(stillLoggedIn(window), true);
  assert.equal(window.alerts.length, 0);
});

test('library 410 account deleted logs out', async () => {
  const { window } = load({ fetch: () => reply(410, DELETED), order: ['userData', 'bookmarkLibrary'] });
  await assert.rejects(window.BookmarkLibrary.publish('n', [], null), err => err.status === 410);
  assert.equal(stillLoggedIn(window), false);
});

test('profile save 410 account deleted logs out', async () => {
  const { window } = load({ fetch: url => url === '/profile/save' ? reply(410, DELETED) : reply(200, {}) });
  await assert.rejects(window.ProfileStore.saveMine({ nickname: 'a', icon: 'i', color: 'c', bio: '' }));
  assert.equal(stillLoggedIn(window), false);
});

test('login with a deleted code fails with the deleted message', async () => {
  const { window } = load({ fetch: () => reply(410, DELETED) });
  window.localStorage.removeItem('chokaguya_personal_code');
  await assert.rejects(window.UserData.login(CODE), err => err.message === '삭제된 계정의 코드예요.');
  assert.equal(stillLoggedIn(window), false);
});

test('deleteAccount logs out on success', async () => {
  const { window, calls } = load({ fetch: () => reply(200, { ok: true }) });
  await window.UserData.deleteAccount();
  const call = calls.find(c => c.url === '/user/delete');
  assert.ok(call);
  assert.deepEqual(JSON.parse(call.options.body), { personalCode: CODE });
  assert.equal(stillLoggedIn(window), false);
});

test('deleteAccount failures reject and keep the login', async () => {
  const busy = load({ fetch: () => reply(429, {}) });
  await assert.rejects(busy.window.UserData.deleteAccount(), err => err.message === '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');
  assert.equal(stillLoggedIn(busy.window), true);
  const down = load({ fetch: () => reply(503, { error: 'account delete unavailable' }) });
  await assert.rejects(down.window.UserData.deleteAccount(), err => err.message === '지금은 계정을 삭제할 수 없어요.');
  const offline = load({ fetch: () => Promise.reject(new Error('net')) });
  await assert.rejects(offline.window.UserData.deleteAccount(), err => err.message === '지금은 계정을 삭제할 수 없어요.');
  assert.equal(stillLoggedIn(offline.window), true);
});

// ---- 설정창 계정 삭제 패널(auth.js) ----
function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(), children: [], listeners: {}, textContent: '', className: '', value: '', disabled: false, hidden: false,
    appendChild(child) { this.children.push(child); return child; },
    get firstChild() { return this.children[0] || null; },
    insertBefore(node, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, node); return node; },
    setAttribute() {}, focus() {}, select() {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type) { (this.listeners[type] || []).forEach(fn => fn({ type })); }
  };
  Object.defineProperty(el, 'innerHTML', { set() { el.children = []; }, get() { return ''; } });
  return el;
}
const allText = el => (el.textContent || '') + el.children.map(allText).join('\n');
const findAll = (el, pred) => [].concat(pred(el) ? [el] : [], ...el.children.map(c => findAll(c, pred)));
const byText = (el, text) => findAll(el, n => n.tagName === 'BUTTON' && n.textContent === text);

function loadAuth({ deleteAccount }) {
  const state = { loggedIn: true };
  const window = new EventTarget();
  window.window = window;
  window.I18n = { t: s => s };
  window.BookmarkLibrary = {
    isLoggedIn: () => state.loggedIn, getPersonalCode: () => CODE,
    formatPersonalCodeForDisplay: c => c
  };
  window.UserData = { getStatus: () => 'synced', deleteAccount: () => deleteAccount(state) };
  const context = { window, document: { createElement: fakeElement }, console, setTimeout, fetch: () => Promise.reject(new Error('no')) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/components/auth.js'), 'utf8'), context);
  const container = fakeElement('div');
  window.AuthUI.renderAccountSettings(container);
  return { window, container, state };
}
const tick = () => new Promise(r => setImmediate(r));

test('delete button stays disabled until 삭제 is typed', () => {
  const { container } = loadAuth({ deleteAccount: () => Promise.resolve() });
  const [open] = byText(container, '계정 삭제');
  assert.ok(open);
  open.fire('click');
  const [confirm] = byText(container, '영구 삭제');
  const input = findAll(container, n => n.tagName === 'INPUT' && n.className.includes('settings-danger-input'))[0];
  assert.equal(confirm.disabled, true);
  input.value = '삭';
  input.fire('input');
  assert.equal(confirm.disabled, true);
  input.value = ' 삭제 ';
  input.fire('input');
  assert.equal(confirm.disabled, false);
});

test('successful delete re-renders the logged-out pane', async () => {
  const { container } = loadAuth({ deleteAccount: state => { state.loggedIn = false; return Promise.resolve(); } });
  byText(container, '계정 삭제')[0].fire('click');
  const input = findAll(container, n => n.tagName === 'INPUT' && n.className.includes('settings-danger-input'))[0];
  input.value = '삭제';
  input.fire('input');
  byText(container, '영구 삭제')[0].fire('click');
  await tick();
  assert.equal(byText(container, '로그인').length, 1);
  assert.ok(allText(container).includes('계정을 삭제했어요.'));
});

test('failed delete shows the error in the panel and keeps it open', async () => {
  const { container } = loadAuth({ deleteAccount: () => Promise.reject(new Error('지금은 계정을 삭제할 수 없어요.')) });
  byText(container, '계정 삭제')[0].fire('click');
  const input = findAll(container, n => n.tagName === 'INPUT' && n.className.includes('settings-danger-input'))[0];
  input.value = '삭제';
  input.fire('input');
  const [confirm] = byText(container, '영구 삭제');
  confirm.fire('click');
  assert.equal(confirm.disabled, true);
  assert.equal(confirm.textContent, '삭제하는 중…');
  await tick();
  const error = findAll(container, n => n.className.includes('settings-danger-error'))[0];
  assert.equal(error.textContent, '지금은 계정을 삭제할 수 없어요.');
  const panel = findAll(container, n => n.className.includes('settings-danger-panel'))[0];
  assert.equal(panel.hidden, false);
  assert.equal(confirm.disabled, false);
  assert.equal(confirm.textContent, '영구 삭제');
});

test('account delete UI strings have English and Japanese translations', () => {
  const keys = [
    '계정 삭제', '계정을 삭제하면 되돌릴 수 없어요.',
    '지워지는 것: 서버에 저장된 북마크, 프로필, 공개한 서재, 프로필로 올린 랭킹 기록',
    '남는 것: 태그 투표·끌올 신청(익명으로), 이 브라우저에 있는 북마크',
    "계속하려면 아래에 '삭제'라고 입력해 주세요.", '삭제', '취소', '영구 삭제', '삭제하는 중…',
    '계정을 삭제했어요.', '지금은 계정을 삭제할 수 없어요.', '삭제된 계정이라 로그아웃됐어요.', '삭제된 계정의 코드예요.'
  ];
  for (const lang of ['English', 'Japanese']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'src/data/i18n', lang + '.json'), 'utf8'));
    for (const key of keys) assert.ok(dict[key], `${lang}: ${key}`);
  }
});

test('deleteAccount treats 404 as nothing to delete and logs out', async () => {
  const { window } = load({ fetch: () => reply(404, { error: 'account not found' }) });
  await window.UserData.deleteAccount();
  assert.equal(stillLoggedIn(window), false);
});
