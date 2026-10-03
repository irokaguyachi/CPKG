(function (global) {
  'use strict';
  // 우주 미니게임(spaceGame.js)의 온라인 랭킹. 한 판이라도 해 본 사람에게만
  // 장면 왼쪽 아래에 트로피가 나타나고, 누르면 그 위로 전체/주간 순위표가
  // 펼쳐진다. 게임이 끝나면 순위표가 저절로 열리고 닉네임을 넣어 방금 기록을
  // 등록할 수 있다.
  //
  // 로그인 없이 닉네임만으로 참여한다. 플레이어는 이 브라우저가 만든 무작위
  // playerId 로 구분한다. 판을 시작할 때 서버에서 run 토큰을 받아 두고, GAME
  // OVER 순간 곧바로 기록과 함께 /game/end 로 보내 result 토큰으로 바꾼다 —
  // 서버가 잰 시간과 기록이 맞지 않으면(위조, 일시정지, 슬로우 모션) 여기서
  // 거부된다. 등록은 그 result 토큰으로 한 번만 할 수 있다
  // (worker/favoritesShareWorker.js 의 /game/* 참고).

  var t = (global.I18n && global.I18n.t) || function (key, params) {
    return key.replace(/\{(\w+)\}/g, function (m, name) { return params && name in params ? params[name] : m; });
  };
  var PLAYER_KEY = 'chokaguya_space_player';
  var NICKNAME_KEY = 'chokaguya_space_nickname';
  var PLAYED_KEY = 'chokaguya_space_played';
  var NICKNAME_MAX = 10; // 서버의 GAME_NICKNAME_MAX 와 맞춘다
  var BOARD_TTL = 30000; // 순위표를 다시 열 때 이 시간 안이면 받아 둔 것을 그대로 쓴다
  var OPEN_DELAY = 650; // 게임이 끝나고 장면이 원래 크기로 줄어든 뒤에 연다
  var ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* 저장소가 막혀 있으면 이번 방문 동안만 기억한다 */
    }
  }

  var memoryPlayerId = null;

  function playerId() {
    var id = readStore(PLAYER_KEY) || memoryPlayerId;
    if (id) return id;
    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    id = '';
    for (var i = 0; i < bytes.length; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    memoryPlayerId = id;
    writeStore(PLAYER_KEY, id);
    return id;
  }

  // 순위표 시간은 "분:초:1/100초"
  function formatScore(ms) {
    var m = Math.floor(ms / 60000);
    var s = Math.floor(ms / 1000) % 60;
    var cs = Math.floor(ms / 10) % 100;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ':' + (cs < 10 ? '0' : '') + cs;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data };
      });
    });
  }

  var SUBMIT_ERRORS = {
    'nickname taken': '이미 쓰이고 있는 닉네임이에요',
    'invalid nickname': '닉네임은 1~10자로 입력해 주세요',
    'invalid run': '이번 판은 등록할 수 없어요',
    'run too slow': '게임이 멈추거나 느려진 판은 등록할 수 없어요'
  };

  // 실패한 응답을 화면에 띄울 문구로 바꾼다
  function errorText(res) {
    var error = res.data && res.data.error;
    if (SUBMIT_ERRORS[error]) return t(SUBMIT_ERRORS[error]);
    if (res.status === 429) return t('잠시 후 다시 시도해 주세요');
    return t('랭킹 서버에 연결하지 못했어요');
  }

  // opts: { scene }
  function create(opts) {
    var scene = opts.scene;
    var tab = 'all';
    var board = null; // 서버가 준 { all, weekly, me, week }
    var boardAt = 0;
    var loading = null;
    var pending = null; // 아직 등록하지 않은 방금 판 { result: Promise<응답>, scoreMs }
    var submitting = false;
    var open = false;
    var openTimer = 0;
    var currentRun = null; // 지금 하는 판의 run 토큰을 기다리는 Promise
    var played = false; // 이번 게임에서 기록이 남았는지 — afterGame 이 순위표를 열지 정한다

    // ---- 화면 ----------------------------------------------------------------

    var root = el('div', 'space-rank');
    var panel = el('div', 'space-rank-panel');
    panel.id = 'space-rank-panel';
    var tabs = el('div', 'space-rank-tabs');
    tabs.setAttribute('role', 'tablist');
    var tabAll = el('button', 'space-rank-tab', t('전체'));
    var tabWeek = el('button', 'space-rank-tab', t('주간'));
    [tabAll, tabWeek].forEach(function (btn, index) {
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', function () {
        tab = index === 0 ? 'all' : 'weekly';
        render();
      });
    });
    tabs.appendChild(tabAll);
    tabs.appendChild(el('span', 'space-rank-tab-sep', '|'));
    tabs.appendChild(tabWeek);

    var entry = el('form', 'space-rank-entry');
    var entryScore = el('span', 'space-rank-entry-score');
    var entryRow = el('div', 'space-rank-entry-row');
    var input = el('input', 'space-rank-input');
    input.type = 'text';
    input.maxLength = NICKNAME_MAX * 2; // 조합 중인 한글이 잘리지 않게 넉넉히 두고, 실제 길이는 등록할 때 센다
    input.placeholder = t('닉네임');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', t('닉네임'));
    var submitBtn = el('button', 'space-rank-submit', t('등록'));
    submitBtn.type = 'submit';
    entryRow.appendChild(input);
    entryRow.appendChild(submitBtn);
    var entryMsg = el('p', 'space-rank-msg');
    entryMsg.setAttribute('aria-live', 'polite');
    entry.appendChild(entryScore);
    entry.appendChild(entryRow);

    var list = el('ol', 'space-rank-list');
    var mine = el('p', 'space-rank-me');
    var status = el('p', 'space-rank-status');
    var note = el('p', 'space-rank-note', t('매주 월요일 0시 초기화'));
    panel.appendChild(tabs);
    panel.appendChild(entry);
    panel.appendChild(entryMsg); // 등록이 끝나 입력 칸이 사라진 뒤에도 결과가 보이게 밖에 둔다
    panel.appendChild(list);
    panel.appendChild(mine);
    panel.appendChild(status);
    panel.appendChild(note);

    var trophy = el('button', 'space-rank-trophy');
    trophy.type = 'button';
    trophy.setAttribute('aria-label', t('랭킹'));
    trophy.setAttribute('aria-controls', panel.id);
    trophy.setAttribute('aria-expanded', 'false');
    trophy.appendChild(el('span', 'space-rank-trophy-icon'));
    trophy.addEventListener('click', function () {
      setOpen(!open);
    });

    root.appendChild(panel);
    root.appendChild(trophy);
    // 장면의 클릭은 유성을 날리고 카구야 클릭을 센다 — 순위표 위에서는 막는다
    ['click', 'pointerdown'].forEach(function (type) {
      root.addEventListener(type, function (e) {
        e.stopPropagation();
      });
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        trophy.focus();
      }
    });
    entry.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });
    scene.appendChild(root);
    if (readStore(PLAYED_KEY)) root.classList.add('is-ready');

    function rowNode(rank, nickname, scoreMs, isMe) {
      var li = el('li', 'space-rank-row' + (isMe ? ' is-me' : ''));
      if (rank <= 3) li.setAttribute('data-rank', String(rank));
      li.appendChild(el('span', 'space-rank-pos', rank + '.'));
      li.appendChild(el('span', 'space-rank-name', nickname));
      li.appendChild(el('span', 'space-rank-sep', '|'));
      li.appendChild(el('span', 'space-rank-time', formatScore(scoreMs)));
      return li;
    }

    function render() {
      tabAll.classList.toggle('is-active', tab === 'all');
      tabWeek.classList.toggle('is-active', tab === 'weekly');
      tabAll.setAttribute('aria-selected', String(tab === 'all'));
      tabWeek.setAttribute('aria-selected', String(tab === 'weekly'));
      note.hidden = tab !== 'weekly';

      entry.hidden = !pending;
      if (pending) entryScore.textContent = t('내 기록 {time}', { time: formatScore(pending.scoreMs) });
      input.disabled = submitBtn.disabled = submitting;

      list.textContent = '';
      mine.textContent = '';
      mine.hidden = true;
      status.hidden = true;
      if (!board) {
        status.hidden = false;
        status.textContent = loading ? t('불러오는 중...') : t('랭킹을 불러오지 못했어요');
        return;
      }
      var rows = board[tab] || [];
      var me = board.me && board.me[tab];
      if (!rows.length) {
        status.hidden = false;
        status.textContent = t('아직 기록이 없어요');
      }
      for (var i = 0; i < rows.length; i++) {
        list.appendChild(rowNode(rows[i].rank, rows[i].nickname, rows[i].scoreMs, !!me && me.rank === rows[i].rank));
      }
      // 10위 밖이면 순위표 아래에 내 자리를 따로 보여 준다
      if (me && me.rank > rows.length) {
        mine.hidden = false;
        mine.textContent = t('내 순위') + ' ' + me.rank + '. ' + (readStore(NICKNAME_KEY) || '') + ' | ' + formatScore(me.scoreMs);
      }
    }

    function setMessage(text) {
      entryMsg.textContent = text || '';
    }

    // ---- 서버 ----------------------------------------------------------------

    function load(force) {
      if (loading) return loading;
      if (!force && board && Date.now() - boardAt < BOARD_TTL) return Promise.resolve(board);
      loading = postJson('/game/ranking', { playerId: playerId() })
        .then(function (res) {
          if (res.ok) {
            board = res.data;
            boardAt = Date.now();
          }
        })
        .catch(function () {
          /* 다음에 열 때 다시 시도한다 */
        })
        .then(function () {
          loading = null;
          render();
        });
      render();
      return loading;
    }

    function submit() {
      if (!pending || submitting) return;
      var nickname = input.value.replace(/\s+/g, ' ').trim();
      var length = Array.from(nickname).length;
      if (length < 1 || length > NICKNAME_MAX) {
        setMessage(t(SUBMIT_ERRORS['invalid nickname']));
        return;
      }
      var run = pending;
      submitting = true;
      setMessage(t('등록 중...'));
      render();
      run.result
        .then(function (ended) {
          if (!ended.ok) return ended;
          return postJson('/game/submit', { playerId: playerId(), resultToken: ended.data.resultToken, nickname: nickname });
        })
        .catch(function () {
          return { status: 0, data: {} };
        })
        .then(function (res) {
          submitting = false;
          var error = res.data && res.data.error;
          if (res.ok) {
            writeStore(NICKNAME_KEY, nickname);
            board = res.data;
            boardAt = Date.now();
            if (pending === run) pending = null;
            var me = board.me || {};
            setMessage(t('등록했어요! 전체 {all}위 · 주간 {week}위', {
              all: me.all ? me.all.rank : '-',
              week: me.weekly ? me.weekly.rank : '-'
            }));
          } else {
            // 닉네임 문제나 잠깐의 오류는 같은 판으로 다시 시도할 수 있다
            if ((error === 'invalid run' || error === 'run too slow') && pending === run) pending = null;
            setMessage(errorText(res));
          }
          render();
        });
    }

    function setOpen(next) {
      clearTimeout(openTimer);
      open = next;
      root.classList.toggle('is-open', open);
      trophy.setAttribute('aria-expanded', String(open));
      if (open) load(false);
    }

    // ---- 게임과 잇는 곳 --------------------------------------------------------

    // 카운트다운이 시작될 때. 서버가 이 시각부터 잰다.
    function startRun() {
      setOpen(false);
      pending = null;
      played = false;
      setMessage('');
      currentRun = postJson('/game/start', { playerId: playerId() })
        .then(function (res) {
          return res.ok && res.data.runToken ? res.data.runToken : null;
        })
        .catch(function () {
          return null;
        });
    }

    // GAME OVER 순간. 서버 시간 검사는 지금 바로 받아 두고(닉네임을 고르느라
    // 늦어져도 무효가 되지 않게), 실제 등록은 사람이 닉네임을 넣고 누를 때 한다.
    function recordRun(seconds) {
      var scoreMs = Math.floor(seconds * 1000);
      if (!currentRun || scoreMs < 1) return;
      var run = { scoreMs: scoreMs, result: null };
      run.result = currentRun
        .then(function (runToken) {
          if (!runToken) return { status: 0, ok: false, data: {} };
          return postJson('/game/end', { playerId: playerId(), runToken: runToken, scoreMs: scoreMs });
        })
        .catch(function () {
          return { status: 0, ok: false, data: {} };
        })
        .then(function (res) {
          if (res.ok && res.data.resultToken) return res;
          // 이 판은 등록할 수 없다 — 입력 칸 대신 이유를 보여 준다
          if (pending === run) {
            pending = null;
            setMessage(errorText(res));
            render();
          }
          return { status: res.status, ok: false, data: res.data };
        });
      pending = run;
      played = true;
      currentRun = null;
      writeStore(PLAYED_KEY, '1');
      root.classList.add('is-ready');
    }

    // 게임 화면이 닫힐 때(Esc 로 그만둔 때도). 방금 판이 있으면 순위표를 연다.
    function afterGame() {
      if (!played) return;
      played = false;
      input.value = readStore(NICKNAME_KEY) || '';
      board = null; // 그 사이 바뀌었을 수 있으니 새로 받는다
      openTimer = setTimeout(function () {
        setOpen(true);
      }, OPEN_DELAY);
    }

    render();

    return {
      startRun: startRun,
      recordRun: recordRun,
      afterGame: afterGame
    };
  }

  global.SpaceRanking = { create: create };
})(window);
