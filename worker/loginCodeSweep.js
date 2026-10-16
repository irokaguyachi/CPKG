// 마감 뒤 자동 정리. 로그인 코드 마감(LOGIN_CODE_DEADLINE) 뒤에 아이디가 없는
// 코드만 계정을 지운다. 설계: docs/superpowers/specs/2026-10-16-login-id-design.md
//
// - _worker.js scheduled 가 매분 부른다(D1 을 많이 쓰는 다른 작업이 도는 5의 배수 분은 빼고).
//   한 틱에 단계 하나를 최대 SWEEP_BATCH(25) 개만, 그리고 틱 예산(D1 쿼리·SHA-256 횟수) 안에서만
//   처리하고, 진행 상태({ phase, cursor, counts })를 D1 maintenance_jobs 에 남겨 다음 틱이
//   이어서 한다. 예산이 차면 그 자리에서 멈추고 끝까지 처리한 마지막 키를 커서로 남긴다 —
//   처리하지 못한 키를 건너뛰는 일은 없다. 마지막 단계가 끝나면 done = 1 이고 다시 돌지 않는다.
// - 실제로 지우는 조건은 셋 다 맞을 때뿐이다: 마감이 지났고, env.ACCOUNT_SWEEP_ENABLED
//   가 정확히 '1' 이고(프로덕션 [vars] 에만 있다 — dev 는 같은 D1·R2 를 쓴다),
//   이번 틱에 login_ids 를 읽는 데 성공했다(비어 있으면 이상 상태로 보고 쉰다).
// - 남길 계정 목록(login_ids)은 매 틱, 묶음을 나열한 뒤에 읽고, 삭제 직전마다 바뀌었는지
//   다시 확인한다(행 수·마지막 갱신 시각). 바뀌었으면 다시 읽어 판정을 새로 한다 —
//   정리 도중 아이디를 만든 계정은 같은 틱 안에서도 지우지 않는다.
// - 단계: users → owners → libraries → profiles. 모든 삭제는 멱등이라 틱이 중간에
//   실패해도 같은 위치부터 다시 하면 된다.
// - 태그 투표·끌올은 계정 삭제 때와 같이 익명으로 남는다(프로필 연결 행만 지운다).
import { LOGIN_CODE_DEADLINE } from './loginIdConfig.js';
import { userStoreKey, ownerIndexKey, ownerHashFor, profileOwnerHash } from './accountKeys.js';
import { deleteProfileRows } from './accountDelete.js';
import { removeFromLibraryIndex } from './libraryIndex.js';
import { logAction } from './adminCommon.js';

// 한 틱에 나열하는 묶음 크기. 무료 플랜 한도는 Worker 호출 한 번에 D1 쿼리 50개, CPU 10ms 이고,
// scheduled 한 번을 서재 색인 갱신·접속자 표본과 나눠 쓴다. 그래서 묶음 크기와 별개로 아래
// 예산을 넘기 전에 멈춘다. 늘리려면 요금제 한도부터 확인한다.
export const SWEEP_BATCH = 25;
// 한 틱에 정리가 쓰는 D1 쿼리 수 상한(batch 는 문장 수만큼 센다). 50개 중 나머지는 다른 작업 몫.
export const SWEEP_QUERY_BUDGET = 30;
// 한 틱에 정리가 계산하는 SHA-256 횟수 상한(CPU 10ms 한도 대비).
export const SWEEP_DIGEST_BUDGET = 800;
// 틱 끝의 상태 저장(상태 + 가드 + 작업 기록 batch)과 숨김 행 정리 몫으로 늘 남겨 두는 쿼리 수.
var QUERY_RESERVE = 4;

