/**
 * ChoKaguya 공지사항 페이지 (업데이트 로그 / 공지사항 두 탭)
 * - src/data/changelog/index.json, src/data/notice/index.json (각각
 *   src/scripts/12_build_changelog_index.py, 13_build_notice_index.py 가
 *   src/data/{changelog,notice}/*.md 를 스캔해 생성) 을 받아 목록을 그린다.
 *   이 인덱스는 날짜/제목/파일명(+업데이트 로그는 버전)만 담은 가벼운
 *   목록이고, 본문은 들어있지 않다 — 상세를 열 때 그 항목의 .md 파일을
 *   그때그때 fetch해서 읽는다. 본문이 .md 파일 하나에만 있어야 index.json과
 *   내용이 어긋날 일이 없다.
 * - 탭 전환은 bookmarksPage.js 의 "내 북마크"/"북마크 라이브러리" 탭과 같은
 *   패턴 — ?tab=notice 쿼리로 상태를 담고, pushState + 다시 그리기로
 *   전환한다(진짜 페이지 이동이 아니라 로더가 다시 재생되지 않는다). 이
 *   페이지는 탭 두 개 말고는 내부에 다른 라우팅(상세를 URL에 담는 등)이
 *   없어서, bookmarksPage.js처럼 모든 링크 클릭을 가로채는 대신 탭
 *   링크 두 개만 다룬다.
 * - 목록 행은 북마크 목록(.bkm-row-card)과 같은 모양 — 왼쪽 굵은 제목
 *   자리엔 태그(업데이트 로그는 버전, 공지사항은 카테고리), 그 아래 서브
 *   텍스트엔 실제 제목을 쓴다. 오른쪽엔 날짜, 그리고 공지사항 중
 *   진행 상태(진행중/예정/종료)가 있는 항목은 그 아래에 상태 뱃지를 더 단다
 *   — 이벤트류만 해당하고 일반 공지는 그 데이터 자체가 없어도 된다.
 * - 행을 누르면 뜨는 상세 모달은 시리즈 상세(postDetailSeries.js)와 달리
 *   사진이 없어 그 구조를 재사용할 수 없다 — src/js/authModal.js 의 싱글턴
 *   오버레이 패턴을 그대로 본떠 새로 만들되, 닫기 버튼은 사이트 전역에서
 *   재사용되는 .pds-close 를 그대로 쓴다.
 */
