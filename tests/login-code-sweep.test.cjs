// 마감 뒤 자동 정리(worker/loginCodeSweep.js) 검증(Task 3).
// 아이디 없는 코드만 계정만 지우고, 아이디 계정·익명 서재·관리자 계정 본체는 남긴다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, hash } = require('./helpers/workerHarness.cjs');
const { setupDisplay, withClock, code } = require('./helpers/profileSetup.cjs');

const ADMIN_CODE = 'admin_personal_code_0001';
const userKey = c => 'user/' + hash('user-v2:' + c) + '.json';
const ownersKey = c => 'owners/' + hash('owner-index:' + c) + '.json';
const rows = (t, sql, ...args) => t.env.TAGS_DB.rows(sql, ...args);

// 묶음 크기보다 조금 많은 채움 계정 수(묶음 하나로 끝나지 않게).
const fillerCount = sweep => sweep.SWEEP_BATCH + 5;
const fillerCode = i => 'filler_code_' + String(i).padStart(6, '0');

const loadSweep = async () => ({
  sweep: await load('worker/loginCodeSweep.js'),
  config: await load('worker/loginIdConfig.js')
});

// 계정 하나(가입 + 프로필 + 소유 서재 둘). loginId 가 있으면 아이디 계정.
// early 서재는 프로필을 만들기 전에 게시해 profileId 가 없다(주인 짐작 없이 전체 대조로만 판정).
// direct: 가입 API(IP 하루 가입 한도가 있다) 대신 계정 본체를 바로 넣는다(코드만 계정 대량 생성용).
async function makeAccount(t, c, loginId, direct) {
  if (direct) {
    await t.account(c);
  } else {
    const signup = await t.send('POST', '/user/signup', loginId ? { personalCode: c, loginId } : { personalCode: c });
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
  }
  const early = await t.send('POST', '/library', { personalCode: c, name: '먼저 ' + c.slice(-4), items: [{ type: 'novel', id: 789 }] });
  assert.equal(early.status, 201, JSON.stringify(early.body));
  const earlyRecord = JSON.parse(t.env.FAVORITES_BUCKET.objects.get('library/' + early.body.code + '.json').text);
  assert.equal(earlyRecord.profileId, null);
  assert.ok(earlyRecord.ownerHash);
  const profileId = await t.makeProfile(c);
  const lib = await t.send('POST', '/library', { personalCode: c, name: '서재 ' + c.slice(-4), items: [{ type: 'novel', id: 123 }] });
  assert.equal(lib.status, 201, JSON.stringify(lib.body));
  t.tick();
  return { code: c, profileId, library: lib.body.code, earlyLibrary: early.body.code };
}

// 계정 K(아이디), D(코드만), 익명 서재, 관리자 A(코드만).
async function setupWorld(dCode) {
  const t = await setupDisplay();
  t.env.ADMIN_USER_HASHES = hash('user-v2:' + ADMIN_CODE);
  const K = await makeAccount(t, code(1), 'keep_user');
  const D = await makeAccount(t, dCode || code(2));
  assert.equal((await t.vote(D.code, 123, '일상')).status, 200);
  const anon = await t.send('POST', '/library', { name: '익명 서재', items: [{ type: 'novel', id: 456 }] });
  assert.equal(anon.status, 201, JSON.stringify(anon.body));
  const sig = await t.send('POST', '/user/signup', { personalCode: ADMIN_CODE });
  assert.equal(sig.status, 201, JSON.stringify(sig.body));
  return { t, K, D, anonLibrary: anon.body.code };
}

const snapshot = t => ({
  objects: [...t.env.FAVORITES_BUCKET.objects.keys()].sort(),
  profiles: rows(t, 'SELECT profile_id FROM profiles ORDER BY profile_id').map(r => r.profile_id),
  links: rows(t, 'SELECT profile_id FROM profile_links ORDER BY profile_id').map(r => r.profile_id)
});

async function runUntilDone(sweep, env, now) {
  for (let i = 0; i < 100; i++) {
    const res = await sweep.runLoginCodeSweep(env, now);
    assert.equal(res.ran, true, JSON.stringify(res));
    if (res.done) return i + 1;
  }
  throw new Error('sweep did not finish');
}

test('does nothing before the deadline', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  const before = snapshot(t);
  const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE - 1);
  assert.equal(res.ran, false);
  assert.deepEqual(snapshot(t), before);
  assert.equal(rows(t, 'SELECT * FROM maintenance_jobs').length, 0);
}));