var JOB = 'login-code-sweep';
var PHASES = ['users', 'owners', 'libraries', 'profiles'];
var PREFIXES = { users: 'user/', owners: 'owners/', libraries: 'library/' };
// 이 모양이 아닌 키는 어느 단계에서도 건드리지 않는다.
var USER_KEY_RE = /^user\/([0-9a-f]{64})\.json$/;
var OWNER_KEY_RE = /^owners\/[0-9a-f]{64}\.json$/;
var LIBRARY_KEY_RE = /^library\/([A-Za-z0-9_-]{1,32})\.json$/;
// 남길 목록이 판정과 삭제 사이에 계속 바뀌면 이만큼만 다시 판정하고 이번 틱을 멈춘다.
var MAX_KEEP_RETRIES = 3;

// adminApi.js 의 adminHashes 와 같은 해석. 공백으로 나눈 목록도 받아 관리자를 더 넓게 남긴다.
function adminHashes(env) {
  return String(env.ADMIN_USER_HASHES || '').split(/[\s,]+/)
    .map(function (h) { return h.trim().toLowerCase(); })
    .filter(function (h) { return /^[0-9a-f]{64}$/.test(h); });
}

// login_ids 전체의 변경 표지. 아이디가 생기거나 없어지면 행 수가, 바뀌면 마지막 갱신 시각이 달라진다.
function fingerprintOf(count, maxUpdatedAt) {
  return Number(count) + ':' + (maxUpdatedAt === null || maxUpdatedAt === undefined ? '' : Number(maxUpdatedAt));
}

// ---- 틱 예산 ----
// D1 쿼리는 env.TAGS_DB 를 감싸 실제로 부른 만큼 세고, SHA-256 은 부르는 자리에서 센다.
function newBudget() {
  return { queries: 0, digests: 0 };
}

// cost({ queries, digests }) 만큼 더 써도 예산 안인가(상태 저장 몫은 늘 남긴다).
function fits(budget, cost) {
  return budget.queries + cost.queries + QUERY_RESERVE <= SWEEP_QUERY_BUDGET &&
    budget.digests + cost.digests <= SWEEP_DIGEST_BUDGET;
}

// D1 바인딩을 감싸 쿼리 수를 센다. batch 에는 감싸기 전 문장을 넘긴다.
function countingDb(db, budget) {
  function wrap(statement) {
    return {
      original: statement,
      bind: function () { return wrap(statement.bind.apply(statement, arguments)); },
      first: function () { budget.queries++; return statement.first.apply(statement, arguments); },
      run: function () { budget.queries++; return statement.run.apply(statement, arguments); },
      all: function () { budget.queries++; return statement.all.apply(statement, arguments); }
    };
  }
  return {
    prepare: function (sql) { return wrap(db.prepare(sql)); },
    batch: function (statements) {
      budget.queries += statements.length;
      return db.batch(statements.map(function (s) { return s.original || s; }));
    }
  };
}

// 남길 계정 = login_ids 의 모든 행. 못 읽거나 쓸 만한 코드가 하나도 없으면 null
// (그러면 아무것도 지우지 않는다). 키 해시 집합은 필요한 단계에서만 한 번 계산해 둔다.
async function readKeep(env) {
  var result;
  try {
    result = await env.TAGS_DB.prepare('SELECT personal_code, owner_hash, updated_at FROM login_ids').all();
  } catch (e) {
    console.error('login code sweep: login_ids unreadable', e && e.message);
    return null;
  }
  var all = result && Array.isArray(result.results) ? result.results : null;
  if (!all) return null;
  var maxUpdatedAt = null;
  all.forEach(function (r) {
    if (typeof r.updated_at === 'number' && (maxUpdatedAt === null || r.updated_at > maxUpdatedAt)) maxUpdatedAt = r.updated_at;
  });
  var rows = all.filter(function (r) { return typeof r.personal_code === 'string' && r.personal_code; });
  if (rows.length === 0) {
    console.error('login code sweep: login_ids empty, skipping');
    return null;
  }
  return {
    rows: rows,
    codes: rows.map(function (r) { return r.personal_code; }),
    fingerprint: fingerprintOf(all.length, maxUpdatedAt),
    cache: {}
  };
}