(function (global) {
  var DATA = global.dataUrl || function (p) { return p; };
  var listEl = document.getElementById('changelog-list');
  if (!listEl) return;

  var titleEl = document.getElementById('notice-title');
  var subEl = document.getElementById('notice-sub');

  // 업데이트 로그의 "버전"과 공지사항의 "카테고리"는 헤더 첫 필드라는
  // 위치만 같고 JSON 필드 이름이 다르다(version vs category) — tagField로
  // 그 차이만 갈라두면 나머지 렌더링/모달 코드는 완전히 공용으로 쓸 수 있다.
  var KINDS = {
    changelog: {
      dir: 'changelog',
      label: '업데이트 로그',
      sub: '사이트의 변경 내역을 버전별로 확인해보세요!',
      emptyMessage: '아직 등록된 업데이트 로그가 없어요.',
      tagField: 'version'
    },
    notice: {
      dir: 'notice',
      label: '공지사항',
      sub: '사이트의 공지사항을 확인해보세요!',
      emptyMessage: '아직 등록된 공지사항이 없어요.',
      tagField: 'category'
    }
  };

  // 진행중/예정/종료 — 이벤트류 공지에만 있는 선택 필드(13_build_notice_index.py
  // 참고). 일반 공지·업데이트 로그 항목엔 entry.status 자체가 없다.
  var STATUS_CLASS = {
    '진행중': 'is-live',
    '예정': 'is-upcoming',
    '종료': 'is-ended'
  };

  // ---- 아주 작은 마크다운 → HTML 렌더러 ----
  // 이 프로젝트는 외부 CDN 라이브러리를 전혀 쓰지 않는다(cdnConfig.js 참고,
  // 이미지도 R2로 직접 서빙) — 업데이트 로그/공지사항 정도의 단순한 문법
  // (제목/목록/굵게·기울임/링크/인라인 코드)만 지원하면 충분해 별도
  // 라이브러리 없이 직접 짠다.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderInline(text) {
    var codeSlots = [];
    text = text.replace(/`([^`]+)`/g, function (_, code) {
      var idx = codeSlots.push('<code>' + code + '</code>') - 1;
      return ' ' + idx + ' ';
    });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      var safeUrl = /^https?:\/\//i.test(url) ? url : '#';
      return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/ (\d+) /g, function (_, idx) { return codeSlots[idx]; });
    return text;
  }

  function renderMarkdown(raw) {
    var lines = escapeHtml(raw || '').split('\n');
    var html = '';
    var listBuffer = null; // { type: 'ul' | 'ol', items: [] }
    var paraBuffer = [];

    function flushPara() {
      if (!paraBuffer.length) return;
      html += '<p>' + renderInline(paraBuffer.join(' ')) + '</p>';
      paraBuffer = [];
    }
    function flushList() {
      if (!listBuffer) return;
      var tag = listBuffer.type;
      html += '<' + tag + '>' + listBuffer.items.map(function (it) {
        return '<li>' + renderInline(it) + '</li>';
      }).join('') + '</' + tag + '>';
      listBuffer = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) { flushPara(); flushList(); continue; }

      var heading = trimmed.match(/^(#{2,4})\s+(.*)$/);
      if (heading) {
        flushPara(); flushList();
        var tag = 'h' + Math.min(heading[1].length + 1, 4);
        html += '<' + tag + '>' + renderInline(heading[2]) + '</' + tag + '>';
        continue;
      }

      var ul = trimmed.match(/^[-*]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (!listBuffer || listBuffer.type !== 'ul') { flushList(); listBuffer = { type: 'ul', items: [] }; }
        listBuffer.items.push(ul[1]);
        continue;
      }

      var ol = trimmed.match(/^\d+\.\s+(.*)$/);
      if (ol) {
        flushPara();
        if (!listBuffer || listBuffer.type !== 'ol') { flushList(); listBuffer = { type: 'ol', items: [] }; }
        listBuffer.items.push(ol[1]);
        continue;
      }

      flushList();
      paraBuffer.push(trimmed);
    }
    flushPara();
    flushList();
    return html;
  }

  function formatDate(dateStr) {
    return String(dateStr || '').replace(/-/g, '.');
  }

  // entry.status가 있을 때만(이벤트류 공지) 뱃지를 만든다 — 없으면 null.
  function createStatusBadge(entry) {
    if (!entry.status) return null;
    var badge = document.createElement('span');
    badge.className = 'changelog-status ' + (STATUS_CLASS[entry.status] || '');
    badge.textContent = entry.status;
    return badge;
  }

  // ---- 상세 모달 (authModal.js 의 싱글턴 오버레이 패턴을 그대로 본떴다) ----
  var overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'changelog-detail-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closeDetail();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDetail();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function closeDetail() {
    if (overlayEl) overlayEl.classList.remove('is-open');
  }

  // index.json에는 목록만 있고 본문은 없다 — 상세를 열 때 그 항목의 .md
  // 파일을 그때그때 fetch해서 읽는다. 본문이 .md 파일 하나에만 있어야
  // index.json과 내용이 어긋날 일이 없다.
  var openToken = 0;

  // .md 파일의 첫 줄은 헤더이고(업데이트 로그: "# 버전 - 날짜 - 제목",
  // 공지사항: "# 카테고리 - 날짜 - 제목" — 12/13_build_*_index.py 참고),
  // 그 다음 줄이 "status: 진행중" 형태면(이벤트류 공지 전용, 선택) 그것도
  // 본문이 아니라 메타데이터이므로 함께 걷어낸다. 나머지가 실제 마크다운
  // 본문이다.
  function stripHeaderLine(raw) {
    var lines = (raw || '').split('\n');
    lines.shift(); // 헤더 줄
    if (/^status:\s*(진행중|예정|종료)\s*$/.test((lines[0] || '').trim())) {
      lines.shift();
    }
    return lines.join('\n').replace(/^\n+/, '');
  }

  function openDetail(kind, entry) {
    var token = ++openToken;
    var overlay = ensureOverlay();
    overlay.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'changelog-detail-card';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pds-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener('click', closeDetail);
    card.appendChild(closeBtn);

    var header = document.createElement('div');
    header.className = 'changelog-detail-header';
    var tagValue = entry[kind.tagField];
    if (tagValue) {
      var tagEl = document.createElement('span');
      tagEl.className = 'changelog-version';
      tagEl.textContent = tagValue;
      header.appendChild(tagEl);
    }
    var statusBadge = createStatusBadge(entry);
    if (statusBadge) header.appendChild(statusBadge);
    var dateEl = document.createElement('span');
    dateEl.className = 'changelog-date';
    dateEl.textContent = formatDate(entry.date);
    header.appendChild(dateEl);
    card.appendChild(header);

    var title = document.createElement('h2');
    title.className = 'changelog-detail-title';
    title.textContent = entry.title;
    card.appendChild(title);

    var scroll = document.createElement('div');
    scroll.className = 'changelog-detail-scroll';
    var body = document.createElement('div');
    body.className = 'changelog-body';
    body.textContent = '불러오는 중...';
    scroll.appendChild(body);
    card.appendChild(scroll);

    overlay.appendChild(card);
    void card.offsetWidth;
    overlay.classList.add('is-open');

    fetch(DATA('../data/' + kind.dir + '/' + entry.file))
      .then(function (r) {
        if (!r.ok) throw new Error('fetch failed');
        return r.text();
      })
      .then(function (raw) {
        if (token !== openToken) return; // 그 사이 다른 항목을 열었으면 버린다
        body.innerHTML = renderMarkdown(stripHeaderLine(raw));
      })
      .catch(function () {
        if (token !== openToken) return;
        body.textContent = '내용을 불러오지 못했어요.';
      });
  }

  // ---- 목록 ----
  function createRow(kind, entry) {
    var row = document.createElement('article');
    row.className = 'bkm-row-card';
    row.addEventListener('click', function () { openDetail(kind, entry); });

    var info = document.createElement('div');
    info.className = 'bkm-row-info';

    var title = document.createElement('p');
    title.className = 'bkm-row-title';
    // 굵은 제목 자리엔 태그(업데이트 로그는 버전, 공지사항은 카테고리),
    // 그 아래 서브 텍스트엔 실제 제목.
    title.textContent = entry[kind.tagField];
    info.appendChild(title);

    if (entry.title) {
      var sub = document.createElement('p');
      sub.className = 'bkm-row-sub';
      sub.textContent = entry.title;
      info.appendChild(sub);
    }
    row.appendChild(info);

    var right = document.createElement('div');
    right.className = 'changelog-row-right';
    var date = document.createElement('p');
    date.className = 'bkm-row-count changelog-row-date';
    date.textContent = formatDate(entry.date);
    right.appendChild(date);
    var statusBadge = createStatusBadge(entry);
    if (statusBadge) right.appendChild(statusBadge);
    row.appendChild(right);

    return row;
  }

  // ---- 탭 ----
  function createTabs(active) {
    var tabs = document.createElement('div');
    tabs.className = 'bkm-tabs';

    [
      { key: 'changelog', label: KINDS.changelog.label, href: 'changelogPage.html' },
      { key: 'notice', label: KINDS.notice.label, href: 'changelogPage.html?tab=notice' }
    ].forEach(function (t) {
      var link = document.createElement('a');
      link.className = 'bkm-tab' + (active === t.key ? ' is-active' : '');
      link.href = t.href;
      link.textContent = t.label;
      tabs.appendChild(link);
    });

    return tabs;
  }

  function renderList(kindKey, entries) {
    var kind = KINDS[kindKey];
    if (titleEl) titleEl.textContent = kind.label;
    if (subEl) subEl.textContent = kind.sub;

    listEl.innerHTML = '';
    listEl.appendChild(createTabs(kindKey));

    if (!entries.length) {
      var empty = document.createElement('p');
      empty.className = 'changelog-empty';
      empty.textContent = kind.emptyMessage;
      listEl.appendChild(empty);
      return;
    }
    var list = document.createElement('div');
    list.className = 'bkm-row-list';
    entries.forEach(function (entry) {
      list.appendChild(createRow(kind, entry));
    });
    listEl.appendChild(list);
  }

  // 탭을 오갈 때마다 다시 fetch하지 않도록 이 세션 안에서 캐시한다.
  var indexCache = {};
  function loadIndex(kindKey) {
    if (indexCache[kindKey]) return indexCache[kindKey];
    indexCache[kindKey] = fetch(DATA('../data/' + KINDS[kindKey].dir + '/index.json'))
      .then(function (r) { return r.json(); })
      .then(function (entries) { return Array.isArray(entries) ? entries : []; })
      .catch(function () { return []; });
    return indexCache[kindKey];
  }

  function renderCurrentView() {
    var params = new URLSearchParams(global.location.search);
    var kindKey = params.get('tab') === 'notice' ? 'notice' : 'changelog';
    loadIndex(kindKey).then(function (entries) {
      renderList(kindKey, entries);
    });
  }

  // bookmarksPage.js의 pushState 패턴과 같음 — 진짜 페이지 이동 대신 URL만
  // 바꾸고 다시 그려서 로더가 재생되지 않게 한다. 이 페이지엔 탭 링크
  // 두 개 말고 내부 라우팅이 없어서, 링크 전체를 가로채는 대신 탭 클릭만
  // 처리한다.
  listEl.addEventListener('click', function (e) {
    var a = e.target.closest('a.bkm-tab');
    if (!a) return;
    e.preventDefault();
    if (a.classList.contains('is-active')) return; // 이미 그 탭이면 아무것도 안 함
    global.history.pushState(null, '', a.getAttribute('href'));
    renderCurrentView();
  });

  global.addEventListener('popstate', renderCurrentView);

  renderCurrentView();
})(window);
