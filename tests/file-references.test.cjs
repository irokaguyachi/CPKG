const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

// offlineSrc/ lives at the repo root and build.js merges it into the site root,
// so a site path under src/offlineSrc/ is actually served from root/offlineSrc/.
function servedFile(target) {
  const rel = path.relative(src, target);
  return rel.split(path.sep)[0] === 'offlineSrc' ? path.join(root, rel) : target;
}

test('HTML scripts and styles resolve to existing files', () => {
  const htmlFiles = [path.join(root, 'index.html'), path.join(src, 'index.html'),
    ...files(path.join(src, 'page')).filter(file => file.endsWith('.html'))];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
      const url = match[1];
      if (/^(?:https?:|data:|\/\/)/i.test(url)) continue;
      const target = url.startsWith('/')
        ? path.join(src, decodeURI(url.split(/[?#]/)[0]))
        : path.resolve(path.dirname(file), decodeURI(url.split(/[?#]/)[0]));
      assert.ok(fs.existsSync(servedFile(target)), `${path.relative(root, file)}: missing ${url}`);
    }
  }
});

test('browser JSON references and Worker imports resolve after organization', () => {
  for (const file of files(path.join(src, 'js')).filter(file => file.endsWith('.js'))) {
    const code = fs.readFileSync(file, 'utf8');
    // Browser fetch paths resolve against the HTML document, not the script folder.
    for (const match of code.matchAll(/["'](\.\.\/data\/[^"']+\.json)["']/g)) {
      const target = path.resolve(src, 'page', match[1]);
      assert.ok(fs.existsSync(target), `${path.relative(root, file)}: missing ${match[1]}`);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(target, 'utf8')));
    }
  }
  for (const file of [path.join(src, '_worker.js'), ...files(path.join(root, 'worker')).filter(file => file.endsWith('.js'))]) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${file}: missing ${match[1]}`);
    }
  }
});

test('main page keeps translation sections in the requested order', () => {
  const source = fs.readFileSync(path.join(src, 'js', 'pages', 'mainPage.js'), 'utf8');
  const recent = source.indexOf("'최근 등록 번역'");
  const randomNovel = source.indexOf("'랜덤 문학'");
  const randomTranslation = source.indexOf("'랜덤 번역'");
  const randomSeries = source.indexOf("'랜덤 시리즈'");
  assert.ok(recent >= 0, 'recent translation section is missing');
  assert.ok(randomNovel >= 0 && randomTranslation >= 0 && randomSeries >= 0, 'random translation sections are incomplete');
  assert.ok(randomNovel < randomTranslation && randomTranslation < randomSeries, 'random translation must sit between novel and series');
});

test('main page warns before recent translations and blurs only their photos', () => {
  const html = fs.readFileSync(path.join(src, 'page', 'mainPage.html'), 'utf8');
  const source = fs.readFileSync(path.join(src, 'js', 'pages', 'mainPage.js'), 'utf8');
  const warningCss = fs.readFileSync(path.join(src, 'css', 'components', 'translation-warning.css'), 'utf8');
  const cardCss = fs.readFileSync(path.join(src, 'css', 'components', 'series-card.css'), 'utf8');

  assert.match(html, /css\/components\/translation-warning\.css/);
  assert.match(source, /createTranslationWarning\(\)/);
  assert.match(source, /className: 'recent-translation'/);
  assert.match(source, /warning: true/);
  // 후방주의 모드가 꺼져 있을 때만 흐린다.
  assert.match(source, /blurPhoto: !global\.ContentSettings \|\| global\.ContentSettings\.isTranslationCensored\(\)/);
  assert.match(warningCss, /\.translation-warning-title/);
  assert.match(warningCss, /linear-gradient\(/);
  assert.match(cardCss, /\.post-row-image\.is-photo-blurred \.post-row-image-bg/);
  assert.match(cardCss, /filter:\s*blur\(12px\)/);
});

test('daily gift includes one daily literature and one daily translation', () => {
  const main = fs.readFileSync(path.join(src, 'js', 'pages', 'mainPage.js'), 'utf8');
  const dailyGift = fs.readFileSync(path.join(src, 'js', 'components', 'dailyGift.js'), 'utf8');
  assert.match(main, /secondaryDataUrl:\s*['"]\.\.\/data\/pageData\/Translation\.json['"]/);
  assert.match(main, /secondaryFavType:\s*['"]translation['"]/);
  assert.match(main, /renderCard:\s*function \(item, favType\)/);
  assert.match(dailyGift, /오늘의 랜덤 문학 \/ 번역!/);
  assert.match(dailyGift, /Promise\.all\(\[loadItems\(opts\.dataUrl\), loadItems\(opts\.secondaryDataUrl\)\]\)/);
  assert.match(dailyGift, /opts\.secondaryLabel \|\| t\('오늘의 번역'\)/);
});

test('literature page exposes the translation warning before its toolbar', () => {
  const html = fs.readFileSync(path.join(src, 'page', 'novelPage.html'), 'utf8');
  const tabs = html.indexOf('class="library-tabs"');
  const warning = html.indexOf('class="translation-warning"');
  const toolbar = html.indexOf('class="series-toolbar"');
  assert.ok(tabs >= 0 && tabs < warning, 'novel/translation tabs must sit above the warning');
  assert.ok(warning >= 0 && warning < toolbar, 'warning must appear above the search toolbar');
  assert.match(html, /data-source="novel"/);
  assert.match(html, /data-source="translation"/);
  assert.match(html, /⚠️\s*주의/);
  assert.match(html, /해당 페이지는 태그를 지원하지 않습니다\./);
  assert.match(html, /일부 선정적인 페이지가 노출될 수 있으므로 주의해주세요/);

  const css = fs.readFileSync(path.join(src, 'css', 'components', 'translation-warning.css'), 'utf8');
  assert.match(css, /linear-gradient\(/);
  assert.match(css, /\[data-theme="dark"\] \.translation-warning/);
});

test('translation tab gates everything below the warning until scrolling', () => {
  const css = fs.readFileSync(path.join(src, 'css', 'pages', 'library-page.css'), 'utf8');
  assert.match(css, /\.is-content-gated \.series-toolbar/);
  assert.match(css, /\.is-content-gated \.series-grid/);
  assert.match(css, /\.is-content-gated \.site-footer/);
  assert.match(css, /filter:\s*blur\(12px\)/);

  const script = fs.readFileSync(path.join(src, 'js', 'pages', 'novelPage.js'), 'utf8');
  assert.match(script, /remove\('is-content-gated'\)/);
  assert.match(script, /addEventListener\('scroll',\s*revealOnScroll/);
  assert.match(script, /userTagsOnly:\s*true/);
});

test('old translation address redirects to the literature page translation tab', () => {
  const worker = fs.readFileSync(path.join(src, '_worker.js'), 'utf8');
  assert.match(worker, /'\/translation':\s*'\/novel\?tab=translation'/);
  assert.doesNotMatch(worker, /translation:\s*'translationPage\.html'/);
  assert.ok(!fs.existsSync(path.join(src, 'page', 'translationPage.html')), 'merged translation page must not come back');
});
