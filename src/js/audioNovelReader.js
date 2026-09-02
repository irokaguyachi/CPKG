/**
 * 오디오 노벨 리더 — 프로토타입
 * `<sound="...">...</sound>` / `<img="...">` 태그가 섞인 본문(.md)을 읽어서
 * 문단 단위로 렌더링하고, 스크롤로 사운드 구간이 화면에 들어오면 자동 재생한다.
 * 자세한 배경은 .agent/rules/AudioNovel.md 참고.
 */
(function (global) {

  // ---------------------------------------------------------------------
  // 파서 — 문단(빈 줄 또는 &nbsp; 로 구분)을 읽으며 <sound>/<img> 태그로
  // 상태를 전환한다. 인접한 문단이 같은 sound 값을 쓰면 하나의 구간으로 합친다.
  // 원본은 문단 사이에 &nbsp; 줄을 더 넣어서 장면 전환처럼 큰 여백을 의도적으로
  // 표현하므로, 그 개수를 세어 각 문단의 gapBefore 로 들고 다닌다.
  // ---------------------------------------------------------------------
  function parse(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    var segments = [];
    var buffer = '';
    var currentSound = null;
    var pendingGap = 0; // 직전 문단 이후 만난 &nbsp; 줄 개수

    function flushParagraph() {
      if (buffer.length) {
        segments.push({ type: 'p', text: buffer, sound: currentSound, gap: pendingGap });
        buffer = '';
        pendingGap = 0;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      if (line === '&nbsp;') {
        flushParagraph();
        pendingGap += 1;
        continue;
      }

      if (line === '') {
        flushParagraph();
        continue;
      }

      if (segments.length === 0 && buffer === '') {
        var headingMatch = line.match(/^#\s+(.+)$/);
        if (headingMatch) {
          segments.push({ type: 'heading', text: headingMatch[1] });
          continue;
        }
      }

      // sound가 아직 닫히지 않은 상태(currentSound)에서 만난 img/sfx는 그
      // 구간 소속으로 함께 표시해둔다 — 아래 병합 단계에서 이걸로 "같은
      // 사운드 구간 안의 이미지"와 "구간 밖의 독립 이미지"를 구분한다.
      var imgMatch = line.match(/^<img="([^"]*)">$/);
      if (imgMatch) {
        flushParagraph();
        segments.push({ type: 'img', src: imgMatch[1], gap: pendingGap, sound: currentSound });
        pendingGap = 0;
        continue;
      }

      // 효과음 — 여닫는 구간이 아니라 이 지점을 읽고 지나치는 순간 딱 한 번만
      // 재생되는 점(point) 트리거. <img> 처럼 self-closing.
      var sfxMatch = line.match(/^<sfx="([^"]*)">$/);
      if (sfxMatch) {
        flushParagraph();
        segments.push({ type: 'sfx', src: sfxMatch[1], gap: pendingGap, sound: currentSound });
        pendingGap = 0;
        continue;
      }

      var soundStartMatch = line.match(/^<sound="([^"]*)">$/);
      if (soundStartMatch) {
        flushParagraph();
        currentSound = soundStartMatch[1];
        continue;
      }

      if (line === '</sound>') {
        flushParagraph();
        currentSound = null;
        continue;
      }

      // 원본이 고정 폭으로 줄바꿈된 줄글이라, 빈 줄로 안 끊긴 다음 줄은
      // 같은 문단의 이어지는 부분으로 보고 그대로 붙인다 (띄어쓰기 없이).
      buffer += line;
    }
    flushParagraph();

    // 인접한 세그먼트의 sound 값이 같으면 하나의 구간(sound-block)으로 병합.
    // 문단뿐 아니라 그 구간 안에서 만난 img/sfx도 같이 묶는다 — 안 그러면
    // <sound>...<img>...</sound> 처럼 구간 중간에 이미지가 끼었을 때 앞뒤
    // 문단이 서로 다른 sound-block(DOM 엘리먼트)으로 쪼개져서, 스크롤로 그
    // 이미지를 지나가는 순간 재생 중이던 같은 곡이 "새 구간 진입"으로
    // 오인되어 처음부터 다시 시작되는 것처럼 끊겨 들린다
    // (audioNovelReader.js의 playKey가 구간을 DOM 엘리먼트 참조로 구분하기
    // 때문 — 아래 setupScrollTrigger/createPlayer 참고).
    var blocks = [];
    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j];
      if (seg.sound) {
        var item = seg.type === 'p'
          ? { type: 'p', text: seg.text, gap: seg.gap }
          : { type: seg.type, src: seg.src, gap: seg.gap };
        var last = blocks[blocks.length - 1];
        if (last && last.type === 'sound-block' && last.sound === seg.sound) {
          last.items.push(item);
        } else {
          blocks.push({ type: 'sound-block', sound: seg.sound, items: [item] });
        }
      } else {
        blocks.push(seg);
      }
    }
    return blocks;
  }

  // ---------------------------------------------------------------------
  // 렌더러 — 원본의 &nbsp; 줄 개수(gap)만큼 문단 위쪽에 여백을 더해서,
  // 작가가 의도한 "장면 사이 큰 여백"을 그대로 살린다.
  // ---------------------------------------------------------------------
  var GAP_UNIT_PX = 16; // &nbsp; 한 줄당 추가되는 여백

  function applyGap(el, gap) {
    if (gap) el.style.marginTop = (gap * GAP_UNIT_PX) + 'px';
  }

  // sound-block 안/밖 어디서든 재사용하는 엘리먼트 빌더 — 구간에 딸린
  // img/sfx도 구간 밖의 독립 img/sfx와 완전히 같은 모양으로 그려야 하므로
  // 렌더링 코드를 한 군데로 모은다.
  function buildImgEl(src, gap, resolveImgUrl) {
    var figure = document.createElement('figure');
    figure.className = 'an-figure';
    applyGap(figure, gap);
    var img = document.createElement('img');
    img.src = resolveImgUrl(src);
    img.alt = '';
    img.loading = 'lazy';
    figure.appendChild(img);
    return figure;
  }
  function buildSfxEl(src) {
    var marker = document.createElement('span');
    marker.className = 'an-sfx-marker';
    marker.dataset.sfx = src;
    return marker;
  }
  function buildPEl(text, gap) {
    var p = document.createElement('p');
    p.className = 'an-p';
    p.textContent = text;
    applyGap(p, gap);
    return p;
  }

  function render(container, blocks, resolveImgUrl) {
    container.innerHTML = '';
    var frag = document.createDocumentFragment();

    blocks.forEach(function (block) {
      if (block.type === 'heading') {
        var h1 = document.createElement('h1');
        h1.className = 'an-heading';
        h1.textContent = block.text;
        frag.appendChild(h1);
      } else if (block.type === 'img') {
        frag.appendChild(buildImgEl(block.src, block.gap, resolveImgUrl));
      } else if (block.type === 'sound-block') {
        var section = document.createElement('section');
        section.className = 'an-sound-block';
        section.dataset.sound = block.sound;
        block.items.forEach(function (item) {
          if (item.type === 'img') {
            section.appendChild(buildImgEl(item.src, item.gap, resolveImgUrl));
          } else if (item.type === 'sfx') {
            section.appendChild(buildSfxEl(item.src));
          } else {
            section.appendChild(buildPEl(item.text, item.gap));
          }
        });
        frag.appendChild(section);
      } else if (block.type === 'p') {
        frag.appendChild(buildPEl(block.text, block.gap));
      } else if (block.type === 'sfx') {
        frag.appendChild(buildSfxEl(block.src));
      }
    });

    container.appendChild(frag);
  }

  // ---------------------------------------------------------------------
  // 경로 해석 — sound 값의 마지막 조각만 파일명으로 쓰고, 폴더는 이 작품
  // 전용 base 경로로 고정한다 (지금은 소설판 1개 작품만 대상인 프로토타입).
  // ---------------------------------------------------------------------
  function makeResolvers(config) {
    function resolveSoundKey(value) {
      var parts = String(value).split('/');
      return parts[parts.length - 1];
    }
    function resolveSoundUrl(value) {
      return config.soundBase + encodeURIComponent(resolveSoundKey(value)) + '.mp3';
    }
    function resolveImgUrl(value) {
      return config.imgBase + String(value).split('/').map(encodeURIComponent).join('/');
    }
    function resolveSfxUrl(value) {
      return config.sfxBase + String(value).split('/').map(encodeURIComponent).join('/') + '.mp3';
    }
    return { resolveSoundKey: resolveSoundKey, resolveSoundUrl: resolveSoundUrl, resolveImgUrl: resolveImgUrl, resolveSfxUrl: resolveSfxUrl };
  }

  // ---------------------------------------------------------------------
  // 미니 플레이어 — Figma "AudioPlayer"(node 2252:2) 스펙: 슬라이더 + 시간 +
  // 재생/음소거 버튼, 그 위에 "작곡가 - 곡명" 라벨.
  // ---------------------------------------------------------------------
  function createPlayer(resolvers, audioData) {
    var els = {
      root: document.getElementById('an-player'),
      label: document.getElementById('an-player-label'),
      play: document.getElementById('an-player-play'),
      mute: document.getElementById('an-player-mute'),
      sliderIn: document.getElementById('an-player-slider-in'),
      time: document.getElementById('an-player-time')
    };

    var FADE_MS = 600;
    // 루프 곡이 끝에 도달하기 이만큼 전에 같은 곡을 새로 하나 더 띄워 겹쳐
    // 재생한다(크로스페이드) — attachLoopCrossfade() 참고.
    var LOOP_CROSSFADE_MS = 1500;
    var audioEl = null;
    var activeBlockEl = null;

    // 브라우저 자동재생 정책 — 사용자 동작이 한 번도 없었던 시점(로드 직후)의
    // play() 는 소리 없이 조용히 거부된다. 거부됐을 때만 사용자 동작 리스너를
    // 걸어두고, 실제로 재생에 성공할 때까지 계속 재시도한다 (한 번 시도하고
    // 리스너를 떼버리면 그 시점에 아직 트랙이 없었을 경우 영영 막힌 채로 남는다).
    var resumeEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    var resumeArmed = false;
    var userPaused = false; // 사용자가 직접 일시정지한 경우엔 멋대로 되살리지 않는다

    function onResumeEvent() {
      if (userPaused || !audioEl || !audioEl.paused) {
        disarmResume();
        return;
      }
      attemptPlay(audioEl);
    }
    function armResume() {
      if (resumeArmed) return;
      resumeArmed = true;
      resumeEvents.forEach(function (ev) {
        document.addEventListener(ev, onResumeEvent, { passive: true });
      });
    }
    function disarmResume() {
      if (!resumeArmed) return;
      resumeArmed = false;
      resumeEvents.forEach(function (ev) {
        document.removeEventListener(ev, onResumeEvent);
      });
    }
    function attemptPlay(el) {
      var promise;
      try {
        promise = el.play();
      } catch (e) {
        armResume();
        return;
      }
      if (promise && typeof promise.then === 'function') {
        promise.then(function () {
          disarmResume();
        }, function () {
          if (audioEl === el && !userPaused) armResume();
        });
      }
    }

    function fmtTime(sec) {
      if (!isFinite(sec) || sec < 0) return '0:00';
      sec = Math.floor(sec);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function fadeTo(el, target, ms, done) {
      var start = el.volume;
      var startTime = performance.now();
      function step(now) {
        var t = Math.min(1, (now - startTime) / ms);
        el.volume = start + (target - start) * t;
        if (t < 1) {
          requestAnimationFrame(step);
        } else if (done) {
          done();
        }
      }
      requestAnimationFrame(step);
    }

    function updateProgress() {
      if (!audioEl) return;
      var pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
      els.sliderIn.style.width = pct + '%';
      els.time.textContent = fmtTime(audioEl.currentTime) + ' / ' + fmtTime(audioEl.duration || 0);
    }

    function updateLabel(key) {
      var meta = audioData[key] || {};
      var title = meta.title || key;
      els.label.textContent = meta.composer ? (meta.composer + ' - ' + title) : title;
    }

    // AudioData.json 의 volume(0~1) — 곡마다 녹음 음량이 달라서 미리 맞춰둔 기준 볼륨.
    // 값이 없거나 범위를 벗어나면 1로 취급한다. 여기에 설정창(오디오 문학
    // 탭)의 마스터 볼륨(AudioSettings)을 곱해서 최종 재생 볼륨을 낸다.
    function targetVolume(key) {
      var v = (audioData[key] || {}).volume;
      var base = (typeof v !== 'number' || isNaN(v)) ? 1 : Math.min(1, Math.max(0, v));
      var master = global.AudioSettings ? global.AudioSettings.get().volume : 1;
      return base * master;
    }

    // 재생 중에 설정창에서 음량 슬라이더를 움직이면 바로 들리게, 지금 트는
    // 곡의 볼륨을 즉시 다시 계산해서 앉힌다(페이드 없이 스냅).
    function applyVolumeSettingNow() {
      if (!audioEl || !activeBlockEl) return;
      var key = resolvers.resolveSoundKey(activeBlockEl.dataset.sound);
      audioEl.volume = targetVolume(key);
    }
    global.addEventListener('chokaguya:audio-settings-change', applyVolumeSettingNow);

    // AudioData.json 의 playMode — "Once"면 끝까지 재생 후 멈추고,
    // 그 외(기본값 "Loop")는 끝나면 처음부터 다시 반복 재생한다.
    function isOnceMode(key) {
      return (audioData[key] || {}).playMode === 'Once';
    }

    // 루프 곡 전용 — 네이티브 loop 속성 대신, 곡이 끝나기 LOOP_CROSSFADE_MS
    // 전에 같은 곡의 새 인스턴스를 하나 더 만들어 재생을 시작해서, 기존 트랙은
    // 페이드아웃하고 새 트랙은 페이드인시켜 두 트랙이 겹치며 매끄럽게 이어지게
    // 한다. 새 인스턴스가 audioEl 자리를 이어받으면 자기 자신도 다시
    // attachLoopCrossfade()로 다음 순번을 예약해서, 구간을 벗어날 때까지
    // 이 과정이 계속 이어진다.
    function attachLoopCrossfade(el, key) {
      if (isOnceMode(key)) return;
      var scheduled = false; // timeupdate가 자주 발생하므로 한 번만 트리거되게 잠근다
      el.addEventListener('timeupdate', function () {
        if (scheduled || audioEl !== el) return; // 이미 다른 트랙으로 넘어갔으면 무시
        if (!el.duration || !isFinite(el.duration)) return;
        if (el.duration - el.currentTime > LOOP_CROSSFADE_MS / 1000) return;
        scheduled = true;

        var loopNext = new Audio(el.src);
        loopNext.loop = false;
        loopNext.muted = el.muted; // 음소거 상태는 그대로 이어받는다
        loopNext.volume = 0;
        loopNext.addEventListener('timeupdate', updateProgress);
        attachLoopCrossfade(loopNext, key); // 이 트랙도 언젠가 다시 끝에 다다르면 똑같이 이어붙인다
        attemptPlay(loopNext);

        audioEl = loopNext;
        fadeTo(loopNext, targetVolume(key), LOOP_CROSSFADE_MS);
        fadeTo(el, 0, LOOP_CROSSFADE_MS, function () {
          el.pause();
          el.src = '';
        });
      });
    }

    function setPlayIcon(paused) {
      els.play.classList.toggle('is-paused', paused);
    }

    function playKey(soundValue, blockEl) {
      if (activeBlockEl === blockEl) return; // 같은 구간이면 재시작하지 않음

      if (activeBlockEl) activeBlockEl.classList.remove('is-playing');
      blockEl.classList.add('is-playing');
      activeBlockEl = blockEl;

      var key = resolvers.resolveSoundKey(soundValue);
      var prevAudio = audioEl;

      var next = new Audio(resolvers.resolveSoundUrl(soundValue));
      // 네이티브 loop는 쓰지 않는다 — 끝에서 처음으로 순간 이동하면 이음매가
      // 뚝 끊겨 들리므로, 루프 곡은 attachLoopCrossfade()가 끝나기 직전에
      // 같은 곡을 하나 더 겹쳐 재생해서(페이드 인/아웃) 매끄럽게 잇는다.
      next.loop = false;
      next.volume = 0;
      next.addEventListener('timeupdate', updateProgress);
      if (isOnceMode(key)) {
        // Once: 끝까지 재생되면 그대로 멈추고 패널도 사라진다 (같은 구간에 계속
        // 머물러 있는 동안은 다시 재생하지 않음 — 구간을 벗어났다 돌아오면 재생)
        next.addEventListener('ended', function () {
          if (audioEl !== next) return;
          fadeTo(next, 0, FADE_MS, function () {
            next.pause();
            if (audioEl === next) {
              audioEl = null;
              els.root.classList.remove('is-visible');
            }
          });
        });
      } else {
        attachLoopCrossfade(next, key);
      }
      // 설정창의 "자동재생" 스위치가 꺼져 있으면 트랙만 준비해두고 재생은
      // 시작하지 않는다 — 미니 플레이어의 재생 버튼을 직접 눌러야 나온다.
      var autoplayEnabled = !global.AudioSettings || global.AudioSettings.get().autoplay;
      if (autoplayEnabled) {
        userPaused = false;
        attemptPlay(next); // 자동재생이 막히면 다음 사용자 조작 때 다시 시도한다
      }

      audioEl = next;
      fadeTo(next, targetVolume(key), FADE_MS);
      setPlayIcon(!autoplayEnabled);

      if (prevAudio) {
        fadeTo(prevAudio, 0, FADE_MS, function () {
          prevAudio.pause();
          prevAudio.src = '';
        });
      }

      updateLabel(key);
      els.root.classList.add('is-visible');
    }

    function stop() {
      if (!audioEl) return;
      disarmResume();
      var prevAudio = audioEl;
      if (activeBlockEl) activeBlockEl.classList.remove('is-playing');
      activeBlockEl = null;
      audioEl = null;
      fadeTo(prevAudio, 0, FADE_MS, function () {
        prevAudio.pause();
        prevAudio.src = '';
        // 페이드아웃되는 동안 다른 구간이 새로 재생을 시작했다면(audioEl 이
        // 이미 그 새 트랙을 가리키고 있다면) 막 나타난 패널을 도로 숨기면
        // 안 되므로, 여전히 아무것도 재생 중이 아닐 때만 숨긴다.
        if (!audioEl) {
          els.root.classList.remove('is-visible');
        }
      });
    }

    els.play.addEventListener('click', function () {
      if (!audioEl) return;
      if (audioEl.paused) {
        userPaused = false;
        attemptPlay(audioEl);
        setPlayIcon(false);
      } else {
        userPaused = true;
        disarmResume();
        audioEl.pause();
        setPlayIcon(true);
      }
    });

    els.mute.addEventListener('click', function () {
      if (!audioEl) return;
      audioEl.muted = !audioEl.muted;
      els.mute.classList.toggle('is-muted', audioEl.muted);
    });

    return { playKey: playKey, stop: stop };
  }

  // ---------------------------------------------------------------------
  // 스크롤 재생 트리거 — 뷰포트에 들어온 사운드 구간 중 교차 비율이 가장
  // 큰 것을 "현재 구간"으로 삼는다. 하나도 없으면 정지.
  // ---------------------------------------------------------------------
  function setupScrollTrigger(container, player) {
    var blocks = Array.prototype.slice.call(container.querySelectorAll('.an-sound-block'));
    if (!blocks.length || !('IntersectionObserver' in global)) return;

    var state = new Map();

    function recompute() {
      var best = null;
      blocks.forEach(function (el) {
        var s = state.get(el);
        if (s && s.isIntersecting && (!best || s.ratio > best.ratio)) {
          best = { el: el, ratio: s.ratio };
        }
      });
      if (best) {
        player.playKey(best.el.dataset.sound, best.el);
      } else {
        player.stop();
      }
    }

    // rootMargin 위/아래를 모두 음수로 줄여서, 교차 판정 영역을 화면 위에서
    // 45%~70% 사이의 좁은 띠로 제한한다. 구간이 아래에서 올라와 70% 선에 닿는
    // 순간 음악이 시작되고, 위로 올라가 바닥이 45% 선을 넘는 순간 꺼진다.
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        state.set(entry.target, { ratio: entry.intersectionRatio, isIntersecting: entry.isIntersecting });
      });
      recompute();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-45% 0px -30% 0px' });

    blocks.forEach(function (el) { observer.observe(el); });
  }

  // ---------------------------------------------------------------------
  // 효과음 트리거 — <soundEffect> 마커가 배경음악 전환에 쓰는 것과 같은
  // "화면 위에서 58% 지점" 기준선을 아래→위로 지나가는 순간(=그 지점을 읽고
  // 지나친 순간) 딱 한 번 재생한다. 배경음악과는 독립적으로 겹쳐서 재생되며
  // loop 없이 끝까지 재생되고 자연히 멈춘다. 위로 스크롤해 그 지점 아래로
  // 다시 내려가면(재교차) 재무장되어, 다시 지나칠 때 또 재생된다.
  // ---------------------------------------------------------------------
  function playSfx(url) {
    var el = new Audio(url);
    el.loop = false;
    el.volume = global.AudioSettings ? global.AudioSettings.get().volume : 1;
    el.play().catch(function () {}); // 자동재생 정책에 막혀도 조용히 무시(효과음은 재시도할 트리거가 마땅치 않음)
  }

  function setupSfxTrigger(container, resolvers) {
    var markers = Array.prototype.slice.call(container.querySelectorAll('.an-sfx-marker'));
    if (!markers.length || !('IntersectionObserver' in global)) return;

    var wasIntersecting = new Map();

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var el = entry.target;
        var before = wasIntersecting.get(el);
        // rootMargin 으로 위쪽이 58% 눌린 root 를 기준으로 판정해야 한다.
        // 실제 뷰포트 맨 위(0)가 아니라 그 기준선(entry.rootBounds.top)을
        // 지나 위로 빠져나갈 때가 "지나친 순간"이다. 아래로(뷰포트 밖 화면
        // 아래) 빠져나간 경우(위로 스크롤해 멀어짐)는 재무장만 하고 재생하지
        // 않는다.
        if (before && !entry.isIntersecting && entry.rootBounds && entry.boundingClientRect.top < entry.rootBounds.top) {
          playSfx(resolvers.resolveSfxUrl(el.dataset.sfx));
        }
        wasIntersecting.set(el, entry.isIntersecting);
      });
    }, { threshold: 0, rootMargin: '-58% 0px 0px 0px' });

    markers.forEach(function (el) { observer.observe(el); });
  }

  // ---------------------------------------------------------------------
  // 진입점
  // ---------------------------------------------------------------------
  function init(config) {
    config = config || {};
    var container = document.getElementById(config.containerId || 'an-content');
    if (!container) return;

    var resolvers = makeResolvers(config);

    // 본문(.md)과 오디오 메타를 모두 받아서 렌더링까지 끝낸 뒤에야 준비 완료.
    // 이 약속을 로더에 등록해두면(registerLoadingTask) 로딩 스크린이 그때까지
    // 남아 있으므로, "아직 아무것도 안 불러온 상태에서 재생부터 시도했다가
    // 조용히 실패" 하는 상황 자체가 생기지 않는다.
    var ready = Promise.all([
      fetch(config.sourceUrl, { cache: 'no-store' }).then(function (r) { return r.text(); }),
      config.audioDataUrl
        ? fetch(config.audioDataUrl, { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return {}; })
        : Promise.resolve({})
    ]).then(function (results) {
      var text = results[0];
      var audioData = results[1];

      var blocks = parse(text);
      render(container, blocks, resolvers.resolveImgUrl);
      return audioData;
    });

    if (typeof global.registerLoadingTask === 'function') {
      global.registerLoadingTask(ready);
    }

    ready.then(function (audioData) {
      // 재생/스크롤 감지는 로딩 스크린이 완전히 걷힌 뒤에 켠다. 로더가 화면을
      // 덮고 있는 동안 재생이 시작되면 사용자에겐 들리지도 않고, 자동재생
      // 정책에 막혀 그대로 죽어버리는 구간이 생긴다.
      function start() {
        var player = createPlayer(resolvers, audioData);
        setupScrollTrigger(container, player);
        setupSfxTrigger(container, resolvers);
      }
      if (typeof global.whenLoadingFinished === 'function') {
        global.whenLoadingFinished(start);
      } else {
        start();
      }
    });
  }

  global.AudioNovelReader = { init: init, parse: parse };
})(window);
