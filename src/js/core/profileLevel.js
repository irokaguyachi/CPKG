/**
 * ChoKaguya Profile Level (프로필 레벨 공식)
 * - xp = 본 문학*1 + 저장*2 + 투표*3 + 끌올*5. 레벨 L 의 시작 경험치는 5*L*(L-1), 상한은 없다.
 * - 서버(worker/profileStats.js)와 같은 식이다. 음수·숫자가 아닌 값은 0 으로 본다.
 */
(function (global) {
  var WEIGHTS = { viewed: 1, saved: 2, voted: 3, bumped: 5 };

  function count(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function xp(stats) {
    var s = stats || {};
    var total = 0;
    for (var key in WEIGHTS) total += count(s[key]) * WEIGHTS[key];
    return total;
  }

  function startOf(level) {
    return 5 * level * (level - 1);
  }

  function fromStats(stats) {
    var total = xp(stats);
    var level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * total) / 5)) / 2));
    // 부동소수점 오차로 한 칸 어긋나면 바로잡는다.
    while (startOf(level) > total) level--;
    while (startOf(level + 1) <= total) level++;
    return { level: level, xp: total, levelStart: startOf(level), nextStart: startOf(level + 1) };
  }

  global.ProfileLevel = { xp: xp, fromStats: fromStats };
})(window);
