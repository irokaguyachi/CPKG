// 로그인 아이디 브라우저 상태(userData.js·bookmarkLibrary.js) 검증.
// 실제 소스를 vm 의 window 하나에 올리고 fetch·localStorage 만 흉내 낸다.
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
const OTHER = 'ZZZZZZZZZZZZZZZZZZZZ';
const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const ID_KEY = 'chokaguya_login_id';

// dict: 번역 사전(없으면 한국어 원문 그대로). 다른 언어에서 한국어가 새지 않는지 볼 때 쓴다.
const fakeT = dict => (s, vars) => String(dict && dict[s] || s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m));

function load({ fetch, loggedIn = true, now, dict } = {}) {
  const window = new EventTarget();
  window.window = window;
  window.I18n = { t: fakeT(dict) };
  window.localStorage = storage();
  window.sessionStorage = storage();
  window.alert = () => {};
  window.confirm = () => true;
  if (loggedIn) window.localStorage.setItem('chokaguya_personal_code', CODE);
  const calls = [];
  const events = [];
  window.addEventListener('chokaguya:login-id-change', e => events.push(e.detail));
  const DateStub = now === undefined ? Date : Object.assign(function (...a) { return new Date(...a); }, { UTC: Date.UTC, now: () => now });
  const context = {
    window, console, CustomEvent, Date: DateStub, localStorage: window.localStorage, crypto: { getRandomValues: a => a },
    document: { readyState: 'complete' },
    fetch: (url, options) => { calls.push({ url, body: JSON.parse(options.body), options }); return fetch(url, options); }
  };
  for (const f of ['src/js/core/bookmarkLibrary.js', 'src/js/core/userData.js']) vm.runInNewContext(fs.readFileSync(path.join(root, f), 'utf8'), context);
  return { window, calls, events };
}

// vm 안에서 만든 객체는 프로토타입이 달라 deepEqual 이 실패하므로 평범한 객체로 바꿔 비교한다
const plain = x => JSON.parse(JSON.stringify(x));
const remembered = w => JSON.parse(w.localStorage.getItem(ID_KEY));
const userStore = { syncVersion: 1, data: { version: 1, bookmarks: [], deletedBookmarks: [] } };

test('loginWithId posts the raw id, logs in with the returned code and remembers the id', async () => {
  const { window, calls, events } = load({
    loggedIn: false,
    fetch: url => url === '/user/login' ? reply(200, { personalCode: CODE, loginId: 'kim_01' }) : reply(200, { userStore })
  });
  const code = await window.UserData.loginWithId('Kim_01');
  assert.equal(code, CODE);
  assert.equal(calls[0].url, '/user/login');
  assert.equal(calls[0].body.loginId, 'Kim_01');
  assert.equal(calls[1].url, '/user/get');
  assert.equal(window.localStorage.getItem('chokaguya_personal_code'), CODE);
  assert.equal(remembered(window).loginId, 'kim_01');
  assert.equal(remembered(window).code, CODE);
  assert.deepEqual(plain(events), [{ loginId: 'kim_01' }]);
});

test('loginWithId rejects a bad format without calling the server', async () => {
  const { window, calls } = load({ loggedIn: false, fetch: () => reply(200, {}) });
  for (const bad of ['abc', 'has space', 'a'.repeat(21), '한글한글한글', '']) {
    await assert.rejects(window.UserData.loginWithId(bad), err => err.message === '영문 소문자, 숫자, _ 로 4~20자로 입력해 주세요.');
  }
  assert.equal(calls.length, 0);
});

test('loginWithId maps 404 and 429', async () => {
  const missing = load({ loggedIn: false, fetch: () => reply(404, { error: 'login id not found' }) });
  await assert.rejects(missing.window.UserData.loginWithId('nobody'), err => err.message === '없는 아이디예요.');
  const busy = load({ loggedIn: false, fetch: () => reply(429, {}) });
  await assert.rejects(busy.window.UserData.loginWithId('nobody'), err => err.message === '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');
});

