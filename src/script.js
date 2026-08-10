(function () {
  fetch('data.json')
    .then(function (r) { return r.json(); })
    .then(init);

  function init(DATA) {
    var posts = DATA.posts;
    var series = DATA.series;

    document.getElementById('stat-posts').textContent = posts.length.toLocaleString('ko-KR');
    document.getElementById('stat-series').textContent = series.length.toLocaleString('ko-KR');
    document.getElementById('stat-chapters').textContent = series.reduce(function (a, s) { return a + s.c; }, 0).toLocaleString('ko-KR');

    var LINK = function (id) { return 'https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no=' + id; };

    // ---- tag counts ----
    var tagCounts = {};
    posts.forEach(function (p) {
      p.g.forEach(function (t) { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });
    var LEN_TAGS = ['짧문학', '소설', '장문'];
    var tagOrder = Object.keys(tagCounts).filter(function (t) { return LEN_TAGS.indexOf(t) === -1; })
      .sort(function (a, b) { return tagCounts[b] - tagCounts[a]; });

    var tagbar = document.getElementById('tagbar');
    var activeTags = {};
    tagOrder.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = t + '<span class="n">' + tagCounts[t] + '</span>';
      b.addEventListener('click', function () {
        activeTags[t] = !activeTags[t];
        b.setAttribute('aria-pressed', activeTags[t] ? 'true' : 'false');
        state.page = 1;
        render();
      });
      tagbar.appendChild(b);
    });

    var state = { q: '', sortKey: 'i', sortDir: -1, page: 1, pageSize: 100 };

    var searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', function () { state.q = this.value.trim(); state.page = 1; render(); });
    document.getElementById('page-size').addEventListener('change', function () { state.pageSize = parseInt(this.value, 10); state.page = 1; render(); });

    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sortKey === k) { state.sortDir *= -1; } else { state.sortKey = k; state.sortDir = (k === 'i') ? -1 : 1; }
        document.querySelectorAll('th[data-sort] .arrow').forEach(function (a) { a.textContent = ''; });
        th.querySelector('.arrow').textContent = state.sortDir === 1 ? '▲' : '▼';
        render();
      });
    });

    function filtered() {
      var q = state.q.toLowerCase();
      var activeList = Object.keys(activeTags).filter(function (k) { return activeTags[k]; });
      return posts.filter(function (p) {
        if (q && p.t.toLowerCase().indexOf(q) === -1) return false;
        if (activeList.length && !activeList.every(function (t) { return p.g.indexOf(t) !== -1; })) return false;
        return true;
      });
    }

    function sortRows(rows) {
      var k = state.sortKey, dir = state.sortDir;
      return rows.slice().sort(function (a, b) {
        var av = k === 'g' ? (a.g[0] || '') : k === 'c' ? parseInt((a.c || '0'), 10) : a[k];
        var bv = k === 'g' ? (b.g[0] || '') : k === 'c' ? parseInt((b.c || '0'), 10) : b[k];
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }

    function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function render() {
      var rows = sortRows(filtered());
      document.getElementById('count-line').innerHTML = '<b>' + rows.length.toLocaleString('ko-KR') + '</b>건 표시 중 (전체 ' + posts.length.toLocaleString('ko-KR') + '건)';
      var totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      if (state.page > totalPages) state.page = totalPages;
      var start = (state.page - 1) * state.pageSize;
      var pageRows = rows.slice(start, start + state.pageSize);

      var tbody = document.getElementById('post-rows');
      tbody.innerHTML = pageRows.map(function (p) {
        var tagsHtml = p.g.map(function (t) {
          var cls = LEN_TAGS.indexOf(t) !== -1 ? 'tg len' : 'tg';
          return '<span class="' + cls + '">' + esc(t) + '</span>';
        }).join('');
        return '<tr><td class="id">' + p.i + '</td><td class="title"><a href="' + LINK(p.i) + '" target="_blank" rel="noopener">' + esc(p.t) + '</a></td><td class="tags">' + tagsHtml + '</td><td>' + esc(p.c || '') + '</td></tr>';
      }).join('');

      var pager = document.getElementById('pager');
      pager.innerHTML = '';
      var prev = document.createElement('button'); prev.textContent = '이전'; prev.disabled = state.page <= 1;
      prev.addEventListener('click', function () { state.page--; render(); window.scrollTo({ top: 0 }); });
      var next = document.createElement('button'); next.textContent = '다음'; next.disabled = state.page >= totalPages;
      next.addEventListener('click', function () { state.page++; render(); window.scrollTo({ top: 0 }); });
      var info = document.createElement('span'); info.className = 'p-info'; info.textContent = state.page + ' / ' + totalPages + ' 페이지';
      pager.appendChild(prev); pager.appendChild(info); pager.appendChild(next);
    }
    render();

    // ---- series tab ----
    var seriesGrid = document.getElementById('series-grid');
    document.getElementById('series-count-line').innerHTML = '<b>' + series.length + '</b>개 시리즈 · <b>' + series.reduce(function (a, s) { return a + s.c; }, 0) + '</b>화';
    function renderSeries(list) {
      seriesGrid.innerHTML = list.map(function (s) {
        var chaptersHtml = s.ch.map(function (c) {
          return '<div class="s-ch"><span class="cn">' + c.n + '</span><a href="' + LINK(c.i) + '" target="_blank" rel="noopener">' + esc(c.t) + '</a></div>';
        }).join('');
        return '<details class="s-card"><summary><span class="s-name">' + esc(s.n) + '</span><span class="s-count">' + s.c + '화</span></summary><div class="s-tagline">' + esc(s.g) + '</div><div class="s-chapters">' + chaptersHtml + '</div></details>';
      }).join('');
    }
    renderSeries(series);
    document.getElementById('series-search').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      renderSeries(series.filter(function (s) { return s.n.toLowerCase().indexOf(q) !== -1; }));
    });

    // ---- tabs ----
    var tabPostsBtn = document.getElementById('tab-posts-btn');
    var tabSeriesBtn = document.getElementById('tab-series-btn');
    var panelPosts = document.getElementById('panel-posts');
    var panelSeries = document.getElementById('panel-series');
    function selectTab(which) {
      var postsSel = which === 'posts';
      tabPostsBtn.setAttribute('aria-selected', postsSel);
      tabSeriesBtn.setAttribute('aria-selected', !postsSel);
      panelPosts.classList.toggle('active', postsSel);
      panelSeries.classList.toggle('active', !postsSel);
    }
    tabPostsBtn.addEventListener('click', function () { selectTab('posts'); });
    tabSeriesBtn.addEventListener('click', function () { selectTab('series'); });
  }
})();
