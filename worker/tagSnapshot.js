// 유저 태그 투표 스냅샷. src/_worker.js 의 5분 Cron 과, 투표를 바꾼 직후의
// 관리 API(worker/adminApi.js)가 같은 함수를 쓴다.
//
// 5분마다(1분 Cron 중 분이 5의 배수일 때만) D1(TAGS_DB)의 유저 태그 투표를
// 게시글별로 집계해 R2에 정적 스냅샷으로 구워 둔다. 목록/필터 화면은 D1을
// 직접 조회하지 않고 이 스냅샷만 읽는다(gridPage.js) — 카드 하나 그릴 때마다
// D1 쿼리를 날리는 대신, 무거운 집계를 여기 한 번으로 몰아준다.
export async function recordTagSnapshot(env) {
  try {
    if (!env.TAGS_DB || !env.FAVORITES_BUCKET) return;
    var rows = await env.TAGS_DB.prepare(
      'SELECT post_id, tag_name, COUNT(*) AS votes FROM tag_votes GROUP BY post_id, tag_name'
    ).all();

    var posts = {};
    (rows.results || []).forEach(function (r) {
      var key = String(r.post_id);
      if (!posts[key]) posts[key] = [];
      posts[key].push({ tag: r.tag_name, votes: r.votes });
    });
    Object.keys(posts).forEach(function (key) {
      posts[key].sort(function (a, b) { return b.votes - a.votes; });
    });

    var snapshot = { generatedAt: Date.now(), posts: posts };
    await env.FAVORITES_BUCKET.put('tags/snapshot.json', JSON.stringify(snapshot), {
      httpMetadata: { contentType: 'application/json' }
    });
  } catch (e) {
    // 이번 집계를 걸러도 5분 뒤 다시 시도된다 — 조용히 넘어간다.
  }
}