test('does nothing without ACCOUNT_SWEEP_ENABLED', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  const before = snapshot(t);
  assert.equal((await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE + 60000)).ran, false);
  // '1' 이 아닌 값도 꺼진 것으로 본다
  t.env.ACCOUNT_SWEEP_ENABLED = 'true';
  assert.equal((await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE + 60000)).ran, false);
  assert.deepEqual(snapshot(t), before);
  assert.equal(rows(t, 'SELECT * FROM maintenance_jobs').length, 0);
}));

test('deletes only code-only accounts', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t, K, D, anonLibrary } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  await runUntilDone(sweep, t.env, config.LOGIN_CODE_DEADLINE);

  const objects = t.env.FAVORITES_BUCKET.objects;
  // K: 전부 남음
  assert.ok(objects.has(userKey(K.code)));
  assert.ok(objects.has(ownersKey(K.code)));
  assert.ok(objects.has('library/' + K.library + '.json'));
  assert.ok(objects.has('library/' + K.earlyLibrary + '.json'), 'library without profileId kept by full comparison');
  assert.equal(rows(t, 'SELECT * FROM profiles WHERE profile_id = ?', K.profileId).length, 1);
  assert.equal(rows(t, 'SELECT * FROM profile_links WHERE profile_id = ?', K.profileId).length, 1);
  // D: 전부 지워짐
  assert.ok(!objects.has(userKey(D.code)));
  assert.ok(!objects.has(ownersKey(D.code)));
  assert.ok(!objects.has('library/' + D.library + '.json'));
  assert.ok(!objects.has('library/' + D.earlyLibrary + '.json'));
  assert.equal(rows(t, 'SELECT * FROM profiles WHERE profile_id = ?', D.profileId).length, 0);
  assert.equal(rows(t, 'SELECT * FROM profile_links WHERE profile_id = ?', D.profileId).length, 0);
  // D 의 태그 투표는 익명으로 남는다
  assert.equal(rows(t, 'SELECT * FROM tag_votes').length, 1);
  assert.deepEqual((await t.voters(123, '일상')).body, { profileIds: [], anonymous: 1 });
  // 익명 서재, 관리자 계정 본체는 남음
  assert.ok(objects.has('library/' + anonLibrary + '.json'));
  assert.ok(objects.has(userKey(ADMIN_CODE)));
  // 아이디는 그대로
  assert.equal(rows(t, 'SELECT * FROM login_ids').length, 1);

  const actions = rows(t, "SELECT * FROM admin_actions WHERE action = 'account.sweep' ORDER BY id");
  assert.deepEqual(actions.map(a => JSON.parse(a.detail).phase), ['users', 'owners', 'libraries', 'profiles']);
  assert.ok(actions.every(a => a.actor === 'system'));
  const deleted = Object.fromEntries(actions.map(a => [JSON.parse(a.detail).phase, JSON.parse(a.detail).deleted]));
  assert.deepEqual(deleted, { users: 1, owners: 1, libraries: 2, profiles: 1 });
  assert.equal(rows(t, "SELECT done FROM maintenance_jobs WHERE job = 'login-code-sweep'")[0].done, 1);
}));

test('resumes across ticks', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t, K } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  const fillers = Array.from({ length: fillerCount(sweep) }, (_, i) => fillerCode(i));
  for (const c of fillers) await t.account(c);

  const first = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE);
  assert.equal(first.ran, true);
  assert.equal(first.phase, 'users');
  assert.equal(first.done, false);
  const objects = t.env.FAVORITES_BUCKET.objects;
  const left = fillers.filter(c => objects.has(userKey(c))).length;
  assert.ok(left > 0 && left < fillers.length, 'first tick handles one batch only: ' + left);
  const state = JSON.parse(rows(t, 'SELECT state FROM maintenance_jobs')[0].state);
  assert.equal(state.phase, 'users');
  assert.ok(state.cursor, 'cursor saved');

  await runUntilDone(sweep, t.env, config.LOGIN_CODE_DEADLINE);
  assert.equal(fillers.filter(c => objects.has(userKey(c))).length, 0);
  assert.ok(objects.has(userKey(K.code)));
  assert.ok(objects.has(userKey(ADMIN_CODE)));
  const users = rows(t, "SELECT detail FROM admin_actions WHERE action = 'account.sweep'")
    .map(a => JSON.parse(a.detail)).find(d => d.phase === 'users');
  assert.equal(users.deleted, fillers.length + 1); // 채움 + D
}));

