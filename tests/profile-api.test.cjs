// 유저 프로필(worker/nickname.js, worker/profileApi.js) 검증.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, D1 } = require('./helpers/workerHarness.cjs');

test('cleanNickname trims, strips invisible chars and enforces max', async () => {
  const { cleanNickname } = await load('worker/nickname.js');
  assert.equal(cleanNickname('  카구야​  짱 ', 12), '카구야 짱');
  assert.equal(cleanNickname('가'.repeat(12), 12), '가'.repeat(12));
  assert.equal(cleanNickname('가'.repeat(13), 12), null);
  assert.equal(cleanNickname('   ', 12), null);
  assert.equal(cleanNickname(5, 12), null);
});

test('bannedWordIn matches lowercase substrings and fails open', async () => {
  const { bannedWordIn } = await load('worker/nickname.js');
  const db = new D1(['admin_schema.sql']);
  db.db.exec("INSERT INTO banned_nicknames VALUES ('bad', 1)");
  assert.equal(await bannedWordIn({ TAGS_DB: db }, ['ok', 'xBADx']), true);
  assert.equal(await bannedWordIn({ TAGS_DB: db }, ['ok']), false);
  assert.equal(await bannedWordIn({ TAGS_DB: new D1([]) }, ['bad']), false);
});

test('reserved nickname pattern covers admin reset names only', async () => {
  const { RESERVED_NICKNAME_RE } = await load('worker/nickname.js');
  assert.ok(RESERVED_NICKNAME_RE.test('유저abc123'));
  assert.ok(RESERVED_NICKNAME_RE.test('유저abcdefghijkl'));
  assert.ok(!RESERVED_NICKNAME_RE.test('유저'));
  assert.ok(!RESERVED_NICKNAME_RE.test('유저 abc123'));
  assert.ok(!RESERVED_NICKNAME_RE.test('유저abc12'));
});

test('profile schema applies twice', () => {
  const db = new D1(['profile_schema.sql', 'profile_schema.sql']);
  const names = db.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name);
  assert.ok(names.includes('profiles'));
});
