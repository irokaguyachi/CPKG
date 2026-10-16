// 관리 API 테스트용 공용 하네스. game-ranking·security-regressions 테스트에
// 있던 Worker 모듈 로더, 메모리 SQLite D1, 메모리 R2 모형을 한곳에 모았다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..', '..');

// 서버 시계. 테스트가 clock.now 를 옮겨 시간 경과를 흉내 낸다.
const clock = { now: Date.parse('2026-10-05T12:00:00+09:00') };
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock.now])); }
  static now() { return clock.now; }
}

async function load(file, overrides = {}) {
  const context = vm.createContext({
    crypto: webcrypto, Request, Response, Headers, URL, TextEncoder, TextDecoder, ReadableStream, console,
    Date: FakeDate, btoa, atob, ...overrides
  });
  // 루트 모듈 한 번의 link() 가 의존성 전체를 링크한다. 모듈마다 link() 를 따로
  // 부르면 여러 모듈이 같은 모듈을 import 하는 그래프(adminCommon.js 등)에서
  // "not linked" 오류가 난다.
  const modules = new Map();
  function moduleFor(filename) {
    filename = path.resolve(filename);
    if (!modules.has(filename)) {
      modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename }));
    }
    return modules.get(filename);
  }
  const module = moduleFor(path.join(root, file));
  await module.link((specifier, parent) => moduleFor(path.resolve(path.dirname(parent.identifier), specifier)));
  await module.evaluate();
  return module.namespace;
}

// 실제 SQLite 위에 D1 API 중 쓰는 부분(prepare/bind/first/run/all/batch)만 흉내 낸다.
// schemas: 적용할 worker/*.sql 파일 이름 배열.
class D1 {
  constructor(schemas = []) {
    this.db = new DatabaseSync(':memory:');
    for (const name of schemas) this.db.exec(fs.readFileSync(path.join(root, 'worker', name), 'utf8'));
  }
  prepare(sql) { return new Statement(this.db, sql, []); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(s => s.exec());
      this.db.exec('COMMIT');
      return results;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  rows(sql, ...args) { return this.db.prepare(sql).all(...args).map(r => ({ ...r })); }
}
class Statement {
  constructor(db, sql, args) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  exec() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)/i.test(this.sql)) return { results: stmt.all(...this.args).map(r => ({ ...r })), meta: {} };
    return { results: [], meta: { changes: Number(stmt.run(...this.args).changes) } };
  }
  async first() { return this.exec().results[0] || null; }
  async run() { return this.exec(); }
  async all() { return this.exec(); }
}

class Bucket {
  constructor() { this.objects = new Map(); this.version = 0; }
  async get(key) {
    const value = this.objects.get(key);
    if (!value) return null;
    return { ...value, json: async () => JSON.parse(value.text), body: new Response(value.text).body };
  }
  async head(key) { return this.objects.get(key) || null; }
  async put(key, text, options = {}) {
    const existing = this.objects.get(key);
    const condition = options.onlyIf || {};
    if (condition.etagMatches && (!existing || existing.etag !== condition.etagMatches)) return null;
    if (condition.etagDoesNotMatch === '*' && existing) return null;
    const value = { key, text, etag: String(++this.version), customMetadata: options.customMetadata || {} };
    this.objects.set(key, value);
    return value;
  }
  // R2 처럼 키 하나 또는 키 배열을 받는다.
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  // startAfter: R2 처럼 이 키 다음부터(이 키 제외) 나열한다.
  async list({ prefix, cursor, limit, startAfter }) {
    const rows = [...this.objects.values()]
      .filter(row => row.key.startsWith(prefix) && (startAfter === undefined || row.key > startAfter))
      .sort((a, b) => a.key < b.key ? -1 : 1);
    const offset = Number(cursor) || 0;
    const end = offset + limit;
    return { objects: rows.slice(offset, end), truncated: end < rows.length, cursor: String(end) };
  }
}

const hash = text => createHash('sha256').update(text).digest('hex');
const allow = { limit: async () => ({ success: true }) };
const request = (method, url, body, headers = {}) => new Request('https://example.test' + url, {
  method,
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body)
});

module.exports = { root, clock, load, D1, Bucket, hash, allow, request };
