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
    el.style.setProperty('--cover-color',
      tag ? 'var(--tag-glow-' + tag + ', var(--tag-glow-default))' : 'var(--tag-glow-default)');
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

  global.TagConfig = {
    TAG_EMOJI: TAG_EMOJI,
    DEFAULT_EMOJI: DEFAULT_EMOJI,
    TAG_ORDER: TAG_ORDER,
    sortTags: sortTags,
    maskAuthor: maskAuthor,
    coverTags: coverTags,
    applyTextCover: applyTextCover
  };
})(window);