// 삭제 직전 확인. 그대로면 같은 keep, 바뀌었으면 새로 읽은 keep. 못 읽으면 throw 해서
// 이번 틱을 상태 저장 없이 멈춘다(다음 틱이 같은 묶음부터 다시 한다).
async function confirmKeep(env, keep) {
  var row = await env.TAGS_DB.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM login_ids').first();
  if (row && fingerprintOf(row.n, row.u) === keep.fingerprint) return keep;
  var fresh = await readKeep(env);
  if (!fresh) throw new Error('login_ids unreadable during sweep');
  return fresh;
}

// decide(keep) 로 지울 대상을 정하고(없으면 null), 그 사이 남길 목록이 바뀌지 않았을 때만
// remove(target) 한다. 바뀌었으면 새 목록으로 다시 판정한다. { keep, removed: target | null }.
// 다시 판정할 예산(cost(keep))이 없으면 아무것도 지우지 않고 { incomplete: true } — 호출자는
// 이 항목을 처리하지 못한 것으로 보고 틱을 멈춘다(다음 틱이 같은 항목부터 다시 한다).
async function removeIfStillOrphan(env, budget, keep, cost, decide, remove) {
  for (var attempt = 0; attempt < MAX_KEEP_RETRIES; attempt++) {
    if (attempt > 0 && !fits(budget, cost(keep))) return { keep: keep, removed: null, incomplete: true };
    var target = await decide(keep);
    if (target === null) return { keep: keep, removed: null };
    var confirmed = await confirmKeep(env, keep);
    if (confirmed === keep) {
      await remove(target);
      return { keep: keep, removed: target };
    }
    keep = confirmed;
  }
  throw new Error('login_ids kept changing during sweep');
}

async function keySet(budget, keep, name, fn) {
  if (!keep.cache[name]) {
    budget.digests += keep.codes.length;
    keep.cache[name] = new Set(await Promise.all(keep.codes.map(fn)));
  }
  return keep.cache[name];
}

// profiles.owner_hash → 남길 코드. login_ids 에 저장된 값과 다시 계산한 값을 모두 넣는다.
async function profileHashMap(budget, keep) {
  if (keep.cache.profiles) return keep.cache.profiles;
  var map = new Map();
  for (var i = 0; i < keep.rows.length; i++) {
    var c = keep.rows[i].personal_code;
    budget.digests++;
    map.set(await profileOwnerHash(c), c);
    if (typeof keep.rows[i].owner_hash === 'string' && !map.has(keep.rows[i].owner_hash)) map.set(keep.rows[i].owner_hash, c);
  }
  keep.cache.profiles = map;
  return map;
}

function initialState() {
  return { phase: PHASES[0], cursor: null, counts: { users: 0, owners: 0, libraries: 0, profiles: 0 } };
}

// R2 한 묶음을 나열한다. cursor 에는 마지막으로 본 키를 두고 startAfter 로 넘긴다 —
// 방금 지운 키가 사라져도 다음 위치가 흔들리지 않고, 오래 둔 커서가 만료될 일도 없다.
async function listBatch(env, phase, cursor) {
  var options = { prefix: PREFIXES[phase], limit: SWEEP_BATCH };
  if (cursor) options.startAfter = cursor;
  var page = await env.FAVORITES_BUCKET.list(options);
  var objects = (page && Array.isArray(page.objects)) ? page.objects : [];
  return {
    keys: objects.map(function (o) { return o.key; }),
    // 빈 묶음인데 truncated 면 더 나아갈 수 없으므로 끝난 것으로 본다(덜 지우는 쪽).
    finished: !page || !page.truncated || objects.length === 0,
    next: objects.length ? objects[objects.length - 1].key : cursor
  };
}