test('signupWithId sends code and id, then logs in and remembers', async () => {
  const { window, calls } = load({ loggedIn: false, fetch: () => reply(201, { ok: true, syncVersion: 1, loginId: 'kim_01' }) });
  const code = await window.UserData.signupWithId('Kim_01');
  assert.equal(calls[0].url, '/user/signup');
  assert.equal(calls[0].body.loginId, 'Kim_01');
  assert.equal(calls[0].body.personalCode, code);
  assert.equal(code.length, 20);
  assert.equal(window.localStorage.getItem('chokaguya_personal_code'), code);
  assert.equal(remembered(window).loginId, 'kim_01');
});

test('signupWithId 409 shows the taken message and keeps the login empty', async () => {
  const { window } = load({ loggedIn: false, fetch: () => reply(409, { error: 'login id taken' }) });
  await assert.rejects(window.UserData.signupWithId('kim_01'), err => err.message === '이미 쓰이고 있는 아이디예요.');
  assert.equal(window.localStorage.getItem('chokaguya_personal_code'), null);
  assert.equal(window.localStorage.getItem(ID_KEY), null);
});

test('signupWithId reuses one pending code across retries until it succeeds', async () => {
  let n = 0;
  const { window, calls } = load({
    loggedIn: false,
    fetch: () => (++n === 1 ? reply(409, { error: 'login id taken' }) : reply(201, { ok: true, syncVersion: 1, loginId: 'other_id' }))
  });
  // 호출마다 다른 코드를 만들어 주는 발급기로 바꿔, 재사용이 아니면 코드가 달라지게 한다
  let issued = 0;
  window.BookmarkLibrary.issueNewPersonalCode = () => { issued++; return issued === 1 ? CODE : OTHER; };
  await assert.rejects(window.UserData.signupWithId('kim_01'));
  await window.UserData.signupWithId('other_id');
  assert.equal(calls[0].body.personalCode, CODE);
  assert.equal(calls[1].body.personalCode, CODE);
  assert.equal(issued, 1);
  // 성공 뒤에는 비우므로 다음 가입은 새 코드를 만든다
  window.BookmarkLibrary.logout();
  await window.UserData.signupWithId('third_id');
  assert.equal(calls[2].body.personalCode, OTHER);
});

test('signupWithId remembers only the id the server reports, never the typed one', async () => {
  // 이미 있는 계정(existed)이라 보낸 아이디가 붙지 않은 경우
  const existed = load({ loggedIn: false, fetch: () => reply(200, { ok: true, existed: true, syncVersion: 3, loginId: null }) });
  await existed.window.UserData.signupWithId('Typed_Id');
  assert.equal(existed.window.localStorage.getItem(ID_KEY), null);
  assert.equal(existed.events.some(e => e && e.loginId === 'typed_id'), false);
  // 서버가 다른 아이디를 알려 주면 그것을 기억한다
  const other = load({ loggedIn: false, fetch: () => reply(200, { ok: true, existed: true, syncVersion: 3, loginId: 'real_id' }) });
  await other.window.UserData.signupWithId('Typed_Id');
  assert.equal(remembered(other.window).loginId, 'real_id');
});

