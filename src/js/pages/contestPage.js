// 대회 페이지 — /contest 는 대회 목록, /contest?c=<id> 는 그 대회 참가작 그리드.
//
// [대회 목록 데이터] src/data/pageData/Contest.json 을 손으로 편집합니다.
// 빌드 스크립트가 만드는 파일이 아니므로 재빌드로 덮어써지지 않습니다.
// 배열 순서가 그대로 목록 순서이고, 항목 하나가 카드 하나(Figma Contest_List,
// #2298:2)입니다.
//   · id             : 주소에 쓰는 영문 식별자 (/contest?c=<id>)
//   · name           : 카드 제목 (Contest_Name)
//   · shortName      : 약칭 (검색창 안내 문구와 탭 제목에 씀)
//   · description    : 카드 설명 (Contest_Info)
//   · startDate/endDate : "YYYY-MM-DD". 기간 옆에 D-day 나 종료 표시가 붙음
//   · notices        : [{ label, url }] 개최·공지 글 링크. 상세 카드에 버튼으로
//                      나란히 붙음 (목록 카드는 카드 전체가 링크라 넣지 않음).
//                      label 을 비우면 "개최 글 보기"
//   · image          : 카드 상단 배너 (Image). 비우면 참가작 중 첫 이미지를 씀
//   · imagePosition  : 배너에서 보일 부분 (CSS background-position, 예:
//                      "center 25%"). 비우면 가운데
//   · characterImage : 카드 오른쪽 캐릭터 (Character_Image). 비우면 숨김
//   · posts          : 참가작 게시글 번호 목록
//   · titleKeywords  : 제목에 이 글자가 들어간 글도 참가작으로 침 (진행 중인
//                      대회에서 posts 를 매번 갱신하지 않으려고 쓸 때만)
// 이미지 경로는 다른 데이터와 같이 "../assets/image/..." 로 적으면 R2 CDN
// 으로 바뀝니다(cdnConfig.js). 새 이미지는 sync_to_r2.py 로 올려야 보입니다.
// "../offlineSrc/..." 로 적으면 R2 를 거치지 않고 사이트에서 바로 받습니다
// (대회 배너는 offlineSrc/contest/ 에 둠).
//
// [참가작] Novel.json(시리즈에 속하지 않은 단독 글)에서 골라냅니다. 시리즈
// 회차로 들어간 글은 문학 탭과 마찬가지로 여기에도 나오지 않습니다.
// Contest.json 을 고치면 src/scripts/10_update_data_version.py 로
// DATA_VERSION 을 올려야 브라우저가 새 목록을 받아 갑니다.
(function (global) {
  var t = global.I18n.t;
  var CONTEST_URL = '../data/pageData/Contest.json';
  var NOVEL_URL = '../data/pageData/Novel.json';
  // HTML <title>("초카공 문학&번역 • 대회") 뒤에 대회 이름을 붙인다. 상세를
  // 다시 그려도 이름이 겹겹이 붙지 않도록 처음 제목을 따로 잡아 둔다.
  var BASE_TITLE = document.title;

  var body = document.body;
  var listEl = document.getElementById('contest-list');
  var heroEl = document.getElementById('contest-hero');
  if (!body || !listEl || !heroEl) return;

  var DATA = global.dataUrl || function (p) { return p; };
  var fetchJson = global.fetchJsonCached || function (p) {
    return fetch(DATA(p)).then(function (r) { return r.json(); });
  };

  var selectedId = new URLSearchParams(global.location.search).get('c');

  function postIdSet(contest) {
    var set = {};
    (contest.posts || []).forEach(function (id) { set[String(id)] = true; });
    return set;
  }

  function matcher(contest) {
    var ids = postIdSet(contest);
    var keywords = (contest.titleKeywords || []).filter(Boolean);
    return function (item) {
      var posts = item.posts || [];
      for (var i = 0; i < posts.length; i++) {
        if (ids[String(posts[i].id)]) return true;
      }
      var name = item.name || '';
      for (var k = 0; k < keywords.length; k++) {
        if (name.indexOf(keywords[k]) !== -1) return true;
      }
      return false;
    };
  }

  // "2026-03-19" → 로컬 자정 Date. new Date('2026-03-19') 는 UTC 로 해석돼
  // 한국 시간 기준 D-day 가 하루 어긋날 수 있어 직접 나눈다.
  function parseDate(str) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function formatDate(d) {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function daysBetween(from, to) {
    return Math.round((to - from) / 86400000);
  }

  // Figma 의 "대회 기간 (D-15)" 자리. 시작 전이면 시작까지, 진행 중이면
  // 마감까지 남은 날을 세고, 끝났으면 "종료"로 표시한다.
  function periodText(contest) {
    var start = parseDate(contest.startDate);
    var end = parseDate(contest.endDate);
    if (!start && !end) return '';
    var range = start && end
      ? formatDate(start) + ' ~ ' + formatDate(end)
      : formatDate(start || end);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var status;
    if (start && today < start) {
      status = t('시작 D-{n}', { n: daysBetween(today, start) });
    } else if (end && today > end) {
      status = t('종료');
    } else if (end) {
      var left = daysBetween(today, end);
      status = left === 0 ? 'D-Day' : 'D-' + left;
    } else {
      status = t('진행 중');
    }
    return range + ' (' + status + ')';
  }

  // 카드의 "참가작 N편"이 그리드 개수와 어긋나지 않도록, gridPage.js 의
  // recomputeAllItems 와 같은 기준으로 후방주의 글을 뺀다(설정이 꺼져 있을 때).
  function visibleItems(items) {
    var CS = global.ContentSettings;
    if (!CS || CS.get().showMature) return items;
    return items.filter(function (s) { return !CS.hasMatureTag(s.tags); });
  }

  // offlineSrc/ 는 R2 가 아니라 오리진에서 서빙한다(theme.js 의 로고와 같은
  // 예외). resolveAssetUrl 에 넘기면 R2 의 없는 주소로 바뀐다.
  function isOriginPath(path) {
    return /^(\.\.\/|\/)offlineSrc\//.test(path || '');
  }

  function firstImage(items) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].image) return items[i].image;
    }
    return '';
  }

  // 대회 카드 한 장 (Figma Contest_List #2298:2). href 가 있으면 목록용
  // 링크 카드, 없으면 상세 페이지 상단에 얹는 정적 카드가 된다.
  function createContestCard(contest, entries, href) {
    var card = document.createElement(href ? 'a' : 'div');
    card.className = 'contest-card';
    if (href) card.href = href;

    var banner = document.createElement('div');
    banner.className = 'contest-card-banner';
    var bannerSrc = contest.image || firstImage(entries);
    if (bannerSrc) {
      if (contest.image && contest.imagePosition) {
        banner.style.backgroundPosition = contest.imagePosition;
      }
      if (isOriginPath(bannerSrc)) {
        banner.style.backgroundImage = 'url("' + bannerSrc + '")';
      } else if (global.revealBackgroundProgressive) {
        global.revealBackgroundProgressive(banner, bannerSrc);
      } else {
        banner.style.backgroundImage = 'url("' + bannerSrc + '")';
      }
    } else {
      banner.classList.add('is-empty');
    }
    card.appendChild(banner);

    if (contest.characterImage) {
      var character = document.createElement('img');
      character.className = 'contest-card-character';
      character.alt = '';
      character.loading = 'lazy';
      character.src = global.resolveAssetUrl && !isOriginPath(contest.characterImage)
        ? global.resolveAssetUrl(contest.characterImage)
        : contest.characterImage;
      card.appendChild(character);
      card.classList.add('has-character');
    }

    var info = document.createElement('div');
    info.className = 'contest-card-body';

    var period = periodText(contest);
    if (period) {
      var date = document.createElement('p');
      date.className = 'contest-card-date';
      date.textContent = period;
      info.appendChild(date);
    }

    var name = document.createElement(href ? 'h2' : 'h1');
    name.className = 'contest-card-name';
    name.textContent = contest.name || contest.shortName || contest.id;
    info.appendChild(name);

    if (contest.description) {
      var desc = document.createElement('p');
      desc.className = 'contest-card-info';
      desc.textContent = contest.description;
      info.appendChild(desc);
    }

    var count = document.createElement('p');
    count.className = 'contest-card-count';
    count.textContent = t('참가작 {n}편', { n: entries.length });
    info.appendChild(count);

    // 목록 카드는 <a> 라서 안에 링크를 또 넣을 수 없다. 상세 카드에만 단다.
    var notices = (contest.notices || []).filter(function (n) { return n && n.url; });
    if (!href && notices.length) {
      var noticeRow = document.createElement('div');
      noticeRow.className = 'contest-card-notices';
      notices.forEach(function (n) {
        var notice = document.createElement('a');
        notice.className = 'contest-card-notice';
        notice.href = n.url;
        notice.target = '_blank';
        notice.rel = 'noopener noreferrer';
        notice.textContent = (n.label || t('개최 글 보기')) + ' ↗';
        noticeRow.appendChild(notice);
      });
      info.appendChild(noticeRow);
    }

    card.appendChild(info);
    return card;
  }

  function renderList(contests, novels) {
    body.classList.add('is-contest-list');
    listEl.hidden = false;
    listEl.textContent = '';
    if (!contests.length) {
      var empty = document.createElement('p');
      empty.className = 'contest-list-empty';
      empty.textContent = t('아직 등록된 대회가 없어요.');
      listEl.appendChild(empty);
      return;
    }
    contests.forEach(function (contest) {
      if (!contest || !contest.id) return;
      var entries = visibleItems(novels.filter(matcher(contest)));
      listEl.appendChild(createContestCard(
        contest,
        entries,
        '/contest?c=' + encodeURIComponent(contest.id)
      ));
    });
  }

  function renderDetail(contest, novels) {
    body.classList.add('is-contest-detail');
    var match = matcher(contest);
    var entries = visibleItems(novels.filter(match));

    heroEl.hidden = false;
    heroEl.textContent = '';
    var back = document.createElement('a');
    back.className = 'contest-back-link';
    back.href = '/contest';
    back.textContent = '← ' + t('대회 목록');
    heroEl.appendChild(back);
    heroEl.appendChild(createContestCard(contest, entries, null));

    document.title = BASE_TITLE + ' — ' + (contest.shortName || contest.name);
    var searchInput = document.getElementById('series-search-input');
    if (searchInput) searchInput.placeholder = t('{name} 참가작 검색', { name: contest.shortName || contest.name });

    global.GridPage.create({
      dataUrl: NOVEL_URL,
      favType: 'novel',
      userTags: true,
      filterItems: function (items) { return items.filter(match); },
      countText: function (n) { return t('{n}개의 참가작이 있습니다!', { n: n }); },
      emptyText: t('조건에 맞는 참가작이 없어요.')
    });
  }

  Promise.all([
    fetchJson(CONTEST_URL).then(function (d) { return Array.isArray(d) ? d : []; }),
    fetchJson(NOVEL_URL).then(function (d) { return Array.isArray(d) ? d : []; })
  ]).then(function (results) {
    var contests = results[0];
    var novels = results[1];
    var selected = null;
    if (selectedId) {
      for (var i = 0; i < contests.length; i++) {
        if (contests[i] && contests[i].id === selectedId) { selected = contests[i]; break; }
      }
    }
    // 없는 id 로 들어오면 빈 그리드 대신 목록을 보여준다.
    if (selected) renderDetail(selected, novels);
    else renderList(contests, novels);
  }).catch(function () {
    renderList([], []);
  });
})(window);