test('does not run again after done', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  await runUntilDone(sweep, t.env, config.LOGIN_CODE_DEADLINE);
  await t.account(code(9));
  const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE + 120000);
  assert.equal(res.ran, false);
  assert.ok(t.env.FAVORITES_BUCKET.objects.has(userKey(code(9))));
  assert.equal(rows(t, "SELECT * FROM admin_actions WHERE action = 'account.sweep'").length, 4);
}));

test('skips the tick when login_ids cannot be read', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  t.env.TAGS_DB.db.exec('DROP TABLE login_ids');
  const before = snapshot(t);
  const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE);
  assert.equal(res.ran, false);
  assert.deepEqual(snapshot(t), before);
  assert.equal(rows(t, "SELECT * FROM admin_actions WHERE action = 'account.sweep'").length, 0);
}));

test('skips the tick when login_ids is empty', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  t.env.TAGS_DB.db.exec('DELETE FROM login_ids');
  const before = snapshot(t);
  const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE);
  assert.equal(res.ran, false);
  assert.deepEqual(snapshot(t), before);
}));

test('does not delete an account converted during the sweep', withClock(async () => {
  const { sweep, config } = await loadSweep();
  // D 의 계정 본체 키가 정렬상 맨 뒤쪽에 오도록(첫 묶음에 들지 않도록) 코드를 고른다
  let n = 0;
  while (!hash('user-v2:' + code(100000 + n)).startsWith('fff')) n++;
  const { t, D } = await setupWorld(code(100000 + n));
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  for (let i = 0; i < fillerCount(sweep); i++) await t.account(fillerCode(i));

  const first = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE);
  assert.equal(first.phase, 'users');
  assert.equal(first.done, false);
  const objects = t.env.FAVORITES_BUCKET.objects;
  assert.ok(objects.has(userKey(D.code)), 'precondition: D not reached in the first batch');

  // 마감 직전에 아이디를 만든 것처럼 D 를 전환한다
  const api = await load('worker/loginIdApi.js');
  assert.equal(await api.insertLoginId(t.env, 'late_user', D.code, Date.now()), 'ok');

  await runUntilDone(sweep, t.env, config.LOGIN_CODE_DEADLINE + 60000);
  assert.ok(objects.has(userKey(D.code)));
  assert.ok(objects.has(ownersKey(D.code)));
  assert.ok(objects.has('library/' + D.library + '.json'));
  assert.ok(objects.has('library/' + D.earlyLibrary + '.json'));
  assert.equal(rows(t, 'SELECT * FROM profiles WHERE profile_id = ?', D.profileId).length, 1);
  assert.equal(rows(t, 'SELECT * FROM profile_links WHERE profile_id = ?', D.profileId).length, 1);
}));

// 틱이 남길 목록(login_ids)을 읽은 바로 뒤, 삭제 전에 D 가 아이디를 만든다.
// 각 단계에서 삭제 직전 확인이 이를 잡아 D 의 그 단계 데이터를 남겨야 한다.
for (const target of ['users', 'owners', 'libraries', 'profiles']) {
  test('does not delete an account converted mid-tick (' + target + ')', withClock(async () => {
    const { sweep, config } = await loadSweep();
    const api = await load('worker/loginIdApi.js');
    const { t, D } = await setupWorld();
    t.env.ACCOUNT_SWEEP_ENABLED = '1';
    const phaseNow = () => {
      const row = rows(t, 'SELECT state FROM maintenance_jobs')[0];
      return row ? JSON.parse(row.state).phase : 'users';
    };
    while (phaseNow() !== target) {
      assert.equal((await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE)).ran, true);
    }

    const db = t.env.TAGS_DB;
    const realPrepare = db.prepare.bind(db);
    let armed = true;
    db.prepare = sql => {
      const statement = realPrepare(sql);
      if (armed && /^SELECT personal_code, owner_hash, updated_at FROM login_ids/.test(sql)) {
        const realAll = statement.all.bind(statement);
        statement.all = async () => {
          const result = await realAll();
          armed = false;
          assert.equal(await api.insertLoginId(t.env, 'mid_tick', D.code, Date.now()), 'ok');
          return result;
        };
      }
      return statement;
    };
    const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE);
    db.prepare = realPrepare;
    assert.equal(armed, false, 'hook fired');
    assert.equal(res.phase, target);

    const objects = t.env.FAVORITES_BUCKET.objects;
    if (target === 'users') assert.ok(objects.has(userKey(D.code)));
    if (target === 'owners') assert.ok(objects.has(ownersKey(D.code)));
    if (target === 'libraries') {
      assert.ok(objects.has('library/' + D.library + '.json'));
      assert.ok(objects.has('library/' + D.earlyLibrary + '.json'));
    }
    if (target === 'profiles') {
      assert.equal(rows(t, 'SELECT * FROM profiles WHERE profile_id = ?', D.profileId).length, 1);
      assert.equal(rows(t, 'SELECT * FROM profile_links WHERE profile_id = ?', D.profileId).length, 1);
    }
  }));
}