test('getLoginId fetches once, then answers from memory; another code asks again', async () => {
  const { window, calls } = load({ fetch: () => reply(200, { loginId: 'kim_01', changeableAt: 123 }) });
  assert.deepEqual(plain(await window.UserData.getLoginId()), { loginId: 'kim_01', changeableAt: 123 });
  assert.deepEqual(plain(await window.UserData.getLoginId()), { loginId: 'kim_01', changeableAt: 123 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/login-id/me');
  assert.deepEqual(calls[0].body, { personalCode: CODE });
  window.localStorage.setItem('chokaguya_personal_code', OTHER);
  await window.UserData.getLoginId();
  assert.equal(calls.length, 2);
  assert.equal(remembered(window).code, OTHER);
});

test('getLoginId does not remember a missing id and skips the server when logged out', async () => {
  const { window } = load({ fetch: () => reply(200, { loginId: null, changeableAt: 0 }) });
  assert.deepEqual(plain(await window.UserData.getLoginId()), { loginId: null, changeableAt: 0 });
  assert.equal(window.localStorage.getItem(ID_KEY), null);
  const out = load({ loggedIn: false, fetch: () => reply(200, {}) });
  assert.deepEqual(plain(await out.window.UserData.getLoginId()), { loginId: null, changeableAt: 0 });
  assert.equal(out.calls.length, 0);
});

test('getLoginId 410 account deleted logs out and clears the remembered id', async () => {
  const { window } = load({ fetch: () => reply(410, { error: 'account deleted' }) });
  window.localStorage.setItem(ID_KEY, JSON.stringify({ code: OTHER, loginId: 'old_id', changeableAt: 0 }));
  await assert.rejects(window.UserData.getLoginId(), err => err.accountDeleted === true);
  assert.equal(window.localStorage.getItem('chokaguya_personal_code'), null);
  assert.equal(window.localStorage.getItem(ID_KEY), null);
});

test('setLoginId posts to /login-id/set, remembers and notifies', async () => {
  const { window, calls, events } = load({ fetch: () => reply(200, { loginId: 'new_id', changeableAt: 999 }) });
  assert.deepEqual(plain(await window.UserData.setLoginId('New_Id')), { loginId: 'new_id', changeableAt: 999 });
  assert.equal(calls[0].url, '/login-id/set');
  assert.deepEqual(calls[0].body, { personalCode: CODE, loginId: 'New_Id' });
  assert.deepEqual(remembered(window), { code: CODE, loginId: 'new_id', changeableAt: 999 });
  assert.deepEqual(plain(events), [{ loginId: 'new_id' }]);
});

test('setLoginId errors: cooldown time, taken, format, other', async () => {
  const retryAt = new Date(2026, 9, 17, 9, 5).getTime();
  const cool = load({ fetch: () => reply(429, { error: 'login id cooldown', retryAt }) });
  await assert.rejects(cool.window.UserData.setLoginId('new_id'), err => err.message === '10월 17일 09:05 이후에 다시 바꿀 수 있어요.');
  const taken = load({ fetch: () => reply(409, { error: 'login id taken' }) });
  await assert.rejects(taken.window.UserData.setLoginId('new_id'), err => err.message === '이미 쓰이고 있는 아이디예요.');
  const bad = load({ fetch: () => reply(200, {}) });
  await assert.rejects(bad.window.UserData.setLoginId('x'), err => err.message === '영문 소문자, 숫자, _ 로 4~20자로 입력해 주세요.');
  assert.equal(bad.calls.length, 0);
  const bad400 = load({ fetch: () => reply(400, { error: 'invalid login id' }) });
  await assert.rejects(bad400.window.UserData.setLoginId('new_id'), err => err.message === '영문 소문자, 숫자, _ 로 4~20자로 입력해 주세요.');
  const down = load({ fetch: () => reply(503, {}) });
  await assert.rejects(down.window.UserData.setLoginId('new_id'), err => err.message === '서버와 통신하지 못했어요 (503)');
  // 다른 기기에서 먼저 바뀐 경우(409 login id changed)는 '이미 쓰이는 아이디'가 아니다
  const changed = load({ fetch: () => reply(409, { error: 'login id changed' }) });
  await assert.rejects(changed.window.UserData.setLoginId('new_id'), err => err.message === '다른 곳에서 아이디가 바뀌었어요. 다시 시도해 주세요.');
});

test('cooldown time is formatted through the translated template', async () => {
  const retryAt = new Date(2026, 9, 17, 9, 5).getTime();
  const dict = { '{month}월 {day}일 {hh}:{mm}': '{month}/{day} {hh}:{mm}', '{time} 이후에 다시 바꿀 수 있어요.': 'You can change it again after {time}.' };
  const cool = load({ dict, fetch: () => reply(429, { error: 'login id cooldown', retryAt }) });
  await assert.rejects(cool.window.UserData.setLoginId('new_id'), err => err.message === 'You can change it again after 10/17 09:05.');
});

test('logout, handleAccountDeleted and deleteAccount clear the remembered id', async () => {
  const seed = w => w.localStorage.setItem(ID_KEY, JSON.stringify({ code: CODE, loginId: 'kim_01', changeableAt: 0 }));
  const a = load({ fetch: () => reply(200, {}) });
  seed(a.window); a.window.BookmarkLibrary.logout();
  assert.equal(a.window.localStorage.getItem(ID_KEY), null);
  const b = load({ fetch: () => reply(200, {}) });
  seed(b.window); b.window.UserData.handleAccountDeleted();
  assert.equal(b.window.localStorage.getItem(ID_KEY), null);
  const c = load({ fetch: () => reply(200, { ok: true }) });
  seed(c.window); await c.window.UserData.deleteAccount();
  assert.equal(c.window.localStorage.getItem(ID_KEY), null);
});

test('isBeforeLoginCodeDeadline flips exactly at the deadline', () => {
  const deadline = Date.UTC(2026, 9, 31, 15, 0, 0);
  const before = load({ fetch: () => reply(200, {}), now: deadline - 1 });
  assert.equal(before.window.UserData.LOGIN_CODE_DEADLINE, deadline);
  assert.equal(before.window.UserData.isBeforeLoginCodeDeadline(), true);
  const at = load({ fetch: () => reply(200, {}), now: deadline });
  assert.equal(at.window.UserData.isBeforeLoginCodeDeadline(), false);
});

test('getLoginId({ fresh: true }) bypasses the remembered value and remembers the new answer', async () => {
  const { window, calls } = load({ fetch: () => reply(200, { loginId: 'kim_01', changeableAt: 777 }) });
  window.localStorage.setItem(ID_KEY, JSON.stringify({ code: CODE, loginId: 'kim_01', changeableAt: 0 }));
  assert.deepEqual(plain(await window.UserData.getLoginId()), { loginId: 'kim_01', changeableAt: 0 });
  assert.equal(calls.length, 0);
  assert.deepEqual(plain(await window.UserData.getLoginId({ fresh: true })), { loginId: 'kim_01', changeableAt: 777 });
  assert.equal(calls.length, 1);
  assert.equal(remembered(window).changeableAt, 777);
  assert.deepEqual(plain(await window.UserData.getLoginId()), { loginId: 'kim_01', changeableAt: 777 });
  assert.equal(calls.length, 1);
});

// ---- 화면(authModal.js · loginIdModal.js · auth.js) — 흉내 낸 DOM 위에서 ----
const NOTICE = '이제 로그인 코드는 폐지됩니다! 아이디를 변경하세요! 10월 31일 오후 11:59에 변경하지 않은 로그인 코드는 계정이 삭제됩니다!';

function fakeElement(tag) {
  const classes = () => String(el.className).split(/\s+/).filter(Boolean);
  const el = {
    tagName: tag.toUpperCase(), children: [], listeners: {}, attrs: {}, textContent: '', className: '', value: '', disabled: false, hidden: false, type: '',
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    get firstChild() { return this.children[0] || null; },
    insertBefore(node, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, node); return node; },
    setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, select() {},
    classList: {
      add(c) { if (!classes().includes(c)) el.className = classes().concat(c).join(' '); },
      remove(c) { el.className = classes().filter(x => x !== c).join(' '); },
      toggle(c, on) { if (on) this.add(c); else this.remove(c); },
      contains: c => classes().includes(c)
    },
    querySelector(sel) { const c = sel.slice(1); return findAll(this, n => n !== this && String(n.className).split(/\s+/).includes(c))[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, extra) { (this.listeners[type] || []).forEach(fn => fn(Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, extra))); }
  };
  Object.defineProperty(el, 'innerHTML', { set() { el.children = []; }, get() { return ''; } });
  return el;
}
const allText = el => (el.textContent || '') + '\n' + el.children.map(allText).join('\n');
const findAll = (el, pred) => [].concat(pred(el) ? [el] : [], ...el.children.map(c => findAll(c, pred)));
const buttons = (el, text) => findAll(el, n => n.tagName === 'BUTTON' && n.textContent === text);
const inputs = el => findAll(el, n => n.tagName === 'INPUT');
const forms = el => findAll(el, n => n.tagName === 'FORM');
const errorOf = el => findAll(el, n => String(n.className).includes('auth-error'))[0];
const tick = () => new Promise(r => setImmediate(r));
const flush = async () => { for (let i = 0; i < 5; i++) await tick(); };

function loadUi({ files = ['loginIdModal', 'authModal', 'auth'], loggedIn = true, before = true, userData = {}, dict } = {}) {
  const window = new EventTarget();
  window.window = window;
  window.I18n = { t: fakeT(dict) };
  window.sessionStorage = storage();
  const state = { loggedIn, before, confirms: [], getLoginIdCalls: [], calls: [] };
  window.confirm = msg => { state.confirms.push(msg); return true; };
  window.BookmarkLibrary = {
    isLoggedIn: () => state.loggedIn, getPersonalCode: () => CODE, formatPersonalCodeForDisplay: c => 'DISPLAY-' + c,
    normalizePersonalCode: s => String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    logout: () => { state.loggedIn = false; window.dispatchEvent(new Event('chokaguya:auth-change')); }
  };
  window.UserData = Object.assign({
    isBeforeLoginCodeDeadline: () => state.before,
    getStatus: () => 'synced',
    getLoginId: opts => { state.getLoginIdCalls.push(opts || null); return Promise.resolve({ loginId: null, changeableAt: 0 }); },
    loginWithId: id => { state.calls.push(['loginWithId', id]); return Promise.resolve(CODE); },
    signupWithId: id => { state.calls.push(['signupWithId', id]); return Promise.resolve(CODE); },
    setLoginId: id => { state.calls.push(['setLoginId', id]); return Promise.resolve({ loginId: id.toLowerCase(), changeableAt: 1 }); },
    login: code => { state.calls.push(['login', code]); return Promise.resolve(code); }
  }, userData);
  const body = fakeElement('body');
  const context = { window, document: { createElement: fakeElement, body, addEventListener() {} }, console, setTimeout, Date, fetch: () => Promise.reject(new Error('no')) };
  const names = { loginIdModal: 'src/js/components/loginIdModal.js', authModal: 'src/js/components/authModal.js', auth: 'src/js/components/auth.js' };
  for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(root, names[f]), 'utf8'), context);
  return { window, body, state };
}

