import { json, readBody, logAction, intParam } from './adminCommon.js';

// 관리 페이지의 공식 태그 탭. 작품(종류 + 첫 게시물 ID)의 공식 태그를 통째로
// 교체하는 덮어쓰기를 D1 official_tag_overrides 에 두고, 바뀔 때마다 전체 목록을
// R2 tags/official-overrides.json 으로 다시 굽는다. 공개 GET /tags/official
// (favoritesShareWorker.js)이 그 파일을 내려주고, 브라우저(cdnConfig.js)가 pageData
// JSON 을 읽을 때 tags 를 교체한다 — 정적 데이터를 다시 빌드해도 수정이 남는다.

var TYPES = ['novel', 'translation', 'series', 'hof', 'official'];
var OVERRIDES_KEY = 'tags/official-overrides.json';
var MAX_TAGS = 10;
var MAX_TAG_LENGTH = 20;
// 쉼표는 태그보정.md 의 구분자라 막고, 제어·폭 없는·방향 문자도 막는다.
var BAD_TAG_RE = /[,\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/;

function cleanType(raw) {
  return TYPES.indexOf(raw) !== -1 ? raw : null;
}

// 잘못된 태그가 하나라도 있으면 null. 공백 정리·중복 제거 후 순서는 유지한다.
function cleanTags(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_TAGS) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    if (typeof raw[i] !== 'string') return null;
    var tag = raw[i].normalize('NFC').trim();
    var length = Array.from(tag).length;
    if (length < 1 || length > MAX_TAG_LENGTH || BAD_TAG_RE.test(tag)) return null;
    if (out.indexOf(tag) === -1) out.push(tag);
  }
  return out;
}

// 끌올(bumpItemExists)과 같은 방식으로 Lookup.json 에서 작품이 실제로 있는지 본다.
async function itemExists(request, env, type, id) {
  var lookupUrl = new URL(request.url);
  lookupUrl.pathname = '/data/pageData/Lookup.json';
  lookupUrl.search = '';
  var res = await env.ASSETS.fetch(new Request(lookupUrl, { method: 'GET' }));
  if (!res.ok) return false;
  try {
    var lookup = await res.json();
    return !!(lookup && lookup[type] && lookup[type][String(id)]);
  } catch (e) {
    return false;
  }
}

async function currentOverride(env, type, id) {
  var row = await env.TAGS_DB.prepare(
    'SELECT tags FROM official_tag_overrides WHERE item_type = ? AND item_id = ?'
  ).bind(type, id).first();
  return row ? JSON.parse(row.tags) : null;
}

// D1 의 전체 덮어쓰기로 R2 JSON 을 다시 만든다. 실패하면 false — 다음 변경 때 다시 구워진다.
async function publishOverrides(env) {
  try {
    var rows = (await env.TAGS_DB.prepare('SELECT item_type, item_id, tags FROM official_tag_overrides').all()).results || [];
    var items = {};
    rows.forEach(function (r) { items[r.item_type + ':' + r.item_id] = JSON.parse(r.tags); });
    await env.FAVORITES_BUCKET.put(OVERRIDES_KEY, JSON.stringify({ v: 1, items: items }), {
      httpMetadata: { contentType: 'application/json' }
    });
    return true;
  } catch (e) {
    return false;
  }
}

function published(ok, body) {
  if (!ok) body.warning = 'saved, but the public overrides file could not be updated';
  return json(body);
}

// GET official-tags — 지금 걸려 있는 덮어쓰기 목록(최근 수정순).
async function handleList(request, env) {
  var rows = (await env.TAGS_DB.prepare(
    'SELECT item_type, item_id, tags, updated_at FROM official_tag_overrides ORDER BY updated_at DESC'
  ).all()).results || [];
  return json({
    items: rows.map(function (r) {
      return { itemType: r.item_type, itemId: r.item_id, tags: JSON.parse(r.tags), updatedAt: r.updated_at };
    })
  });
}

// POST official-tags/set { itemType, itemId, tags, before? } — before 는 화면이 본 원래 태그로,
// 이미 덮어쓰기가 있으면 그 값을 대신 기록한다.
async function handleSet(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var type = cleanType(body.itemType);
  var id = intParam(body.itemId);
  var tags = cleanTags(body.tags);
  if (!type || !id || !tags) return json({ error: 'invalid payload shape' }, 400);
  if (!(await itemExists(request, env, type, id))) return json({ error: 'unknown item' }, 400);

  var existing = await currentOverride(env, type, id);
  var before = existing || cleanTags(body.before) || null;
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare(
      'INSERT INTO official_tag_overrides (item_type, item_id, tags, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(item_type, item_id) DO UPDATE SET tags = excluded.tags, updated_at = excluded.updated_at'
    ).bind(type, id, JSON.stringify(tags), Date.now()),
    logAction(env, session.actor, 'official-tags.set', type + ' ' + id, { before: before, after: tags })
  ]);
  return published(await publishOverrides(env), { ok: true, tags: tags });
}

// POST official-tags/reset { itemType, itemId } — 덮어쓰기를 지워 원래 태그로 돌린다.
async function handleReset(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var type = cleanType(body.itemType);
  var id = intParam(body.itemId);
  if (!type || !id) return json({ error: 'invalid payload shape' }, 400);
  var existing = await currentOverride(env, type, id);
  if (!existing) return json({ error: 'not found' }, 404);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM official_tag_overrides WHERE item_type = ? AND item_id = ?').bind(type, id),
    logAction(env, session.actor, 'official-tags.reset', type + ' ' + id, { before: existing, after: null })
  ]);
  return published(await publishOverrides(env), { ok: true });
}

export var officialTagRoutes = {
  'GET /official-tags': handleList,
  'POST /official-tags/set': handleSet,
  'POST /official-tags/reset': handleReset
};
