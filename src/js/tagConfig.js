/**
 * ChoKaguya Tag Presentation Config
 * - 태그 색상/이모지/정렬 순서의 단일 소스. gridPage.js(문학·시리즈·명예관·공식)와
 *   mainPage.js가 각자 따로 들고 있던 두 벌의 TAG_COLORS/TAG_EMOJI가 실제로
 *   어긋나 있었다 — 같은 태그가 페이지마다 다른 이모지로 보이고, `대회`/
 *   `IF 스토리`/`로카`는 gridPage 쪽 테이블에 아예 없어서 회색 기본 색으로
 *   떨어지고 있었다. 여기 하나로 합쳐서 두 파일이 이걸 가져다 쓴다.
 * - 색상은 두 파일이 이미 겹치는 태그 전부에서 완전히 같은 값을 쓰고 있었다
 *   (충돌 없음, 그냥 합집합). 이모지는 9개 태그에서 실제로 달랐는데, mainPage.js
 *   쪽이 가장 최근(카드 UI 전면 재구현 커밋)에 다시 만들어진 값이라 그걸 기준으로
 *   삼았다.
 * - 정렬은 gridPage.js의 TAG_ORDER 방식을 그대로 가져왔다. `.agent/rules/tag.md`
 *   분류 순서(분량 태그 → 명예관/대회 → 장르 태그)를 명시적으로 따르도록 전체
 *   태그를 다 나열해둔 쪽이라, 일부만 우선순위로 두고 나머지는 가나다순으로
 *   떨어뜨리던 mainPage.js의 TAG_PRIORITY보다 더 완전하다. 이 순서 목록에는
 *   이미 IF 스토리/로카가 들어 있었다 — 색상/이모지 테이블만 안 채워져 있었다.
 */
(function (global) {
  var TAG_COLORS = {
    '일상': '#e2f4f2',
    '소설': '#f3ebe4',
    '장편': '#e6f4df',
    '로맨스': '#fae4ec',
    '슬픔': '#e8ecf8',
    '코미디': '#faf1d2',
    '피폐': '#fae4e4',
    '후방주의': '#fae4e4',
    '짧문': '#f5e4f2',
    '단편': '#eee4fb',
    '감동': '#fbf0df',
    '명예관': '#faeed4',
    '대회': '#e4eefb',
    'IF 스토리': '#fbebe4',
    '로카': '#fde2e4',
    '미스테리': '#ece8f7',
    'SF': '#e0f1f6',
    '글카스': '#ebecee'
  };

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
    'IF 스토리': '🔮',
    '로카': '🌸',
    '글카스': '🗃️'
  };

  var DEFAULT_TAG_COLOR = '#efefef';
  var DEFAULT_EMOJI = '🏷️';

  // matches the classification order in .agent/rules/tag.md (분량 태그 →
  // 명예관/대회 → 장르 태그 순) so the filter list and card pills read in a
  // consistent, intentional order instead of alphabetically
  var TAG_ORDER = [
    '짧문', '소설', '장편', '단편',
    '명예관', '대회',
    '피폐', '슬픔', '감동', '로맨스', '후방주의', '코미디', '일상', '미스테리', 'SF',
    '글카스', '이모티콘', 'IF 스토리',
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

  global.TagConfig = {
    TAG_COLORS: TAG_COLORS,
    TAG_EMOJI: TAG_EMOJI,
    DEFAULT_TAG_COLOR: DEFAULT_TAG_COLOR,
    DEFAULT_EMOJI: DEFAULT_EMOJI,
    TAG_ORDER: TAG_ORDER,
    sortTags: sortTags
  };
})(window);