test('sign-in screen: id field + 로그인, 새로 만들기 switches to a 가입 screen that calls signupWithId', async () => {
  const { window, body, state } = loadUi({ loggedIn: false });
  let done = null;
  window.AuthModal.openSignIn({ onSuccess: c => { done = c; } });
  const [input] = inputs(body);
  assert.equal(input.placeholder, '아이디 입력창');
  assert.equal(input.type, 'text');
  assert.ok(buttons(body, '로그인').length >= 1);
  input.value = 'Kim_01';
  forms(body)[0].fire('submit');
  await flush();
  assert.deepEqual(state.calls[0], ['loginWithId', 'Kim_01']);
  assert.equal(done, CODE);

  const again = loadUi({ loggedIn: false });
  again.window.AuthModal.openSignIn({});
  buttons(again.body, '새로 만들기')[0].fire('click');
  assert.equal(buttons(again.body, '가입').length, 1);
  assert.equal(allText(again.body).includes('잊어버리지 마세요!'), false);
  inputs(again.body)[0].value = 'new_id';
  forms(again.body)[0].fire('submit');
  await flush();
  assert.deepEqual(again.state.calls[0], ['signupWithId', 'new_id']);
});

test('sign-in shows the server error under the field', async () => {
  const { window, body } = loadUi({ loggedIn: false, userData: { loginWithId: () => Promise.reject(new Error('없는 아이디예요.')) } });
  window.AuthModal.openSignIn({});
  inputs(body)[0].value = 'nobody';
  forms(body)[0].fire('submit');
  await flush();
  assert.equal(errorOf(body).textContent, '없는 아이디예요.');
  assert.equal(errorOf(body).hidden, false);
});

