import { json, readBody } from './adminCommon.js';
import { TAG_DEFS_KEY, BAD_TAG_RE, cleanTagName, readTagDefinitions, publishTagFile } from './tagDocs.js';
import { recordTagSnapshot } from './tagSnapshot.js';

// 관리 페이지의 태그 정의 탭. 태그의 이모지·색·순서·투표 허용 여부와 이름 바꾸기
// 기록(renames)을 D1 site_documents['tag-definitions'] 문서 하나에 두고, 바뀔 때마다
// 공식 태그 덮어쓰기와 함께 R2 공개 파일로 다시 굽는다(worker/tagDocs.js). 브라우저
// (cdnConfig.js → tagConfig.js 의 applyDefinitions)가 화면을 그리기 전에 적용한다.
//
// 문서는 통째로 저장하고 version 으로 낙관적 잠금을 건다 — 화면이 받아 둔 version 이
// 서버와 다르면 409 를 돌려줘서 다른 창에서 고친 내용을 덮어쓰지 않는다.

var MAX_DEFS = 100;
var MAX_EMOJI_LENGTH = 8;
var COLOR_RE = /^#[0-9a-f]{6}$/i;
// 태그 100개 문서(한글 이름 20자 + 이모지 + 색)가 들어가는 크기.
var DOC_MAX_BODY_BYTES = 32768;

function cleanEmoji(raw) {
  if (typeof raw !== 'string') return null;
  var emoji = raw.normalize('NFC').trim();
  var length = Array.from(emoji).length;
  if (length < 1 || length > MAX_EMOJI_LENGTH || BAD_TAG_RE.test(emoji)) return null;
  return emoji;
}

// 정의 배열 검증. 잘못된 항목이 하나라도 있거나 이름이 겹치면 null.
function cleanDefinitionTags(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_DEFS) return null;
  var out = [];
  var names = {};
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    if (!t || typeof t !== 'object') return null;
    var name = cleanTagName(t.name);
    var emoji = cleanEmoji(t.emoji);
    if (name === null || emoji === null || names[name]) return null;
    if (t.color !== null && !(typeof t.color === 'string' && COLOR_RE.test(t.color))) return null;
    if (typeof t.votable !== 'boolean') return null;
    names[name] = true;
    out.push({ name: name, emoji: emoji, color: t.color === null ? null : t.color.toLowerCase(), votable: t.votable });
  }
  return out;
}

function cleanVersion(raw) {
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

// 문서 쓰기와 작업 기록을 한 batch 로 묶을 문장들. 작업 기록은 "아직 prevVersion 인
// 경우에만" 들어가게 조건을 걸어, 저장이 version 충돌로 빠지면 기록도 남지 않는다.
// 결과 배열의 마지막 문장이 문서 쓰기다(changes 0 = 충돌). prevVersion 0 은 새 행
// INSERT 라 이미 행이 있으면 PK 충돌로 batch 전체가 실패한다.
// 문서가 아직 prevVersion 인지 보는 SQL 조건과 그 인자. 문서 쓰기와 같은 batch 에
// 넣는 다른 문장(작업 기록, 이름 바꾸기의 투표·덮어쓰기 이동)에도 걸어서, 충돌하면
// 아무것도 바뀌지 않게 한다.
function versionGuard(prevVersion) {
  return prevVersion === 0
    ? { sql: 'NOT EXISTS (SELECT 1 FROM site_documents WHERE key = ?)', args: [TAG_DEFS_KEY] }
    : { sql: 'EXISTS (SELECT 1 FROM site_documents WHERE key = ? AND version = ?)', args: [TAG_DEFS_KEY, prevVersion] };
}

function guarded(env, sql, args, prevVersion) {
  var g = versionGuard(prevVersion);
  var stmt = env.TAGS_DB.prepare(sql + ' AND ' + g.sql);
  return stmt.bind.apply(stmt, args.concat(g.args));
}

function docWriteStatements(env, session, action, detail, doc, prevVersion, extra) {
  var now = Date.now();
  var g = versionGuard(prevVersion);
  var guard = g.sql;
  var guardArgs = g.args;
  var log = env.TAGS_DB.prepare(
    'INSERT INTO admin_actions (at, actor, action, target, detail) SELECT ?, ?, ?, ?, ? WHERE ' + guard
  );
  log = log.bind.apply(log, [now, session.actor, action, TAG_DEFS_KEY, JSON.stringify(detail)].concat(guardArgs));
  var write = prevVersion === 0
    ? env.TAGS_DB.prepare('INSERT INTO site_documents (key, doc, version, updated_at) VALUES (?, ?, 1, ?)')
      .bind(TAG_DEFS_KEY, JSON.stringify(doc), now)
    : env.TAGS_DB.prepare('UPDATE site_documents SET doc = ?, version = ?, updated_at = ? WHERE key = ? AND version = ?')
      .bind(JSON.stringify(doc), prevVersion + 1, now, TAG_DEFS_KEY, prevVersion);
  return [log].concat(extra || [], [write]);
}

// batch 를 실행하고 문서 쓰기가 실제로 됐는지 돌려준다.
async function runDocBatch(env, statements) {
  try {
    var results = await env.TAGS_DB.batch(statements);
    var last = results[results.length - 1];
    return !!(last && last.meta && last.meta.changes > 0);
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) return false;
    throw e;
  }
}

