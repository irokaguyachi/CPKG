// 관리자 API 를 함께 쓰는 계정 테스트 공용 준비 코드. setupDisplay 환경에 관리자 설정을 얹는다.
const { load, hash, allow, request } = require('./workerHarness.cjs');
const { setupDisplay } = require('./profileSetup.cjs');

const ADMIN_CODE = 'admin_personal_code_0001';
const PASSWORD = 'correct horse battery';

async function setupDisplayAdmin(schemas) {
  const t = await setupDisplay(schemas);
  Object.assign(t.env, {
    ADMIN_USER_HASHES: hash('user-v2:' + ADMIN_CODE),
    ADMIN_PASSWORD: PASSWORD, ADMIN_SESSION_SECRET: 'session-secret-for-tests', RL_ADMIN_LOGIN: allow
  });
  const admin = (await load('worker/adminApi.js')).default;
  const ctx = { waitUntil() {} };
  let token = null;
  const api = async (method, url, body) => {
    if (!token) {
      const login = await admin.fetch(request('POST', '/api/admin/login', { personalCode: ADMIN_CODE, password: PASSWORD }), t.env, ctx);
      token = (await login.json()).token;
    }
    const res = await admin.fetch(request(method, '/api/admin/' + url, body, { Authorization: 'Bearer ' + token }), t.env, ctx);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return Object.assign(t, { api });
}

module.exports = { setupDisplayAdmin, ADMIN_CODE };
