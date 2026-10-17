#!/usr/bin/env node
/**
 * 배포 산출물 빌드 스크립트: src/ → dist/
 *
 * - src/ 전체를 dist/로 그대로 복사한다(HTML, CSS, 데이터, wrangler.toml 등).
 *   저장소 루트의 offlineSrc/(로고·아이콘·파비콘)도 dist/offlineSrc/ 로 함께 복사한다.
 * - dist/js/**\/*.js 만 javascript-obfuscator로 난독화해서 덮어쓴다.
 *   실제 사이트는 Cloudflare Workers Assets가 이 디렉터리를 그대로 서빙하므로,
 *   여기 있는 파일이 곧 방문자가 다운로드하는 파일이다.
 * - src/_worker.js / worker/statsApi.js / worker/presenceDO.js 등 서버(Workers) 쪽 코드는
 *   난독화 대상이 아니다. Cloudflare 엣지에서만 실행되고 브라우저로는 절대
 *   내려가지 않으므로 애초에 노출 위험이 없고, 오히려 건드리면 Worker
 *   런타임 로직이 깨질 위험만 커진다.
 * - 개발은 계속 src/에서 한다(`cd src && python -m http.server`). 단 offlineSrc/
 *   는 src/ 밖에 있으므로 로고·아이콘까지 확인하려면 `npm run build -- --loose`
 *   후 dist/ 를 띄운다.
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
// 오리진에서 직접 서빙하는 로고·아이콘·파비콘. src/ 밖(저장소 루트)에 두고
// 빌드할 때 dist/offlineSrc/ 로 합쳐 넣는다 — 공개 URL은 /offlineSrc/... 이다.
const OFFLINE_SRC = path.join(ROOT, 'offlineSrc');
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
// 이름은 _0x3ab7 같은 16진수 대신 a, b, c 같은 짧은 이름(mangled)을 쓴다.
// 난독화기가 파일 최상위에 넣는 문자열 표 함수까지 a, b 가 되면 전역을
// 공유하는 다른 파일과 이름이 겹치므로, 파일마다 고유한 앞글자
// (identifiersPrefix, prefixMapFor 참고)를 obfuscateJsDir 에서 붙인다.
const OBFUSCATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: 'mangled',
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
  fs.cpSync(OFFLINE_SRC, path.join(DIST, 'offlineSrc'), { recursive: true });
}

// OBFUSCATE_OPTIONS를 해시에 섞어 넣어서, 옵션을 바꾸면 캐시가 자동으로
// 무효화되고(예전 옵션으로 만든 결과를 재사용하지 않고) 전체가 다시 난독화되게 한다.
const OPTIONS_FINGERPRINT = crypto
  .createHash('sha256')
  .update(JSON.stringify(OBFUSCATE_OPTIONS))
  .update(fs.readFileSync(path.join(ROOT, 'scripts', 'strip-js-comments.cjs')))
  .digest('hex')
  .slice(0, 16);

function cachePathFor(original, prefix) {
  const hash = crypto.createHash('sha256').update(original).update(OPTIONS_FINGERPRINT).update(prefix).digest('hex');
  return path.join(CACHE_DIR, `${hash}.js`);
}

function listJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

// 파일마다 3글자 앞글자(소문자 1 + 소문자·숫자 2)를 정한다. 경로 해시로 정하므로
// 파일을 추가·삭제해도 다른 파일의 앞글자(= 캐시)는 그대로다. 길이가 모두 같아서
// 서로 다른 앞글자로 만든 이름은 첫 세 글자부터 달라 절대 겹치지 않는다.
// 해시가 겹치면 정렬 순서상 뒤 파일이 소금(salt)을 바꿔 다시 뽑는다.
function prefixMapFor(relPaths) {
  const used = new Set();
  const map = new Map();
  for (const relPath of [...relPaths].sort()) {
    const key = relPath.split(path.sep).join('/');
    for (let salt = 0; ; salt++) {
      const digest = crypto.createHash('sha256').update(key + '#' + salt).digest();
      const prefix =
        String.fromCharCode(97 + (digest[0] % 26)) + (digest.readUInt16BE(1) % 1296).toString(36).padStart(2, '0');
      if (!used.has(prefix)) {
        used.add(prefix);
        map.set(relPath, prefix);
        break;
      }
    }
  }
  return map;
}

// 스크립트 최상위에 선언된 이름(function, var/let/const, class).
function topLevelNames(code) {
  const acornPath = require.resolve('acorn', { paths: [path.dirname(require.resolve('javascript-obfuscator'))] });
  const names = new Set();
  let ast;
  try {
    ast = require(acornPath).parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch (err) {
    return names; // 문법 오류 파일은 난독화 단계에서 이미 [skip] 으로 걸러진다.
  }
  for (const node of ast.body) {
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names.add(node.id.name);
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) if (decl.id.type === 'Identifier') names.add(decl.id.name);
    }
  }
  return names;
}

// 난독화기가 최상위에 새로 만든 이름이 다른 파일의 최상위 이름과 겹치면, 전역을
// 공유하는 <script> 들 사이에서 서로를 덮어써 사이트가 깨진다. 그런 이름을 돌려준다.
function findGlobalCollisions(processed) {
  const outputNames = new Map();
  for (const relPath of processed) {
    outputNames.set(relPath, topLevelNames(fs.readFileSync(path.join(DIST, relPath), 'utf8')));
  }
  const collisions = [];
  for (const relPath of processed) {
    const srcFile = path.join(SRC, relPath);
    const sourceNames = fs.existsSync(srcFile) ? topLevelNames(fs.readFileSync(srcFile, 'utf8')) : new Set();
    for (const name of outputNames.get(relPath)) {
      if (sourceNames.has(name)) continue; // 원래 있던 전역 이름은 그대로 둔다(renameGlobals: false)
      for (const [other, names] of outputNames) {
        if (other !== relPath && names.has(name)) collisions.push(`${name}: ${relPath} ↔ ${other}`);
      }
    }
  }
  return collisions;
}

function obfuscateJsDir(dir) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let hits = 0;
  let misses = 0;
  const skipped = [];
  const processed = [];
  const files = listJsFiles(dir);
  const prefixes = prefixMapFor(files.map((full) => path.relative(DIST, full)));

  for (const full of files) {
    const original = fs.readFileSync(full, 'utf8');
    const relPath = path.relative(DIST, full);
    const prefix = prefixes.get(relPath);
    processed.push(relPath);
    const cachePath = cachePathFor(original, prefix);

    if (fs.existsSync(cachePath)) {
      fs.copyFileSync(cachePath, full);
      hits++;
      console.log(`  [cache] ${relPath}`);
      continue;
    }

    try {
      // 난독화 후 남는 주석도 제거한다. 원본 src/의 개발용 주석은 보존한다.
      const options = Object.assign({}, OBFUSCATE_OPTIONS, { identifiersPrefix: prefix });
      const obfuscated = stripJsComments(JavaScriptObfuscator.obfuscate(original, options).getObfuscatedCode());
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

  console.log(`[build] 난독화 캐시 적중 ${hits}개 / 신규 ${misses}개`);

  // 전역 이름 충돌 검사. 겹치면 사이트가 깨지므로 LOOSE 여부와 무관하게 중단한다.
  const collisions = findGlobalCollisions(processed);
  if (collisions.length > 0) {
    console.error(`\n[build] 난독화가 만든 전역 이름이 다른 파일과 겹칩니다(${collisions.length}개):`);
    for (const line of collisions) console.error(`  - ${line}`);
    process.exit(1);
  }

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

console.log('[build] src/ + offlineSrc/ -> dist/ 복사 중...');
copySrcToDist();

console.log('[build] dist/js 난독화 중...');
obfuscateJsDir(path.join(DIST, 'js'));

console.log('[build] 완료 -> dist/ (배포: npx wrangler deploy --config dist/wrangler.toml)');