test('legacy code login link exists only before the deadline', () => {
  const before = loadUi({ loggedIn: false, before: true });
  before.window.AuthModal.openSignIn({});
  assert.equal(buttons(before.body, '기존 로그인 코드로 로그인').length, 1);
  const after = loadUi({ loggedIn: false, before: false });
  after.window.AuthModal.openSignIn({});
  assert.equal(buttons(after.body, '기존 로그인 코드로 로그인').length, 0);
});

test('legacy code login success opens the create-id window', async () => {
  const { window, body, state } = loadUi({ files: ['authModal'], loggedIn: false });
  const opened = [];
  window.LoginIdModal = { open: o => { opened.push(o); } };
  let done = null;
  window.AuthModal.openSignIn({ onSuccess: c => { done = c; } });
  buttons(body, '기존 로그인 코드로 로그인')[0].fire('click');
  inputs(body)[0].value = 'abcd-efgh-jkmn-pqrs-tuvw';
  forms(body)[0].fire('submit');
  await flush();
  assert.equal(state.calls[0][0], 'login');
  assert.deepEqual(plain(opened), [{ mode: 'create' }]);
  assert.equal(done, CODE);
});

test('create window shows the verbatim notice; success shows the welcome line', async () => {
  const { window, body, state } = loadUi();
  await window.LoginIdModal.open({ mode: 'create' });
  const text = allText(body);
  assert.ok(text.includes('아이디를 만들어 주세요'));
  assert.ok(text.includes(NOTICE));
  inputs(body)[0].value = 'Kim_01';
  forms(body)[0].fire('submit');
  await flush();
  assert.deepEqual(state.calls[0], ['setLoginId', 'Kim_01']);
  assert.ok(allText(body).includes('이제 kim_01 아이디로 로그인할 수 있어요'));
});

