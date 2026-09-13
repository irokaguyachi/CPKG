/**
 * 태그 이모지와 정렬 순서의 공통 설정.
 * 색상은 css/components/tags.css에서 data-tag별 CSS 변수로 관리한다.
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

  global.TagConfig = {
    TAG_EMOJI: TAG_EMOJI,
    DEFAULT_EMOJI: DEFAULT_EMOJI,
    TAG_ORDER: TAG_ORDER,
    sortTags: sortTags
  };
})(window);
