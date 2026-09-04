#!/usr/bin/env node
/**
 * 배포 산출물 빌드 스크립트: src/ → dist/
 *
 * - src/ 전체를 dist/로 그대로 복사한다(HTML, CSS, 데이터, wrangler.toml 등).
 * - dist/js/**\/*.js 만 javascript-obfuscator로 난독화해서 덮어쓴다.
 *   실제 사이트는 Cloudflare Workers Assets가 이 디렉터리를 그대로 서빙하므로,
 *   여기 있는 파일이 곧 방문자가 다운로드하는 파일이다.
 * - _worker.js / statsApi.js / presenceDO.js 등 서버(Workers) 쪽 코드는
 *   난독화 대상이 아니다. Cloudflare 엣지에서만 실행되고 브라우저로는 절대
 *   내려가지 않으므로 애초에 노출 위험이 없고, 오히려 건드리면 Worker
 *   런타임 로직이 깨질 위험만 커진다.
 * - 개발은 계속 src/에서 한다(`cd src && python -m http.server`).
 *   dist/는 빌드할 때마다 새로 생성되는 산출물이라 git에 커밋하지 않는다.
 * - 난독화 결과는 .build-cache/에 (원본 내용 + 옵션) 해시로 캐싱한다. dist/는
 *   매번 통째로 새로 만들어도, 실제로 바뀐 js 파일만 다시 난독화하고 나머지는
 *   캐시에서 그대로 복사한다 — 옵션(OBFUSCATE_OPTIONS)을 바꾸면 해시가 달라져
 *   자동으로 전체 재난독화된다. .build-cache/도 산출물이라 git에 커밋하지 않는다.
 *
 * 사용법:
 *   npm run build   # dist/ 생성
 *   npm run deploy  # 빌드 후 dist/에서 wrangler deploy
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CACHE_DIR = path.join(ROOT, '.build-cache', 'js');

// 변수/함수명을 완전히 꼬아서 읽기 어렵게 만드는 게 목적.
// selfDefending / deadCodeInjection은 일부러 껐다 — 이 두 옵션은 실행 중
// 코드 변형(포맷팅, 콘솔에서 코드 복사 등)에 스스로 반응해 멈추거나
// 파일만 키우는 방식이라, 개인 갤러리 사이트 규모에서는 "사이트가 이상하게
// 동작할 위험"이 "코드 읽기 어려움 조금 더 얻는 이득"보다 크다고 판단.
const OBFUSCATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal',
  // 파일마다 독립적으로 난독화한다. 이 프로젝트의 js 파일들은 <script defer>로
  // 각자 로드되어 전역(window) 스코프를 공유하는 구조라, 최상위(전역) 식별자
  // 이름까지 바꾸면 다른 파일에서 그 이름을 부르는 부분이 깨진다. 기본값인
  // false를 유지해 최상위 선언은 그대로 두고, 함수 내부 지역 변수만 꼬은다.
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: false,
  numbersToExpressions: true,
  simplify: true,
  selfDefending: false,
};

function rmrf(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copySrcToDist() {
  rmrf(DIST);
  fs.cpSync(SRC, DIST, {
    recursive: true,
    // wrangler 로컬 캐시/상태는 산출물이 아니므로 복사하지 않는다.
    filter: (srcPath) => !srcPath.split(path.sep).includes('.wrangler'),
  });
}

// OBFUSCATE_OPTIONS를 해시에 섞어 넣어서, 옵션을 바꾸면 캐시가 자동으로
// 무효화되고(예전 옵션으로 만든 결과를 재사용하지 않고) 전체가 다시 난독화되게 한다.
const OPTIONS_FINGERPRINT = crypto
  .createHash('sha256')
  .update(JSON.stringify(OBFUSCATE_OPTIONS))
  .digest('hex')
  .slice(0, 16);

function cachePathFor(original) {
  const hash = crypto.createHash('sha256').update(original).update(OPTIONS_FINGERPRINT).digest('hex');
  return path.join(CACHE_DIR, `${hash}.js`);
}

function obfuscateJsDir(dir) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let hits = 0;
  let misses = 0;

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;

      const original = fs.readFileSync(full, 'utf8');
      const relPath = path.relative(DIST, full);
      const cachePath = cachePathFor(original);

      if (fs.existsSync(cachePath)) {
        fs.copyFileSync(cachePath, full);
        hits++;
        console.log(`  [cache] ${relPath}`);
        continue;
      }

      try {
        const obfuscated = JavaScriptObfuscator.obfuscate(original, OBFUSCATE_OPTIONS).getObfuscatedCode();
        fs.writeFileSync(full, obfuscated, 'utf8');
        fs.writeFileSync(cachePath, obfuscated, 'utf8');
        misses++;
        console.log(`  [ok] ${relPath}`);
      } catch (err) {
        // 난독화가 실패한 파일은 원본 그대로 둔다(사이트가 깨지는 것보다
        // 그 파일 하나가 안 꼬이는 게 낫다) — 대신 눈에 띄게 경고한다.
        console.warn(`  [skip] ${relPath}: ${err.message}`);
      }
    }
  }

  walk(dir);
  console.log(`[build] 난독화 캐시 적중 ${hits}개 / 신규 ${misses}개`);
}

console.log('[build] src/ -> dist/ 복사 중...');
copySrcToDist();

console.log('[build] dist/js 난독화 중...');
obfuscateJsDir(path.join(DIST, 'js'));

console.log('[build] 완료 -> dist/ (배포는 dist/에서: cd dist && npx wrangler deploy)');