test('create window falls back to change mode when the account already has an id', async () => {
  const { window, body } = loadUi({ userData: { getLoginId: () => Promise.resolve({ loginId: 'old_id', changeableAt: 0 }) } });
  await window.LoginIdModal.open({ mode: 'create' });
  assert.ok(allText(body).includes('아이디 변경'));
});

test('change window asks the server fresh and locks the form during the cooldown', async () => {
  const later = Date.now() + 3600 * 1000;
  const seen = [];
  const { window, body } = loadUi({ userData: { getLoginId: opts => { seen.push(opts || null); return Promise.resolve({ loginId: 'kim_01', changeableAt: later }); } } });
  await window.LoginIdModal.open({ mode: 'change' });
  assert.deepEqual(plain(seen[0]), { fresh: true });
  const text = allText(body);
  assert.ok(text.includes('아이디 변경'));
  assert.ok(text.includes('kim_01'));
  assert.ok(text.includes('이후에 다시 바꿀 수 있어요.'));
  assert.equal(inputs(body)[0].disabled, true);
  assert.equal(buttons(body, '변경')[0].disabled, true);
});

test('change window formats the cooldown time through the translated template', async () => {
  const later = new Date(2099, 0, 2, 3, 4).getTime();
  const dict = { '{month}월 {day}일 {hh}:{mm}': '{month}/{day} {hh}:{mm}', '{time} 이후에 다시 바꿀 수 있어요.': 'after {time}' };
  const { window, body } = loadUi({ dict, userData: { getLoginId: () => Promise.resolve({ loginId: 'kim_01', changeableAt: later }) } });
  await window.LoginIdModal.open({ mode: 'change' });
  const text = allText(body);
  assert.ok(text.includes('after 1/2 03:04'), text);
  assert.equal(/[월일]/.test(text.split('\n').filter(l => l.includes('after')).join('')), false);
});

test('maskLoginId keeps only the first two characters', () => {
  const { window } = loadUi();
  const mask = window.LoginIdModal.maskLoginId;
  assert.equal(mask('dandelion'), 'da•••');
  assert.equal(mask('abcd'), 'ab•••');
  assert.equal(mask(''), '');
  assert.equal(mask(null), '');
});

