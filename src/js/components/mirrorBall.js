// 전체 화면 로더(loading.js)의 미러볼.
// eoeoe22/tsukuyomi 의 examples/미러볼 SVG 생성기.html 캔버스 렌더러를 옮겨 왔다.
// 반사 모델·타일 배치·줄눈 빛줄기 계산은 원본과 같고, 기본값도 빛줄기 세기(glint)
// 말고는 생성기 슬라이더의 기본값 그대로다. 생성기 UI(슬라이더·SVG 복사)는 빼고
// 렌더링만 남겼다.
//   MirrorBall.mount(canvas, opts) — 캔버스 CSS 크기에 맞춰 그리기 시작하고
//                                    { stop } 을 돌려준다
(function (global) {
  var REF = { amb: 0.30, glow: 1.15, pw: 1.4, njit: 1.2, rim: 0.5, side: [0.5, 0.6, 0.64] };
  var PERIOD = 40; // 1회전 초
  var S = 440, C = 220, R = 200; // 원본 생성기의 좌표계 — 실제 캔버스 크기로 배율만 바꾼다
  var POLE_LIMIT = 60;  // 이보다 극에 가까운 행으로는 진입하지 않음
  var LON_SPAN = 300;   // 줄눈 경로의 총 경도 이동 한계(극 주변을 여러 바퀴 맴돌지 않게)
  // 원본은 처음 한 번과 클릭할 때만 빛줄기를 쏘지만, 로딩 화면은 클릭할 일이
  // 거의 없으니 일정 간격으로 다시 쏜다.
  var BURST_MS = 1600;

  // glint 만 원본(0.1)보다 높였다 — 로딩 화면 크기(139px)에서는 원본 값의
  // 빛줄기가 거의 보이지 않았다.
  var DEFAULTS = {
    tilt: -32, step: 9.5, gap: 0.14, jit: 0.06, off: 1,
    pole: 0.3, poleR: 58, veil: 0.8, veilR: 0.36, haze: 0.47, bloom: 0.3,
    teal: 0.6, tjit: 0, sheen: 0.6,
    glint: 1, gcount: 6, gturn: 0.22, gspd: 2.5, ghold: 0.14, gacc: 0.08, gwhite: 0.74,
    tile: '#dfe4ea', grout: '#d3e3e9', dark: '#5a8696', light: '#eaf7ff', glowC: '#fff3f1',
    seed: 11
  };

  // 실루엣 림: 가장자리 10%가 밝은 청백으로 번진다 (r0.74R → R)
  var RIM_STOPS = [[0, 226, 240, 245, 0], [0.6, 226, 240, 245, 0.3], [0.9, 234, 246, 248, 0.8], [1, 238, 247, 249, 0.55]];
  var SHEEN_HI = [244, 251, 255];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rad(d) { return d * Math.PI / 180; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hxRGB(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function css(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  // 강도가 미리 곱해진 색(검정=무발광) — 가산 합성용
  function pm(c, a) { var k = Math.min(1, a); return 'rgb(' + (c[0] * k | 0) + ',' + (c[1] * k | 0) + ',' + (c[2] * k | 0) + ')'; }

  // 구면 좌표 → 시점 기울기(x축 회전) 적용 → 정사영
  function sys(tilt) { var T = rad(tilt); return { ct: Math.cos(T), st: Math.sin(T) }; }
  function V(lat, lon, s) {
    var la = rad(lat), lo = rad(lon);
    var x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    return [x, y * s.ct - z * s.st, y * s.st + z * s.ct];
  }
  function Pj(lat, lon, s) { var q = V(lat, lon, s); return [C + R * q[0], C - R * q[1]]; }

  // 타일 토폴로지 + 반사 요동 (난수 호출 순서는 원본과 동일: 행마다 폭 n개 → 오프셋 1개,
  // 요동·밝기 편차는 별도 난수열)
  function buildTiles(o) {
    var rnd = mulberry32(o.seed), rndR = mulberry32((o.seed ^ 0x85ebca6b) >>> 0), rndB = mulberry32((o.seed ^ 0x27d4eb2f) >>> 0);
    var tiles = [];
    var rows = Math.ceil(180 / o.step);
    for (var i = 0; i < rows; i++) {
      var lat = -90 + i * o.step, lat2 = Math.min(90, lat + o.step), mid = (lat + lat2) / 2;
      var n = Math.max(4, Math.round(360 * Math.cos(rad(mid)) / o.step));
      var ws = [], sum = 0, j;
      for (j = 0; j < n; j++) { var w = 1 + (rnd() * 2 - 1) * o.jit; ws.push(w); sum += w; }
      var lon = (rnd() * o.off) * (360 / n);
      for (j = 0; j < n; j++) {
        var tw = ws[j] * 360 / sum;
        tiles.push({
          lat: lat, lat2: lat2, mid: mid, lon0: lon, tw: tw,
          jLat: (rndR() * 2 - 1) * REF.njit, jLon: (rndR() * 2 - 1) * REF.njit,
          jB: rndB() * 2 - 1   // 타일별 반사 밝기 편차(상부 청회색 구간에만 적용)
        });
        lon += tw;
      }
    }
    return tiles;
  }

  // 반사 밝기 → 정면RGB·측면RGB (n: 시점계 법선, mid: 타일 위도, jB: 타일 밝기 편차)
  function lit(n, mid, o, jB) {
    var DR = o.rgb.dark, TR = o.rgb.tile, LR = o.rgb.light, GR = o.rgb.grout;
    var nz = Math.max(0, n[2]);
    var bb = (REF.amb + REF.glow * Math.pow(Math.max(0, -n[1]), REF.pw)) * (0.45 + 0.55 * nz);
    var pr = Math.max(0.001, rad(o.poleR));
    var pu = Math.max(0, 1 - rad(mid + 90) / pr); // 남극 각거리 (0=극점)
    var f = pu * pu * (3 - 2 * pu); // 원형 폴오프
    var b = bb + o.pole * f * 1.2;
    // 상부(b<1)는 은빛 타일: 그늘(dark) → tile. teal만큼 그늘 쪽으로 균일하게 쏠리고 tjit만큼
    // 타일별로 밝아지며, 가장자리로 갈수록 프레넬로 밝아진다(림).
    var A, B, u;
    if (b < 1) {
      var e = 1 - nz;
      u = clamp((Math.max(0, b) + REF.rim * e * e * e) * (1 - o.teal) + o.tjit * (jB + 1) * 0.5, 0, 1);
      A = DR; B = TR;
    } else {
      u = Math.min(1, b - 1);
      A = TR; B = LR;
    }
    var front = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u];
    // 타일 옆면(줄눈 쪽 경사면): 상부는 밝은 줄눈색, 빛 비침(b≥1) 쪽은 그늘로 이어진다.
    var w = clamp((1.2 - b) / 0.4, 0, 1), side = [];
    for (var i = 0; i < 3; i++) { var d = front[i] * REF.side[i]; side.push(d + (GR[i] - d) * w); }
    return { b: b, f: f, w: w, front: front, side: side };
  }

  // 은빛 질감(sheen): 타일 대각선으로 그늘 → 본색 → 하이라이트. null이면 단색.
  // 일부 타일(tjit에 비례)만 방향을 뒤집어 반짝임을 흩뜨린다. tjit 0이면 전부 같은 방향.
  function sheenSpec(t, fx, L, o) {
    if (!(L.w > 0 && o.sheen > 0)) return null;
    var flip = t.jB > 1 - 4 * o.tjit;
    var c = L.front, sw = L.w * o.sheen, hw = 0.5 * sw;
    var shade = [], hi = [];
    for (var i = 0; i < 3; i++) {
      shade.push(c[i] * (1 - 0.3 * sw));
      hi.push(c[i] + (SHEEN_HI[i] - c[i]) * hw);
    }
    return { p0: flip ? fx[1] : fx[0], p1: flip ? fx[3] : fx[2], stops: [[0, shade], [0.5, c], [1, hi]] };
  }

  // 하부 발광 베일: 남극(또는 하단 가장자리)에서 퍼지는 방사형 덮개.
  // 핵심부는 거의 불투명해 줄눈·하이라이트 선까지 덮고, 꼬리는 볼 전체에 옅은 안개로 남는다.
  function veilSpec(o) {
    var s = sys(o.tilt);
    var cy = C + R * (s.st < 0 ? s.ct : 1); // 남극이 보이면 그 투영점, 아니면 하단 가장자리
    var stops = [];
    for (var k = 0; k <= 16; k++) {
      var t = k / 16;
      var u = t / Math.max(0.02, o.veilR);
      var core = Math.exp(-2.2 * u * u);                 // 부드러운 가우시안 핵심부 (경계선 없음)
      var skirt = 0.35 * (1 - smooth(0, 1, u * 0.55));   // 핵심부 바깥으로 넓게 이어지는 자락
      var tail = o.haze * (1 - 0.5 * t);                 // 볼 전체 안개
      var a = 1 - (1 - o.veil * core) * (1 - o.veil * skirt) * (1 - tail);
      stops.push([t, Math.min(0.96, Math.max(0, a))]);
    }
    var c = hxRGB(o.glowC);
    return { cx: C, cy: cy, rg: R * 2.1, stops: stops, r: c[0], g: c[1], b: c[2], on: o.veil > 0 || o.haze > 0 };
  }

  // 위상 p → 빨강(0°)→노랑(60°)→초록(120°)→노랑→빨강 왕복, w 만큼 흰빛과 섞음
  function hsl2rgb(h, sat, l) {
    var a = sat * Math.min(l, 1 - l);
    function f(n) { var k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }
    return [f(0), f(8), f(4)];
  }
  function glintRGB(p, w) {
    var c = hsl2rgb(60 * (1 - Math.cos(2 * Math.PI * p)), 1, 0.55);
    return [255 * w + c[0] * (1 - w), 255 * w + c[1] * (1 - w), 255 * w + c[2] * (1 - w)];
  }

  // 이동 거리: 0.1× 저속으로 hold 초 대기 → acc 초 동안 0.1×→1× 로그스케일(지수) 가속 → 최대 속도 유지
  var SLOW = 0.1;
  function travel(st, age) {
    if (age <= 0) return 0;
    var v = st.spd, h = st.hold, a = st.acc;
    if (age < h) return v * SLOW * age;
    var d = v * SLOW * h, t = age - h;
    if (a > 0) {
      if (t < a) return d + v * SLOW * a / Math.LN10 * (Math.pow(10, t / a) - 1);
      d += v * (1 - SLOW) * a / Math.LN10; t -= a;
    }
    return d + v * t;
  }

  function pathCum(P) {
    var cum = [0];
    for (var j = 1; j < P.length; j++) {
      cum.push(cum[j - 1] + Math.abs(P[j][0] - P[j - 1][0]) + Math.abs(P[j][1] - P[j - 1][1]) * Math.cos(rad(P[j][0])));
    }
    return { P: P, cum: cum, total: cum[cum.length - 1] };
  }
  function pathAt(pt, sv) {
    var P = pt.P, cum = pt.cum, j = 0;
    while (j < cum.length - 2 && cum[j + 1] < sv) j++;
    var d = cum[j + 1] - cum[j], t = d > 0 ? Math.min(1, Math.max(0, (sv - cum[j]) / d)) : 0;
    return [P[j][0] + (P[j + 1][0] - P[j][0]) * t, P[j][1] + (P[j + 1][1] - P[j][1]) * t];
  }

  function mount(canvas, opts) {
    var o = {}, key;
    for (key in DEFAULTS) o[key] = DEFAULTS[key];
    if (opts) for (key in opts) if (opts[key] !== undefined) o[key] = opts[key];
    o.rgb = { dark: hxRGB(o.dark), tile: hxRGB(o.tile), light: hxRGB(o.light), grout: hxRGB(o.grout) };

    // 캔버스 CSS 크기 × dpr 로 실제 픽셀을 잡고, 그리기는 원본 440 좌표계 그대로 한다.
    var cssSize = canvas.clientWidth || 139;
    var dpr = global.devicePixelRatio || 1;
    var px = Math.max(1, Math.round(cssSize * dpr));
    var k = px / S; // 원본 좌표 1 당 캔버스 픽셀 — 변환 행렬을 안 타는 blur 길이에 곱한다
    function makeCtx(cv) {
      cv.width = px; cv.height = px;
      var ctx = cv.getContext('2d');
      ctx.setTransform(k, 0, 0, k, 0, 0);
      return ctx;
    }
    var mctx = makeCtx(canvas);
    var off = document.createElement('canvas'), og = makeCtx(off);
    var off2 = document.createElement('canvas'), og2 = makeCtx(off2);
    var off3 = document.createElement('canvas'), og3 = makeCtx(off3);

    var tiles = buildTiles(o);
    var rotDeg = 0, tNow = 0, streaks = [];
    var s = sys(o.tilt);

    // ---- 줄눈 빛줄기: 타일 사이 줄눈을 따라 흐르는 흰빛 위주의 빨강/초록 글린트 ----
    // 가로 빛줄기는 행 경계(위도선 줄눈)를 따라 경도 방향으로, 세로 빛줄기는 각 행의
    // 타일 경계를 이어 위도 방향으로 흐른다.
    var rowsInfo = (function () {
      var byLat = {}, list = [];
      tiles.forEach(function (t) {
        var r = byLat[t.lat];
        if (!r) { r = byLat[t.lat] = { lat: t.lat, lat2: t.lat2, edges: [] }; list.push(r); }
        r.edges.push(((t.lon0 % 360) + 360) % 360);
      });
      list.sort(function (a, b) { return a.lat - b.lat; });
      list.forEach(function (r) { r.edges.sort(function (a, b) { return a - b; }); });
      return list;
    })();

    function zv(la, lo) { return V(la, lo + rotDeg, s)[2]; }
    function rowOK(i) { var r = rowsInfo[i]; return !!r && Math.abs(r.lat) <= POLE_LIMIT && Math.abs(r.lat2) <= POLE_LIMIT; }
    // 행 i 에서 경도 L 을 포함하는 타일 {i, a, b} (a<=L<b, L 기준으로 언랩된 값)
    function tileAt(i, L) {
      var E = rowsInfo[i].edges, n = E.length, Ln = ((L % 360) + 360) % 360;
      var j = n - 1;
      for (var q = 0; q < n; q++) { if (E[q] <= Ln) j = q; else break; }
      var ta = E[j], tb = E[(j + 1) % n];
      if (tb <= ta) tb += 360;
      if (Ln < ta) { ta -= 360; tb -= 360; }
      var d = L - Ln;
      return { i: i, a: ta + d, b: tb + d };
    }
    // 중앙 타일 + 주변 6개(좌우 2, 위 행 2, 아래 행 2)
    function tileCluster(t) {
      var out = [t, tileAt(t.i, t.a - 0.01), tileAt(t.i, t.b + 0.01)];
      var m = (t.a + t.b) / 2;
      [t.i + 1, t.i - 1].forEach(function (r) {
        if (!rowOK(r)) return;
        var T = tileAt(r, m);
        out.push(T, m < (T.a + T.b) / 2 ? tileAt(r, T.a - 0.01) : tileAt(r, T.b + 0.01));
      });
      return out;
    }

    // ---- 줄눈 그래프 위 경로 ----
    // 가로 줄눈 = 행 경계 위도선 B_k(행 k-1 위, 행 k 아래), 세로 줄눈 = 각 행 안의 타일 경계.
    // 가로로 달리다 타일 경계와 만나는 교차점마다 확률적으로 위/아래로 꺾고,
    // 세로 줄눈은 한 행 높이에서 끝나므로 끝에서 반드시 좌/우로 꺾는다.
    // 직전 꺾기와 같은 쪽(좌→좌, 우→우)으로는 꺾지 않아 경로가 계단형으로만 진행하고 원을 그리며 돌아오지 않는다.
    function buildPath(st0) {
      var nR = rowsInfo.length, p = o.gturn;
      var la = st0.la, x = st0.x, st = st0, last = 0; // last: -1 좌회전, +1 우회전
      var P = [[la, x]], arc = 0, x0 = x;
      if (Math.abs(la) > POLE_LIMIT) return { P: P, cum: [0], total: 0 };
      for (var it = 0; it < 800; it++) {
        if (st.mode === 'v') {
          var row = rowsInfo[st.i];
          var nl = st.dv > 0 ? row.lat2 : row.lat;
          if (Math.abs(nl) > POLE_LIMIT) break;   // 극캡 진입 차단: 하부 극점 맴돎 방지
          arc += Math.abs(nl - la); la = nl; P.push([la, x]);
          if (zv(la, x) < -0.2) break;
          // 강제 꺾기: 북진 중 동쪽=우회전, 남진 중 동쪽=좌회전
          var side = last ? -last : (Math.random() < 0.5 ? -1 : 1);
          var east = st.dv > 0 ? side === 1 : side === -1;
          last = side;
          st = { mode: 'h', k: st.dv > 0 ? st.i + 1 : st.i, dh: east ? 1 : -1 };
        } else {
          if (Math.abs(la) > POLE_LIMIT) break;   // 극 위도선 위 주행 금지
          var kk = st.k, up = kk < nR ? rowsInfo[kk] : null, dn = kk >= 1 ? rowsInfo[kk - 1] : null;
          var best = 1e9, kind = 0, dh = st.dh;
          var scan = function (E, kd) {
            for (var q = 0; q < E.length; q++) {
              var dd = (((E[q] - x) * dh) % 360 + 360) % 360;
              if (dd < 1e-6) continue;
              if (dd < best - 1e-6) { best = dd; kind = kd; } else if (dd < best + 1e-6) kind |= kd;
            }
          };
          if (up) scan(up.edges, 1);
          if (dn) scan(dn.edges, 2);
          if (best > 360) break;
          x += dh * best; arc += best * Math.cos(rad(la)); P.push([la, x]);
          if (zv(la, x) < -0.2 || arc > 720 || Math.abs(x - x0) > LON_SPAN) break;
          if (Math.random() < p) {
            var c = []; // 동진 중 북쪽=좌회전
            if ((kind & 1) && rowOK(kk)) c.push({ side: dh > 0 ? -1 : 1, dv: 1, i: kk });
            if ((kind & 2) && rowOK(kk - 1)) c.push({ side: dh > 0 ? 1 : -1, dv: -1, i: kk - 1 });
            var ok = c.filter(function (q) { return q.side !== last; });
            if (ok.length) {
              var pick = ok[Math.floor(Math.random() * ok.length)];
              last = pick.side; st = { mode: 'v', i: pick.i, dv: pick.dv };
            }
          }
        }
      }
      return pathCum(P);
    }
    // 위아래행 경로: 자오선(세로 줄눈)을 따라 단조롭게 상승/하강.
    // 행 경계마다 다음 행의 가장 가까운 세로 줄눈으로 미세 스냅(수평 조그 최소)하고 계속 직진한다.
    function buildPathV(st0) {
      var la = st0.la, x = st0.x, i = st0.j;
      var dir = st0.dv > 0 ? 1 : -1;
      var P = [[la, x]], arc = 0, x0 = x;
      if (!rowsInfo[i] || Math.abs(la) > POLE_LIMIT) return { P: P, cum: [0], total: 0 };
      for (var it = 0; it < 40; it++) {
        if (!rowOK(i)) break;
        var row = rowsInfo[i];
        var bj = 0, found = false;
        for (var q = 0; q < row.edges.length; q++) {
          var d = ((row.edges[q] - x) % 360 + 360) % 360;
          if (d > 180) d -= 360;
          if (!found || Math.abs(d) < Math.abs(bj)) { bj = d; found = true; }
        }
        if (!found) break;
        if (Math.abs(bj) > 1e-6) {
          x += bj; arc += Math.abs(bj) * Math.cos(rad(la)); P.push([la, x]);
        }
        var nl = dir > 0 ? row.lat2 : row.lat;
        if (Math.abs(nl) > POLE_LIMIT) break;
        arc += Math.abs(nl - la); la = nl; P.push([la, x]);
        if (zv(la, x) < -0.2 || arc > 720 || Math.abs(x - x0) > LON_SPAN) break;
        i += dir;
      }
      return pathCum(P);
    }

    // 시야 안 무작위 지점의 타일을 중심으로, 그 타일과 주변 6개 타일의 모서리에서 빛줄기를 출발시킨다.
    // 경로는 좌우 대각선 : 위아래행 = 2 : 1. 초기 색상은 빨강 50% / 초록 50%, 빨강 중 절반은 가속 중간에 초록으로 바뀐다.
    function fireBurst() {
      if (!rowsInfo.length || o.glint <= 0) return;
      var dg = 180 / Math.PI, center = null;
      for (var tries = 0; tries < 30 && !center; tries++) {
        var X = Math.random() * 2 - 1, Y = Math.random() * 2 - 1, Z2 = 1 - X * X - Y * Y;
        if (Z2 < 0.25) continue; // 가장자리 너무 가까운 곳은 제외
        var Z = Math.sqrt(Z2);
        var y = Y * s.ct + Z * s.st, z = -Y * s.st + Z * s.ct;
        var lat = Math.asin(Math.max(-1, Math.min(1, y))) * dg;
        var ri = Math.floor((lat + 90) / o.step);
        if (!rowOK(ri) || !rowOK(ri + 1) || !rowOK(ri - 1)) continue;
        center = tileAt(ri, Math.atan2(X, z) * dg - rotDeg);
      }
      if (!center) return;
      var cl = tileCluster(center);
      for (var q = cl.length - 1; q > 0; q--) {
        var r = Math.floor(Math.random() * (q + 1)), tmp = cl[q];
        cl[q] = cl[r]; cl[r] = tmp;
      }
      for (var n = 0; n < o.gcount; n++) {
        var T = cl[n % cl.length], row = rowsInfo[T.i];
        var top = Math.random() < 0.5, left = Math.random() < 0.5;
        var la = top ? row.lat2 : row.lat, x = left ? T.a : T.b;
        var path;
        if (Math.random() < 1 / 3) {   // 위아래행: 좌우 대각선의 절반 확률
          var dir = Math.random() < 0.5 ? 1 : -1;
          var j = dir > 0 ? (top ? T.i + 1 : T.i) : (top ? T.i : T.i - 1);
          if (!rowOK(j)) continue;
          path = buildPathV({ la: la, x: x, j: j, dv: dir });
        } else {
          var rr = Math.random();
          path = buildPath(rr < 0.34
            ? { mode: 'v', i: T.i, dv: top ? -1 : 1, la: la, x: x }
            : { mode: 'h', k: top ? T.i + 1 : T.i, dh: rr < 0.67 ? 1 : -1, la: la, x: x });
        }
        if (path.total < 1) continue;
        var red0 = Math.random() < 0.5;
        streaks.push({
          path: path, spd: (300 + Math.random() * 160) * o.gspd, len: 32 + Math.random() * 30, hold: o.ghold, acc: o.gacc,
          t0: tNow + (n === 0 ? 0 : Math.random() * 0.08), k: 0.85 + Math.random() * 0.25,
          red0: red0, backG: red0 && Math.random() < 0.5
        });
      }
    }

    function updateStreaks(dt) {
      tNow += dt;
      streaks = streaks.filter(function (st) { return travel(st, tNow - st.t0) - st.len < st.path.total; });
    }

    // 화면 좌표 선분 목록: 강도가 미리 곱해진 색(검정=무발광)으로 가산 합성
    function streakGeom() {
      var w = o.gwhite;
      var gapPx = Math.max(0.6, o.gap * R * rad(o.step));
      var segs = [];
      streaks.forEach(function (st) {
        if (tNow < st.t0) return;
        var pt = st.path, sHead = travel(st, tNow - st.t0), sTail = sHead - st.len;
        var a = Math.max(0, sTail), b = Math.min(pt.total, sHead);
        if (b - a < 0.05) return;
        var sv = [a, b], v;
        for (v = a + 1; v < b; v += 1) sv.push(v);
        pt.cum.forEach(function (c) { if (c > a && c < b) sv.push(c); });
        sv.sort(function (p, q) { return p - q; });
        var env = o.glint * st.k; // 시간 페이드 없음: 경계(림) 밖으로 나가면서만 사라짐
        var P = sv.map(function (val) {
          var ll = pathAt(pt, val), q = V(ll[0], ll[1] + rotDeg, s);
          return [C + R * q[0], C - R * q[1], q[2], (val - sTail) / st.len];
        });
        var ageC = tNow - st.t0, midAcc = st.hold + st.acc * 0.5;
        var redNow = st.red0 && !(st.backG && ageC >= midAcc);
        for (var j = 1; j < P.length; j++) {
          var u = (P[j][3] + P[j - 1][3]) / 2;
          var z = (P[j][2] + P[j - 1][2]) / 2;
          var prof = Math.pow(u, 1.2) * Math.min(1, (1 - u) * 14 + 0.15); // 꼬리→머리로 밝아지고 끝만 짧게 마무리
          var al = env * prof * smooth(0.02, 0.3, z);
          if (al < 0.01) continue;
          var ph = (redNow ? 0 : 0.5) + u * 0.08 + Math.max(0, ageC) * 0.03;
          segs.push({ x0: P[j - 1][0], y0: P[j - 1][1], x1: P[j][0], y1: P[j][1], a: al, halo: glintRGB(ph, w * 0.7), core: glintRGB(ph, 1 - (1 - w) * 0.3) });
        }
      });
      return { segs: segs, hw: gapPx * 2.8 + 3, mw: gapPx * 1.1 + 0.6, cw: Math.max(0.7, gapPx * 0.42) };
    }

    function drawStreaks() {
      if (!streaks.length || o.glint <= 0) return;
      var G = streakGeom();
      if (!G.segs.length) return;
      function pass(ctx, width, key, mul) {
        ctx.lineWidth = width;
        G.segs.forEach(function (g) {
          ctx.strokeStyle = pm(g[key], g.a * mul);
          ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y1); ctx.stroke();
        });
      }
      // halo는 필터 없이 가산으로 모은 뒤 1회만 blur, 중간·핵심 선은 그 위에 선명하게
      og3.save(); og3.clearRect(0, 0, S, S); og3.lineCap = 'round'; og3.globalCompositeOperation = 'lighter';
      pass(og3, G.hw, 'halo', 0.9);
      og3.restore();
      mctx.save();
      mctx.beginPath(); mctx.arc(C, C, R, 0, Math.PI * 2); mctx.clip();
      mctx.globalCompositeOperation = 'lighter';
      mctx.filter = 'blur(' + (G.hw * 0.45 * k).toFixed(2) + 'px)';
      mctx.drawImage(off3, 0, 0, S, S);
      mctx.filter = 'none';
      mctx.lineCap = 'round';
      pass(mctx, G.mw, 'halo', 0.85);
      pass(mctx, G.cw, 'core', 1.15);
      mctx.restore();
    }

    function drawFrame() {
      var ctx = og; // 장면은 오프스크린에 그린 뒤 블룸 합성
      var K = 1 - o.gap;
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.fillStyle = o.grout; ctx.fill(); ctx.clip();
      var tops = [], bots = [], capQ = []; // capQ: 블룸 소스(표면 캡 타일만)
      tiles.forEach(function (t) {
        var midLon = t.lon0 + t.tw / 2 + rotDeg;
        if (V(t.mid, midLon, s)[2] <= 0) return;
        var lon0 = t.lon0 + rotDeg, lon1 = lon0 + t.tw;
        var pts = [Pj(t.lat, lon0, s), Pj(t.lat, lon1, s), Pj(t.lat2, lon1, s), Pj(t.lat2, lon0, s)];
        var cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
        var cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
        var fx = pts.map(function (q) { return [cx + (q[0] - cx) * K, cy + (q[1] - cy) * K]; });
        var L = lit(V(t.mid + t.jLat, midLon + t.jLon, s), t.mid, o, t.jB);
        var sh = sheenSpec(t, fx, L, o);

        ctx.beginPath();
        pts.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.closePath(); ctx.fillStyle = css(L.side); ctx.fill();
        ctx.beginPath();
        fx.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.closePath();
        var FS = css(L.front);
        if (sh) {
          var lg = ctx.createLinearGradient(sh.p0[0], sh.p0[1], sh.p1[0], sh.p1[1]);
          sh.stops.forEach(function (st) { lg.addColorStop(st[0], css(st[1])); });
          ctx.fillStyle = lg;
        } else ctx.fillStyle = FS;
        ctx.fill();
        tops.push([fx[3], fx[2]]); bots.push([fx[0], fx[1]]);
        if (L.f > 0.15) capQ.push([fx, FS]);
      });
      ctx.strokeStyle = 'rgba(222,244,248,0.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      tops.forEach(function (e) { ctx.moveTo(e[0][0], e[0][1]); ctx.lineTo(e[1][0], e[1][1]); });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath();
      bots.forEach(function (e) { ctx.moveTo(e[0][0], e[0][1]); ctx.lineTo(e[1][0], e[1][1]); });
      ctx.stroke();
      var rimG = ctx.createRadialGradient(C, C, R * 0.74, C, C, R);
      RIM_STOPS.forEach(function (r) { rimG.addColorStop(r[0], 'rgba(' + r[1] + ',' + r[2] + ',' + r[3] + ',' + r[4] + ')'); });
      ctx.fillStyle = rimG; ctx.fillRect(0, 0, S, S);
      var vs = veilSpec(o);
      if (vs.on) {
        var gr = ctx.createRadialGradient(vs.cx, vs.cy, 0, vs.cx, vs.cy, vs.rg);
        vs.stops.forEach(function (st) { gr.addColorStop(st[0], 'rgba(' + vs.r + ',' + vs.g + ',' + vs.b + ',' + st[1].toFixed(3) + ')'); });
        ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S);
      }
      ctx.restore();
      // 블룸 합성: 표면 캡 타일에서 나온 빛만 블러해 볼 경계 안쪽에 가산
      mctx.clearRect(0, 0, S, S);
      mctx.drawImage(off, 0, 0, S, S);
      if (o.bloom > 0 && capQ.length > 0) {
        og2.clearRect(0, 0, S, S);
        capQ.forEach(function (cq) {
          og2.beginPath();
          cq[0].forEach(function (p, i) { if (i) og2.lineTo(p[0], p[1]); else og2.moveTo(p[0], p[1]); });
          og2.closePath(); og2.fillStyle = cq[1]; og2.fill();
        });
        mctx.save();
        mctx.beginPath(); mctx.arc(C, C, R, 0, Math.PI * 2); mctx.clip();
        mctx.globalCompositeOperation = 'lighter';
        mctx.filter = 'blur(' + ((4 + o.bloom * 10) * k).toFixed(2) + 'px)';
        mctx.globalAlpha = o.bloom * 0.65;
        mctx.drawImage(off2, 0, 0, S, S);
        mctx.restore();
      }
      drawStreaks();
    }

    var reduceMotion = false;
    try { reduceMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    var rafId = 0, burstTimer = 0, stopped = false, last = performance.now();
    function loop(t) {
      var dt = Math.min(0.1, (t - last) / 1000); last = t;
      updateStreaks(dt);
      rotDeg = (rotDeg + dt * 360 / PERIOD) % 360;
      drawFrame();
      rafId = requestAnimationFrame(loop);
    }

    // 움직임 줄이기 설정이면 회전·빛줄기 없이 한 장만 그린다
    if (reduceMotion) {
      drawFrame();
    } else {
      fireBurst();
      burstTimer = setInterval(fireBurst, BURST_MS);
      rafId = requestAnimationFrame(loop);
    }

    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(rafId);
        clearInterval(burstTimer);
      }
    };
  }

  global.MirrorBall = { mount: mount };
})(window);
