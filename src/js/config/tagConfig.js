/**
 * 태그 이모지와 정렬 순서의 공통 설정.
 * 색상은 css/components/tags.css에서 data-tag별 CSS 변수로 관리한다
 * (이미지 없는 썸네일 표지의 색 --tag-glow-<태그> 도 같은 파일).
 */
(function (global) {

  var TAG_EMOJI = {
    '일상': '☀️',
    '소설': '📖',
    '장편': '📚',
    '로맨스': '💖',
    '슬픔': '💧',
    '코미디': '🤣',
    '피폐': '🩸',
    '후방주의': '🔞',
    '짧문': '✍️',
    '단편': '📄',
    '감동': '🥹',
    '명예관': '👑',
    '대회': '🏆',
    '로카': '🌸',
    '글카스': '🗃️'
  };

  var DEFAULT_EMOJI = '🏷️';

  // matches the classification order in .agent/rules/tag.md (분량 태그 →
  // 명예관/대회 → 장르 태그 순) so the filter list and card pills read in a
  // consistent, intentional order instead of alphabetically
  var TAG_ORDER = [
    '짧문', '소설', '장편', '단편',
    '명예관', '대회',
    '피폐', '슬픔', '감동', '로맨스', '후방주의', '코미디', '일상',
    '글카스', '이모티콘',
    '분류 안함', '로카'
  ];
  function tagOrderIndex(t) {
    var i = TAG_ORDER.indexOf(t);
    return i === -1 ? TAG_ORDER.length : i;
  }
  function sortTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.slice().sort(function (a, b) {
      var d = tagOrderIndex(a) - tagOrderIndex(b);
      return d !== 0 ? d : a.localeCompare(b, 'ko');
    });
  }

  // 작가 이름 일부 가리기 — 작가를 콕 집어 친목이 생기지 않도록, 화면에는
  // 닉네임 앞 두 글자(두 글자 이하면 한 글자)만 남기고 나머지는 *** 로
  // 가린다. 괄호 속 갤러리 아이디는 통째로 뺀다. 가린 글자 수를 짐작할 수
  // 없게 *** 는 이름 길이와 상관없이 늘 세 개다.
  //   "별바다를불태우리(flock4442)" → "별바***"
  function maskAuthor(author) {
    var name = String(author || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!name) return '';
    var chars = Array.from(name);
    return chars.slice(0, chars.length <= 2 ? 1 : 2).join('') + '***';
  }

  // 이미지가 없는 작품의 썸네일 자리를 책 표지처럼 채운다
  // (series-card.css .text-cover, 색은 tags.css 의 --tag-glow-<태그>).
  // 대표 태그 하나의 색을 옅게 깔고, 왼쪽에 책등 같은 색 띠, 오른쪽 위에
  // 대표 태그 이모지를 크게 흐리게 두고, 아래에 제목과 가린 작가 이름을
  // 올린다. 카드에 마우스를 올리면 그 색의 빛이 천천히 흐른다.
  // 대표 태그는 장르 태그에서 고른다 — 분량 태그(짧문/소설/장편/단편)와
  // 대회·명예관은 여러 작품에 똑같이 붙어 표지가 비슷해지므로 장르 태그가
  // 없을 때만 쓴다. 색이 정해진 태그(TAG_EMOJI 에 있는 태그)만 고른다 —
  // 유저 태그처럼 임의의 문자열은 CSS 변수 이름이 될 수 없다.
  //   info: { name, author, tags, text }  text:false 면 색·이모지만 깐다
  //         (상세 모달처럼 제목이 이미 그 위에 올라가는 자리)
  var COVER_FALLBACK_TAGS = ['짧문', '소설', '장편', '단편', '대회', '명예관'];

  // 대표 태그 순서대로 최대 n개 — 장르 태그를 먼저, 모자라면 분량·대회
  // 태그로 채운다. 상세 모달(postDetailSeries.js)이 배경 그라데이션 색 두
  // 개를 고를 때도 쓴다.
  function coverTags(tags, n) {
    var known = sortTags(tags).filter(function (t) {
      return Object.prototype.hasOwnProperty.call(TAG_EMOJI, t);
    });
    var genre = known.filter(function (t) { return COVER_FALLBACK_TAGS.indexOf(t) === -1; });
    var rest = known.filter(function (t) { return COVER_FALLBACK_TAGS.indexOf(t) !== -1; });
    return genre.concat(rest).slice(0, n || 1);
  }

  function coverTag(tags) {
    return coverTags(tags, 1)[0] || null;
  }

  function span(className, text) {
    var el = document.createElement('span');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    if (text) el.textContent = text;
    return el;
  }

  function applyTextCover(el, info) {
    if (!el) return;
    info = info || {};
    var tag = coverTag(info.tags);
    el.style.setProperty('--cover-color', tag ? glowValue(tag) : 'var(--tag-glow-default)');
    el.classList.add('text-cover');

    el.appendChild(span('text-cover-glow'));
    el.appendChild(span('text-cover-spine'));
    el.appendChild(span('text-cover-emoji', tag ? TAG_EMOJI[tag] : DEFAULT_EMOJI));
    if (info.text === false) return;

    var text = document.createElement('span');
    text.className = 'text-cover-text';
    text.setAttribute('aria-hidden', 'true'); // 제목은 카드 정보 영역에 이미 있다
    var title = document.createElement('span');
    title.className = 'text-cover-title';
    title.textContent = info.name || '';
    text.appendChild(title);
    var author = maskAuthor(info.author);
    if (author) {
      var authorEl = document.createElement('span');
      authorEl.className = 'text-cover-author';
      authorEl.textContent = author;
      text.appendChild(authorEl);
    }
    el.appendChild(text);
  }

  // ---- 관리 페이지의 태그 정의(worker/adminTagDefs.js) ----
  // cdnConfig.js 가 /tags/official 에서 받은 { tags, renames } 를 화면을 그리기 전에
  // 넘겨준다. tags 순서가 정렬 순서가 되고, 정의 이모지가 내장 이모지를 덮는다.
  // 색이 정해진 태그는 tags.css 와 같은 변수(--tag-bg 등)를 <style> 하나로 만들어
  // 덮어쓴다. 다른 스크립트가 TAG_ORDER·TAG_EMOJI 를 이미 잡아 두었을 수 있어서
  // 새 객체로 바꾸지 않고 제자리에서 고친다. BUILTIN 은 관리 화면의 초기값이다.
  var BUILTIN = { order: TAG_ORDER.slice(), emoji: Object.assign({}, TAG_EMOJI) };
  // tags.css 의 --tag-glow-<태그> 는 내장 TAG_EMOJI 의 태그와 같은 목록이다.
  var BUILTIN_GLOW = BUILTIN.emoji;
  var definedColors = {};
  var renames = {};
  var STYLE_ID = 'tag-defs-style';

  function hexRgb(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // 색을 흰색과 섞는다. amount 는 원래 색의 비율.
  function mixWhite(rgb, amount) {
    return '#' + rgb.map(function (c) {
      var v = Math.round(c * amount + 255 * (1 - amount));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }
  // 따옴표 속 속성값으로 넣는다. 태그 이름엔 제어 문자가 없으니(서버 검증) \ 와 " 만 막으면 된다.
  function cssString(text) {
    return '"' + String(text).replace(/["\\]/g, '\\$&') + '"';
  }

  function definitionCss(tags) {
    var out = [];
    (tags || []).forEach(function (t) {
      if (!t || !t.color) return;
      var rgb = hexRgb(t.color);
      var rgba = function (a) { return 'rgba(' + rgb.join(', ') + ', ' + a + ')'; };
      var sel = '[data-tag=' + cssString(t.name) + ']';
      out.push(sel + ' { --tag-bg: ' + mixWhite(rgb, 0.12) + '; }');
      out.push('[data-theme="dark"] ' + sel + ' { --tag-bg: ' + rgba(0.22) + '; --tag-text: ' +
        mixWhite(rgb, 0.45) + '; --tag-border: ' + rgba(0.35) + '; }');
    });
    return out.join('\n');
  }

  function glowColor(tag) {
    return Object.prototype.hasOwnProperty.call(definedColors, tag) ? definedColors[tag] : null;
  }

  // 표지·상세 모달·매거진 점 색처럼 "R, G, B" 를 받는 자리에 넣을 값. 정의 색이 있으면
  // 그 값, tags.css 에 --tag-glow-<태그> 가 있는 내장 태그면 그 변수, 나머지(정의만 있고
  // 색이 없는 새 태그)는 기본 색이다 — 없는 변수를 가리키면 선언 전체가 무효가 된다.
  function glowValue(tag) {
    var defined = glowColor(tag);
    if (defined) return defined;
    if (Object.prototype.hasOwnProperty.call(BUILTIN_GLOW, tag)) return 'var(--tag-glow-' + tag + ', var(--tag-glow-default))';
    return 'var(--tag-glow-default)';
  }

  function applyDefinitions(defs) {
    defs = defs || {};
    var tags = Array.isArray(defs.tags) ? defs.tags : null;
    if (tags) {
      TAG_ORDER.length = 0;
      Object.keys(TAG_EMOJI).forEach(function (k) { delete TAG_EMOJI[k]; });
      Object.assign(TAG_EMOJI, BUILTIN.emoji);
      definedColors = {};
      tags.forEach(function (t) {
        if (!t || !t.name) return;
        TAG_ORDER.push(t.name);
        if (t.emoji) TAG_EMOJI[t.name] = t.emoji;
        if (t.color) definedColors[t.name] = hexRgb(t.color).join(', ');
      });
      if (typeof document !== 'undefined' && document && document.head) {
        var style = document.getElementById(STYLE_ID);
        if (!style) {
          style = document.createElement('style');
          style.id = STYLE_ID;
          document.head.appendChild(style);
        }
        style.textContent = definitionCss(tags);
      }
    }
    renames = (defs.renames && typeof defs.renames === 'object') ? defs.renames : {};
    global.TagConfig.renames = renames;
  }

  global.TagConfig = {
    TAG_EMOJI: TAG_EMOJI,
    DEFAULT_EMOJI: DEFAULT_EMOJI,
    TAG_ORDER: TAG_ORDER,
    BUILTIN: BUILTIN,
    renames: renames,
    sortTags: sortTags,
    maskAuthor: maskAuthor,
    coverTags: coverTags,
    applyTextCover: applyTextCover,
    definitionCss: definitionCss,
    glowColor: glowColor,
    glowValue: glowValue,
    applyDefinitions: applyDefinitions
  };

  // cdnConfig.js 가 이 파일보다 먼저 정의를 받았으면 여기서 적용한다.
  if (global.__tagDefinitions) {
    applyDefinitions(global.__tagDefinitions);
    global.__tagDefinitions = null;
  }
})(window);