function published(ok, body) {
  if (!ok) body.warning = 'saved, but the public tag file could not be updated';
  return json(body);
}

function conflict() {
  return json({ error: 'version conflict' }, 409);
}

// GET tag-defs — 지금 문서와 version. 없으면 { doc: null, version: 0 }.
async function handleGet(request, env) {
  var defs = await readTagDefinitions(env);
  return json(defs ? { doc: defs.doc, version: defs.version } : { doc: null, version: 0 });
}

// POST tag-defs/save { doc, version } — 문서 전체 저장. renames 는 이름 바꾸기
// 경로로만 바뀌므로 서버 값을 그대로 둔다.
async function handleSave(request, env, ctx, session) {
  var body = await readBody(request, DOC_MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  var raw = body.doc;
  var version = cleanVersion(body.version);
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || version === null) return json({ error: 'invalid payload shape' }, 400);
  var tags = cleanDefinitionTags(raw.tags);
  if (!tags) return json({ error: 'invalid payload shape' }, 400);

  var current = await readTagDefinitions(env);
  if ((current ? current.version : 0) !== version) return conflict();
  var doc = { v: 1, tags: tags, renames: (current && current.doc.renames) || {} };
  var statements = docWriteStatements(env, session, 'tag-defs.save', { before: current ? current.doc : null, after: doc }, doc, version);
  if (!(await runDocBatch(env, statements))) return conflict();
  return published(await publishTagFile(env), { ok: true, version: version + 1 });
}

// 문서 안에서 from → to 를 처리한다. to 가 정의 목록에 이미 있으면 합치기(to 설정
// 유지, from 항목 삭제), 없으면 이름 바꾸기(from 항목이 이름만 바꿔 자리·설정 유지).
// renames 는 X → from 을 X → to 로 고쳐 연결을 잇고, 자기 자신을 가리키는 항목은 지운다.
function renameDoc(doc, from, to) {
  var merged = doc.tags.some(function (t) { return t.name === to; });
  var tags = merged
    ? doc.tags.filter(function (t) { return t.name !== from; })
    : doc.tags.map(function (t) { return t.name === from ? Object.assign({}, t, { name: to }) : t; });
  var renames = {};
  Object.keys(doc.renames || {}).forEach(function (key) {
    renames[key] = doc.renames[key] === from ? to : doc.renames[key];
  });
  renames[from] = to;
  Object.keys(renames).forEach(function (key) { if (renames[key] === key) delete renames[key]; });
  return { doc: { v: 1, tags: tags, renames: renames }, merged: merged };
}

function replaceTag(tags, from, to) {
  var out = [];
  tags.forEach(function (tag) {
    var next = tag === from ? to : tag;
    if (out.indexOf(next) === -1) out.push(next);
  });
  return out;
}