// users·owners: 한 묶음을 R2 다중 삭제 한 번으로 지운다. 삭제 직전에 남길 목록을 확인한다.
// 묶음 전체가 한 항목이라 다 처리했거나(handled = keys.length) 하나도 못 했다(0). { deleted, handled }.
async function sweepKeys(env, budget, keep, keys, pattern, setName, keyFn, protectedHashes) {
  var cost = function (k) { return { queries: 2, digests: k.cache[setName] ? 0 : k.codes.length }; };
  var result = await removeIfStillOrphan(env, budget, keep, cost, async function (k) {
    var kept = await keySet(budget, k, setName, keyFn);
    var targets = keys.filter(function (key) {
      var m = pattern.exec(key);
      return m && !kept.has(key) && !(m[1] && protectedHashes.indexOf(m[1]) !== -1);
    });
    return targets.length ? targets : null;
  }, function (targets) {
    return env.FAVORITES_BUCKET.delete(targets);
  });
  if (result.incomplete) return { deleted: 0, handled: 0 };
  return { deleted: result.removed ? result.removed.length : 0, handled: keys.length };
}

// 서재 주인이 남길 코드 중 하나인가. 서재의 프로필로 주인을 먼저 짐작해 보고(대부분 한 번에 끝난다),
// 아니면 남길 코드 전부와 대조한다.
async function ownedByKept(env, budget, libCode, record, keep) {
  if (typeof record.profileId === 'string' && record.profileId) {
    try {
      var row = await env.TAGS_DB.prepare('SELECT owner_hash FROM profiles WHERE profile_id = ?').bind(record.profileId).first();
      var hinted = row ? (await profileHashMap(budget, keep)).get(row.owner_hash) : null;
      if (hinted) {
        budget.digests++;
        if ((await ownerHashFor(hinted, libCode)) === record.ownerHash) return true;
      }
    } catch (e) {
      // 짐작만 실패한 것 — 아래 전체 대조로 판정한다
    }
  }
  for (var i = 0; i < keep.codes.length; i++) {
    budget.digests++;
    if ((await ownerHashFor(keep.codes[i], libCode)) === record.ownerHash) return true;
  }
  return false;
}

// 서재 하나를 한 번 판정하는 최대 비용: 주인 짐작 1 + 삭제 직전 확인 최대 2 쿼리,
// 짐작 1 + 전체 대조 + (아직 없으면) 프로필 해시표 만큼의 SHA-256.
function libraryCost(keep) {
  return { queries: 3, digests: 1 + keep.codes.length + (keep.cache.profiles ? 0 : keep.rows.length) };
}

// 프로필 하나: 삭제 직전 확인 최대 2 + 삭제 batch 3 쿼리, 게임 해시 1 + (아직 없으면) 프로필 해시표.
function profileCost(keep) {
  return { queries: 5, digests: 1 + (keep.cache.profiles ? 0 : keep.rows.length) };
}

// 이번 틱에 지운 서재들의 공개 색인 줄과 숨김 행을 한 번에 정리한다. 실패해도 throw 하지 않는다 —
// 원본은 이미 지워졌고, 색인은 cron(refreshLibraryIndex)이 원본에서 다시 만든다.
async function finishLibraryRemoval(env, codes) {
  if (!codes.length) return;
  await removeFromLibraryIndex(env, codes);
  try {
    var statement = env.TAGS_DB.prepare(
      'DELETE FROM library_hidden WHERE code IN (' + codes.map(function () { return '?'; }).join(', ') + ')'
    );
    await statement.bind.apply(statement, codes).run();
  } catch (e) {
    // 숨김 테이블이 없거나 D1 오류여도 서재 삭제 자체는 끝난 것으로 본다
  }
}

// 지울 수도 있는 서재 레코드. 이미 없거나, 못 읽거나, ownerHash 가 없는 익명 서재면 null(남긴다).
async function readOwnedLibrary(env, key) {
  var object = await env.FAVORITES_BUCKET.get(key);
  if (!object) return null;
  var record;
  try { record = await object.json(); } catch (e) { return null; }
  if (!record || typeof record.ownerHash !== 'string' || !record.ownerHash) return null;
  return record;
}

