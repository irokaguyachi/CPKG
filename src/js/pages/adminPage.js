/**
 * adminPage.js — 관리 페이지(/admin)의 클라이언트.
 *
 * - 서버는 worker/adminApi.js. 관리자 계정(이 브라우저의 개인 코드)과 관리자
 *   비밀번호를 POST /api/admin/login 으로 확인받아 12시간짜리 세션 토큰을 받고,
 *   sessionStorage 에 두었다가 모든 요청에 Authorization: Bearer 로 싣는다
 *   (탭을 닫으면 사라진다). 401 이면 세션을 지우고 비밀번호 화면으로 돌아간다.
 * - 탭: 랭킹 / 태그 투표 / 끌올 / 공개 서재 / 작업 기록. 탭 바는 북마크·공지
 *   페이지와 같은 tabsKit.js 알약 탭, 확인 창은 로그인 창과 같은 auth-overlay
 *   카드, 버튼은 설정창의 settings-btn 을 그대로 써서 사이트 디자인을 따른다.
 * - 운영자 전용 화면이라 번역(t())을 쓰지 않는다 — 번역 사전 대상이 아니다.
 * - 닉네임·서재 이름 같은 사용자 입력은 전부 textContent 로만 넣는다.
 */
(function (global) {
  'use strict';

  var SESSION_KEY = 'cpkg_admin_session';
  var API = '/api/admin/';
  var LOOKUP_URL = '../data/pageData/Lookup.json';

  var gateEl = document.getElementById('admin-gate');
  var gateDesc = document.getElementById('admin-gate-desc');
  var gateForm = document.getElementById('admin-gate-form');
  var gateError = document.getElementById('admin-gate-error');
  var passwordInput = document.getElementById('admin-password');
  var appEl = document.getElementById('admin-app');
  var tabsHost = document.getElementById('admin-tabs');
  var panel = document.getElementById('admin-panel');
  var toastEl = document.getElementById('admin-toast');

  var TABS = [
    { key: 'game', label: '랭킹', href: '#game' },
    { key: 'tags', label: '태그 투표', href: '#tags' },
    { key: 'bumps', label: '끌올', href: '#bumps' },
    { key: 'library', label: '공개 서재', href: '#library' },
    { key: 'actions', label: '작업 기록', href: '#actions' }
  ];
  var ACTION_LABELS = {
    'game.delete': '랭킹 기록 삭제',
    'game.rename': '닉네임 변경',
    'game.ban': '랭킹 차단',
    'game.unban': '랭킹 차단 해제',
    'game.nickname.add': '금지 닉네임 추가',
    'game.nickname.remove': '금지 닉네임 삭제',
    'tags.reset': '태그 투표 초기화',
    'tags.purge-voter': '투표자 투표 삭제',
    'tags.lock': '태그 투표 잠금',
    'tags.unlock': '태그 투표 잠금 해제',
    'bump.cancel': '끌올 취소',
    'library.hide': '서재 숨기기',
    'library.unhide': '서재 숨김 해제',
    'library.delete': '서재 영구 삭제'
  };
  var BUMP_STATES = { active: '노출 중', waiting: '대기', done: '종료' };
  var TYPE_LABELS = { novel: '문학', translation: '번역', series: '시리즈', hof: '명예관', official: '공식' };

  var tabs = null;
  var currentTab = null;

  // ---- 작은 도우미 ----

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(ms) {
    if (!ms) return '-';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtScore(ms) { return (ms / 1000).toFixed(2) + '초'; }

  function storage(fn) {
    try { return fn(global.sessionStorage); } catch (e) { return null; }
  }
  function getSession() {
    var raw = storage(function (s) { return s.getItem(SESSION_KEY); });
    if (!raw) return null;
    try {
      var session = JSON.parse(raw);
      return session && session.token && session.expiresAt > Date.now() ? session : null;
    } catch (e) { return null; }
  }
  function setSession(session) { storage(function (s) { s.setItem(SESSION_KEY, JSON.stringify(session)); }); }
  function clearSession() { storage(function (s) { s.removeItem(SESSION_KEY); }); }

  var toastTimer = null;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', !!isError);
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3500);
  }

  function apiError(status, data) {
    var err = new Error(errorMessage(status, data));
    err.status = status;
    return err;
  }
  function errorMessage(status, data) {
    var code = data && data.error;
    if (status === 404) return '이미 처리됐거나 없는 항목이에요.';
    if (code === 'ambiguous voter') return '같은 앞자리를 쓰는 투표자가 여럿이라 지울 수 없어요.';
    if (code === 'nickname taken') return '다른 플레이어가 쓰는 닉네임이에요.';
    if (code === 'not cancellable') return '이미 끝난 끌올은 취소할 수 없어요.';
    if (status === 400) return '입력값을 확인해 주세요.';
    if (status === 503) return '관리 기능이 아직 설정되지 않았거나 잠시 쓸 수 없어요.';
    return '요청에 실패했어요 (' + status + ')';
  }

  // 관리 API 호출. 401 이면 세션을 지우고 비밀번호 화면으로 보낸다.
  function api(method, path, body) {
    var session = getSession();
    if (!session) {
      showGate('세션이 만료됐어요. 비밀번호를 다시 입력해 주세요.');
      return Promise.reject(apiError(401, null));
    }
    return fetch(API + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401) {
          clearSession();
          showGate('세션이 만료됐어요. 비밀번호를 다시 입력해 주세요.');
        }
        if (!res.ok) throw apiError(res.status, data);
        return data;
      });
    });
  }

  // 버튼을 누르는 동안 비활성화하고, 성공하면 현재 탭을 다시 그린다.
  // 실패하면 화면을 그대로 두고 토스트로 알린다(낙관적 업데이트 안 함).
  function run(button, request, successMessage) {
    if (button) button.disabled = true;
    return request()
      .then(function (data) {
        if (data && data.warning) toast('처리됐지만 작업 기록을 남기지 못했어요.', true);
        else if (successMessage) toast(successMessage);
        return renderTab(currentTab);
      })
      .catch(function (err) {
        if (err && err.status !== 401) toast(err.message, true);
        if (err && err.status === 404) renderTab(currentTab);
      })
      .then(function () { if (button) button.disabled = false; });
  }

  function button(label, variant, onClick) {
    var btn = el('button', 'settings-btn admin-btn' + (variant ? ' is-' + variant : ''), label);
    btn.type = 'button';
    btn.addEventListener('click', function () { onClick(btn); });
    return btn;
  }

  // ---- 확인 창(로그인 창과 같은 auth-overlay 카드) ----
  // opts: { title, desc, confirmLabel, danger, input: { placeholder, value }, requireText }
  // 결과: input 이 있으면 입력값(취소 시 null), 없으면 true/false.
  function dialog(opts) {
    return new Promise(function (resolve) {
      var overlay = el('div', 'auth-overlay admin-dialog-overlay');
      var card = el('div', 'auth-card admin-dialog');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.appendChild(el('h2', 'auth-title is-small', opts.title));
      if (opts.desc) card.appendChild(el('p', 'auth-desc', opts.desc));

      var input = null;
      if (opts.input || opts.requireText) {
        if (opts.requireText) {
          var hint = el('p', 'admin-dialog-hint');
          hint.appendChild(document.createTextNode('되돌릴 수 없어요. 확인하려면 '));
          hint.appendChild(el('strong', null, opts.requireText));
          hint.appendChild(document.createTextNode(' 을(를) 그대로 입력하세요.'));
          card.appendChild(hint);
        }
        input = el('input', 'auth-input admin-dialog-input');
        input.type = 'text';
        input.placeholder = (opts.input && opts.input.placeholder) || opts.requireText || '';
        input.value = (opts.input && opts.input.value) || '';
        card.appendChild(input);
      }

      var actions = el('div', 'admin-dialog-actions');
      var cancel = el('button', 'settings-btn', '취소');
      cancel.type = 'button';
      var confirm = el('button', 'settings-btn ' + (opts.danger ? 'is-danger' : 'is-primary'), opts.confirmLabel || '확인');
      confirm.type = 'button';
      actions.appendChild(cancel);
      actions.appendChild(confirm);
      card.appendChild(actions);
      overlay.appendChild(card);

      function sync() {
        if (opts.requireText) confirm.disabled = input.value.trim() !== opts.requireText;
      }
      var closed = false;
      function close(result) {
        if (closed) return;
        closed = true;
        overlay.classList.remove('is-open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { overlay.remove(); }, 300);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(input && !opts.requireText ? null : false);
        // Enter 로 확인하는 건 입력란에 있을 때만 — 버튼에 포커스가 있으면 브라우저가
        // 그 버튼을 누르게 둔다(취소 버튼에서 Enter 가 확인으로 바뀌지 않게).
        if (e.key === 'Enter' && e.target === input && !confirm.disabled) {
          e.preventDefault();
          confirm.click();
        }
      }
      cancel.addEventListener('click', function () { close(input && !opts.requireText ? null : false); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) cancel.click(); });
      confirm.addEventListener('click', function () {
        if (opts.input && !opts.requireText) close(input.value.trim());
        else close(true);
      });
      if (input) input.addEventListener('input', sync);
      document.addEventListener('keydown', onKey);
      sync();

      document.body.appendChild(overlay);
      requestAnimationFrame(function () {
        overlay.classList.add('is-open');
        // 오버레이는 visibility 전환으로 나타나서, 전환 첫 순간에는 아직 hidden 이라
        // focus() 가 무시된다. 전환이 시작된 뒤에 포커스를 준다.
        setTimeout(function () { (input || confirm).focus(); }, 50);
      });
    });
  }

  // ---- 표 ----
  // columns: ['순위', ...], rows: [[cell, ...]], cell 은 문자열이나 Node.
  function table(columns, rows, emptyText) {
    if (!rows.length) return el('p', 'admin-empty', emptyText || '항목이 없어요.');
    var wrap = el('div', 'admin-table-wrap');
    var tbl = el('table', 'admin-table');
    var head = el('tr');
    columns.forEach(function (c) { head.appendChild(el('th', null, c)); });
    tbl.appendChild(el('thead')).appendChild(head);
    var body = el('tbody');
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (cell) {
        var td = el('td');
        if (cell instanceof Node) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    tbl.appendChild(body);
    wrap.appendChild(tbl);
    return wrap;
  }

  function actionsCell(buttons) {
    var cell = el('div', 'admin-row-actions');
    buttons.forEach(function (b) { if (b) cell.appendChild(b); });
    return cell;
  }

  function section(title, desc) {
    var sec = el('section', 'admin-section');
    sec.appendChild(el('h2', 'admin-section-title', title));
    if (desc) sec.appendChild(el('p', 'admin-section-desc', desc));
    return sec;
  }

  function mono(text) { return el('code', 'admin-mono', text); }

  function badge(text, variant) { return el('span', 'admin-badge' + (variant ? ' is-' + variant : ''), text); }

  // ---- 작품 제목(Lookup.json, 헤더 통합 검색과 같은 파일) ----
  var lookupPromise = null;
  function lookup() {
    if (!lookupPromise) {
      var load = global.fetchJsonCached
        ? global.fetchJsonCached(LOOKUP_URL)
        : fetch(LOOKUP_URL).then(function (r) { return r.json(); });
      lookupPromise = load.catch(function () { return {}; });
    }
    return lookupPromise;
  }
  function titleOf(data, type, id) {
    var entry = data && data[type] && data[type][String(id)];
    return entry ? (entry.name || entry.title || ('#' + id)) : ('#' + id);
  }
  // 태그 투표 대상(문학·번역)의 개별 게시물 목록 — { postId, title, type }
  function votablePosts(data) {
    var out = [];
    ['novel', 'translation'].forEach(function (type) {
      var group = (data && data[type]) || {};
      Object.keys(group).forEach(function (key) {
        (group[key].posts || []).forEach(function (post) {
          out.push({ postId: post.id, title: post.title || group[key].name || ('#' + post.id), type: type });
        });
      });
    });
    return out;
  }
  function postTitle(data, postId) {
    var posts = votablePosts(data);
    for (var i = 0; i < posts.length; i++) if (posts[i].postId === postId) return posts[i].title;
    return '#' + postId;
  }

  // ---- 탭: 랭킹 ----
  var gamePeriod = 'all';
  function renderGame() {
    return Promise.all([api('GET', 'game/scores?period=' + gamePeriod), api('GET', 'game/nicknames')]).then(function (res) {
      var scores = res[0];
      var lists = res[1];
      var frag = document.createDocumentFragment();

      var board = section('랭킹 기록', '우주 미니게임 랭킹이에요. 플레이어는 브라우저 단위로 구분돼서, 차단은 저장소를 지우면 피할 수 있어요. 금지 닉네임으로 보완해 주세요.');
      var toggle = el('div', 'admin-toolbar');
      [['all', '전체'], ['weekly', '이번 주']].forEach(function (p) {
        var b = button(p[1], gamePeriod === p[0] ? 'primary' : null, function () {
          gamePeriod = p[0];
          renderTab('game');
        });
        toggle.appendChild(b);
      });
      board.appendChild(toggle);
      board.appendChild(table(['순위', '닉네임', '기록', '달성 시각', '플레이어', ''], scores.items.map(function (r, i) {
        return [i + 1, r.nickname, fmtScore(r.scoreMs), fmtTime(r.achievedAt), mono(r.playerShort), actionsCell([
          gamePeriod === 'weekly' ? button('이번 주 기록 삭제', null, function (btn) {
            dialog({ title: '이번 주 기록 삭제', desc: '"' + r.nickname + '"의 이번 주 기록만 지워요. 전체 기록은 남아요.', confirmLabel: '삭제', danger: true })
              .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'game/delete', { playerHash: r.playerHash, scope: 'period', period: scores.period }); }, '이번 주 기록을 지웠어요.'); });
          }) : null,
          button('전체 기록 삭제', 'danger', function (btn) {
            dialog({ title: '전체 기록 삭제', desc: '"' + r.nickname + '"의 전체·주간 기록을 모두 지워요.', confirmLabel: '영구 삭제', danger: true, requireText: r.nickname })
              .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'game/delete', { playerHash: r.playerHash, scope: 'all' }); }, '기록을 지웠어요.'); });
          }),
          button('닉네임 변경', null, function (btn) {
            dialog({ title: '닉네임 강제 변경', desc: '모든 기간의 기록에 새 닉네임이 보여요(1~10자).', confirmLabel: '변경', input: { value: r.nickname, placeholder: '새 닉네임' } })
              .then(function (name) { if (name) run(btn, function () { return api('POST', 'game/rename', { playerHash: r.playerHash, nickname: name }); }, '닉네임을 바꿨어요.'); });
          }),
          button('차단', 'danger', function (btn) {
            dialog({ title: '랭킹 차단', desc: '"' + r.nickname + '"의 기록을 모두 지우고 이후 랭킹 등록을 막아요. 사유는 선택이에요.', confirmLabel: '차단', danger: true, input: { placeholder: '차단 사유(선택)' } })
              .then(function (reason) { if (reason !== null) run(btn, function () { return api('POST', 'game/ban', { playerHash: r.playerHash, reason: reason }); }, '차단했어요.'); });
          })
        ])];
      }), '아직 기록이 없어요.'));
      frag.appendChild(board);

      var words = section('금지 닉네임', '이 단어가 들어간 닉네임은 랭킹에 등록할 수 없어요(대소문자 무시).');
      var form = el('form', 'admin-toolbar');
      var wordInput = el('input', 'bkm-inline-create-input admin-input');
      wordInput.placeholder = '금지할 단어';
      wordInput.maxLength = 20;
      var addBtn = el('button', 'bkm-inline-create-btn', '추가');
      addBtn.type = 'submit';
      form.appendChild(wordInput);
      form.appendChild(addBtn);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var word = wordInput.value.trim();
        if (word) run(addBtn, function () { return api('POST', 'game/nicknames/add', { word: word }); }, '금지 닉네임을 추가했어요.');
      });
      words.appendChild(form);
      var chips = el('div', 'admin-chips');
      lists.items.forEach(function (w) {
        var chip = el('span', 'admin-chip');
        chip.appendChild(el('span', null, w.word));
        var x = el('button', 'admin-chip-remove', '×');
        x.type = 'button';
        x.setAttribute('aria-label', w.word + ' 삭제');
        x.addEventListener('click', function () {
          run(x, function () { return api('POST', 'game/nicknames/remove', { word: w.word }); }, '금지 닉네임을 뺐어요.');
        });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
      if (!lists.items.length) chips.appendChild(el('p', 'admin-empty', '금지 닉네임이 없어요.'));
      words.appendChild(chips);
      frag.appendChild(words);

      var bans = section('차단된 플레이어');
      bans.appendChild(table(['플레이어', '사유', '차단 시각', ''], lists.bans.map(function (b) {
        return [mono(b.playerShort), b.reason || '-', fmtTime(b.bannedAt), actionsCell([
          button('차단 해제', null, function (btn) {
            dialog({ title: '차단 해제', desc: '이 플레이어가 다시 랭킹에 등록할 수 있어요. 지운 기록은 돌아오지 않아요.', confirmLabel: '해제' })
              .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'game/unban', { playerHash: b.playerHash }); }, '차단을 풀었어요.'); });
          })
        ])];
      }), '차단된 플레이어가 없어요.'));
      frag.appendChild(bans);
      return frag;
    });
  }

  // ---- 탭: 태그 투표 ----
  var selectedPostId = null;
  function renderTags() {
    return Promise.all([lookup(), api('GET', 'tags/recent?limit=50'),
      selectedPostId ? api('GET', 'tags/post?postId=' + selectedPostId) : Promise.resolve(null)]).then(function (res) {
      var data = res[0];
      var recent = res[1];
      var post = res[2];
      var posts = votablePosts(data);
      var emoji = (global.TagConfig && global.TagConfig.TAG_EMOJI) || {};
      var defaultEmoji = (global.TagConfig && global.TagConfig.DEFAULT_EMOJI) || '';
      var frag = document.createDocumentFragment();

      var find = section('작품별 투표', '문학·번역 제목으로 찾아서 태그별 득표를 보고, 초기화하거나 투표를 잠글 수 있어요. 잠그면 지금 표는 그대로 두고 새 투표만 막아요.');
      var search = el('input', 'bkm-inline-create-input admin-input admin-search');
      search.type = 'search';
      search.placeholder = '작품 제목 검색';
      var results = el('div', 'admin-search-results');
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        results.innerHTML = '';
        if (!q) return;
        posts.filter(function (p) { return p.title.toLowerCase().indexOf(q) !== -1; }).slice(0, 12).forEach(function (p) {
          var item = el('button', 'admin-search-item', p.title);
          item.type = 'button';
          item.appendChild(el('span', 'admin-muted', ' · ' + TYPE_LABELS[p.type] + ' #' + p.postId));
          item.addEventListener('click', function () {
            selectedPostId = p.postId;
            renderTab('tags');
          });
          results.appendChild(item);
        });
      });
      find.appendChild(search);
      find.appendChild(results);

      if (post) {
        var head = el('div', 'admin-post-head');
        head.appendChild(el('strong', null, postTitle(data, post.postId)));
        head.appendChild(el('span', 'admin-muted', ' #' + post.postId));
        head.appendChild(post.locked ? badge('투표 잠금', 'danger') : badge('투표 가능'));
        find.appendChild(head);
        find.appendChild(actionsCell([
          post.locked
            ? button('잠금 해제', null, function (btn) { run(btn, function () { return api('POST', 'tags/unlock', { postId: post.postId }); }, '투표 잠금을 풀었어요.'); })
            : button('투표 잠그기', null, function (btn) {
              dialog({ title: '투표 잠그기', desc: '지금 표는 그대로 두고 새 투표와 투표 취소를 막아요.', confirmLabel: '잠그기' })
                .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'tags/lock', { postId: post.postId }); }, '투표를 잠갔어요.'); });
            }),
          Object.keys(post.votes).length ? button('작품 전체 초기화', 'danger', function (btn) {
            dialog({ title: '작품 투표 전체 초기화', desc: '이 작품의 모든 태그 투표를 지워요.', confirmLabel: '초기화', danger: true, requireText: String(post.postId) })
              .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'tags/reset', { postId: post.postId }); }, '투표를 초기화했어요.'); });
          }) : null
        ]));
        find.appendChild(table(['태그', '득표', ''], Object.keys(post.votes).map(function (tag) {
          return [(emoji[tag] || defaultEmoji) + ' ' + tag, post.votes[tag] + '표', actionsCell([
            button('초기화', 'danger', function (btn) {
              dialog({ title: '"' + tag + '" 투표 초기화', desc: '이 작품의 "' + tag + '" 표 ' + post.votes[tag] + '개를 지워요.', confirmLabel: '초기화', danger: true })
                .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'tags/reset', { postId: post.postId, tagName: tag }); }, '투표를 초기화했어요.'); });
            })
          ])];
        }), '이 작품에는 아직 투표가 없어요.'));
      }
      frag.appendChild(find);

      var feed = section('최근 투표', '한 사람이 몰아서 넣은 표가 보이면 그 투표자의 표를 한 번에 지울 수 있어요. 투표자는 태그 투표 전용 식별자 앞 8자예요.');
      feed.appendChild(table(['시각', '작품', '태그', '투표자', ''], recent.items.map(function (v) {
        return [fmtTime(v.createdAt), postTitle(data, v.postId), (emoji[v.tagName] || defaultEmoji) + ' ' + v.tagName, mono(v.voter), actionsCell([
          button('이 투표자 표 전부 삭제', 'danger', function (btn) {
            dialog({ title: '투표자 표 전부 삭제', desc: '투표자 ' + v.voter + '의 모든 작품 태그 투표를 지워요.', confirmLabel: '삭제', danger: true, requireText: v.voter })
              .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'tags/purge-voter', { voterPrefix: v.voter }); }, '투표를 지웠어요.'); });
          })
        ])];
      }), '최근 투표가 없어요.'));
      frag.appendChild(feed);
      return frag;
    });
  }

  // ---- 탭: 끌올 ----
  function renderBumps() {
    return Promise.all([lookup(), api('GET', 'bumps')]).then(function (res) {
      var data = res[0];
      var list = res[1];
      var sec = section('끌올', '노출 중·대기 중인 끌올과 최근 7일 기록이에요. 노출 중인 끌올을 취소하면 다음 대기 항목이 바로 올라와요.');
      sec.appendChild(table(['상태', '작품', '신청자', '신청', '시작', '교체', ''], list.items.map(function (b) {
        var state = b.cancelled ? badge('취소됨', 'danger') : badge(BUMP_STATES[b.state], b.state === 'active' ? 'primary' : null);
        var cancellable = !b.cancelled && b.state !== 'done';
        var title = titleOf(data, b.itemType, b.itemId);
        return [state, (TYPE_LABELS[b.itemType] || b.itemType) + ' · ' + title, mono(b.requester), fmtTime(b.requestedAt), fmtTime(b.startAt),
          b.state === 'waiting' ? '-' : fmtTime(b.endAt), actionsCell([
            cancellable ? button('취소', 'danger', function (btn) {
              dialog({ title: '끌올 취소', desc: '"' + title + '" 끌올을 취소해요.', confirmLabel: '취소하기', danger: true })
                .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'bumps/cancel', { id: b.id }); }, '끌올을 취소했어요.'); });
            }) : null
          ])];
      }), '최근 끌올이 없어요.'));
      return sec;
    });
  }

  // ---- 탭: 공개 서재 ----
  var libraryQuery = '';
  function renderLibrary() {
    return api('GET', 'library' + (libraryQuery ? '?q=' + encodeURIComponent(libraryQuery) : '')).then(function (list) {
      var frag = document.createDocumentFragment();
      var sec = section('공개 서재', '누구나 보는 공개 북마크 목록이에요(전체 ' + list.total + '개, 최신순 200개까지). 숨기면 목록에서 빠지고 링크로 열어도 "숨겨진 서재"로 보여요. 주인의 계정 데이터는 그대로예요.');
      var form = el('form', 'admin-toolbar');
      var q = el('input', 'bkm-inline-create-input admin-input admin-search');
      q.type = 'search';
      q.placeholder = '이름 또는 코드';
      q.value = libraryQuery;
      var go = el('button', 'bkm-inline-create-btn', '검색');
      go.type = 'submit';
      form.appendChild(q);
      form.appendChild(go);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        libraryQuery = q.value.trim();
        renderTab('library');
      });
      sec.appendChild(form);

      function hideButton(code, hidden) {
        return hidden
          ? button('숨김 해제', null, function (btn) { run(btn, function () { return api('POST', 'library/unhide', { code: code }); }, '숨김을 풀었어요.'); })
          : button('숨기기', null, function (btn) {
            dialog({ title: '서재 숨기기', desc: '공개 목록에서 빼고 링크로도 볼 수 없게 해요. 언제든 되돌릴 수 있어요.', confirmLabel: '숨기기' })
              .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'library/hide', { code: code }); }, '서재를 숨겼어요.'); });
          });
      }
      function deleteButton(code, name) {
        return button('영구 삭제', 'danger', function (btn) {
          dialog({ title: '서재 영구 삭제', desc: '"' + name + '" 서재를 지워요. 원본은 작업 기록에 남아요.', confirmLabel: '영구 삭제', danger: true, requireText: code })
            .then(function (ok) { if (ok) run(btn, function () { return api('POST', 'library/delete', { code: code }); }, '서재를 지웠어요.'); });
        });
      }

      sec.appendChild(table(['이름', '코드', '항목', '만든 날', '고친 날', '상태', ''], list.items.map(function (r) {
        return [r.name, mono(r.code), r.itemCount, fmtTime(r.createdAt), fmtTime(r.updatedAt),
          r.hidden ? badge('숨김', 'danger') : badge('공개'), actionsCell([hideButton(r.code, r.hidden), deleteButton(r.code, r.name)])];
      }), libraryQuery ? '검색 결과가 없어요.' : '공개 서재가 없어요.'));
      frag.appendChild(sec);

      var hidden = section('숨긴 서재');
      hidden.appendChild(table(['이름', '코드', '숨긴 시각', ''], list.hidden.map(function (h) {
        return [h.name || '-', mono(h.code), fmtTime(h.hiddenAt), actionsCell([hideButton(h.code, true)])];
      }), '숨긴 서재가 없어요.'));
      frag.appendChild(hidden);
      return frag;
    });
  }

  // ---- 탭: 작업 기록 ----
  var actionFilter = '';
  function renderActions() {
    var sec = section('작업 기록', '데이터를 바꾼 관리 작업이 모두 남아요. 삭제한 항목은 세부 내용에 원본이 들어 있어요.');
    var bar = el('div', 'admin-toolbar');
    [['', '전체'], ['game', '랭킹'], ['tags', '태그 투표'], ['bump', '끌올'], ['library', '공개 서재']].forEach(function (f) {
      bar.appendChild(button(f[1], actionFilter === f[0] ? 'primary' : null, function () {
        actionFilter = f[0];
        renderTab('actions');
      }));
    });
    sec.appendChild(bar);
    var listHost = el('div');
    sec.appendChild(listHost);
    var rows = [];

    function detailCell(detail) {
      if (detail == null) return '-';
      var box = el('details', 'admin-detail');
      box.appendChild(el('summary', null, '보기'));
      box.appendChild(el('pre', null, JSON.stringify(detail, null, 2)));
      return box;
    }
    function load(before) {
      var qs = [];
      if (actionFilter) qs.push('action=' + encodeURIComponent(actionFilter));
      if (before) qs.push('before=' + before);
      return api('GET', 'actions' + (qs.length ? '?' + qs.join('&') : '')).then(function (page) {
        page.items.forEach(function (a) {
          rows.push([fmtTime(a.at), ACTION_LABELS[a.action] || a.action, a.target, mono(a.actor), detailCell(a.detail)]);
        });
        listHost.innerHTML = '';
        listHost.appendChild(table(['시각', '작업', '대상', '관리자', '세부'], rows, '작업 기록이 없어요.'));
        if (page.nextBefore) {
          listHost.appendChild(button('더 보기', null, function (btn) {
            btn.disabled = true;
            load(page.nextBefore).catch(function (err) { toast(err.message, true); btn.disabled = false; });
          }));
        }
      });
    }
    return load(null).then(function () { return sec; });
  }

  var RENDERERS = { game: renderGame, tags: renderTags, bumps: renderBumps, library: renderLibrary, actions: renderActions };

  function renderTab(key) {
    currentTab = key;
    if (tabs) tabs.setActive(key);
    panel.setAttribute('aria-busy', 'true');
    return RENDERERS[key]()
      .then(function (content) {
        if (currentTab !== key) return;
        panel.innerHTML = '';
        panel.appendChild(content);
      })
      .catch(function (err) {
        if (currentTab !== key || (err && err.status === 401)) return;
        panel.innerHTML = '';
        panel.appendChild(el('p', 'admin-empty', err.message || '불러오지 못했어요.'));
      })
      .then(function () { panel.removeAttribute('aria-busy'); });
  }

  // ---- 게이트(로그인) ----
  function personalCode() {
    var lib = global.BookmarkLibrary;
    return lib && lib.isLoggedIn && lib.isLoggedIn() ? lib.getPersonalCode() : null;
  }

  function showGate(message) {
    appEl.hidden = true;
    gateEl.hidden = false;
    gateError.hidden = true;
    var code = personalCode();
    gateForm.hidden = !code;
    gateDesc.textContent = code
      ? (message || '관리자 비밀번호를 입력해 주세요.')
      : '관리자 계정으로 먼저 로그인해 주세요. 오른쪽 위 프로필 메뉴에서 로그인할 수 있어요.';
    if (code) passwordInput.focus();
  }

  function showApp() {
    gateEl.hidden = true;
    appEl.hidden = false;
    if (!tabs) {
      tabs = global.TabsKit.createTabs(TABS, {
        onActivate: function (item) {
          if (global.history && global.history.replaceState) global.history.replaceState(null, '', item.href);
          renderTab(item.key);
        }
      });
      tabsHost.appendChild(tabs.el);
    }
    var fromHash = (global.location.hash || '').slice(1);
    renderTab(RENDERERS[fromHash] ? fromHash : (currentTab || 'game'));
  }

  gateForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = personalCode();
    var submit = gateForm.querySelector('button[type="submit"]');
    if (!code) return showGate();
    submit.disabled = true;
    gateError.hidden = true;
    fetch(API + 'login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalCode: code, password: passwordInput.value })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok && data && data.token) {
          setSession({ token: data.token, expiresAt: data.expiresAt });
          passwordInput.value = '';
          showApp();
          return;
        }
        gateError.textContent = res.status === 429 ? '시도가 너무 많아요. 잠시 후 다시 해 주세요.'
          : res.status === 503 ? '관리 기능이 아직 설정되지 않았어요.'
          : res.status === 401 ? '인증에 실패했어요.'
          : '요청에 실패했어요 (' + res.status + ')';
        gateError.hidden = false;
      });
    }).catch(function () {
      gateError.textContent = '네트워크 오류로 확인하지 못했어요.';
      gateError.hidden = false;
    }).then(function () { submit.disabled = false; });
  });

  function start() {
    if (getSession()) showApp();
    else showGate();
  }

  // 헤더 프로필 메뉴에서 로그인·로그아웃하면 게이트를 다시 판단한다. 로그아웃하면
  // 관리 세션도 같이 버린다(다른 계정으로 바뀐 브라우저에 관리 화면이 남지 않게).
  global.addEventListener('chokaguya:auth-change', function () {
    if (!personalCode()) clearSession();
    start();
  });

  start();
})(window);
