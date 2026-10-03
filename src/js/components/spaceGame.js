(function (global) {
  'use strict';
  // 푸터 우주 장면(spaceScene.js) 안의 미니게임 「카구야 유성 피하기」.
  // 카구야를 15번 연달아 누르면 spaceScene.js 가 create() 로 만든 게임을
  // begin() 한다. 이 파일은 게임 상태(HP, 위협들, 피격 판정, HUD, 최고 기록)만
  // 맡고, 카구야 이동과 그리기 루프는 spaceScene.js 가 그대로 돈다 — 매
  // 프레임 update() / draw() 를 불러 주고, 블랙홀이 카구야를 끄는 힘은
  // pull() 로 받아 간다.
  //
  // 흐름: countdown(3·2·1·시작!) → playing → over(GAME OVER 2.5초) → 끝.
  // 끝나면 opts.onExit() 로 장면에 알려서 평소 이스터에그로 돌아간다.
  //
  // 난이도는 버틴 시간에 따라 LEVELS 단계로 오른다(MAX 뒤로는 30초마다
  // MAX+1, MAX+2 … 로 끝없이 오르며 위협이 커진다 — cfgFor()). 단계가 오를 때마다 위험도
  // 게이지가 흔들리고 "위험도 상승!" 이 뜨며, 새 위협은 그 직후에 바로 한 번
  // 나와서 무엇이 추가됐는지 몸으로 알게 한다.

  var t = (global.I18n && global.I18n.t) || function (key, params) {
    return key.replace(/\{(\w+)\}/g, function (m, name) { return params && name in params ? params[name] : m; });
  };
  var TAU = Math.PI * 2;
  var MAX_HP = 5;
  var HIT_RADIUS = 24; // 카구야 몸 가운데 판정 원 — 머리카락·헬멧 끝은 봐준다
  var INVINCIBLE = 1; // 맞은 뒤 무적 시간(초)
  var COUNTDOWN_STEP = 0.7;
  var OVER_HOLD = 2.5;
  var LEVEL_BANNER = 1.4;
  var NEW_HAZARD_DELAY = 2.5; // 단계가 오른 뒤 새 위협이 처음 나오기까지
  var GAUGE_CELLS = 10;
  var BEST_KEY = 'chokaguya_space_best';

  var METEOR_RADIUS = 5;
  var FRAGMENT_RADIUS = 4;
  var TRAIL = 10;
  var WAVE_EVERY = 12;

  var BOMB_RADIUS = 13;
  var BOMB_SPEED = 110;
  var BOMB_FUSE = 1;
  var BOMB_BLAST = 110; // 경고 원 반지름 — 파편이 이 거리쯤에서 퍼져 나간다
  var BOMB_FRAGMENTS = 10;

  var HOMER_RADIUS = 9;
  var HOMER_CHASE = 3.5; // 이 시간 동안만 카구야를 쫓고 그 뒤로는 직진
  var HOMER_TURN = 2.4; // 초당 꺾을 수 있는 각도(rad)

  var LASER_WARN = 1.1;
  var LASER_FIRE = 0.45;
  var LASER_FADE = 0.2;
  var LASER_WIDTH = 16;

  var HOLE_LIFE = 5.5;
  var HOLE_CORE = 20;
  var HOLE_RANGE = 520;
  var HOLE_PULL = 230; // 가운데 가까이에서 카구야를 끄는 속도(px/s) — 최고 이동 속도보다 낮아 빠져나올 수 있다

  var PANCAKE_RADIUS = 18;
  var PANCAKE_SPEED = 55;

  // 단계표. spawn/speed 는 일반 유성, 나머지 숫자는 그 위협이 나오는 간격(초, 0 이면 아직 없음)
  var LEVELS = [
    { at: 0, spawn: 0.75, speed: 280, aimed: 0.2, wave: false, pancake: 0, bomb: 0, homer: 0, laser: 0, hole: 0 },
    { at: 15, spawn: 0.6, speed: 330, aimed: 0.35, wave: true, pancake: 16, bomb: 0, homer: 0, laser: 0, hole: 0 },
    { at: 30, spawn: 0.5, speed: 380, aimed: 0.35, wave: true, pancake: 16, bomb: 10, homer: 13, laser: 0, hole: 0 },
    { at: 50, spawn: 0.4, speed: 440, aimed: 0.4, wave: true, pancake: 15, bomb: 8, homer: 11, laser: 9, hole: 0 },
    { at: 70, spawn: 0.28, speed: 520, aimed: 0.45, wave: true, pancake: 14, bomb: 5, homer: 8, laser: 6, hole: 16 }
  ];
  var TIMED = ['pancake', 'bomb', 'homer', 'laser', 'hole'];
  var MAX_INDEX = LEVELS.length - 1;
  var OVER_EVERY = 30; // MAX 뒤로 이 간격(초)마다 MAX+1, MAX+2 …
  var SURGE_TIER = 3; // MAX+3 부터 폭주 — 8초에 걸쳐 확 어려워져 168초쯤엔 버티기 힘들다
  var SURGE_RAMP = 8;
  var RAINBOW_TIER = 3; // 게이지가 무지개로 빛나기 시작하는 단계
  var HERO_TOP_SPEED = 380; // spaceScene.js ACTOR_GAME_SPEED — 블랙홀이 이보다 세게 끌면 못 빠져나온다

  // 회복 팬케이크 그림 — offlineSrc/universe/pancake(원본 1536px PNG)를 게임용으로
  // 128px 로 줄인 사본. 게임을 처음 시작할 때 한 번만 불러온다.
  var PANCAKE_SRC = '/offlineSrc/universe/pancake_game.webp';
  var PANCAKE_W = 48;
  var PANCAKE_GLOW = '#ffe680';
  var pancakeImg = null;

  function lerp(a, b, k) {
    return a + (b - a) * k;
  }

  function readBest() {
    try {
      return parseFloat(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) {
      /* 저장소가 막혀 있으면 이번 판 기록만 보여 준다 */
    }
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function levelLabel(index) {
    if (index < MAX_INDEX) return 'Lv.' + (index + 1);
    return index === MAX_INDEX ? 'MAX' : 'MAX+' + (index - MAX_INDEX);
  }

  // MAX 를 넘은 횟수(MAX+N 의 N). MAX 까지는 0
  function tierOf(index) {
    return Math.max(0, index - MAX_INDEX);
  }

  // 단계별 설정. MAX 까지는 LEVELS 그대로, 그 뒤로는 MAX 값을 N 에 따라 키운다.
  // surge(0..1)는 MAX+3 에 들어선 뒤 SURGE_RAMP 초 동안 차오르는 폭주 정도.
  function cfgFor(index, surge) {
    if (index <= MAX_INDEX) return LEVELS[index];
    var base = LEVELS[MAX_INDEX];
    var n = tierOf(index);
    var ease = 1 - 0.35 * surge;
    return {
      spawn: Math.max(0.12, base.spawn * Math.pow(0.92, n) * ease),
      speed: Math.min(760, base.speed * Math.pow(1.06, n) * (1 + 0.15 * surge)),
      aimed: Math.min(0.6, base.aimed + 0.03 * n),
      wave: true,
      pancake: base.pancake,
      bomb: Math.max(2.5, base.bomb * Math.pow(0.9, n) * ease),
      homer: Math.max(4, base.homer * Math.pow(0.92, n) * ease),
      laser: Math.max(3, base.laser * Math.pow(0.92, n) * ease),
      hole: Math.max(9, base.hole * Math.pow(0.92, n) * ease)
    };
  }

  // opts: { scene, actor, grid, snapX(v), snapY(v), colors, onExit(), onStart(), onGameOver(seconds) }
  //   colors 는 spaceScene.js 가 테마에 맞춰 채워 두는 색 객체(danger, star, laser, homer, hole)를 그대로 받는다
  //   onStart / onGameOver 는 온라인 랭킹(spaceRanking.js)에 판의 시작과 버틴 시간을 알린다
  function create(opts) {
    var scene = opts.scene;
    var grid = opts.grid;
    var colors = opts.colors;
    var state = 'idle'; // idle | countdown | playing | over
    var phaseTime = 0; // 지금 단계에 들어온 뒤 흐른 시간
    var survived = 0;
    var hp = MAX_HP;
    var invincible = 0;
    var level = 0;
    var best = 0;
    var bannerUntil = 0;
    var nextSpawn = 0;
    var nextWave = 0;
    var next = {}; // 위협별 다음 등장 시각(survived 기준)
    var meteors = []; // 일반 유성과 폭발 파편
    var bombs = [];
    var echoes = []; // 2단·3단 폭발의 뒤따르는 폭발 {x, y, at, turn, count, speed}
    var homers = [];
    var lasers = [];
    var holes = [];
    var pancakes = [];
    var sparks = [];
    var popups = [];

    // ---- HUD ---------------------------------------------------------------

    var hud = el('div', 'space-game-hud');
    var hearts = el('div', 'space-game-hearts');
    var gauge = el('div', 'space-game-gauge');
    var gaugeBar = el('span', 'space-game-gauge-bar');
    var gaugeCells = [];
    for (var c = 0; c < GAUGE_CELLS; c++) {
      var cell = gaugeBar.appendChild(el('i', 'space-game-gauge-cell'));
      cell.style.setProperty('--i', String(c)); // 무지개 단계에서 칸마다 다른 색을 고른다
      gaugeCells.push(cell);
    }
    var gaugeLevel = el('span', 'space-game-gauge-level');
    gauge.appendChild(el('span', 'space-game-gauge-label', t('위험도')));
    gauge.appendChild(gaugeBar);
    gauge.appendChild(gaugeLevel);
    var clock = el('div', 'space-game-clock');
    var timeEl = el('span', 'space-game-time');
    var bestEl = el('span', 'space-game-best');
    clock.appendChild(timeEl);
    clock.appendChild(bestEl);
    hud.appendChild(hearts);
    hud.appendChild(gauge);
    hud.appendChild(clock);
    var banner = el('div', 'space-game-banner');
    hud.setAttribute('aria-hidden', 'true');
    banner.setAttribute('aria-hidden', 'true');

    function renderHearts() {
      var s = '';
      for (var i = 0; i < MAX_HP; i++) s += i < hp ? '♥' : '♡';
      hearts.textContent = s;
    }

    function renderClock() {
      timeEl.textContent = formatTime(survived);
      bestEl.textContent = 'BEST ' + formatTime(Math.max(best, survived));
    }

    function renderGauge() {
      var top = LEVELS[MAX_INDEX].at;
      var filled = Math.min(GAUGE_CELLS, Math.floor((survived / top) * GAUGE_CELLS));
      for (var i = 0; i < GAUGE_CELLS; i++) gaugeCells[i].classList.toggle('is-on', i < filled);
      gaugeLevel.textContent = levelLabel(level);
      gauge.setAttribute('data-level', String(Math.min(level, MAX_INDEX) + 1));
      gauge.classList.toggle('is-rainbow', tierOf(level) >= RAINBOW_TIER);
    }

    // MAX+3 에 들어선 뒤 SURGE_RAMP 초에 걸쳐 0 -> 1
    function surge() {
      if (tierOf(level) < SURGE_TIER) return 0;
      var from = LEVELS[MAX_INDEX].at + SURGE_TIER * OVER_EVERY;
      return Math.max(0, Math.min(1, (survived - from) / SURGE_RAMP));
    }

    function cfg() {
      return cfgFor(level, surge());
    }

    function showBanner(main, sub) {
      banner.textContent = '';
      banner.appendChild(el('span', 'space-game-banner-main', main));
      if (sub) {
        for (var i = 0; i < sub.length; i++) banner.appendChild(el('span', 'space-game-banner-sub', sub[i]));
      }
      banner.classList.remove('is-pop');
      void banner.offsetWidth; // 같은 글자라도 매번 튀어나오는 애니메이션을 다시 건다
      banner.classList.add('is-pop', 'is-visible');
    }

    function restartAnimation(node, className) {
      node.classList.remove(className);
      void node.offsetWidth;
      node.classList.add(className);
    }

    // ---- 시작과 끝 ----------------------------------------------------------

    function begin() {
      if (state !== 'idle') return;
      state = 'countdown';
      phaseTime = 0;
      survived = 0;
      hp = MAX_HP;
      invincible = 0;
      level = 0;
      bannerUntil = 0;
      nextSpawn = 0;
      nextWave = 0;
      next = {};
      meteors = [];
      bombs = [];
      echoes = [];
      homers = [];
      lasers = [];
      holes = [];
      pancakes = [];
      sparks = [];
      popups = [];
      best = readBest();
      if (!pancakeImg) {
        pancakeImg = new Image();
        pancakeImg.src = PANCAKE_SRC;
      }
      renderHearts();
      renderClock();
      renderGauge();
      scene.appendChild(hud);
      scene.appendChild(banner);
      scene.classList.add('is-gaming', 'is-flash');
      setTimeout(function () {
        scene.classList.remove('is-flash');
      }, 450);
      requestAnimationFrame(function () {
        hud.classList.add('is-visible');
      });
      showBanner('3');
      document.addEventListener('keydown', onKey);
      if (opts.onStart) opts.onStart();
    }

    function finish() {
      if (state === 'idle') return;
      state = 'idle';
      meteors = [];
      bombs = [];
      echoes = [];
      homers = [];
      lasers = [];
      holes = [];
      pancakes = [];
      sparks = [];
      popups = [];
      document.removeEventListener('keydown', onKey);
      opts.actor.classList.remove('is-invincible');
      scene.classList.remove('is-gaming', 'is-flash', 'is-shaking');
      hud.classList.remove('is-visible');
      banner.classList.remove('is-visible', 'is-pop');
      // 사라지는 전환이 끝난 뒤 떼어 낸다
      setTimeout(function () {
        if (state !== 'idle') return;
        if (hud.parentNode) hud.parentNode.removeChild(hud);
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 600);
      opts.onExit();
    }

    function onKey(e) {
      if (e.key === 'Escape') finish();
    }

    // ---- 단계 ---------------------------------------------------------------

    function levelUp(index) {
      var prev = cfgFor(level, 0);
      level = index;
      var cur = cfgFor(level, 0);
      // 이번 단계에서 새로 생긴 위협은 곧바로 한 번 보여 준다
      for (var i = 0; i < TIMED.length; i++) {
        var key = TIMED[i];
        if (cur[key] && !prev[key]) next[key] = survived + NEW_HAZARD_DELAY;
      }
      if (cur.wave && !prev.wave) nextWave = survived + NEW_HAZARD_DELAY;
      renderGauge();
      restartAnimation(gauge, 'is-shaking');
      showBanner(t('위험도 상승!'), [levelLabel(level)]);
      bannerUntil = survived + LEVEL_BANNER;
    }

    // ---- 생성 ---------------------------------------------------------------

    // 위쪽 가장자리에서 아래로 비스듬히 떨어진다(90° 가 바로 아래)
    function spawnMeteor(x, angleDeg, speed) {
      var a = (angleDeg * Math.PI) / 180;
      meteors.push({ x: x, y: -30, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: METEOR_RADIUS });
    }

    function spawnOne(W, hero) {
      var c = cfg();
      var speed = c.speed + Math.random() * 60;
      var x = W * (-0.1 + Math.random() * 1.2);
      var angle = 90 + (Math.random() - 0.5) * 50;
      if (Math.random() < c.aimed) {
        // 위쪽 가장자리(-30)에서 카구야를 향해 곧게 떨어지는 각도 — 가만히 있으면 맞는다
        x = hero.x + (Math.random() - 0.5) * W * 0.5;
        angle = (Math.atan2(hero.y + 30, hero.x - x) * 180) / Math.PI;
      }
      spawnMeteor(x, angle, speed);
    }

    // 한쪽으로 기운 같은 각도의 유성 5개가 나란히 쏟아진다
    function spawnWave(W) {
      var angle = Math.random() < 0.5 ? 68 : 112;
      var speed = cfg().speed * 0.9;
      var offset = Math.random() * W * 0.2;
      for (var i = 0; i < 5; i++) {
        spawnMeteor(offset + (W * 0.8 * i) / 4 + (angle < 90 ? -W * 0.25 : W * 0.25), angle, speed);
      }
    }

    // 천천히 내려와 화면 가운데쯤에 멈춘 뒤, 깜빡이다가 파편으로 터진다
    // MAX+N 마다 더 빨리 내려오고, 더 크고, 파편이 많아진다. MAX+1 부터는 두 번,
    // MAX+3 부터는 세 번 터지는데, 뒤따르는 폭발은 앞 파편 사이 빈틈으로 각도를 엇갈린다.
    function spawnBomb(W, H) {
      var n = tierOf(level);
      var r = BOMB_RADIUS * Math.min(2, 1 + 0.15 * n);
      bombs.push({
        x: W * (0.15 + Math.random() * 0.7),
        y: -r * 2,
        ty: H * (0.3 + Math.random() * 0.35),
        fuse: 0,
        falling: true,
        r: r,
        blast: BOMB_BLAST * (1 + 0.15 * n),
        speed: BOMB_SPEED * (1 + 0.2 * n),
        count: Math.min(20, BOMB_FRAGMENTS + 2 * n),
        fragSpeed: 230 * (1 + 0.08 * n),
        times: n >= 3 ? 3 : n >= 1 ? 2 : 1
      });
    }

    function fireBurst(x, y, turn, count, speed) {
      for (var i = 0; i < count; i++) {
        var a = turn + (i / count) * TAU;
        meteors.push({ x: x, y: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: FRAGMENT_RADIUS });
      }
      burst(x, y, 16, colors.danger);
    }

    function explode(b) {
      var turn = Math.random() * TAU;
      fireBurst(b.x, b.y, turn, b.count, b.fragSpeed);
      for (var k = 1; k < b.times; k++) {
        echoes.push({
          x: b.x,
          y: b.y,
          at: survived + 0.5 * k,
          turn: turn + (k / b.times) * (TAU / b.count),
          count: b.count,
          speed: b.fragSpeed
        });
      }
    }

    // 화면 가장자리 한 곳에서 나와 잠시 카구야를 쫓는다
    function spawnHomer(W, H) {
      var side = Math.floor(Math.random() * 3); // 0 왼쪽, 1 위, 2 오른쪽
      var x = side === 0 ? -20 : side === 2 ? W + 20 : W * Math.random();
      var y = side === 1 ? -20 : H * (0.1 + Math.random() * 0.4);
      homers.push({ x: x, y: y, angle: 0, speed: 160, age: 0, aimed: false });
    }

    // 카구야가 있는 줄을 노려 가로나 세로로 빔을 쏜다 — 경고선이 먼저 깜빡인다
    function spawnLaser(W, H, hero) {
      var horizontal = Math.random() < 0.5;
      var pos = horizontal
        ? Math.max(30, Math.min(H - 30, hero.y + (Math.random() - 0.5) * 120))
        : Math.max(30, Math.min(W - 30, hero.x + (Math.random() - 0.5) * 120));
      lasers.push({ horizontal: horizontal, pos: pos, age: 0 });
    }

    // 카구야와 멀리 떨어진 곳에 열린다
    function spawnHole(W, H, hero) {
      var x;
      var y;
      for (var i = 0; i < 8; i++) {
        x = W * (0.15 + Math.random() * 0.7);
        y = H * (0.2 + Math.random() * 0.6);
        if ((x - hero.x) * (x - hero.x) + (y - hero.y) * (y - hero.y) > 300 * 300) break;
      }
      // MAX+N 마다 몸통이 커지고 더 멀리서 더 세게 끈다 — 다만 카구야 최고 속도의
      // 85% 를 넘게 끌지는 않아서 언제나 빠져나올 수는 있다
      var n = tierOf(level);
      holes.push({
        x: x,
        y: y,
        age: 0,
        size: Math.min(3, 1 + 0.25 * n),
        range: HOLE_RANGE * (1 + 0.15 * n),
        strength: Math.min(HERO_TOP_SPEED * 0.85, HOLE_PULL * (1 + 0.12 * n))
      });
    }

    function spawnPancake(W) {
      var x = W * (0.15 + Math.random() * 0.7);
      pancakes.push({ x: x, baseX: x, y: -30, age: 0 });
    }

    function burst(x, y, count, color) {
      for (var i = 0; i < count; i++) {
        var a = (i / count) * TAU + Math.random() * 0.4;
        var sp = 90 + Math.random() * 140;
        sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 0.5, color: color });
      }
    }

    function popup(x, y, text) {
      popups.push({ x: x, y: y, text: text, age: 0, life: 0.9 });
    }

    // ---- 피격 ---------------------------------------------------------------

    function hit(hero) {
      if (state !== 'playing' || invincible > 0) return;
      hp -= 1;
      invincible = INVINCIBLE;
      renderHearts();
      burst(hero.x, hero.y, 12, colors.star);
      restartAnimation(scene, 'is-shaking');
      if (hp <= 0) gameOver();
    }

    function touches(x, y, r, hero) {
      var dx = x - hero.x;
      var dy = y - hero.y;
      var reach = HIT_RADIUS + r;
      return dx * dx + dy * dy < reach * reach;
    }

    function gameOver() {
      state = 'over';
      phaseTime = 0;
      invincible = 0;
      opts.actor.classList.remove('is-invincible');
      var record = survived > best;
      if (record) {
        best = survived;
        writeBest(best);
      }
      renderClock();
      if (opts.onGameOver) opts.onGameOver(survived);
      showBanner('GAME OVER', [
        t('{n}초 버텼어요', { n: survived.toFixed(1) }),
        record ? t('최고 기록!') : t('최고 {n}초', { n: best.toFixed(1) })
      ]);
    }

    // ---- 갱신 ---------------------------------------------------------------

    function updateSpawns(dt, hero, W, H) {
      var c = cfg();
      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        spawnOne(W, hero);
        nextSpawn = c.spawn * (0.7 + Math.random() * 0.6);
      }
      if (c.wave && survived >= nextWave) {
        spawnWave(W);
        nextWave = survived + WAVE_EVERY;
      }
      for (var i = 0; i < TIMED.length; i++) {
        var key = TIMED[i];
        if (!c[key] || survived < (next[key] || 0)) continue;
        if (key === 'pancake') spawnPancake(W);
        else if (key === 'bomb') {
          spawnBomb(W, H);
          if (level >= MAX_INDEX && Math.random() < 0.35) spawnBomb(W, H); // MAX 부터는 가끔 둘
        } else if (key === 'homer') spawnHomer(W, H);
        else if (key === 'laser') spawnLaser(W, H, hero);
        else if (key === 'hole') spawnHole(W, H, hero);
        next[key] = survived + c[key] * (0.8 + Math.random() * 0.4);
      }
    }

    // hero: { x, y } — 카구야가 지금 그려진 가운데(둥실거림 포함)
    function update(dt, hero, W, H) {
      if (state === 'idle') return;
      phaseTime += dt;
      var playing = state === 'playing';

      if (state === 'countdown') {
        var step = Math.floor(phaseTime / COUNTDOWN_STEP);
        var labels = ['3', '2', '1', t('시작!')];
        if (step >= labels.length) {
          state = 'playing';
          phaseTime = 0;
          banner.classList.remove('is-visible');
        } else if (banner.firstChild && banner.firstChild.textContent !== labels[step]) {
          showBanner(labels[step]);
        }
      } else if (playing) {
        survived += dt;
        renderClock();
        var target = level;
        while (target < MAX_INDEX && survived >= LEVELS[target + 1].at) target++;
        if (target >= MAX_INDEX) target = MAX_INDEX + Math.floor((survived - LEVELS[MAX_INDEX].at) / OVER_EVERY);
        if (target !== level) levelUp(target);
        else renderGauge();
        if (bannerUntil && survived >= bannerUntil) {
          bannerUntil = 0;
          banner.classList.remove('is-visible');
        }
        updateSpawns(dt, hero, W, H);
        if (invincible > 0) {
          invincible -= dt;
          opts.actor.classList.toggle('is-invincible', invincible > 0);
        }
      } else if (state === 'over' && phaseTime >= OVER_HOLD) {
        finish();
        return;
      }

      var i;
      for (i = meteors.length - 1; i >= 0; i--) {
        var m = meteors[i];
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y > H + 40 || m.y < -80 || m.x < -W * 0.4 || m.x > W * 1.4) {
          meteors.splice(i, 1);
        } else if (playing && invincible <= 0 && touches(m.x, m.y, m.r, hero)) {
          meteors.splice(i, 1);
          hit(hero);
        }
      }

      for (i = bombs.length - 1; i >= 0; i--) {
        var b = bombs[i];
        if (b.falling) {
          b.y += b.speed * dt;
          if (b.y >= b.ty) b.falling = false;
        } else {
          b.fuse += dt;
          if (b.fuse >= BOMB_FUSE) {
            bombs.splice(i, 1);
            explode(b);
            continue;
          }
        }
        if (playing && touches(b.x, b.y, b.r, hero)) hit(hero);
      }

      for (i = echoes.length - 1; i >= 0; i--) {
        if (survived < echoes[i].at) continue;
        var e = echoes[i];
        echoes.splice(i, 1);
        fireBurst(e.x, e.y, e.turn, e.count, e.speed);
      }

      for (i = homers.length - 1; i >= 0; i--) {
        var h = homers[i];
        h.age += dt;
        var want = Math.atan2(hero.y - h.y, hero.x - h.x);
        if (!h.aimed) {
          h.angle = want;
          h.aimed = true;
        }
        if (h.age < HOMER_CHASE) {
          // 한 번에 홱 돌지 않고 초당 HOMER_TURN 만큼만 꺾는다
          var diff = Math.atan2(Math.sin(want - h.angle), Math.cos(want - h.angle));
          h.angle += Math.max(-HOMER_TURN * dt, Math.min(HOMER_TURN * dt, diff));
        } else {
          h.speed = Math.min(300, h.speed + 120 * dt);
        }
        h.x += Math.cos(h.angle) * h.speed * dt;
        h.y += Math.sin(h.angle) * h.speed * dt;
        if (h.age > HOMER_CHASE && (h.x < -60 || h.x > W + 60 || h.y < -60 || h.y > H + 60)) {
          homers.splice(i, 1);
        } else if (playing && invincible <= 0 && touches(h.x, h.y, HOMER_RADIUS, hero)) {
          homers.splice(i, 1);
          burst(h.x, h.y, 8, colors.homer);
          hit(hero);
        }
      }

      for (i = lasers.length - 1; i >= 0; i--) {
        var l = lasers[i];
        l.age += dt;
        if (l.age >= LASER_WARN + LASER_FIRE + LASER_FADE) {
          lasers.splice(i, 1);
          continue;
        }
        var firing = l.age >= LASER_WARN && l.age < LASER_WARN + LASER_FIRE;
        var off = l.horizontal ? Math.abs(hero.y - l.pos) : Math.abs(hero.x - l.pos);
        if (playing && firing && off < LASER_WIDTH / 2 + HIT_RADIUS * 0.6) hit(hero);
      }

      for (i = holes.length - 1; i >= 0; i--) {
        var hole = holes[i];
        hole.age += dt;
        if (hole.age >= HOLE_LIFE) {
          holes.splice(i, 1);
          continue;
        }
        if (playing && touches(hole.x, hole.y, HOLE_CORE * hole.size * holeScale(hole), hero)) hit(hero);
      }

      for (i = pancakes.length - 1; i >= 0; i--) {
        var p = pancakes[i];
        p.age += dt;
        p.y += PANCAKE_SPEED * dt;
        p.x = p.baseX + Math.sin(p.age * 1.6) * 30;
        if (p.y > H + 40) {
          pancakes.splice(i, 1);
        } else if (playing && touches(p.x, p.y, PANCAKE_RADIUS, hero)) {
          pancakes.splice(i, 1);
          if (hp < MAX_HP) {
            hp += 1;
            renderHearts();
            popup(p.x, p.y, '+♥');
          } else {
            popup(p.x, p.y, 'MAX');
          }
          burst(p.x, p.y, 10, PANCAKE_GLOW);
        }
      }

      for (i = sparks.length - 1; i >= 0; i--) {
        var s = sparks[i];
        s.age += dt;
        if (s.age >= s.life) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }

      for (i = popups.length - 1; i >= 0; i--) {
        popups[i].age += dt;
        popups[i].y -= 40 * dt;
        if (popups[i].age >= popups[i].life) popups.splice(i, 1);
      }
    }

    // 블랙홀은 열릴 때 커지고 닫힐 때 줄어든다
    function holeScale(hole) {
      return Math.min(1, hole.age / 0.6, (HOLE_LIFE - hole.age) / 0.6);
    }

    // 블랙홀이 카구야를 끄는 속도(px/s). spaceScene.js 가 카구야 이동에 더한다.
    function pull(hero) {
      var vx = 0;
      var vy = 0;
      if (state !== 'playing') return { x: 0, y: 0 };
      for (var i = 0; i < holes.length; i++) {
        var hole = holes[i];
        var dx = hole.x - hero.x;
        var dy = hole.y - hero.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var k = Math.max(0, 1 - dist / hole.range) * holeScale(hole);
        vx += (dx / dist) * hole.strength * k;
        vy += (dy / dist) * hole.strength * k;
      }
      return { x: vx, y: vy };
    }

    // ---- 그리기 -------------------------------------------------------------

    function dot(ctx, x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    // 평소 유성처럼 꼬리 점을 격자에 맞춰 찍되, 머리를 키우고 경고 색으로 칠한다
    function drawMeteors(ctx) {
      ctx.fillStyle = colors.danger;
      for (var i = 0; i < meteors.length; i++) {
        var m = meteors[i];
        var speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy) || 1;
        var ux = m.vx / speed;
        var uy = m.vy / speed;
        var lastX = null;
        var lastY = null;
        // 머리 둘레의 옅은 빛 — 넓은 화면에서도 위협으로 눈에 띄게
        ctx.globalAlpha = 0.22;
        dot(ctx, m.x, m.y, m.r * 2.6);
        var trail = m.r === FRAGMENT_RADIUS ? 5 : TRAIL;
        for (var k = 0; k < trail; k++) {
          var x = k === 0 ? m.x : opts.snapX(m.x - ux * grid * k);
          var y = k === 0 ? m.y : opts.snapY(m.y - uy * grid * k);
          if (x === lastX && y === lastY) continue;
          lastX = x;
          lastY = y;
          ctx.globalAlpha = k === 0 ? 1 : 0.85 - (k / trail) * 0.6;
          dot(ctx, x, y, k === 0 ? m.r : 2.6 * (1 - k / trail) + 0.4);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 점으로 채운 둥근 바위. 터지기 직전엔 점점 빨리 깜빡이고 터질 범위를 점선 원으로 보여 준다.
    function drawBombs(ctx, time) {
      for (var i = 0; i < bombs.length; i++) {
        var b = bombs[i];
        var flash = !b.falling && Math.sin(b.fuse * b.fuse * 40) > 0;
        if (!b.falling) {
          ctx.fillStyle = colors.danger;
          ctx.globalAlpha = 0.25 + 0.5 * (b.fuse / BOMB_FUSE);
          var ringDots = 36;
          for (var r = 0; r < ringDots; r++) {
            var a = (r / ringDots) * TAU + time * 0.8;
            dot(ctx, b.x + Math.cos(a) * b.blast, b.y + Math.sin(a) * b.blast, 1.6);
          }
        }
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = colors.danger;
        dot(ctx, b.x, b.y, b.r * 1.9);
        ctx.globalAlpha = 1;
        ctx.fillStyle = flash ? colors.star : colors.danger;
        for (var gy = -b.r; gy <= b.r; gy += 4) {
          for (var gx = -b.r; gx <= b.r; gx += 4) {
            var d = Math.sqrt(gx * gx + gy * gy);
            if (d > b.r) continue;
            dot(ctx, b.x + gx, b.y + gy, d < b.r * 0.55 ? 1.9 : 1.4);
          }
        }
        // 맥박처럼 뛰는 가운데 빛
        ctx.fillStyle = colors.star;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 8);
        dot(ctx, b.x, b.y, 3);
        ctx.globalAlpha = 1;
      }
    }

    // 고리 두른 작은 행성과 짧은 꼬리
    function drawHomers(ctx) {
      for (var i = 0; i < homers.length; i++) {
        var h = homers[i];
        var cx = Math.cos(h.angle);
        var cy = Math.sin(h.angle);
        ctx.fillStyle = colors.homer;
        for (var k = 1; k < 6; k++) {
          ctx.globalAlpha = 0.5 - k * 0.08;
          dot(ctx, h.x - cx * grid * k * 0.9, h.y - cy * grid * k * 0.9, 3 - k * 0.4);
        }
        ctx.globalAlpha = 0.25;
        dot(ctx, h.x, h.y, HOMER_RADIUS * 2);
        ctx.globalAlpha = 1;
        dot(ctx, h.x, h.y, HOMER_RADIUS);
        ctx.strokeStyle = colors.homer;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, HOMER_RADIUS * 1.9, HOMER_RADIUS * 0.6, -0.4, 0, TAU);
        ctx.stroke();
      }
    }

    function drawLasers(ctx, W, H) {
      for (var i = 0; i < lasers.length; i++) {
        var l = lasers[i];
        ctx.fillStyle = colors.laser;
        if (l.age < LASER_WARN) {
          // 경고: 점선이 점점 빨리 깜빡이고, 줄 끝에 작은 위성이 보인다
          var blink = Math.sin(l.age * l.age * 30) > -0.2;
          ctx.globalAlpha = blink ? 0.75 : 0.2;
          var len = l.horizontal ? W : H;
          for (var p = 0; p < len; p += 14) {
            if (l.horizontal) ctx.fillRect(p, l.pos - 1, 7, 2);
            else ctx.fillRect(l.pos - 1, p, 2, 7);
          }
          ctx.globalAlpha = 1;
          var sx = l.horizontal ? 10 : l.pos - 9;
          var sy = l.horizontal ? l.pos - 9 : 10;
          ctx.fillRect(sx + 6, sy + 6, 6, 6);
          ctx.fillRect(sx, sy + 7, 5, 4);
          ctx.fillRect(sx + 13, sy + 7, 5, 4);
        } else {
          var k = l.age < LASER_WARN + LASER_FIRE ? 1 : 1 - (l.age - LASER_WARN - LASER_FIRE) / LASER_FADE;
          var w = LASER_WIDTH * (0.6 + 0.4 * k);
          ctx.globalAlpha = 0.3 * k;
          if (l.horizontal) ctx.fillRect(0, l.pos - w, W, w * 2);
          else ctx.fillRect(l.pos - w, 0, w * 2, H);
          ctx.globalAlpha = k;
          if (l.horizontal) ctx.fillRect(0, l.pos - w / 2, W, w);
          else ctx.fillRect(l.pos - w / 2, 0, w, H);
          ctx.fillStyle = colors.star;
          if (l.horizontal) ctx.fillRect(0, l.pos - w / 6, W, w / 3);
          else ctx.fillRect(l.pos - w / 6, 0, w / 3, H);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 검은 원반을 점 고리가 감아 돈다
    function drawHoles(ctx, time) {
      for (var i = 0; i < holes.length; i++) {
        var hole = holes[i];
        var k = holeScale(hole) * hole.size;
        if (k <= 0) continue;
        ctx.fillStyle = colors.hole;
        ctx.globalAlpha = 0.9 * k;
        dot(ctx, hole.x, hole.y, HOLE_CORE * 1.4 * k);
        ctx.fillStyle = colors.danger;
        for (var ring = 0; ring < 3; ring++) {
          var radius = (HOLE_CORE * 1.8 + ring * 14) * k;
          var count = 18 + ring * 8;
          var spin = time * (2.4 - ring * 0.6);
          ctx.globalAlpha = (0.9 - ring * 0.25) * k;
          for (var d = 0; d < count; d++) {
            var a = (d / count) * TAU + spin;
            dot(ctx, hole.x + Math.cos(a) * radius, hole.y + Math.sin(a) * radius * 0.85, 2 - ring * 0.4);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawPancakes(ctx) {
      for (var i = 0; i < pancakes.length; i++) {
        var p = pancakes[i];
        // 집어 먹을 수 있다는 걸 알리는 옅은 빛
        ctx.fillStyle = PANCAKE_GLOW;
        ctx.globalAlpha = 0.18 + 0.1 * Math.sin(p.age * 5);
        dot(ctx, p.x, p.y, PANCAKE_RADIUS * 1.6);
        ctx.globalAlpha = 1;
        if (pancakeImg && pancakeImg.complete && pancakeImg.naturalWidth) {
          var h = (PANCAKE_W * pancakeImg.naturalHeight) / pancakeImg.naturalWidth;
          // 둥실 떠내려오는 느낌으로 살짝 기울인다
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(p.age * 1.6) * 0.12);
          ctx.drawImage(pancakeImg, -PANCAKE_W / 2, -h / 2, PANCAKE_W, h);
          ctx.restore();
        } else {
          dot(ctx, p.x, p.y, PANCAKE_RADIUS * 0.8); // 그림이 아직 안 왔으면 노란 점으로
        }
      }
    }

    function drawEffects(ctx) {
      for (var i = 0; i < sparks.length; i++) {
        var s = sparks[i];
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 1 - s.age / s.life;
        dot(ctx, s.x, s.y, 2.2 * (1 - s.age / s.life) + 0.6);
      }
      ctx.font = '18px Mona12, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.star;
      for (var j = 0; j < popups.length; j++) {
        var p = popups[j];
        ctx.globalAlpha = 1 - p.age / p.life;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }

    function draw(ctx, W, H, time) {
      if (state === 'idle') return;
      drawHoles(ctx, time);
      drawPancakes(ctx);
      drawBombs(ctx, time);
      drawHomers(ctx);
      drawMeteors(ctx);
      drawLasers(ctx, W, H);
      drawEffects(ctx);
    }

    return {
      begin: begin,
      finish: finish,
      update: update,
      draw: draw,
      pull: pull,
      // 카운트다운부터 GAME OVER 화면이 끝날 때까지 true
      isActive: function () {
        return state !== 'idle';
      }
    };
  }

  global.SpaceGame = { create: create };
})(window);