// POST tag-defs/rename { from, to, version } — 이름 바꾸기·합치기. 문서, 유저 투표,
// 공식 태그 덮어쓰기를 한 batch 로 옮긴다. 같은 사람이 from·to 둘 다 찍은 표는
// UPDATE OR IGNORE 로 건너뛴 뒤 남은 from 행을 지워 한 표로 합친다.
async function handleRename(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var from = cleanTagName(body.from);
  var to = cleanTagName(body.to);
  var version = cleanVersion(body.version);
  if (from === null || to === null || from === to || version === null) return json({ error: 'invalid payload shape' }, 400);

  var current = await readTagDefinitions(env);
  if ((current ? current.version : 0) !== version) return conflict();
  var before = current ? current.doc : { v: 1, tags: [], renames: {} };
  // to 가 이미 다른 이름으로 바뀐 이름(renames 의 키)이면 그 끝 이름까지 따라간다 —
  // 아니면 브라우저가 덮어쓰기 값을 한 번 더 바꿔서 같은 태그가 두 이름으로 보인다.
  // 끝 이름이 from 이면(되돌리기) 따라가지 않는다. renameDoc 이 그 항목을 지운다.
  var seen = {};
  while (Object.prototype.hasOwnProperty.call(before.renames || {}, to) && before.renames[to] !== from && !seen[to]) {
    seen[to] = true;
    to = before.renames[to];
  }
  if (to === from) return json({ error: 'invalid payload shape' }, 400);
  var result = renameDoc(before, from, to);

  var movedVotes = (await env.TAGS_DB.prepare('SELECT COUNT(*) AS n FROM tag_votes WHERE tag_name = ?').bind(from).first()).n;
  var overrideRows = (await env.TAGS_DB.prepare('SELECT item_type, item_id, tags FROM official_tag_overrides').all()).results || [];
  var now = Date.now();
  var extra = [
    guarded(env, 'UPDATE OR IGNORE tag_votes SET tag_name = ? WHERE tag_name = ?', [to, from], version),
    guarded(env, 'DELETE FROM tag_votes WHERE tag_name = ?', [from], version)
  ];
  var changedOverrides = 0;
  overrideRows.forEach(function (r) {
    var tags = JSON.parse(r.tags);
    if (tags.indexOf(from) === -1) return;
    changedOverrides++;
    // 읽은 뒤에 누가 이 행을 고쳤으면(tags 가 달라졌으면) 덮어쓰지 않고 건너뛴다.
    // 그 행의 옛 이름은 브라우저의 renames 가 계속 새 이름으로 보여 준다.
    extra.push(guarded(env,
      'UPDATE official_tag_overrides SET tags = ?, updated_at = ? WHERE item_type = ? AND item_id = ? AND tags = ?',
      [JSON.stringify(replaceTag(tags, from, to)), now, r.item_type, r.item_id, r.tags], version));
  });

  var detail = { from: from, to: to, merged: result.merged, movedVotes: movedVotes, changedOverrides: changedOverrides, before: current ? current.doc : null };
  var statements = docWriteStatements(env, session, 'tag-defs.rename', detail, result.doc, version, extra);
  if (!(await runDocBatch(env, statements))) return conflict();
  await recordTagSnapshot(env);
  return published(await publishTagFile(env), {
    ok: true, to: to, merged: result.merged, movedVotes: movedVotes, changedOverrides: changedOverrides, version: version + 1
  });
}

// POST tag-defs/unrename { from, version } — renames 항목 하나만 지운다. 이미 옮긴
// 표와 덮어쓰기는 그대로 새 이름에 남는다.
async function handleUnrename(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var from = cleanTagName(body.from);
  var version = cleanVersion(body.version);
  if (from === null || version === null) return json({ error: 'invalid payload shape' }, 400);

  var current = await readTagDefinitions(env);
  if ((current ? current.version : 0) !== version) return conflict();
  if (!current || !Object.prototype.hasOwnProperty.call(current.doc.renames || {}, from)) return json({ error: 'not found' }, 404);
  var renames = Object.assign({}, current.doc.renames);
  var to = renames[from];
  delete renames[from];
  var doc = { v: 1, tags: current.doc.tags, renames: renames };
  var statements = docWriteStatements(env, session, 'tag-defs.unrename', { from: from, to: to }, doc, version);
  if (!(await runDocBatch(env, statements))) return conflict();
  return published(await publishTagFile(env), { ok: true, version: version + 1 });
}

export var tagDefRoutes = {
  'GET /tag-defs': handleGet,
  'POST /tag-defs/save': handleSave,
  'POST /tag-defs/rename': handleRename,
  'POST /tag-defs/unrename': handleUnrename
};