test('empty personal codes count as an empty keep list', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  t.env.TAGS_DB.db.exec("UPDATE login_ids SET personal_code = ''");
  const before = snapshot(t);
  assert.equal((await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE)).ran, false);
  assert.deepEqual(snapshot(t), before);
}));

test('an overlapping tick that loses the state race writes no audit row', withClock(async () => {
  const { sweep, config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  const db = t.env.TAGS_DB;
  // 첫 틱이 상태를 읽은 직후, 겹친 다른 틱이 먼저 상태를 바꾼 것처럼 만든다
  const realPrepare = db.prepare.bind(db);
  let armed = true;
  db.prepare = sql => {
    const statement = realPrepare(sql);
    if (armed && /^SELECT personal_code, owner_hash, updated_at FROM login_ids/.test(sql)) {
      armed = false;
      db.db.exec(`INSERT INTO maintenance_jobs (job, state, done, updated_at) VALUES ('login-code-sweep', '{"phase":"owners","cursor":null,"counts":{}}', 0, 1)`);
    }
    return statement;
  };
  const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE);
  db.prepare = realPrepare;
  assert.equal(res.ran, true);
  assert.equal(res.done, false);
  assert.equal(rows(t, "SELECT * FROM admin_actions WHERE action = 'account.sweep'").length, 0);
  assert.equal(JSON.parse(rows(t, 'SELECT state FROM maintenance_jobs')[0].state).phase, 'owners');
}));

// ---- 최종 리뷰 I-1: 틱 예산(D1 쿼리·SHA-256 횟수), 서재 색인 한 번 갱신, scheduled 배선 ----
const { webcrypto } = require('node:crypto');
const { clock } = require('./helpers/workerHarness.cjs');
const QUERY_BUDGET = 30;
const DIGEST_BUDGET = 800;
const INDEX_KEY = 'indexes/library-v1.json';

// 정리 모듈이 쓰는 crypto.subtle.digest 호출 수를 센다.
function countingCrypto(counter) {
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, prop) {
      if (prop === 'digest') return (...args) => { counter.digests++; return target.digest(...args); };
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return { subtle, getRandomValues: a => webcrypto.getRandomValues(a), randomUUID: () => webcrypto.randomUUID() };
}

// D1 쿼리 수를 센다(first/run/all 한 번 = 1, batch 는 문장 수만큼). 이 D1 인스턴스의 문장에만 건다.
function countQueries(db, counter) {
  const realPrepare = db.prepare.bind(db);
  const wrap = statement => {
    const realBind = statement.bind.bind(statement);
    statement.bind = (...args) => wrap(realBind(...args));
    for (const name of ['first', 'run', 'all']) {
      const real = statement[name].bind(statement);
      statement[name] = (...args) => { counter.queries++; return real(...args); };
    }
    return statement;
  };
  db.prepare = sql => wrap(realPrepare(sql));
  const realBatch = db.batch.bind(db);
  db.batch = statements => { counter.queries += statements.length; return realBatch(statements); };
}