// 서재: R2 원본만 하나씩 지우고, 공개 색인과 숨김 행은 틱 끝에 한 번에 정리한다.
// 첫 항목은 예산과 상관없이 처리한다(그래야 매 틱 조금씩이라도 나아간다). { deleted, handled }.
async function sweepLibraries(env, budget, keep, keys) {
  var removed = [];
  var handled = 0;
  try {
    for (var i = 0; i < keys.length; i++) {
      if (i > 0 && !fits(budget, libraryCost(keep))) break;
      var m = LIBRARY_KEY_RE.exec(keys[i]);
      var record = m ? await readOwnedLibrary(env, keys[i]) : null;
      if (record) {
        var libCode = m[1];
        var key = keys[i];
        var result = await removeIfStillOrphan(env, budget, keep, libraryCost, async function (k) {
          return (await ownedByKept(env, budget, libCode, record, k)) ? null : key;
        }, function (target) {
          return env.FAVORITES_BUCKET.delete(target);
        });
        keep = result.keep;
        if (result.incomplete) break;
        if (result.removed) removed.push(libCode);
      }
      handled = i + 1;
    }
  } finally {
    // 중간에 throw 해도 이미 지운 서재의 색인·숨김 행은 정리한다
    await finishLibraryRemoval(env, removed);
  }
  return { deleted: removed.length, handled: handled };
}

async function sweepProfiles(env, budget, keep, rows) {
  var deleted = 0;
  var handled = 0;
  for (var i = 0; i < rows.length; i++) {
    if (i > 0 && !fits(budget, profileCost(keep))) break;
    var row = rows[i];
    var result = await removeIfStillOrphan(env, budget, keep, profileCost, async function (k) {
      return (await profileHashMap(budget, k)).has(row.owner_hash) ? null : row.profile_id;
    }, function (target) {
      budget.digests++; // 랭킹 줄을 찾는 게임 해시
      return deleteProfileRows(env, target);
    });
    keep = result.keep;
    if (result.incomplete) break;
    if (result.removed) deleted++;
    handled = i + 1;
  }
  return { deleted: deleted, handled: handled };
}

// 진행 상태를 저장한다. 읽은 상태 그대로일 때만 바꾼다(틱이 겹쳐도 한쪽만 이긴다).
// 단계가 끝났으면 작업 기록(admin_actions)을 같은 batch 에 넣는다. 상태를 못 바꿨으면
// 가드 문장이 같은 job 행을 한 번 더 넣으려다 PK 충돌로 batch 전체(기록 포함)를 되돌린다.
// 이겼으면 true, 다른 틱에 졌으면 false.
async function saveState(env, previousText, state, done, now, logEntry) {
  var db = env.TAGS_DB;
  var text = JSON.stringify(state);
  var save = previousText === null
    ? db.prepare(
      'INSERT INTO maintenance_jobs (job, state, done, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(job) DO NOTHING'
    ).bind(JOB, text, done ? 1 : 0, now)
    : db.prepare(
      'UPDATE maintenance_jobs SET state = ?, done = ?, updated_at = ? WHERE job = ? AND state = ? AND done = 0'
    ).bind(text, done ? 1 : 0, now, JOB, previousText);
  if (!logEntry) {
    var single = await save.run();
    return !!(single && single.meta && single.meta.changes === 1);
  }
  var guard = db.prepare(
    'INSERT INTO maintenance_jobs (job, state, done, updated_at) ' +
    'SELECT job, state, done, updated_at FROM maintenance_jobs WHERE job = ? AND changes() = 0'
  ).bind(JOB);
  try {
    await db.batch([save, guard, logAction(env, 'system', 'account.sweep', logEntry.phase, logEntry)]);
    return true;
  } catch (e) {
    if (String(e && e.message || '').indexOf('UNIQUE constraint failed') !== -1) return false;
    throw e;
  }
}