test('change window is open for a change when the cooldown is over, and shows set errors', async () => {
  const { window, body } = loadUi({
    userData: { getLoginId: () => Promise.resolve({ loginId: 'kim_01', changeableAt: 0 }), setLoginId: () => Promise.reject(new Error('이미 쓰이고 있는 아이디예요.')) }
  });
  await window.LoginIdModal.open({ mode: 'change' });
  assert.equal(inputs(body)[0].disabled, false);
  inputs(body)[0].value = 'taken_id';
  forms(body)[0].fire('submit');
  await flush();
  assert.equal(errorOf(body).textContent, '이미 쓰이고 있는 아이디예요.');
  assert.equal(buttons(body, '변경')[0].disabled, false);
});

test('maybeAutoOpen opens once per session, only for code-only accounts before the deadline', async () => {
  const a = loadUi();
  assert.equal(await a.window.LoginIdModal.maybeAutoOpen(), true);
  assert.ok(allText(a.body).includes('아이디를 만들어 주세요'));
  assert.equal(a.window.sessionStorage.getItem('chokaguya_login_id_prompted'), '1');
  assert.equal(await a.window.LoginIdModal.maybeAutoOpen(), false);
  const hasId = loadUi({ userData: { getLoginId: () => Promise.resolve({ loginId: 'kim_01', changeableAt: 0 }) } });
  assert.equal(await hasId.window.LoginIdModal.maybeAutoOpen(), false);
  const late = loadUi({ before: false });
  assert.equal(await late.window.LoginIdModal.maybeAutoOpen(), false);
  const out = loadUi({ loggedIn: false });
  assert.equal(await out.window.LoginIdModal.maybeAutoOpen(), false);
});

test('notices ask the server once, show only for code-only accounts before the deadline, and redraw on events', async () => {
  const { window, state } = loadUi();
  const nodes = [fakeElement('div'), fakeElement('div'), fakeElement('div')].map(h => window.LoginIdModal.mountNotice(h));
  await flush();
  assert.equal(state.getLoginIdCalls.length, 1);
  for (const n of nodes) {
    assert.equal(n.hidden, false);
    assert.ok(allText(n).includes(NOTICE));
    assert.equal(buttons(n, '아이디 만들기').length, 1);
  }
  window.dispatchEvent(new Event('chokaguya:auth-change'));
  window.LoginIdModal.mountNotice(fakeElement('div'));
  await flush();
  assert.equal(state.getLoginIdCalls.length, 2);

  const hasId = loadUi({ userData: { getLoginId: () => Promise.resolve({ loginId: 'kim_01', changeableAt: 0 }) } });
  const n1 = hasId.window.LoginIdModal.mountNotice(fakeElement('div'));
  const late = loadUi({ before: false });
  const n2 = late.window.LoginIdModal.mountNotice(fakeElement('div'));
  const out = loadUi({ loggedIn: false });
  const n3 = out.window.LoginIdModal.mountNotice(fakeElement('div'));
  await flush();
  assert.equal(n1.hidden, true);
  assert.equal(n2.hidden, true);
  assert.equal(n3.hidden, true);
});

test('notice button opens the create window; notice hides after the id is set', async () => {
  const { window } = loadUi();
  const opened = [];
  window.LoginIdModal.open = o => { opened.push(o); return Promise.resolve(); };
  const node = window.LoginIdModal.mountNotice(fakeElement('div'));
  await flush();
  buttons(node, '아이디 만들기')[0].fire('click');
  assert.deepEqual(plain(opened), [{ mode: 'create' }]);
  window.UserData.getLoginId = () => Promise.resolve({ loginId: 'kim_01', changeableAt: 0 });
  window.dispatchEvent(new CustomEvent('chokaguya:login-id-change', { detail: { loginId: 'kim_01' } }));
  await flush();
  assert.equal(node.hidden, true);
});

