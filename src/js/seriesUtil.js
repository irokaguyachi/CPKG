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

  // 사이트 자체 게시물 번호(N1/S1/H1/O1) — 오래된 글이 1번, 최신 글이 마지막
  // 번호입니다. DC 게시물 번호가 곧 작성 순서라 그걸 오름차순으로 정렬해서
  // 매깁니다. 파일 순서(최신순)대로 매기면 새 글이 크롤링될 때마다 기존 번호가
  // 통째로 한 칸씩 밀리는데, 이렇게 하면 새 글이 항상 마지막 번호를 받아서
  // 이미 공유된 번호가 그대로 유지됩니다.
  // ※ 표시 순서와는 무관합니다. 카드가 놓이는 순서는 각 페이지가 정합니다.
  function assignPostNumbers(items, prefix) {
    var posts = [];
    (items || []).forEach(function (s) {
      (s && s.posts ? s.posts : []).forEach(function (p) { posts.push(p); });
    });
    posts.sort(function (a, b) { return a.id - b.id; });
    posts.forEach(function (p, i) { p.customNo = prefix + (i + 1); });
  }

  function oldestPostId(s) {
    var posts = (s && s.posts) || [];
    return posts.reduce(function (min, p) { return p.id < min ? p.id : min; }, Infinity);
  }

  // 시리즈 자체 번호(카드에 보이는 "화 | S11" 의 S11) — 화 하나짜리 post
  // 번호와는 별개로, 시리즈(자식이 2개 이상인 항목)만 골라 가장 오래된
  // 화를 기준으로 오름차순 정렬해 매깁니다.
  function assignSeriesNumbers(items, prefix) {
    var series = (items || []).filter(isSeries);
    series.sort(function (a, b) { return oldestPostId(a) - oldestPostId(b); });
    series.forEach(function (s, i) { s.seriesNo = prefix + (i + 1); });
  }

  // 카드에 표시할 번호: 시리즈는 시리즈 번호, 단독 글은 그 글의 게시물
  // 번호(assignPostNumbers 로 매겨진 값)를 씁니다.
  function itemNumber(s) {
    if (isSeries(s)) return (s && s.seriesNo) || '';
    var post = s && s.posts && s.posts[0];
    return (post && post.customNo) || '';
  }

  global.SeriesUtil = {
    postCount: postCount,
    isSeries: isSeries,
    countLine: countLine,
    assignPostNumbers: assignPostNumbers,
    assignSeriesNumbers: assignSeriesNumbers,
    itemNumber: itemNumber
  };
})(window);