// 한 틱. { ran: false } 면 아무것도 지우지 않았다.
export async function runLoginCodeSweep(rawEnv, now) {
  if (!(now >= LOGIN_CODE_DEADLINE)) return { ran: false };
  if (rawEnv.ACCOUNT_SWEEP_ENABLED !== '1') return { ran: false };

  // 이 틱이 쓰는 D1 쿼리를 모두 세도록 TAGS_DB 만 감싼 env 를 쓴다(나머지 바인딩은 그대로).
  var budget = newBudget();
  var env = Object.create(rawEnv);
  env.TAGS_DB = countingDb(rawEnv.TAGS_DB, budget);

  var job = await env.TAGS_DB.prepare('SELECT state, done FROM maintenance_jobs WHERE job = ?').bind(JOB).first();
  if (job && job.done) return { ran: false, done: true };
  var previousText = job ? job.state : null;
  var state;
  try {
    state = job ? JSON.parse(job.state) : initialState();
  } catch (e) {
    state = null;
  }
  if (!state || PHASES.indexOf(state.phase) === -1) {
    console.error('login code sweep: invalid job state');
    return { ran: false };
  }
  if (!state.counts || typeof state.counts !== 'object') state.counts = {};

  // 묶음을 먼저 읽고, 남길 목록은 그 뒤에 읽는다(읽은 뒤 생긴 아이디는 삭제 직전 확인이 잡는다).
  var phase = state.phase;
  var keys = null, profileRows = null, finished, next;
  if (phase === 'profiles') {
    var selected = await env.TAGS_DB.prepare(
      'SELECT profile_id, owner_hash FROM profiles WHERE profile_id > ? ORDER BY profile_id LIMIT ?'
    ).bind(state.cursor || '', SWEEP_BATCH).all();
    profileRows = selected.results || [];
    finished = profileRows.length < SWEEP_BATCH;
    next = profileRows.length ? profileRows[profileRows.length - 1].profile_id : state.cursor;
  } else {
    var batch = await listBatch(env, phase, state.cursor);
    keys = batch.keys; finished = batch.finished; next = batch.next;
  }

  var keep = await readKeep(env);
  if (!keep) return { ran: false };

  var outcome;
  if (phase === 'users') outcome = await sweepKeys(env, budget, keep, keys, USER_KEY_RE, 'users', userStoreKey, adminHashes(env));
  else if (phase === 'owners') outcome = await sweepKeys(env, budget, keep, keys, OWNER_KEY_RE, 'owners', ownerIndexKey, []);
  else if (phase === 'libraries') outcome = await sweepLibraries(env, budget, keep, keys);
  else outcome = await sweepProfiles(env, budget, keep, profileRows);

  // 예산 때문에 묶음 중간에 멈췼으면 끝까지 처리한 마지막 항목까지만 진행한 것으로 저장한다.
  var items = phase === 'profiles'
    ? profileRows.map(function (r) { return r.profile_id; })
    : keys;
  if (outcome.handled < items.length) {
    finished = false;
    if (outcome.handled === 0) return { ran: true, phase: phase, done: false }; // 저장할 진행이 없다
    next = items[outcome.handled - 1];
  }

  state.counts[phase] = (Number(state.counts[phase]) || 0) + outcome.deleted;
  var done = false;
  if (finished) {
    var nextIndex = PHASES.indexOf(phase) + 1;
    done = nextIndex >= PHASES.length;
    state.phase = done ? phase : PHASES[nextIndex];
    state.cursor = null;
  } else {
    state.cursor = next;
  }

  var logEntry = finished ? { phase: phase, deleted: state.counts[phase] } : null;
  if (!(await saveState(env, previousText, state, done, now, logEntry))) {
    // 겹친 다른 틱이 먼저 저장했다. 지운 것은 멱등이라 그쪽 상태를 따른다.
    return { ran: true, phase: phase, done: false };
  }
  return { ran: true, phase: phase, done: done };
}
