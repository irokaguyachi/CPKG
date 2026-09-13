#!/usr/bin/env node
/**
 * 배포 산출물 빌드 스크립트: src/ → dist/
 *
 * - src/ 전체를 dist/로 그대로 복사한다(HTML, CSS, 데이터, wrangler.toml 등).
 * - dist/js/**\/*.js 만 javascript-obfuscator로 난독화해서 덮어쓴다.
 *   실제 사이트는 Cloudflare Workers Assets가 이 디렉터리를 그대로 서빙하므로,
 *   여기 있는 파일이 곧 방문자가 다운로드하는 파일이다.
 * - src/_worker.js / worker/statsApi.js / worker/presenceDO.js 등 서버(Workers) 쪽 코드는
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
 *   npm run build             # dist/ 생성. 난독화 안 된 JS가 남으면 빌드 실패(exit 1).
 *   npm run build -- --loose  # 위 안전장치를 끄고(경고만) 산출물만 확인.
 *   npm run deploy            # 빌드 후 wrangler deploy --config dist/wrangler.toml
 *
 * Cloudflare Workers Builds(깃 푸시 자동 배포)도 이 스크립트를 거치게 하려면
 * 대시보드의 Build 명령을 `npm run build`, Deploy 명령을
 * `npx wrangler deploy --config dist/wrangler.toml`(dev 워커는 뒤에 `--env dev`)
 * 로 두고 Root directory 를 저장소 루트로 맞춘다. 그러면 배포되는 자산은 항상
 * 난독화된 dist/ 가 되고, 난독화가 깨지면 빌드가 실패해 원본이 새어 나가지 않는다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { stripJsComments } = require('./scripts/strip-js-comments.cjs');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CACHE_DIR = path.join(ROOT, '.build-cache', 'js');

// 이 스크립트의 존재 이유는 "원본 JS가 그대로 배포되면 안 된다" 하나다. 그래서
// 기본 동작을 fail-closed 로 둔다: 난독화에 실패했거나 결과가 원본과 똑같은
// 파일이 하나라도 있으면 빌드를 exit 1 로 끝낸다(Cloudflare Workers Builds 도
// 그 시점에 배포를 멈춘다). 로컬에서 산출물만 눈으로 확인하고 싶을 때는
// `node build.js --loose` 로 경고만 남기고 계속 진행한다.
const LOOSE = process.argv.includes('--loose');

// 변수/함수명을 완전히 꼬아서 읽기 어렵게 만드는 게 목적.
// selfDefending / deadCodeInjection은 일부러 껐다 — 이 두 옵션은 실행 중
// 코드 변형(포맷팅, 콘솔에서 코드 복사 등)에 스스로 반응해 멈추거나
// 파일만 키우는 방식이라, 개인 갤러리 사이트 규모에서는 "사이트가 이상하게
// 동작할 위험"이 "코드 읽기 어려움 조금 더 얻는 이득"보다 크다고 판단.
const OBFUSCATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal',
  // 파일마다 독립적으로 난독화한다. 이 프로젝트의 js 파일들은 <script defer>로
  // 각자 로드되어 전역(window) 스코프를 공유하는 구조라, 최상위(전역) 식별자
  // 이름까지 바꾸면 다른 파일에서 그 이름을 부르는 부분이 깨진다. 기본값인
  // false를 유지해 최상위 선언은 그대로 두고, 함수 내부 지역 변수만 꼬은다.
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: [],
  stringArrayThreshold: 0.5,
  splitStrings: false,
  numbersToExpressions: false,
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
  .update(fs.readFileSync(path.join(ROOT, 'scripts', 'strip-js-comments.cjs')))
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
  const skipped = [];
  const processed = [];

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
      processed.push(relPath);
      const cachePath = cachePathFor(original);

      if (fs.existsSync(cachePath)) {
        fs.copyFileSync(cachePath, full);
        hits++;
        console.log(`  [cache] ${relPath}`);
        continue;
      }

      try {
        // 난독화 후 남는 주석도 제거한다. 원본 src/의 개발용 주석은 보존한다.
        const obfuscated = stripJsComments(
          JavaScriptObfuscator.obfuscate(original, OBFUSCATE_OPTIONS).getObfuscatedCode()
        );
        fs.writeFileSync(full, obfuscated, 'utf8');
        fs.writeFileSync(cachePath, obfuscated, 'utf8');
        misses++;
        console.log(`  [ok] ${relPath}`);
      } catch (err) {
        // 난독화에 실패한 파일. LOOSE 모드에서는 원본을 그대로 두고 경고만
        // 남기지만, 기본 빌드에서는 아래 최종 검사에서 빌드를 중단시킨다.
        skipped.push(relPath);
        console.warn(`  [skip] ${relPath}: ${err.message}`);
      }
    }
  }

  walk(dir);
  console.log(`[build] 난독화 캐시 적중 ${hits}개 / 신규 ${misses}개`);

  // 최종 검사: dist/js 의 각 파일이 정말로 원본(src/js)과 달라졌는가.
  // 난독화가 조용히 실패했거나(skipped), 캐시가 손상돼 원본이 그대로 남은
  // 경우를 여기서 한 번 더 걸러 낸다.
  const unchanged = processed.filter((relPath) => {
    const srcFile = path.join(SRC, relPath);
    if (!fs.existsSync(srcFile)) return false;
    return fs.readFileSync(path.join(DIST, relPath), 'utf8') === fs.readFileSync(srcFile, 'utf8');
  });

  const leaked = [...new Set([...skipped, ...unchanged])];
  if (leaked.length === 0) return;

  console.error(`\n[build] 난독화되지 않은 JS ${leaked.length}개가 dist/ 에 남아 있습니다:`);
  for (const relPath of leaked) console.error(`  - ${relPath}`);

  if (LOOSE) {
    console.error('[build] --loose 모드이므로 계속 진행합니다. 이 산출물은 배포하지 마십시오.');
    return;
  }
  console.error(
    '[build] 원본 JS가 그대로 배포되는 것을 막기 위해 빌드를 중단합니다.\n' +
      '        해당 파일의 문법 오류를 고치거나, 원인을 파악하기 전까지는\n' +
      '        `node build.js --loose` 로만 빌드하십시오.'
  );
  process.exit(1);
}

console.log('[build] src/ -> dist/ 복사 중...');
copySrcToDist();

console.log('[build] dist/js 난독화 중...');
obfuscateJsDir(path.join(DIST, 'js'));

console.log('[build] 완료 -> dist/ (배포: npx wrangler deploy --config dist/wrangler.toml)');
