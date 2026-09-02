/**
 * statsPage.js — 관리자용 방문자 통계 화면(/stats)의 클라이언트.
 *
 * - 관리자 토큰(STATS_ADMIN_TOKEN)을 한 번 받아 localStorage에 저장하고,
 *   모든 조회에 Authorization: Bearer 로 실어 보낸다.
 * - /api/stats/summary 하나로 상단 타일(현재/피크 동시 접속자, 오늘·7일·
 *   30일 순 방문자)과 30일 그래프까지 채운다. 기간 버튼(7/30/90일)을 누르면
 *   /api/stats/visitors 를 따로 부른다.
 * - 동시 접속자 수치는 15초마다 다시 불러 갱신한다.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'cpkg_stats_token';
  var REFRESH_MS = 15000;

  var gate = document.getElementById('gate');
  var gateForm = document.getElementById('gate-form');
  var gateInput = document.getElementById('gate-input');
  var gateErr = document.getElementById('gate-err');
  var app = document.getElementById('app');
  var tilesEl = document.getElementById('tiles');
  var chartEl = document.getElementById('chart');
  var chartMsg = document.getElementById('chart-msg');
  var tableBody = document.getElementById('table-body');
  var refreshedEl = document.getElementById('refreshed');
  var rangeBtns = document.getElementById('range-btns');
  var hintEl = document.getElementById('hint');

  var token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  var currentDays = 30;
  var refreshTimer = null;

  function api(path) {
    return fetch(path, { headers: { 'Authorization': 'Bearer ' + token } });
  }

  function fmt(n) {
    return (typeof n === 'number' ? n : 0).toLocaleString('ko-KR');
  }

  function fmtTime(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString('ko-KR', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  // ---- 게이트 ----

  function showGate(message) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    app.hidden = true;
    gate.hidden = false;
    gateErr.textContent = message || '';
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
  }

  gateForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = gateInput.value.trim();
    if (!value) return;
    token = value;
    gateErr.textContent = '확인 중...';
    loadAll().then(function (ok) {
      if (ok) {
        try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
        showApp();
        startRefresh();
      }
    });
  });

  document.getElementById('btn-logout').addEventListener('click', function () {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    token = '';
    gateInput.value = '';
    showGate('');
  });

  // ---- 렌더링 ----

  function renderTiles(summary) {
    var p = (summary && summary.presence) || {};
    var v = (summary && summary.visitors) || {};
    var online = typeof p.online === 'number' ? p.online : null;
    var tiles = [
      {
        cls: 'tile live',
        label: '현재 접속자',
        value: online === null ? '—' : ('<span class="live-dot"></span>' + fmt(online)),
        unit: '명',
        meta: p.error ? '집계 준비 중' : '25초 하트비트 기준'
      },
      {
        label: '오늘 피크',
        value: fmt(p.peakToday || 0), unit: '명',
        meta: p.peakTodayAt ? fmtTime(p.peakTodayAt) + ' 기록' : '아직 기록 없음'
      },
      {
        label: '역대 피크',
        value: fmt(p.peakAllTime || 0), unit: '명',
        meta: p.peakAllTimeAt ? fmtTime(p.peakAllTimeAt) + ' 기록' : '아직 기록 없음'
      },
      { label: '오늘 순 방문자', value: fmt(v.today || 0), unit: '명', meta: '페이지뷰 ' + fmt(v.todayPageviews || 0) },
      { label: '최근 7일 순 방문자', value: fmt(v.last7d || 0), unit: '명', meta: '일 합계' },
      { label: '최근 30일 순 방문자', value: fmt(v.last30d || 0), unit: '명', meta: '일 합계' }
    ];
    tilesEl.innerHTML = tiles.map(function (t) {
      return '<div class="' + (t.cls || 'tile') + '">' +
        '<div class="label">' + t.label + '</div>' +
        '<div class="value">' + t.value + '<span class="unit">' + t.unit + '</span></div>' +
        '<div class="meta">' + (t.meta || '') + '</div>' +
        '</div>';
    }).join('');
  }

  function renderChart(rows) {
    if (!rows || !rows.length) {
      chartEl.innerHTML = '';
      chartMsg.hidden = false;
      chartMsg.textContent = '아직 기록된 방문 데이터가 없습니다. 배포 후 방문이 쌓이면 표시됩니다.';
      return;
    }
    chartMsg.hidden = true;

    var W = 720, H = 220, padL = 40, padR = 12, padT = 12, padB = 24;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var max = rows.reduce(function (m, r) { return Math.max(m, r.uniques); }, 0) || 1;
    var niceMax = Math.ceil(max / 5) * 5 || 5;
    var gap = rows.length > 40 ? 1 : 3;
    var barW = Math.max(1, (innerW / rows.length) - gap);

    var parts = [];
    // Y 기준선 3개(0, 절반, 최대)
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + innerH - innerH * f;
      var val = Math.round(niceMax * f);
      parts.push('<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>');
      parts.push('<text class="axis-label" x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + val + '</text>');
    });

    rows.forEach(function (r, i) {
      var h = innerH * (r.uniques / niceMax);
      var x = padL + i * (innerW / rows.length);
      var y = padT + innerH - h;
      parts.push('<rect class="bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '">' +
        '<title>' + r.day + ' · 순 방문자 ' + fmt(r.uniques) + ' · 페이지뷰 ' + fmt(r.pageviews) + '</title></rect>');
    });

    // X 라벨은 대략 6개만
    var step = Math.max(1, Math.round(rows.length / 6));
    rows.forEach(function (r, i) {
      if (i % step !== 0 && i !== rows.length - 1) return;
      var x = padL + i * (innerW / rows.length) + barW / 2;
      var label = r.day.slice(5); // MM-DD
      parts.push('<text class="axis-label" x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + label + '</text>');
    });

    chartEl.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="일별 순 방문자 막대 그래프">' +
      parts.join('') + '</svg>';
  }

  function renderTable(rows) {
    if (!rows || !rows.length) { tableBody.innerHTML = ''; return; }
    tableBody.innerHTML = rows.slice().reverse().map(function (r) {
      return '<tr><td>' + r.day + '</td><td>' + fmt(r.uniques) + '</td><td>' + fmt(r.pageviews) + '</td></tr>';
    }).join('');
  }

  // ---- 로딩 ----

  // summary(현재 접속자 + 30일 시계열)를 부른다. 성공하면 true.
  // 401이면 게이트로 되돌리고, 503이면 안내 문구를 띄운다.
  function loadAll() {
    return api('/api/stats/summary').then(function (res) {
      if (res.status === 401) { showGate('토큰이 올바르지 않습니다.'); return false; }
      if (res.status === 503) { showGate('서버에 STATS_ADMIN_TOKEN이 아직 설정되지 않았습니다.'); return false; }
      if (!res.ok) { showGate('불러오지 못했습니다 (' + res.status + ').'); return false; }
      return res.json().then(function (data) {
        renderTiles(data);
        var series = (data.visitors && data.visitors.series) || [];
        if (currentDays === 30) {
          renderChart(series);
          renderTable(series);
        } else {
          loadVisitors(currentDays);
        }
        refreshedEl.textContent = '갱신 ' + fmtTime(Date.now());
        updateHint(data);
        return true;
      });
    }).catch(function () {
      showGate('네트워크 오류로 불러오지 못했습니다.');
      return false;
    });
  }

  function loadVisitors(days) {
    return api('/api/stats/visitors?days=' + days).then(function (res) {
      if (!res.ok) return;
      return res.json().then(function (data) {
        renderChart(data.rows || []);
        renderTable(data.rows || []);
      });
    }).catch(function () {});
  }

  function updateHint(data) {
    var parts = [];
    if (data.presence && data.presence.error) {
      parts.push('동시 접속자 집계(Durable Object)가 아직 응답하지 않습니다. 첫 배포 직후라면 잠시 뒤 다시 시도해주세요.');
    }
    var v = data.visitors || {};
    if (!v.series || !v.series.length) {
      parts.push('순 방문자 그래프는 Analytics Engine에 방문이 쌓인 뒤부터 채워집니다.');
    }
    hintEl.textContent = parts.join(' ');
  }

  function startRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      // 배경 갱신은 게이트로 튕기지 않도록 조용히 처리한다(토큰 만료 시에만 이동).
      api('/api/stats/summary').then(function (res) {
        if (res.status === 401) { showGate('토큰이 만료되었습니다. 다시 입력해주세요.'); return; }
        if (!res.ok) return;
        return res.json().then(function (data) {
          renderTiles(data);
          if (currentDays === 30) {
            var series = (data.visitors && data.visitors.series) || [];
            renderChart(series);
            renderTable(series);
          }
          refreshedEl.textContent = '갱신 ' + fmtTime(Date.now());
        });
      }).catch(function () {});
    }, REFRESH_MS);
  }

  rangeBtns.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-days]');
    if (!btn) return;
    currentDays = parseInt(btn.getAttribute('data-days'), 10) || 30;
    Array.prototype.forEach.call(rangeBtns.children, function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    loadVisitors(currentDays);
  });

  // ---- 시작 ----
  if (!token) {
    showGate('');
  } else {
    loadAll().then(function (ok) {
      if (ok) { showApp(); startRefresh(); }
    });
  }
})();
