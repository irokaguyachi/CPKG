/**
 * ChoKaguya 업데이트 로그 페이지
 * - src/data/changelog/index.json (src/scripts/12_build_changelog_index.py 가
 *   src/data/changelog/*.md 를 스캔해 생성) 을 받아 목록을 그린다. 이 인덱스는
 *   버전/날짜/제목/파일명만 담은 가벼운 목록이고, 본문은 들어있지 않다 —
 *   상세를 열 때 그 항목의 .md 파일을 그때그때 fetch해서 읽는다. 본문이
 *   .md 파일 하나에만 있어야 index.json과 내용이 어긋날 일이 없다.
 * - 목록 행은 북마크 목록(.bkm-row-card)과 같은 모양 — 왼쪽 굵은 제목 자리엔
 *   버전, 그 아래 서브 텍스트엔 로그 제목, 오른쪽 굵은 숫자 자리엔 날짜.
 * - 행을 누르면 뜨는 상세 모달은 시리즈 상세(postDetailSeries.js)와 달리
 *   사진이 없어 그 구조를 재사용할 수 없다 — src/js/authModal.js 의 싱글턴
 *   오버레이 패턴을 그대로 본떠 새로 만들되, 닫기 버튼은 사이트 전역에서
 *   재사용되는 .pds-close 를 그대로 쓴다.
 */
(function (global) {
  var DATA = global.dataUrl || function (p) { return p; };
  var listEl = document.getElementById('changelog-list');
  if (!listEl) return;

  // ---- 아주 작은 마크다운 → HTML 렌더러 ----
  // 이 프로젝트는 외부 CDN 라이브러리를 전혀 쓰지 않는다(cdnConfig.js 참고,
  // 이미지도 R2로 직접 서빙) — 업데이트 로그 정도의 단순한 문법(제목/목록/
  // 굵게·기울임/링크/인라인 코드)만 지원하면 충분해 별도 라이브러리 없이 직접 짠다.
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

  // index.json에는 목록(버전/날짜/제목/파일명)만 있고 본문은 없다 — 상세를
  // 열 때 그 항목의 .md 파일을 그때그때 fetch해서 읽는다. 본문이 .md 파일
  // 하나에만 있어야 index.json과 내용이 어긋날 일이 없다.
  var openToken = 0;

  // .md 파일의 첫 줄은 "# 버전 - 날짜 - 제목" 헤더이고(12_build_changelog_index.py
  // 참고), 그 아래부터가 실제 마크다운 본문이다.
  function stripHeaderLine(raw) {
    var idx = raw.indexOf('\n');
    return idx === -1 ? '' : raw.slice(idx + 1).replace(/^\n+/, '');
  }

  function openDetail(entry) {
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
    var versionEl = document.createElement('span');
    versionEl.className = 'changelog-version';
    versionEl.textContent = entry.version;
    var dateEl = document.createElement('span');
    dateEl.className = 'changelog-date';
    dateEl.textContent = formatDate(entry.date);
    header.appendChild(versionEl);
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

    fetch(DATA('../data/changelog/' + entry.file))
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
  function createRow(entry) {
    var row = document.createElement('article');
    row.className = 'bkm-row-card';
    row.addEventListener('click', function () { openDetail(entry); });

    var info = document.createElement('div');
    info.className = 'bkm-row-info';

    var title = document.createElement('p');
    title.className = 'bkm-row-title';
    title.textContent = entry.version;
    info.appendChild(title);

    if (entry.title) {
      var sub = document.createElement('p');
      sub.className = 'bkm-row-sub';
      sub.textContent = entry.title;
      info.appendChild(sub);
    }
    row.appendChild(info);

    var date = document.createElement('p');
    date.className = 'bkm-row-count changelog-row-date';
    date.textContent = formatDate(entry.date);
    row.appendChild(date);

    return row;
  }

  function renderList(entries) {
    listEl.innerHTML = '';
    if (!entries.length) {
      var empty = document.createElement('p');
      empty.className = 'changelog-empty';
      empty.textContent = '아직 등록된 업데이트 로그가 없어요.';
      listEl.appendChild(empty);
      return;
    }
    var list = document.createElement('div');
    list.className = 'bkm-row-list';
    entries.forEach(function (entry) {
      list.appendChild(createRow(entry));
    });
    listEl.appendChild(list);
  }

  fetch(DATA('../data/changelog/index.json'))
    .then(function (r) { return r.json(); })
    .then(function (entries) {
      renderList(Array.isArray(entries) ? entries : []);
    })
    .catch(function () {
      renderList([]);
    });
})(window);