test('a tick stays within the query and digest budget, never skips a key, and still finishes', withClock(async () => {
  const counter = { queries: 0, digests: 0 };
  const sweep = await load('worker/loginCodeSweep.js', { crypto: countingCrypto(counter) });
  const config = await load('worker/loginIdConfig.js');
  assert.equal(sweep.SWEEP_QUERY_BUDGET, QUERY_BUDGET);
  assert.equal(sweep.SWEEP_DIGEST_BUDGET, DIGEST_BUDGET);
  const { t, K, D, anonLibrary } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  // 코드만 계정을 묶음보다 많이 만든다(각각 프로필 + 서재 둘).
  const orphans = [D];
  for (let i = 0; i < 30; i++) orphans.push(await makeAccount(t, code(500 + i), null, true));
  // 남길 코드를 늘려 서재 하나의 전체 대조가 해시를 많이 쓰게 한다(계정 없이 아이디 행만).
  const insert = t.env.TAGS_DB.db.prepare('INSERT INTO login_ids (id_key, personal_code, owner_hash, changed_at, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)');
  for (let i = 0; i < 150; i++) {
    const c = 'kept_code_' + String(i).padStart(6, '0');
    insert.run('kept_' + i, c, hash('profile:' + c));
  }
  // 공개 서재 색인을 만들어 둔다(정리가 지운 서재를 색인에서도 빼는지 본다).
  await (await load('worker/libraryIndex.js')).refreshLibraryIndex(t.env);
  assert.ok(t.env.FAVORITES_BUCKET.objects.has(INDEX_KEY));

  countQueries(t.env.TAGS_DB, counter);
  const bucket = t.env.FAVORITES_BUCKET;
  const realPut = bucket.put.bind(bucket);
  let indexPuts = 0;
  bucket.put = (key, ...rest) => { if (key === INDEX_KEY) indexPuts++; return realPut(key, ...rest); };

  const orphanLibraryKeys = orphans.flatMap(o => ['library/' + o.library + '.json', 'library/' + o.earlyLibrary + '.json']);
  const orphanProfiles = orphans.map(o => o.profileId);
  const orphanUserKeys = orphans.map(o => userKey(o.code));
  const stoppedEarly = new Set();
  let ticks = 0;
  for (;;) {
    assert.ok(++ticks < 200, 'sweep did not finish');
    counter.queries = 0; counter.digests = 0; indexPuts = 0;
    const res = await sweep.runLoginCodeSweep(t.env, config.LOGIN_CODE_DEADLINE + 60000);
    assert.equal(res.ran, true, JSON.stringify(res));
    assert.ok(counter.queries <= QUERY_BUDGET, 'queries ' + counter.queries + ' in ' + res.phase);
    assert.ok(counter.digests <= DIGEST_BUDGET, 'digests ' + counter.digests + ' in ' + res.phase);
    assert.ok(indexPuts <= 1, 'index written ' + indexPuts + ' times in one tick');
    if (res.done) break;
    const state = JSON.parse(rows(t, 'SELECT state FROM maintenance_jobs')[0].state);
    // 커서 이하(이미 처리했다고 저장한 범위)의 지울 대상은 모두 지워져 있어야 한다.
    if (state.cursor && state.phase === 'users') {
      for (const k of orphanUserKeys) if (k <= state.cursor) assert.ok(!bucket.objects.has(k), 'skipped ' + k);
    }
    if (state.cursor && state.phase === 'libraries') {
      stoppedEarly.add('libraries');
      for (const k of orphanLibraryKeys) if (k <= state.cursor) assert.ok(!bucket.objects.has(k), 'skipped ' + k);
    }
    if (state.cursor && state.phase === 'profiles') {
      stoppedEarly.add('profiles');
      for (const id of orphanProfiles) if (id <= state.cursor) assert.equal(rows(t, 'SELECT 1 FROM profiles WHERE profile_id = ?', id).length, 0, 'skipped ' + id);
    }
  }
  // 두 단계 모두 묶음 하나로 끝나지 않고 여러 틱에 나눠 진행됐다
  assert.ok(stoppedEarly.has('libraries') && stoppedEarly.has('profiles'), [...stoppedEarly].join(','));

  for (const k of orphanLibraryKeys) assert.ok(!bucket.objects.has(k), k);
  for (const k of orphanUserKeys) assert.ok(!bucket.objects.has(k), k);
  for (const id of orphanProfiles) assert.equal(rows(t, 'SELECT 1 FROM profiles WHERE profile_id = ?', id).length, 0, id);
  assert.ok(bucket.objects.has(userKey(K.code)));
  assert.ok(bucket.objects.has('library/' + K.library + '.json'));
  assert.ok(bucket.objects.has('library/' + K.earlyLibrary + '.json'));
  assert.ok(bucket.objects.has('library/' + anonLibrary + '.json'));
  assert.equal(rows(t, 'SELECT 1 FROM profiles WHERE profile_id = ?', K.profileId).length, 1);
  // 공개 색인에서도 지운 서재만 빠졌다
  const indexed = JSON.parse(bucket.objects.get(INDEX_KEY).text).items.map(row => row.code).sort();
  assert.deepEqual(indexed, [K.library, K.earlyLibrary, anonLibrary].sort());
  const deleted = Object.fromEntries(rows(t, "SELECT detail FROM admin_actions WHERE action = 'account.sweep'")
    .map(a => [JSON.parse(a.detail).phase, JSON.parse(a.detail).deleted]));
  assert.deepEqual(deleted, { users: orphans.length, owners: orphans.length, libraries: orphans.length * 2, profiles: orphans.length });
}));