test('account tab: id with 변경 button and no personal code', async () => {
  const { window } = loadUi({ userData: { getLoginId: () => Promise.resolve({ loginId: 'kim_01', changeableAt: 0 }) } });
  const container = fakeElement('div');
  window.AuthUI.renderAccountSettings(container);
  await flush();
  const text = allText(container);
  assert.ok(text.includes('아이디'));
  assert.ok(text.includes('kim_01'));
  assert.equal(buttons(container, '변경').length, 1);
  assert.equal(text.includes('개인 코드'), false);
  assert.equal(text.includes('DISPLAY-'), false);
  assert.equal(inputs(container).some(i => String(i.value).includes(CODE)), false);
  const opened = [];
  window.LoginIdModal.open = o => { opened.push(o); return Promise.resolve(); };
  buttons(container, '변경')[0].fire('click');
  assert.deepEqual(plain(opened), [{ mode: 'change' }]);
});

test('account tab: code-only account shows the notice and 아이디 만들기', async () => {
  const { window } = loadUi();
  const container = fakeElement('div');
  window.AuthUI.renderAccountSettings(container);
  await flush();
  assert.ok(allText(container).includes(NOTICE));
  assert.equal(buttons(container, '아이디 만들기').length, 1);
  assert.equal(allText(container).includes('DISPLAY-'), false);
});

test('logout asks with the id-based sentence', () => {
  const { window, state } = loadUi();
  window.AuthUI.confirmAndLogout();
  assert.equal(state.confirms[0], '로그아웃할까요? 다시 로그인하려면 아이디를 알고 있어야 해요.');
  assert.equal(state.loggedIn, false);
});

test('header menu and profile tab wire the notice; header subtitle uses the id', () => {
  const header = fs.readFileSync(path.join(root, 'src/js/components/siteHeader.js'), 'utf8');
  assert.ok(header.includes('LoginIdModal.mountNotice'));
  assert.ok(header.includes("t('아이디 없음')"));
  assert.ok(header.includes('chokaguya:login-id-change'));
  // 아이디가 곧 열쇠라 메뉴 부제에는 가린 아이디만 보인다(전체 아이디는 계정 탭에만)
  assert.ok(header.includes('maskLoginId(status.loginId)'));
  assert.equal(header.includes('status.loginId || '), false);
  assert.equal(header.includes('maskedCode()'), false);
  const settings = fs.readFileSync(path.join(root, 'src/js/components/settingsModal.js'), 'utf8');
  assert.ok(settings.includes('LoginIdModal.mountNotice'));
});

test('every page that loads authModal.js also loads loginIdModal.js after it', () => {
  const dir = path.join(root, 'src/page');
  const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html')).filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('authModal.js'));
  assert.equal(pages.length, 10);
  for (const f of pages) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(html.indexOf('components/loginIdModal.js') > html.indexOf('components/authModal.js'), f);
  }
});

test('login id UI strings have English and Japanese translations', () => {
  const keys = [
    '영문 소문자, 숫자, _ 로 4~20자로 입력해 주세요.', '이미 쓰이고 있는 아이디예요.', '없는 아이디예요.', '{time} 이후에 다시 바꿀 수 있어요.',
    NOTICE, '아이디 입력창', '계정이 없으신가요?', '새로 만들기', '기존 로그인 코드로 로그인', '가입', '이미 계정이 있으신가요?', '아이디로 로그인',
    '영문 소문자, 숫자, _ 로 4~20자', '아이디를 만들어 주세요', '아이디 만들기', '아이디 변경', '현재 아이디: {id}', '변경',
    '이제 {id} 아이디로 로그인할 수 있어요', '아이디', '아이디 없음', '아이디 보기', '로그아웃할까요? 다시 로그인하려면 아이디를 알고 있어야 해요.',
    '{month}월 {day}일 {hh}:{mm}', '다른 곳에서 아이디가 바뀌었어요. 다시 시도해 주세요.'
  ];
  for (const lang of ['English', 'Japanese']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'src/data/i18n', lang + '.json'), 'utf8'));
    for (const key of keys) assert.ok(dict[key], `${lang}: ${key}`);
  }
});
