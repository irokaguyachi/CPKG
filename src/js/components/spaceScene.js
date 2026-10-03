(function () {
  'use strict';
  // .site-footer 바로 아래에 붙는 우주 배경 이스터에그. claude.dev 푸터 장면에서
  // 아이디어만 빌려 새로 짰다 — 캔버스 하나에 GRID 간격 격자로 점을 찍어서
  // 달·고리 행성·별가루를 점 크기 디더링으로 그린다. 이 정적인 층은 화면 밖
  // 캔버스(staticCanvas)에 한 번 그려 두고, 매 프레임에는 반짝이는 별과 유성만
  // 그 위에 다시 그린다. 가운데에는 우주복 카구야(.space-scene-actor)가 떠
  // 있다가 마우스가 장면 위에 올라오면 천천히 따라온다. 카구야를 15번 연달아
  // 누르면 미니게임(spaceGame.js)이 시작된다.
  var footer = document.querySelector('.site-footer');
  if (!footer) return;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var TAU = Math.PI * 2;
  var GRID = 9;
  var DOT_BIG = 0.27 * GRID;
  var DOT_SMALL = 0.15 * GRID;
  var ACTOR_SIZE = 112; // space-scene.css 의 .space-scene-actor 크기와 맞춘다
  var ACTOR_MAX_SPEED = 150; // px/s — 천천히 다가오도록 낮게 잡는다
  var ACTOR_KEEP = 70; // 커서와 이만큼 가까워지면 멈춘다 (커서를 가리지 않게)
  var ACTOR_BOB = 7; // 둥실거리는 위아래 진폭(px)
  var ACTOR_GAME_SPEED = 380; // 미니게임 중에는 커서를 바짝 따라붙는다
  var GAME_CLICKS = 15; // 카구야를 이만큼 연달아 누르면 미니게임 시작
  var GAME_CLICK_GAP = 1500; // 클릭 사이가 이보다 벌어지면(ms) 다시 처음부터 센다
  var KIND_DUST = 1;
  var KIND_BODY = 2;
  var TRAIL = 11;
  var MAX_METEORS = 40;
  var SEED = (Math.random() * 0x7fffffff) | 0;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var scene = document.createElement('div');
  scene.className = 'space-scene';
  // 장면은 꾸밈이라 화면 낭독기에서 감추되, 안에 붙는 랭킹 순위표(spaceRanking.js)는 읽히게 둔다
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'space-scene-canvas';
  // actor 는 위치(translate), actorBody 는 좌우 반전·기울기, actorSprite 는 4프레임
  // 스프라이트 애니메이션(CSS)을 맡는다 — 변환을 한 요소에 몰면 서로 덮어쓴다.
  var actor = document.createElement('div');
  actor.className = 'space-scene-actor';
  actor.setAttribute('aria-hidden', 'true');
  var actorBody = document.createElement('div');
  actorBody.className = 'space-scene-actor-body';
  var actorSprite = document.createElement('div');
  actorSprite.className = 'space-scene-actor-sprite';
  actorBody.appendChild(actorSprite);
  actor.appendChild(actorBody);
  scene.appendChild(canvas);
  scene.appendChild(actor);
  footer.parentNode.insertBefore(scene, footer.nextSibling);

  var staticCanvas = document.createElement('canvas');
  var sctx = staticCanvas.getContext('2d');

  var W = 0;
  var H = 0;
  var dpr = 1;
  var G = null; // 장면 배치(달·행성·고리·캐릭터 위치와 격자 원점)
  var dots = [];
  var stars = [];
  var meteors = [];
  var pending = []; // 유성우처럼 시간차를 두고 나올 유성
  var colors = {};
  var progress = 0; // 스크롤로 장면이 드러난 정도 0..1
  var revealed = -1; // staticCanvas 를 마지막으로 그린 progress (양자화)
  var running = false;
  var rafId = 0;
  var lastT = 0;
  var nextSingle = 0;
  var nextShower = 0;
  var hero = null; // 카구야의 현재 위치·속도 {x, y, vx, vy, facingRight}
  var pointer = null; // 장면 위 마우스 위치, 장면 밖이면 null
  var heroClicks = 0;
  var lastHeroClick = 0;
  var game = null; // SpaceGame 인스턴스 (spaceGame.js 가 없거나 애니메이션 줄이기면 null)
  var ranking = null; // SpaceRanking 인스턴스 (게임이 있고 spaceRanking.js 가 있을 때만)

  // ---- 노이즈 -------------------------------------------------------------

  function hash(x, y, seed) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed ^ SEED, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function valueNoise(x, y, seed) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var fx = smooth(x - xi);
    var fy = smooth(y - yi);
    var a = hash(xi, yi, seed);
    var b = hash(xi + 1, yi, seed);
    var c = hash(xi, yi + 1, seed);
    var d = hash(xi + 1, yi + 1, seed);
    var top = a + (b - a) * fx;
    return top + (c + (d - c) * fx - top) * fy;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // ---- 배치 ---------------------------------------------------------------

  function layout() {
    var cols = Math.max(1, Math.floor(W / GRID));
    var rows = Math.max(1, Math.floor(H / GRID));
    var S = Math.min(W, H);
    var moonR = clamp(0.12 * S, 36, 84);
    var planetR = clamp(0.16 * S, 48, 110);
    var ringTilt = 0.32; // 약 18°, 오른쪽이 아래로 기운다
    var moon = { x: Math.max(0.14 * W, moonR * 1.4), y: 0.3 * H, r: moonR };
    return {
      cols: cols,
      rows: rows,
      ox: (W - (cols - 1) * GRID) / 2,
      oy: (H - (rows - 1) * GRID) / 2,
      moon: moon,
      // 오른쪽으로 비켜 둔 원을 빼서 초승달을 만든다 (C 자 모양)
      cut: { x: moon.x + 0.48 * moonR, y: moon.y - 0.12 * moonR, r: 0.9 * moonR },
      planet: { x: (W < 640 ? 0.74 : 0.8) * W, y: H - 0.7 * planetR, r: planetR },
      ring: { a: 1.85 * planetR, b: 0.34 * planetR, cos: Math.cos(ringTilt), sin: Math.sin(ringTilt) },
      home: { x: 0.5 * W, y: 0.56 * H } // 마우스가 없을 때 카구야가 돌아와 떠 있는 자리
    };
  }

  // 고리 좌표계: u 는 고리 장축 방향, v > 0 이 화면 쪽(행성 앞)으로 지나는 반쪽
  function ringCoords(x, y) {
    var dx = x - G.planet.x;
    var dy = y - G.planet.y;
    var u = G.ring.cos * dx + G.ring.sin * dy;
    var v = -G.ring.sin * dx + G.ring.cos * dy;
    return { u: u, v: v, f: Math.sqrt((u / G.ring.a) * (u / G.ring.a) + (v / G.ring.b) * (v / G.ring.b)) };
  }

  function ringDot(rc, i, j) {
    var tip = Math.abs(rc.u) / G.ring.a;
    if (tip > 0.9 && hash(i, j, 41) < ((tip - 0.9) / 0.1) * 0.9) return 0;
    return Math.abs(rc.f - 1) < 0.09 ? DOT_BIG : DOT_SMALL;
  }

  function inRing(rc) {
    return rc.f >= 0.82 && rc.f < 1.18;
  }

  // 앞쪽 고리 둘레의 행성 표면을 비워서 고리가 행성 위에 떠 보이게 한다
  function inRingGap(rc) {
    return rc.v > 0 && rc.f >= 0.62 && rc.f < 1.38;
  }

  function planetDot(x, y, i, j) {
    var p = G.planet;
    var nx = (x - p.x) / p.r;
    var ny = (y - p.y) / p.r;
    var nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    // 왼쪽 위에서 들어오는 빛
    var lit = Math.max(0, nx * -0.55 + ny * -0.6 + nz * 0.58);
    var rc = ringCoords(x, y);
    lit *= 0.8 + 0.2 * valueNoise(rc.v / (p.r * 0.16), 0.5, 23); // 고리와 나란한 줄무늬
    var v = lit + (hash(i, j, 29) - 0.5) * 0.3;
    if (v > 0.62) return DOT_BIG;
    if (v > 0.22) return DOT_SMALL;
    var dist = Math.sqrt((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y));
    return p.r - dist < GRID * 0.8 && hash(i, j, 31) < 0.5 ? DOT_SMALL : 0;
  }

  function moonDot(x, y, i, j, dist) {
    var c = G.cut;
    var dc = Math.sqrt((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y));
    if (dc < c.r) return 0; // 그늘진 쪽
    if (G.moon.r - dist < GRID * 1.1) return DOT_BIG; // 바깥 테두리
    var t = Math.min(1, (dc - c.r) / (0.35 * G.moon.r));
    var v = t + (hash(i, j, 17) - 0.5) * 0.35;
    return v > 0.62 ? DOT_BIG : v > 0.12 ? DOT_SMALL : 0;
  }

  // 천체 주변을 비울 때 가장자리가 딱 잘리지 않도록 확률로 흩뜨린다
  function fadeClear(t, i, j, seed) {
    return hash(i, j, seed) > smooth(t);
  }

  function dustDot(i, j) {
    var d =
      0.55 * valueNoise(i * 0.07, j * 0.07, 3) +
      0.25 * valueNoise(i * 0.16, j * 0.16, 5) +
      0.2 * valueNoise(i * 0.03, j * 0.18, 7); // 가로로 길게 늘어진 결
    var density = smooth((d - 0.56) / 0.22) * 0.85;
    if (hash(i, j, 11) < density) return DOT_SMALL * (0.55 + 0.6 * hash(i, j, 13));
    return hash(i, j, 15) > 0.985 ? 0.7 : 0;
  }

  function buildDots() {
    dots = [];
    var m = G.moon;
    var p = G.planet;
    for (var j = 0; j < G.rows; j++) {
      var y = G.oy + j * GRID;
      for (var i = 0; i < G.cols; i++) {
        var x = G.ox + i * GRID;
        var r = 0;
        var kind = KIND_BODY;
        var dp = Math.sqrt((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y));
        var dm = Math.sqrt((x - m.x) * (x - m.x) + (y - m.y) * (y - m.y));
        var rc = ringCoords(x, y);
        if (inRing(rc) && rc.v > 0) {
          r = ringDot(rc, i, j);
        } else if (dp < p.r) {
          if (inRingGap(rc)) continue;
          r = planetDot(x, y, i, j);
        } else if (inRing(rc)) {
          r = ringDot(rc, i, j);
        } else if (dm < m.r) {
          r = moonDot(x, y, i, j, dm);
        } else {
          if (dm < m.r * 1.6 && fadeClear((dm / m.r - 1) / 0.6, i, j, 51)) continue;
          if (dp < p.r * 1.35 && fadeClear((dp / p.r - 1) / 0.35, i, j, 53)) continue;
          if (rc.f > 0.55 && rc.f < 1.45 && fadeClear(Math.abs(rc.f - 1) / 0.45 - 0.5, i, j, 55)) continue;
          r = dustDot(i, j);
          kind = KIND_DUST;
        }
        if (r <= 0) continue;
        dots.push({
          x: x,
          y: y,
          r: r,
          kind: kind,
          // 아래쪽 점부터 드러나게 해서 스크롤하면 별이 차오르는 느낌을 준다
          key: kind === KIND_BODY ? 0.25 + hash(i, j, 61) * 0.35 : 0.5 * hash(i, j, 63) + 0.5 * (1 - y / H)
        });
      }
    }
  }

  function blocked(x, y) {
    var m = G.moon;
    var p = G.planet;
    if ((x - m.x) * (x - m.x) + (y - m.y) * (y - m.y) < (m.r + GRID) * (m.r + GRID)) return true;
    if ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < (p.r + GRID) * (p.r + GRID)) return true;
    var f = ringCoords(x, y).f;
    return f > 0.6 && f < 1.4;
  }

  function buildStars() {
    stars = [];
    var count = Math.min(160, Math.round((W * H) / 8000));
    for (var n = 0, tries = 0; n < count && tries < count * 10; tries++) {
      var x = G.ox + Math.floor(Math.random() * G.cols) * GRID;
      var y = G.oy + Math.floor(Math.random() * G.rows) * GRID;
      if (blocked(x, y)) continue;
      stars.push({
        x: x,
        y: y,
        r0: 0.5 + Math.random() * 0.5,
        phase: Math.random() * TAU,
        speed: 0.5 + Math.random() * 1.8,
        sparkle: Math.random() < 0.22, // 밝을 때 십자 모양으로 빛이 퍼지는 별
        key: Math.random()
      });
      n++;
    }
  }

  // ---- 그리기 -------------------------------------------------------------

  function readColors() {
    var cs = getComputedStyle(scene);
    colors.dot = cs.getPropertyValue('--space-dot').trim() || '#87867f';
    colors.body = cs.getPropertyValue('--space-body').trim() || '#b8b5aa';
    colors.star = cs.getPropertyValue('--space-star').trim() || '#ece8dc';
    colors.shot = cs.getPropertyValue('--space-shot').trim() || '#d6cfbf';
    colors.glow = cs.getPropertyValue('--space-glow').trim() || 'rgba(214, 207, 191, 0.07)';
    colors.danger = cs.getPropertyValue('--space-danger').trim() || '#ffb48a';
    colors.laser = cs.getPropertyValue('--space-laser').trim() || '#ff6b8b';
    colors.homer = cs.getPropertyValue('--space-homer').trim() || '#b49cff';
    colors.hole = cs.getPropertyValue('--space-hole').trim() || '#050506';
  }

  function drawGlow(x, y, radius) {
    var g = sctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, colors.glow);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sctx.fillStyle = g;
    sctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function fillDots(kind, color) {
    sctx.fillStyle = color;
    sctx.beginPath();
    for (var n = 0; n < dots.length; n++) {
      var d = dots[n];
      if (d.kind !== kind || d.key > revealed) continue;
      sctx.moveTo(d.x + d.r, d.y);
      sctx.arc(d.x, d.y, d.r, 0, TAU);
    }
    sctx.fill();
  }

  function drawStatic() {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (revealed <= 0) return;
    // 달과 행성은 은은한 빛무리를 두르고 별가루보다 밝은 색으로 그려서 늘 빛나 보이게 한다
    sctx.globalAlpha = smooth((revealed - 0.3) / 0.4);
    drawGlow(G.moon.x, G.moon.y, G.moon.r * 2);
    drawGlow(G.planet.x, G.planet.y, G.planet.r * 2.1);
    sctx.globalAlpha = 1;
    fillDots(KIND_DUST, colors.dot);
    fillDots(KIND_BODY, colors.body);
  }

  function drawStars(t) {
    ctx.fillStyle = colors.star;
    for (var n = 0; n < stars.length; n++) {
      var s = stars[n];
      if (s.key > revealed) continue;
      var b = reduceMotion ? 0.4 : 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      b = b * b * b; // 대부분 어둡다가 잠깐 반짝이도록
      ctx.globalAlpha = 0.3 + 0.7 * b;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r0 + (DOT_BIG * 1.1 - s.r0) * b, 0, TAU);
      ctx.fill();
      if (s.sparkle && b > 0.55) {
        var k = (b - 0.55) / 0.45;
        ctx.globalAlpha = 0.8 * k;
        ctx.beginPath();
        for (var arm = 1; arm <= 2; arm++) {
          var r = DOT_SMALL * k * (arm === 1 ? 1.1 : 0.6);
          var off = GRID * arm;
          ctx.moveTo(s.x + off + r, s.y);
          ctx.arc(s.x + off, s.y, r, 0, TAU);
          ctx.moveTo(s.x - off + r, s.y);
          ctx.arc(s.x - off, s.y, r, 0, TAU);
          ctx.moveTo(s.x + r, s.y + off);
          ctx.arc(s.x, s.y + off, r, 0, TAU);
          ctx.moveTo(s.x + r, s.y - off);
          ctx.arc(s.x, s.y - off, r, 0, TAU);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function snap(v, origin) {
    return origin + Math.round((v - origin) / GRID) * GRID;
  }

  function drawMeteors() {
    ctx.fillStyle = colors.shot;
    for (var n = 0; n < meteors.length; n++) {
      var m = meteors[n];
      var env = Math.min(1, m.age / (0.2 * m.life)) * Math.min(1, (m.life - m.age) / (0.45 * m.life));
      var hx = m.x + m.vx * m.age;
      var hy = m.y + m.vy * m.age;
      var speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy) || 1;
      var ux = m.vx / speed;
      var uy = m.vy / speed;
      var lastX = null;
      var lastY = null;
      for (var k = 0; k < TRAIL; k++) {
        // 꼬리 점도 격자에 맞춰서 별가루와 같은 도트 질감을 유지한다
        var x = snap(hx - ux * GRID * k, G.ox);
        var y = snap(hy - uy * GRID * k, G.oy);
        if (x === lastX && y === lastY) continue;
        lastX = x;
        lastY = y;
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        var r = (k === 0 ? DOT_BIG * 1.15 : DOT_SMALL * 1.25 * (1 - k / TRAIL)) * env;
        if (r < 0.35) continue;
        ctx.globalAlpha = env * (1 - (k / TRAIL) * 0.6);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- 유성 ---------------------------------------------------------------

  // (tx, ty) 를 수명 중간쯤에 지나가도록 출발점을 거꾸로 계산한다
  function launchThrough(tx, ty, angle, speed, life) {
    if (meteors.length >= MAX_METEORS) return;
    var vx = Math.cos(angle) * speed;
    var vy = Math.sin(angle) * speed;
    var back = life * 0.45;
    meteors.push({ x: tx - vx * back, y: ty - vy * back, vx: vx, vy: vy, age: 0, life: life });
  }

  // 오른쪽 위에서 왼쪽 아래로 떨어지는 방향(약 145°)이 기본, 가끔 좌우를 뒤집는다
  function meteorAngle(base, spread) {
    var deg = base + (Math.random() - 0.5) * 2 * spread;
    return (deg * Math.PI) / 180;
  }

  function spawnSingle() {
    var base = Math.random() < 0.7 ? 145 : 35;
    launchThrough(
      W * (0.15 + Math.random() * 0.7),
      H * (0.1 + Math.random() * 0.5),
      meteorAngle(base, 8),
      420 + Math.random() * 260,
      1.4 + Math.random() * 0.9
    );
  }

  function queueShower(t) {
    var base = Math.random() < 0.7 ? 145 : 35;
    var count = 4 + Math.floor(Math.random() * 4);
    var delay = 0;
    for (var n = 0; n < count; n++) {
      delay += 0.08 + Math.random() * 0.3;
      pending.push({ at: t + delay, base: base });
    }
  }

  function updateMeteors(t, dt) {
    if (revealed > 0.5) {
      if (!nextSingle) nextSingle = t + 1 + Math.random() * 2;
      if (!nextShower) nextShower = t + 6 + Math.random() * 8;
      if (t >= nextSingle) {
        spawnSingle();
        nextSingle = t + 1.2 + Math.random() * 2.6;
      }
      if (t >= nextShower) {
        queueShower(t);
        nextShower = t + 15 + Math.random() * 15;
      }
    }
    for (var p = pending.length - 1; p >= 0; p--) {
      if (pending[p].at > t) continue;
      launchThrough(
        W * (0.2 + Math.random() * 0.6),
        H * (0.1 + Math.random() * 0.45),
        meteorAngle(pending[p].base, 3), // 유성우는 한 방향에서 쏟아지게 각도를 좁힌다
        480 + Math.random() * 200,
        1.3 + Math.random() * 0.7
      );
      pending.splice(p, 1);
    }
    for (var n = meteors.length - 1; n >= 0; n--) {
      meteors[n].age += dt;
      if (meteors[n].age >= meteors[n].life) meteors.splice(n, 1);
    }
  }

  scene.addEventListener('click', function (e) {
    if (reduceMotion || !G) return;
    if (game && game.isActive()) return;
    var rect = scene.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    if (hero && game) {
      var hx = x - hero.x;
      var hy = y - hero.drawY;
      var reach = ACTOR_SIZE * 0.42;
      if (hx * hx + hy * hy < reach * reach) {
        countHeroClick();
        return;
      }
    }
    var speed = 400 + Math.random() * 220;
    if (Math.random() < 0.75) {
      // 화면 가장자리에서 날아와 클릭한 곳을 지나간다
      launchThrough(x, y, meteorAngle(Math.random() < 0.5 ? 145 : 35, 12), speed, 2.2);
    } else {
      // 클릭한 곳에서 튀어나간다
      if (meteors.length >= MAX_METEORS) return;
      var angle = meteorAngle(Math.random() < 0.5 ? 145 : 35, 12);
      meteors.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: 1.6 });
    }
    start();
  });

  // ---- 카구야 -------------------------------------------------------------

  // claude.dev 의 Clawd 처럼 커서 쪽으로 천천히 헤엄쳐 오고, 가까워지면 속도를
  // 줄여 커서 옆에 멈춘다. 커서가 장면을 벗어나면 제자리(G.home)로 돌아간다.
  function updateHero(t, dt) {
    var margin = ACTOR_SIZE / 2;
    var gaming = game && game.isActive();
    var target = pointer || G.home;
    var dx = target.x - hero.x;
    var dy = target.y - hero.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    // 미니게임 중에는 커서 바로 위까지 빠르게 따라붙어야 피할 수 있다
    var maxSpeed = gaming ? ACTOR_GAME_SPEED : ACTOR_MAX_SPEED;
    var keep = pointer && !gaming ? ACTOR_KEEP : 0;
    var want = dist > keep ? maxSpeed * smooth((dist - keep) / (gaming ? 120 : 220)) : 0;
    var tvx = dist > 0 ? (dx / dist) * want : 0;
    var tvy = dist > 0 ? (dy / dist) * want : 0;
    // 목표 속도로 바로 바꾸지 않고 서서히 맞춰서 물에 뜬 것처럼 관성 있게 움직인다
    var k = Math.min(1, dt * (gaming ? 6 : 1.8));
    hero.vx += (tvx - hero.vx) * k;
    hero.vy += (tvy - hero.vy) * k;
    // 미니게임의 블랙홀이 카구야를 끌어당긴다
    var pull = gaming ? game.pull({ x: hero.x, y: hero.drawY }) : null;
    hero.x = clamp(hero.x + (hero.vx + (pull ? pull.x : 0)) * dt, margin, W - margin);
    hero.y = clamp(hero.y + (hero.vy + (pull ? pull.y : 0)) * dt, margin, H - margin);
    // 원본 그림은 왼쪽을 본다 — 오른쪽으로 갈 때만 뒤집고, 작은 흔들림에는 반응하지 않게 문턱을 둔다
    if (hero.vx > 12) hero.facingRight = true;
    else if (hero.vx < -12) hero.facingRight = false;
    var bob = reduceMotion ? 0 : Math.sin(t * 1.3) * ACTOR_BOB;
    var tilt = reduceMotion ? 0 : clamp(hero.vy / maxSpeed, -1, 1) * 8 + Math.sin(t * 0.8) * 3;
    hero.drawY = hero.y + bob; // 클릭 판정과 미니게임 피격 판정은 실제로 그려진 위치를 쓴다
    actor.style.transform = 'translate(' + hero.x.toFixed(1) + 'px,' + hero.drawY.toFixed(1) + 'px)';
    actorBody.style.transform = 'scaleX(' + (hero.facingRight ? -1 : 1) + ') rotate(' + tilt.toFixed(2) + 'deg)';
  }

  var touchTimer = 0;

  function setPointer(e) {
    var rect = scene.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  scene.addEventListener('pointermove', function (e) {
    if (reduceMotion || e.pointerType !== 'mouse') return;
    setPointer(e);
  });

  // 미니게임 중에는 커서가 장면 밖으로 나가도 마지막 위치에 머무른다
  // (가장자리에서 피하다가 제자리로 끌려가면 억울하다)
  scene.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'mouse' && !(game && game.isActive())) pointer = null;
  });

  // 터치 화면에는 커서가 없으니 탭한 곳으로 헤엄쳐 갔다가 잠시 뒤 제자리로 돌아간다.
  // 미니게임 중에는 손가락을 끄는 대로 따라오고(.is-gaming 이 touch-action 을 막아
  // 페이지가 대신 스크롤되지 않는다), 손을 떼도 그 자리에 머무른다.
  scene.addEventListener('pointerdown', function (e) {
    if (reduceMotion || e.pointerType === 'mouse') return;
    setPointer(e);
    clearTimeout(touchTimer);
    if (game && game.isActive()) return;
    touchTimer = setTimeout(function () {
      pointer = null;
    }, 5000);
  });

  scene.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse' || !(game && game.isActive())) return;
    setPointer(e);
  });

  // ---- 미니게임 -----------------------------------------------------------

  // 15번째에 시작한다. 8번째부터 카구야가 움찔거리고 14번째엔 크게 흔들려서
  // 뭔가 일어날 것 같다는 단서를 준다.
  function countHeroClick() {
    var now = Date.now();
    heroClicks = now - lastHeroClick > GAME_CLICK_GAP ? 1 : heroClicks + 1;
    lastHeroClick = now;
    if (heroClicks >= GAME_CLICKS) {
      heroClicks = 0;
      meteors = [];
      pending = [];
      expandStage();
      game.begin();
      start();
      return;
    }
    if (heroClicks >= 8) {
      var strong = heroClicks >= GAME_CLICKS - 1;
      actorSprite.classList.remove('is-nudge', 'is-nudge-strong');
      void actorSprite.offsetWidth;
      actorSprite.classList.add(strong ? 'is-nudge-strong' : 'is-nudge');
    }
  }

  if (!reduceMotion && window.SpaceGame) {
    if (window.SpaceRanking) ranking = window.SpaceRanking.create({ scene: scene });
    game = window.SpaceGame.create({
      scene: scene,
      actor: actor,
      grid: GRID,
      colors: colors,
      snapX: function (v) {
        return snap(v, G.ox);
      },
      snapY: function (v) {
        return snap(v, G.oy);
      },
      onExit: function () {
        // 평소 유성이 끝나자마자 우르르 나오지 않게 타이머를 새로 잡는다
        nextSingle = 0;
        nextShower = 0;
        actorSprite.classList.remove('is-nudge', 'is-nudge-strong');
        collapseStage();
        if (ranking) ranking.afterGame();
      },
      onStart: function () {
        if (ranking) ranking.startRun();
      },
      onGameOver: function (seconds) {
        if (ranking) ranking.recordRun(seconds);
      }
    });
  }

  // 미니게임 동안 우주 장면을 화면 전체로 넓힌다. 장면을 position:fixed 로
  // 띄우면 문서 흐름에서 빠져 페이지 높이가 줄고 스크롤이 튀므로, 같은 높이의
  // 빈 자리(stageHolder)를 대신 끼워 둔다. 넓어지고 줄어드는 모습은 clip-path
  // 로 원래 자리에서 화면 전체까지 펼쳐 보인다. 캔버스·배치는 크기가 바뀌면
  // ResizeObserver 가 resize() 로 다시 그린다.
  var stageHolder = null;
  var stageTimer = 0;

  function insetOf(rect) {
    return 'inset(' + Math.max(0, rect.top) + 'px ' + Math.max(0, window.innerWidth - rect.right) + 'px ' +
      Math.max(0, window.innerHeight - rect.bottom) + 'px ' + Math.max(0, rect.left) + 'px)';
  }

  function expandStage() {
    clearTimeout(stageTimer);
    var rect = scene.getBoundingClientRect();
    if (!stageHolder) {
      stageHolder = document.createElement('div');
      stageHolder.className = 'space-scene-holder';
    }
    stageHolder.style.height = rect.height + 'px';
    scene.parentNode.insertBefore(stageHolder, scene);
    scene.style.transition = 'none';
    scene.style.clipPath = insetOf(rect);
    scene.classList.add('is-stage');
    document.documentElement.classList.add('is-space-game');
    void scene.offsetWidth;
    scene.style.transition = '';
    scene.style.clipPath = 'inset(0px)';
  }

  function collapseStage() {
    if (!stageHolder || !stageHolder.parentNode) return;
    scene.style.clipPath = insetOf(stageHolder.getBoundingClientRect());
    stageTimer = setTimeout(function () {
      scene.classList.remove('is-stage');
      scene.style.clipPath = '';
      document.documentElement.classList.remove('is-space-game');
      if (stageHolder.parentNode) stageHolder.parentNode.removeChild(stageHolder);
      // 카구야는 줄어든 장면 안으로 밀려 들어온 뒤(updateHero 의 clamp) 제자리로 헤엄쳐 간다
    }, 600);
  }

  // ---- 루프 ---------------------------------------------------------------

  function updateProgress() {
    var rect = scene.getBoundingClientRect();
    progress = clamp((window.innerHeight - rect.top) / (0.85 * rect.height), 0, 1);
    actor.classList.toggle('is-visible', progress > 0.3);
  }

  function render(t, dt) {
    var q = Math.round(progress * 60) / 60;
    if (q !== revealed) {
      revealed = q;
      drawStatic();
    }
    updateHero(t, dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (revealed <= 0) return;
    ctx.drawImage(staticCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var gaming = game && game.isActive();
    if (!reduceMotion && !gaming) updateMeteors(t, dt);
    drawStars(t);
    drawMeteors();
    if (gaming) {
      game.update(dt, { x: hero.x, y: hero.drawY }, W, H);
      game.draw(ctx, W, H, t);
    }
  }

  function frame(now) {
    rafId = 0;
    var t = now / 1000;
    var dt = lastT ? Math.min(0.1, t - lastT) : 0;
    lastT = t;
    render(t, dt);
    if (running) rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (reduceMotion) {
      render(0, 0);
      return;
    }
    if (rafId) return;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }

  function resize() {
    var rect = scene.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = staticCanvas.width = Math.round(W * dpr);
    canvas.height = staticCanvas.height = Math.round(H * dpr);
    G = layout();
    if (!hero) hero = { x: G.home.x, y: G.home.y, drawY: G.home.y, vx: 0, vy: 0, facingRight: false };
    buildDots();
    buildStars();
    meteors = [];
    pending = [];
    revealed = -1;
    updateProgress();
    start();
  }

  readColors();
  resize();

  if (window.ResizeObserver) {
    var lastW = W;
    var lastH = H;
    new ResizeObserver(function () {
      var rect = scene.getBoundingClientRect();
      if (Math.abs(rect.width - lastW) < 1 && Math.abs(rect.height - lastH) < 1) return;
      lastW = rect.width;
      lastH = rect.height;
      resize();
    }).observe(scene);
  } else {
    window.addEventListener('resize', resize);
  }

  window.addEventListener(
    'scroll',
    function () {
      updateProgress();
      if (reduceMotion) start();
    },
    { passive: true }
  );

  // 화면에 보일 때만 애니메이션을 돌린다 — 페이지 맨 아래라 대부분의 시간엔 멈춰 있다
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      running = entries[entries.length - 1].isIntersecting;
      if (running) {
        updateProgress();
        start();
      }
    }).observe(scene);
  } else {
    running = true;
    start();
  }

  window.addEventListener('chokaguya:theme-change', function () {
    readColors();
    revealed = -1;
    start();
  });
})();