test('library sweep removes hidden rows and the public index entries of deleted libraries', withClock(async () => {
  const sweep = await load('worker/loginCodeSweep.js');
  const config = await load('worker/loginIdConfig.js');
  const { t, K, D } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  await (await load('worker/libraryIndex.js')).refreshLibraryIndex(t.env);
  for (const c of [D.library, D.earlyLibrary, K.library]) {
    t.env.TAGS_DB.db.prepare('INSERT INTO library_hidden (code, name, hidden_at) VALUES (?, ?, 1)').run(c, 'x');
  }
  await runUntilDone(sweep, t.env, config.LOGIN_CODE_DEADLINE + 60000);
  assert.deepEqual(rows(t, 'SELECT code FROM library_hidden').map(r => r.code), [K.library]);
  const indexed = JSON.parse(t.env.FAVORITES_BUCKET.objects.get(INDEX_KEY).text).items.map(row => row.code);
  assert.ok(!indexed.includes(D.library) && !indexed.includes(D.earlyLibrary));
  assert.ok(indexed.includes(K.library));
}));

// _worker.js scheduled: 5의 배수 분에는 정리를 건너뛰고, 정리가 실패해도 다른 작업을 막지 않는다.
async function runScheduled(env, scheduledTime) {
  const worker = (await load('src/_worker.js')).default;
  const pending = [];
  await worker.scheduled({ scheduledTime }, env, { waitUntil: p => pending.push(p) });
  return Promise.allSettled(pending);
}

test('scheduled skips the sweep on every fifth minute and isolates its failure', withClock(async () => {
  const { config } = await loadSweep();
  const { t } = await setupWorld();
  t.env.ACCOUNT_SWEEP_ENABLED = '1';
  const db = t.env.TAGS_DB;
  const realPrepare = db.prepare.bind(db);
  let sweepQueries = 0;
  let failSweep = false;
  db.prepare = sql => {
    if (/maintenance_jobs/.test(sql)) {
      sweepQueries++;
      if (failSweep) throw new Error('boom');
    }
    return realPrepare(sql);
  };
  const minute = 60000;
  const base = config.LOGIN_CODE_DEADLINE; // 15:00 UTC → 5의 배수 분
  clock.now = base + 5 * minute;
  await runScheduled(t.env, base + 5 * minute);
  assert.equal(sweepQueries, 0, 'no sweep on a multiple-of-5 minute');
  clock.now = base + 6 * minute;
  await runScheduled(t.env, base + 6 * minute);
  assert.ok(sweepQueries > 0, 'sweep runs on other minutes');
  failSweep = true;
  clock.now = base + 7 * minute;
  const settled = await runScheduled(t.env, base + 7 * minute);
  assert.ok(settled.length >= 3);
  assert.ok(settled.every(s => s.status === 'fulfilled'), JSON.stringify(settled.map(s => s.status)));
  db.prepare = realPrepare;
}));

// ---- 최종 리뷰 M-2: ACCOUNT_SWEEP_ENABLED 는 프로덕션 [vars] 에만 ----
// 섹션별로 'ACCOUNT_SWEEP_ENABLED = ...' 줄을 모은다.
function sweepFlagSections(toml) {
  let section = '';
  const found = [];
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (header) { section = header[1]; continue; }
    const m = /^\s*ACCOUNT_SWEEP_ENABLED\s*=\s*(.+?)\s*(#.*)?$/.exec(line);
    if (m) found.push({ section, value: m[1] });
  }
  return found;
}

test('ACCOUNT_SWEEP_ENABLED = "1" is only in the top-level [vars], never in [env.dev.vars]', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const toml = fs.readFileSync(path.join(__dirname, '..', 'src', 'wrangler.toml'), 'utf8');
  assert.deepEqual(sweepFlagSections(toml), [{ section: 'vars', value: '"1"' }]);
  // 파서 자체 확인: dev 쪽에 들어가면 잡아낸다
  const broken = toml.replace(/^\[env\.dev\.vars\]/m,'[env.dev.vars]\nACCOUNT_SWEEP_ENABLED = "1"');
  assert.deepEqual(sweepFlagSections(broken).map(f => f.section), ['vars', 'env.dev.vars']);
});
