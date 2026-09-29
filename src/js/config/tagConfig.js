/**
 * 태그 이모지와 정렬 순서의 공통 설정.
 * 색상은 css/components/tags.css에서 data-tag별 CSS 변수로 관리한다
 * (이미지 없는 썸네일의 그라데이션 색 --tag-glow-<태그> 도 같은 파일).
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

  // 이미지가 없는 작품의 썸네일 자리에 태그 색 그라데이션을 깐다
  // (series-card.css .is-tag-glow, 색은 tags.css 의 --tag-glow-<태그>).
  // 분량 태그(짧문/소설/장편/단편)는 거의 모든 작품에 붙어 색이 한쪽으로
  // 쏠리므로 장르 태그를 먼저 쓰고, 색이 정해진 태그(TAG_EMOJI 에 있는
  // 태그)만 고른다 — 유저 태그처럼 임의의 문자열은 CSS 변수 이름이 될 수
  // 없다. 태그가 하나도 없으면 기본 색으로 채운다.
  var LENGTH_TAGS = ['짧문', '소설', '장편', '단편'];
  var GLOW_SLOTS = 3;

  function applyTagGlow(el, tags) {
    if (!el) return;
    var known = sortTags(tags).filter(function (t) {
      return Object.prototype.hasOwnProperty.call(TAG_EMOJI, t);
    });
    var picks = known.filter(function (t) { return LENGTH_TAGS.indexOf(t) === -1; })
      .concat(known.filter(function (t) { return LENGTH_TAGS.indexOf(t) !== -1; }))
      .slice(0, GLOW_SLOTS);
    for (var i = 0; i < GLOW_SLOTS; i++) {
      var tag = picks.length ? picks[i % picks.length] : null;
      el.style.setProperty('--glow-' + (i + 1),
        tag ? 'var(--tag-glow-' + tag + ', var(--tag-glow-default))' : 'var(--tag-glow-default)');
    }
    el.classList.add('is-tag-glow');
  }

  global.TagConfig = {
    TAG_EMOJI: TAG_EMOJI,
    DEFAULT_EMOJI: DEFAULT_EMOJI,
    TAG_ORDER: TAG_ORDER,
    sortTags: sortTags,
    applyTagGlow: applyTagGlow
  };
})(window);
