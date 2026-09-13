/**
 * ChoKaguya Series Util
 * - 시리즈 판별의 유일한 기준: 자식 게시물(posts)이 2개 이상이면 시리즈.
 *   예전에는 데이터에 episodeCount 를 따로 적어 뒀지만, posts 길이와 항상
 *   같은 값이라 어긋날 여지만 있어서 필드를 없애고 여기서 계산합니다.
 * - Series / HOF / Official / Novel / 즐겨찾기 페이지가 모두 이 규칙을 씁니다.
 */
(function (global) {
  function postCount(s) {
    return (s && s.posts ? s.posts.length : 0);
  }

  function isSeries(s) {
    return postCount(s) > 1;
  }

  // 카드 한 줄 요약: 시리즈면 화수, 단독 글이면 크롤링된 글자 수
  function countLine(s) {
    if (isSeries(s)) return postCount(s) + '화';
    return (s && s.charCount) || (postCount(s) + '화');
  }

  global.SeriesUtil = {
    postCount: postCount,
    isSeries: isSeries,
    countLine: countLine
  };
})(window);
