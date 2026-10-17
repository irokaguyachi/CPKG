(function (global) {
  var t = global.I18n.t;
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';

  var overlayEl = null;

  // 오버레이가 뷰포트를 덮고 있어도 그 위에서 휠을 굴리면 배경 페이지가
  // 대신 스크롤됐다 — 오버레이 자체는 스크롤 대상이 아니라서 브라우저가
  // 스크롤 가능한 가장 가까운 조상인 html/body로 스크롤을 넘겼기 때문.
  // loading.js 의 lockScroll/unlockScroll 과 동일한 패턴.
  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  // PC 모달은 예전엔 1552x1064 로 그린 뒤 0.62배로 줄여 띄웠다(창이 낮으면
  // 비율을 더 줄이는 applyFitScale 도 있었다). 지금은 modal-series.css 의 PC
  // 블록이 min(980px, 92vw) x min(640px, 85vh) 실제 크기로 그리므로 축소가 없다.

  // 모달 배경에 깔 대표 장르 태그 색 — 장르 태그가 둘이면 두 번째 색을
  // 반대쪽 모서리에 깐다. 색이 정해진 태그가 없으면 기본 색 하나만 쓴다.
  function applyTagTint(card, tags) {
    var cfg = global.TagConfig;
    var picked = (cfg && cfg.coverTags) ? cfg.coverTags(tags, 2) : [];
    if (!picked.length || !cfg.glowValue) return;
    // 관리 페이지에서 정의한 새 태그는 tags.css 에 변수가 없으므로 glowValue 가
    // 정의 색이나 기본 색으로 바꿔 준다(없는 변수를 쓰면 배경이 통째로 사라진다).
    card.style.setProperty('--pds-tint-1', cfg.glowValue(picked[0]));
    card.style.setProperty('--pds-tint-2', cfg.glowValue(picked[1] || picked[0]));
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'pds-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // 태그 선택 모달이 위에 떠 있으면 그것부터 닫는다(상세 팝업까지 한
      // 번에 닫히면 모달 두 개가 한꺼번에 사라져 당황스럽다).
      if (tagPickerOverlayEl) closeTagPicker();
      else close();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  // ---- 공식 태그 / 유저 인기 태그 섹션 ----
  // "공식 태그"는 AI가 분류해 둔 기존 장르 태그를 그대로 정적으로 보여주는
  // 줄이고(투표 불가), "유저 인기 태그"는 스팀 "이 제품의 태그 보기 및 변경"
  // 다이얼로그를 본뜬 투표 UI다. 둘은 별개 레이어 — 공식 태그를 유저 투표로
  // 대체하는 게 아니라 그 위에 얹는다. 자유 입력 없음 — pageData/
  // UserTagCatalog.json(문학 정리/유저인기태그후보.md에서 사람이 직접 정한
  // 후보)에서만 투표 가능하다. 메인 줄에는 득표 상위 3개만 보이고(0표뿐이면
  // 아무것도 안 보임), `+`를 누르면 전체 후보를 고를 수 있는 별도 모달이
  // 뜬다(스팀처럼 인라인으로 옆에 펼치지 않음).
  var TAG_TOP_VISIBLE = 3;
  // 태그 UI 자체를 그리는 favType 목록. novel은 공식+유저 두 줄, translation은
  // gridPage.js의 config.userTagsOnly와 짝을 맞춰 유저 인기 태그 줄만 그린다
  // (공식 태그는 data.tags가 항상 빈 배열이라 renderOfficialTagsRow 호출 자체가
  // 자연히 스킵된다 — 아래 open()의 tags.length 체크 참고). 시리즈/명예관/공식은
  // 사용자가 직접 관리하는 영역이라 여전히 대상이 아니다.
  var TAG_ENABLED_FAV_TYPES = { novel: true, translation: true };
  var tagCatalogPromise = null;
  // 태그 선택 모달은 상세 팝업(.pds-overlay) 위에 겹쳐 뜨는 별도 오버레이라,
  // Escape 키가 상세 팝업이 아니라 이 모달부터 닫도록 ensureOverlay의 전역
  // keydown 핸들러가 이 변수를 확인한다.
  var tagPickerOverlayEl = null;

  function closeTagPicker() {
    if (!tagPickerOverlayEl) return;
    tagPickerOverlayEl.remove();
    tagPickerOverlayEl = null;
  }

  function getTagCatalog() {
    if (!tagCatalogPromise) {
      var fetchJson = global.fetchJsonCached || function (p) { return fetch(p).then(function (r) { return r.json(); }); };
      var dataUrl = global.dataUrl || function (p) { return p; };
      tagCatalogPromise = fetchJson(dataUrl('../data/pageData/UserTagCatalog.json'))
        .then(function (list) { return Array.isArray(list) ? list : []; })
        .catch(function () {
          // 실패를 캐시해버리면 네트워크가 살아난 뒤에도 새로고침 전까지
          // 계속 빈 후보 목록만 보인다 — 다음 호출이 다시 시도하게 한다.
          tagCatalogPromise = null;
          return [];
        });
    }
    return tagCatalogPromise;
  }

  function postTagsJson(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (data) {
        var err = new Error((data && data.error && t(data.error)) || t('요청에 실패했어요 ({code})', { code: res.status }));
        err.status = res.status;
        throw err;
      });
    });
  }

  // 정적 표시 전용 — AI가 이미 분류해 둔 태그를 그대로 알약으로 보여줄 뿐,
  // 클릭해도 아무 일도 일어나지 않는다(투표는 유저 인기 태그 쪽에서만).
  function renderOfficialTagsRow(tags) {
    var section = document.createElement('div');
    section.className = 'pds-tags pds-tags-official';

    var label = document.createElement('p');
    label.className = 'pds-tags-label';
    label.textContent = t('공식 태그');
    section.appendChild(label);

    var pillsWrap = document.createElement('div');
    pillsWrap.className = 'pds-tags-pills';
    section.appendChild(pillsWrap);
    var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
    var DEFAULT_EMOJI = global.TagConfig.DEFAULT_EMOJI;
    var sortTags = global.TagConfig.sortTags;

    (sortTags ? sortTags(tags) : tags).forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'pds-tag-pill pds-tag-static';
      pill.dataset.tag = tag;
      pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
      pillsWrap.appendChild(pill);
    });

    return section;
  }

  function renderUserTagsSection(postId) {
    var section = document.createElement('div');
    section.className = 'pds-tags pds-tags-user';

    var label = document.createElement('p');
    label.className = 'pds-tags-label';
    label.textContent = t('유저 인기 태그');
    section.appendChild(label);

    var pillsWrap = document.createElement('div');
    pillsWrap.className = 'pds-tags-pills';
    section.appendChild(pillsWrap);

    var errorEl = document.createElement('p');
    errorEl.className = 'pds-tags-error';
    errorEl.hidden = true;
    section.appendChild(errorEl);
    var errorTimer = null;
    function showTagError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(function () { errorEl.hidden = true; }, 4000);
    }
    var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
    var DEFAULT_EMOJI = global.TagConfig.DEFAULT_EMOJI;

    var catalog = [];
    var votes = {};
    var myTags = [];
    // 관리 페이지에서 투표를 잠근 작품(worker/adminTags.js). 기존 표는 보이고 새 투표만 막힌다.
    var locked = false;
    var LOCKED_MESSAGE = t('이 작품은 투표가 잠겨 있어요');
    var pending = {};
    var pickerListEl = null; // 모달이 열려 있을 때만 채워짐

    function currentPersonalCode() {
      return (global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn())
        ? global.BookmarkLibrary.getPersonalCode()
        : null;
    }

    function sortedCatalog() {
      return catalog.slice().sort(function (a, b) { return (votes[b] || 0) - (votes[a] || 0); });
    }

    // 메인 줄: 득표가 있는 태그만, 상위 3개까지만 보여준다. 득표가 하나도
    // 없으면 "+" 버튼만 남는다(처음엔 비어 있는 상태) — 스팀도 아무도 안 단
    // 태그는 목록에서 아예 빠진다.
    function renderMainRow() {
      pillsWrap.innerHTML = '';
      sortedCatalog()
        .filter(function (t) { return (votes[t] || 0) > 0; })
        .slice(0, TAG_TOP_VISIBLE)
        .forEach(function (tag) { pillsWrap.appendChild(createPill(tag)); });

      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'pds-tag-pill pds-tag-more';
      addBtn.setAttribute('aria-label', t('태그 선택'));
      addBtn.textContent = '+';
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openPicker();
      });
      pillsWrap.appendChild(addBtn);
    }

    function createPill(tag) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pds-tag-pill' + (myTags.indexOf(tag) !== -1 ? ' is-voted' : '');
      pill.dataset.tag = tag;
      pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
      pill.title = t('{n}표', { n: votes[tag] || 0 });
      pill.addEventListener('click', function (e) {
        e.stopPropagation();
        vote(tag);
      });
      return pill;
    }

    // 스팀 "이 제품의 태그 보기 및 변경" 다이얼로그를 본뜬 전체 후보 목록.
    // 메인 줄과 별개 오버레이라 상세 팝업 위에 겹쳐 뜬다.
    function openPicker() {
      if (tagPickerOverlayEl) return;

      var overlay = document.createElement('div');
      overlay.className = 'pds-tagpicker-overlay';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeTagPicker();
      });

      var dialog = document.createElement('div');
      dialog.className = 'pds-tagpicker-dialog';
      dialog.addEventListener('click', function (e) { e.stopPropagation(); });
      overlay.appendChild(dialog);

      var header = document.createElement('div');
      header.className = 'pds-tagpicker-header';
      var title = document.createElement('h3');
      title.className = 'pds-tagpicker-title';
      title.textContent = t('태그 보기 및 변경');
      header.appendChild(title);
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pds-tagpicker-close';
      closeBtn.setAttribute('aria-label', t('닫기'));
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeTagPicker();
      });
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      var sub = document.createElement('p');
      sub.className = 'pds-tagpicker-sub';
      dialog.appendChild(sub);

      var list = document.createElement('div');
      list.className = 'pds-tagpicker-list';
      dialog.appendChild(list);
      pickerListEl = list;

      renderPicker(sub);

      document.body.appendChild(overlay);
      tagPickerOverlayEl = overlay;
    }

    function renderPicker(subEl) {
      if (subEl) {
        var popularCount = catalog.filter(function (t) { return (votes[t] || 0) > 0; }).length;
        subEl.textContent = t('이 문학의 인기 태그: {n}개', { n: popularCount }) + (locked ? ' · ' + LOCKED_MESSAGE : '');
      }
      if (!pickerListEl) return;
      pickerListEl.innerHTML = '';
      sortedCatalog().forEach(function (tag) {
        pickerListEl.appendChild(createPickerRow(tag));
        if (openVoters[tag] && (votes[tag] || 0) > 0) pickerListEl.appendChild(votersPanel(tag));
      });
    }

    // 태그별 투표자(유저 프로필 2단계, worker 의 /tags/voters). "n표" 를 누르면 그 줄
    // 아래에 펼친다. 목록은 투표할 때마다 다시 그려지므로 펼친 태그와 받아 온 결과를
    // 따로 들고 있고, 투표한 태그의 결과는 버려 다음에 새로 받는다.
    var openVoters = {};
    var votersCache = {};
    function loadVoters(tag) {
      if (!votersCache[tag]) {
        votersCache[tag] = postTagsJson('/tags/voters', { postId: postId, tagName: tag }).then(function (res) {
          var ids = (res && res.profileIds) || [];
          return Promise.all([global.ProfileStore.fetchMany(ids), global.ProfileStore.catalog()]).then(function (r) {
            return { ids: ids, anonymous: (res && res.anonymous) || 0, profiles: r[0], catalog: r[1] };
          });
        });
        votersCache[tag].catch(function () { delete votersCache[tag]; });
      }
      return votersCache[tag];
    }

    function votersPanel(tag) {
      var panel = document.createElement('div');
      panel.className = 'pds-tagpicker-voters';
      if (!global.ProfileStore || !global.ProfileCard) return panel;
      panel.textContent = t('불러오는 중…');
      loadVoters(tag).then(function (v) {
        panel.textContent = '';
        panel.appendChild(global.ProfileCard.voterList(v.ids, v.anonymous, v.profiles, v.catalog));
      }, function () {
        panel.textContent = t('잠시 후 다시 시도해 주세요');
      });
      return panel;
    }

    function createPickerRow(tag) {
      var voted = myTags.indexOf(tag) !== -1;
      var row = document.createElement('div');
      row.className = 'pds-tagpicker-row' + (voted ? ' is-added' : '');

      var emoji = document.createElement('span');
      emoji.className = 'pds-tagpicker-row-emoji';
      emoji.textContent = TAG_EMOJI[tag] || DEFAULT_EMOJI;
      row.appendChild(emoji);

      var name = document.createElement('span');
      name.className = 'pds-tagpicker-row-label';
      name.textContent = tag;
      row.appendChild(name);

      var count = document.createElement('button');
      count.type = 'button';
      count.className = 'pds-tagpicker-row-count';
      count.textContent = t('{n}표', { n: votes[tag] || 0 });
      count.disabled = !((votes[tag] || 0) > 0);
      count.setAttribute('aria-expanded', String(!!openVoters[tag]));
      count.setAttribute('aria-label', t('투표한 사람 보기') + ': ' + tag);
      count.addEventListener('click', function (e) {
        e.stopPropagation();
        openVoters[tag] = !openVoters[tag];
        renderPicker();
      });
      row.appendChild(count);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pds-tagpicker-row-btn';
      btn.textContent = voted ? '✓' : '+';
      btn.disabled = locked;
      btn.setAttribute('aria-label', (voted ? t('태그 투표 취소') : t('태그 투표')) + ': ' + tag);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        vote(tag);
      });
      row.appendChild(btn);

      return row;
    }

    function vote(tag) {
      if (pending[tag]) return;
      if (locked) {
        showTagError(LOCKED_MESSAGE);
        return;
      }
      var personalCode = currentPersonalCode();
      if (!personalCode) {
        if (!global.AuthModal) return;
        global.AuthModal.requireLogin({
          reason: t('태그에 투표하려면 로그인이 필요해요'),
          onSuccess: function () { vote(tag); }
        });
        return;
      }

      pending[tag] = true;
      delete votersCache[tag];
      var hadVote = myTags.indexOf(tag) !== -1;
      applyVoteDelta(tag, hadVote ? -1 : 1, !hadVote);
      renderMainRow();
      if (tagPickerOverlayEl) renderPicker(tagPickerOverlayEl.querySelector('.pds-tagpicker-sub'));

      postTagsJson('/tags/vote', { personalCode: personalCode, postId: postId, tagName: tag })
        .catch(function (err) {
          // 실패 — 낙관적으로 반영했던 변경을 되돌리고 이유를 알려준다
          applyVoteDelta(tag, hadVote ? 1 : -1, hadVote);
          // 보고 있는 사이에 잠긴 경우 — 이후 투표 버튼도 잠근다
          if (err && err.status === 403) locked = true;
          renderMainRow();
          if (tagPickerOverlayEl) renderPicker(tagPickerOverlayEl.querySelector('.pds-tagpicker-sub'));
          showTagError(locked ? LOCKED_MESSAGE : ((err && err.message) || t('투표에 실패했어요. 잠시 후 다시 시도해주세요.')));
        })
        .then(function () {
          delete pending[tag];
          delete votersCache[tag];
          if (tagPickerOverlayEl && openVoters[tag]) renderPicker();
        });
    }

    function applyVoteDelta(tag, delta, nowVoted) {
      votes[tag] = Math.max(0, (votes[tag] || 0) + delta);
      myTags = nowVoted ? myTags.concat([tag]) : myTags.filter(function (t) { return t !== tag; });
    }

    getTagCatalog()
      .then(function (list) {
        catalog = list;
        return postTagsJson('/tags/get', { postId: postId, personalCode: currentPersonalCode() || undefined });
      })
      .then(function (res) {
        votes = (res && res.votes) || {};
        myTags = (res && res.myTags) || [];
        locked = !!(res && res.locked);
        renderMainRow();
        // 태그 선택 모달을 열자마자 이 응답이 늦게 도착하면, 이미 그려진
        // 모달이 빈 목록인 채로 남는다 — 열려 있으면 같이 다시 그린다.
        if (tagPickerOverlayEl) renderPicker(tagPickerOverlayEl.querySelector('.pds-tagpicker-sub'));
      })
      .catch(function () {
        renderMainRow();
        if (tagPickerOverlayEl) renderPicker(tagPickerOverlayEl.querySelector('.pds-tagpicker-sub'));
      });

    return section;
  }

  // 후방주의(성인) 태그 문학의 안내 화면에서 설정을 켜는 즉시 이 팝업을
  // 이어서 열기 위한 리스너 — close()에서 반드시 정리한다(그대로 두면 다른
  // 항목을 볼 때도 엉뚱한 data로 재호출된다).
  var matureUnlockListener = null;
  function clearMatureUnlockListener() {
    if (matureUnlockListener) {
      global.removeEventListener('chokaguya:content-settings-change', matureUnlockListener);
      matureUnlockListener = null;
    }
  }

  // 그리드/추천 목록에서는 애초에 걸러지지만, 북마크한 항목이나 랜덤 섹션의
  // 회전 카드처럼 목록 필터를 거치지 않는 경로로도 열릴 수 있어 이 진입점
  // 하나에서 한 번 더 막는다 — 문학/시리즈/명예관/공식/북마크 카드가 전부
  // PostDetailSeries.open()을 거치므로 여기만 고치면 전체가 커버된다.
  function openMatureBlocked(data) {
    var overlay = ensureOverlay();
    overlay.innerHTML = '';
    clearMatureUnlockListener();

    var card = document.createElement('div');
    card.className = 'post-detail-series pds-mature-blocked';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pds-close';
    closeBtn.setAttribute('aria-label', t('닫기'));
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', close);
    card.appendChild(closeBtn);

    var notice = document.createElement('div');
    notice.className = 'pds-mature-notice';

    var icon = document.createElement('p');
    icon.className = 'pds-mature-notice-icon';
    icon.textContent = '🔞';
    notice.appendChild(icon);

    var title = document.createElement('p');
    title.className = 'pds-mature-notice-title';
    title.textContent = t('후방주의 태그가 붙은 문학이에요');
    notice.appendChild(title);

    var desc = document.createElement('p');
    desc.className = 'pds-mature-notice-desc';
    desc.textContent = t('설정에서 표시를 켜야 볼 수 있어요.');
    notice.appendChild(desc);

    var settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'pds-mature-notice-btn';
    settingsBtn.textContent = t('설정 열기');
    settingsBtn.addEventListener('click', function () {
      close();
      if (global.SettingsModal) global.SettingsModal.open('general');
    });
    notice.appendChild(settingsBtn);

    card.appendChild(notice);

    overlay.appendChild(card);
    void card.offsetWidth;
    overlay.classList.add('is-open');
    lockScroll();

    // 안내 화면이 떠 있는 동안 설정을 켜면 새로고침 없이 바로 원래 팝업으로
    // 이어서 열어준다.
    matureUnlockListener = function () {
      if (global.ContentSettings && !global.ContentSettings.isBlocked(data.tags)) {
        clearMatureUnlockListener();
        open(data);
      }
    };
    global.addEventListener('chokaguya:content-settings-change', matureUnlockListener);
  }

  // data: { seriesName, views, likes, imageUrl, episodes: [{ title, id, link, episodeLabel }],
  //         favType?, postId?, tags? }
  // 화수는 따로 받지 않고 episodes 길이로 계산합니다 (시리즈 판별 기준과 동일).
  // favType이 TAG_ENABLED_FAV_TYPES에 있고 postId가 있을 때만 태그 줄을
  // 그립니다. novel은 "공식 태그"(data.tags를 그대로 정적 표시) + "유저 인기
  // 태그"(투표 UI) 두 줄, translation은 공식 태그가 없어(data.tags가 항상 빈
  // 배열) 유저 인기 태그 줄만 자연히 남습니다. 시리즈/명예관/공식은 사용자가
  // 직접 관리하는 영역이라 여전히 대상이 아닙니다(literature-data-scope-
  // boundary). 공식 태그는 novel의 모든 개별 문학이 대상이고(AI 장르 분류는
  // 계속 유지), 유저 인기 태그 투표도 신규·기존 글 구분 없이 전부 대상입니다.
  function open(data) {
    data = data || {};
    if (global.ContentSettings && global.ContentSettings.isBlocked(data.tags)) {
      openMatureBlocked(data);
      return;
    }
    // 본 문학 기록 (성인 차단으로 막힌 경우는 위에서 이미 빠져나갔다)
    if (data.favType && data.postId != null && global.ProfileStats) {
      global.ProfileStats.noteView(data.favType, data.postId);
    }
    var overlay = ensureOverlay();
    overlay.innerHTML = '';
    clearMatureUnlockListener();

    var card = document.createElement('div');
    card.className = 'post-detail-series';
    applyTagTint(card, data.tags);

    var handle = document.createElement('div');
    handle.className = 'pds-sheet-handle';
    card.appendChild(handle);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pds-close';
    closeBtn.setAttribute('aria-label', t('닫기'));
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', close);
    card.appendChild(closeBtn);

    var image = document.createElement('div');
    image.className = 'pds-image';
    if (data.imageUrl) {
      // 예전엔 원본(평균 755KB, 최대 17MB)을 그대로 받아 모달이 뜨는 동안
      // 멈춘 것처럼 보였다. 썸네일을 먼저 배경으로 깔고, 이 모달 크기에는
      // 충분한 1200px 중간 이미지가 도착하면 그걸로 교체한다(애니메이션
      // GIF만 예외로 원본 그대로 유지 — resolveMidUrl 참고).
      if (window.revealBackgroundProgressive) {
        window.revealBackgroundProgressive(image, data.imageUrl);
      } else {
        var finalImg = window.resolveAssetUrl ? window.resolveAssetUrl(data.imageUrl) : data.imageUrl;
        image.style.backgroundImage = 'url("' + finalImg + '")';
      }
    } else if (window.TagConfig && window.TagConfig.applyTextCover) {
      // 이미지가 없는 작품은 카드 표지와 같은 색·이모지로 채운다. 제목은
      // 모달이 이 자리 위에 따로 올리므로 표지 글씨는 넣지 않는다.
      window.TagConfig.applyTextCover(image, { tags: data.tags, text: false });
    }

    var imageEffect = document.createElement('div');
    imageEffect.className = 'pds-image-effect';
    image.appendChild(imageEffect);
    card.appendChild(image);

    var gradient = document.createElement('div');
    gradient.className = 'pds-gradient';
    card.appendChild(gradient);

    var seriesInfo = document.createElement('div');
    seriesInfo.className = 'pds-series-info';

    var name = document.createElement('p');
    name.className = 'pds-series-name';
    // 긴 제목만 2줄로 잘라야지 화수 배지까지 같이 잘리면 안 되므로, 잘리는
    // 대상(제목 텍스트)을 배지와 분리된 자기 span으로 감싼다.
    var nameText = document.createElement('span');
    nameText.className = 'pds-series-name-text';
    nameText.textContent = data.seriesName || t('시리즈 이름');
    name.appendChild(nameText);
    var episodeCountEl = document.createElement('span');
    episodeCountEl.className = 'pds-series-episode-count';
    // 화수(개수)라서 회차 뱃지용 '{n} 화'(n화째)와 다른 키를 쓴다.
    var allEpisodes = data.episodes || [];
    episodeCountEl.textContent = t('{n}화', { n: allEpisodes.length });
    // PC 에서만 화수 뒤에 원문 글 번호 범위를 붙인다(모바일은 CSS 로 숨김).
    var firstId = allEpisodes.length ? allEpisodes[0].dcId : null;
    var lastId = allEpisodes.length ? allEpisodes[allEpisodes.length - 1].dcId : null;
    if (firstId != null) {
      var rangeEl = document.createElement('span');
      rangeEl.className = 'pds-series-range';
      rangeEl.textContent = ' · ' + (allEpisodes.length > 1 && lastId != null && lastId !== firstId
        ? t('글 #{a} ~ #{b}', { a: firstId, b: lastId })
        : t('글 #{a}', { a: firstId }));
      episodeCountEl.appendChild(rangeEl);
    }
    name.appendChild(episodeCountEl);
    seriesInfo.appendChild(name);

    if (TAG_ENABLED_FAV_TYPES[data.favType] && data.postId != null) {
      var tagsGroup = document.createElement('div');
      tagsGroup.className = 'pds-tags-group';
      if (data.tags && data.tags.length) {
        tagsGroup.appendChild(renderOfficialTagsRow(data.tags));
      }
      tagsGroup.appendChild(renderUserTagsSection(data.postId));
      seriesInfo.appendChild(tagsGroup);
    }

    card.appendChild(seriesInfo);

    // Right side container holding toolbar & episode list
    var rightPanel = document.createElement('div');
    rightPanel.className = 'pds-right-panel';

    var textEpisodes = (data.episodes || []).map(function (ep, idx) {
      ep._idx = idx;
      return ep;
    });
    // 오디오 노벨 목록(data.audio — Official.json 소설판처럼 원문 회차와 따로 붙은
    // 장 목록). 있으면 목록 머리에 일반 문학 / 오디오 문학 토글을 띄운다.
    var audioEpisodes = (data.audio || []).map(function (a, idx) {
      return { title: a.title, reader: a.reader, episodeLabel: t('{n} 화', { n: idx + 1 }), _idx: idx };
    });
    var hasAudioMode = audioEpisodes.length > 0;
    var episodes = textEpisodes; // 지금 목록에 그리는 쪽

    var currentSortOrder = 'asc'; // 'asc' = 1화부터, 'desc' = 최신화부터

    var toolbar = document.createElement('div');
    toolbar.className = 'pds-toolbar';

    var sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'pds-sort-btn';
    sortBtn.setAttribute('aria-label', t('화 정렬 순서 변경'));

    function updateSortButtonUI() {
      if (currentSortOrder === 'asc') {
        sortBtn.innerHTML = '<svg class="pds-sort-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h6M2.5 8h4M2.5 11.5h2"/><path d="M10.5 11.5l2.5-3 2.5 3"/><path d="M13 8.5v5"/></svg><span class="pds-sort-text">' + t('1화부터 (오름차순)') + '</span>';
        sortBtn.setAttribute('title', t('현재: 1화부터 순서대로 (클릭 시 최신화부터 역순)'));
      } else {
        sortBtn.innerHTML = '<svg class="pds-sort-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h6M2.5 8h4M2.5 11.5h2"/><path d="M10.5 8.5l2.5 3 2.5-3"/><path d="M13 11.5v-5"/></svg><span class="pds-sort-text">' + t('최신화부터 (내림차순)') + '</span>';
        sortBtn.setAttribute('title', t('현재: 최신화부터 역순으로 (클릭 시 1화부터 순서대로)'));
      }
    }

    var list = document.createElement('div');
    list.className = 'pds-list';

    function getEpisodeSortKey(ep, fallbackIndex) {
      if (!ep) return fallbackIndex;
      if (ep.episodeLabel) {
        var m = String(ep.episodeLabel).match(/(\d+(?:\.\d+)?)/);
        if (m) return parseFloat(m[1]);
      }
      if (ep.title) {
        var tm = String(ep.title).match(/(?:第|\b|\[|\()?\s*(\d+(?:\.\d+)?)\s*(?:화|편|話|\))/);
        if (tm) return parseFloat(tm[1]);
      }
      return fallbackIndex;
    }

    function renderEpisodes() {
      list.innerHTML = '';
      var sorted = episodes.slice().sort(function (a, b) {
        var valA = getEpisodeSortKey(a, a._idx);
        var valB = getEpisodeSortKey(b, b._idx);
        if (valA !== valB) {
          return currentSortOrder === 'asc' ? (valA - valB) : (valB - valA);
        }
        return currentSortOrder === 'asc' ? (a._idx - b._idx) : (b._idx - a._idx);
      });

      // build off-document so the whole list lands in one layout pass
      var frag = document.createDocumentFragment();
      sorted.forEach(function (ep) {
        frag.appendChild(createEpisodeItem(ep));
      });
      list.appendChild(frag);

      list.scrollTop = 0;
      applyTitleMarquee(card, list);
    }

    // 목록을 밀어내고 change() 로 상태를 바꾼 뒤 새 목록을 밀어 넣는다 — 정렬과
    // 일반/오디오 모드 전환이 같은 움직임을 쓴다.
    var isSwapping = false;
    function swapList(change) {
      if (isSwapping) return;
      isSwapping = true;
      change();

      // Slide out effect
      list.classList.remove('pds-list-anim-in', 'pds-list-anim-prep');
      list.classList.add('pds-list-anim-out');

      setTimeout(function () {
        renderEpisodes();
        list.classList.remove('pds-list-anim-out');
        list.classList.add('pds-list-anim-prep');
        void list.offsetWidth; // force reflow
        list.classList.remove('pds-list-anim-prep');
        list.classList.add('pds-list-anim-in');

        setTimeout(function () {
          list.classList.remove('pds-list-anim-in');
          isSwapping = false;
        }, 240);
      }, 140);
    }

    sortBtn.addEventListener('click', function (e) {
      e.preventDefault();
      swapList(function () {
        currentSortOrder = (currentSortOrder === 'asc' ? 'desc' : 'asc');
        updateSortButtonUI();
      });
    });

    updateSortButtonUI();

    // 목록 머리의 "회차 N" — PC 에서만 보인다(모바일 시트는 제목 옆 배지로 충분).
    var toolbarTitle = document.createElement('p');
    toolbarTitle.className = 'pds-toolbar-title';
    toolbarTitle.textContent = t('회차');
    var toolbarCount = document.createElement('span');
    toolbarCount.textContent = String(episodes.length);
    toolbarTitle.appendChild(toolbarCount);
    toolbar.appendChild(toolbarTitle);

    if (hasAudioMode) {
      var modeToggle = document.createElement('div');
      modeToggle.className = 'pds-mode-toggle';
      modeToggle.setAttribute('role', 'group');
      modeToggle.setAttribute('aria-label', t('읽기 방식'));
      var modeButtons = [
        { mode: 'text', label: '📖 ' + t('일반 문학'), list: textEpisodes },
        { mode: 'audio', label: '🎧 ' + t('오디오 문학'), list: audioEpisodes }
      ].map(function (m) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pds-mode-btn';
        btn.textContent = m.label;
        btn.setAttribute('aria-pressed', String(m.list === episodes));
        btn.addEventListener('click', function () {
          if (m.list === episodes) return;
          swapList(function () {
            episodes = m.list;
            toolbarCount.textContent = String(episodes.length);
            modeButtons.forEach(function (b) {
              b.setAttribute('aria-pressed', String(b === btn));
            });
            modeToggle.setAttribute('data-mode', m.mode);
          });
        });
        modeToggle.appendChild(btn);
        return btn;
      });
      modeToggle.setAttribute('data-mode', 'text');
      toolbar.appendChild(modeToggle);
      toolbar.classList.add('has-mode-toggle');
    }

    // 한 편짜리 글은 순서를 바꿀 게 없다 — 모바일에선 "회차" 머리도 숨기므로
    // 토글도 없으면 툴바 줄 자체를 접는다(modal-series.css 의 .pds-toolbar.is-single).
    if (Math.max(textEpisodes.length, audioEpisodes.length) > 1) toolbar.appendChild(sortBtn);
    else if (!hasAudioMode) toolbar.classList.add('is-single');
    rightPanel.appendChild(toolbar);
    rightPanel.appendChild(list);
    card.appendChild(rightPanel);

    // episodes are rendered only after the card is in the document — measuring
    // title overflow on a detached node reads zeroes, so doing it earlier just
    // threw the whole pass away and made it run twice.
    // is-open goes on before the list is built (after a forced reflow, so the
    // open transition still has a start value to animate from) — that way the
    // marquee visibility observer measures against the modal's real on-screen
    // geometry instead of its hidden, pre-open state.
    overlay.appendChild(card);
    void card.offsetWidth;
    overlay.classList.add('is-open');
    lockScroll();
    renderEpisodes();
  }

  // titles longer than the clipped box get a ping-pong scroll instead of
  // being cut off under the episode badge — only overflowing ones animate.
  // Reads and writes are kept in separate passes so the browser recalculates
  // layout twice total instead of once per title.
  function applyTitleMarquee(root, scrollRoot) {
    var titles = root.querySelectorAll('.pds-episode-title');

    var toMarquee = [];
    for (var i = 0; i < titles.length; i++) {
      var titleEl = titles[i];
      var inner = titleEl.querySelector('.pds-episode-title-inner');
      if (!inner) continue;
      var overflow = inner.scrollWidth - titleEl.clientWidth;
      if (overflow > 0) toMarquee.push({ el: titleEl, overflow: overflow });
    }
    if (!toMarquee.length) return;

    for (var j = 0; j < toMarquee.length; j++) {
      toMarquee[j].el.classList.add('is-marquee');
    }

    // the ::after fade only exists once .is-marquee is set, and its width is
    // the same for every title — so measure it once, after the class pass
    var fadeWidth = parseFloat(getComputedStyle(toMarquee[0].el, '::after').width) || 0;

    for (var k = 0; k < toMarquee.length; k++) {
      // scroll past the overflow by the fade's own width too, so the trailing
      // text (e.g. the episode ID) ends up fully clear of the gradient
      // instead of sitting permanently faded under it
      toMarquee[k].el.style.setProperty('--marquee-distance', -(toMarquee[k].overflow + fadeWidth) + 'px');
    }

    observeMarqueeVisibility(toMarquee, scrollRoot);
  }

  // A long series can have dozens of overflowing titles, and leaving every one
  // of them running an infinite transform animation pins the compositor even
  // though only a handful are on screen. Animate the visible ones only.
  var marqueeObserver = null;
  function observeMarqueeVisibility(entries, scrollRoot) {
    if (!('IntersectionObserver' in global)) {
      for (var i = 0; i < entries.length; i++) entries[i].el.classList.add('is-marquee-live');
      return;
    }
    if (marqueeObserver) marqueeObserver.disconnect();
    marqueeObserver = new IntersectionObserver(function (records) {
      records.forEach(function (record) {
        record.target.classList.toggle('is-marquee-live', record.isIntersecting);
      });
    }, { root: scrollRoot || null, rootMargin: '50px 0px' });
    for (var j = 0; j < entries.length; j++) marqueeObserver.observe(entries[j].el);
  }

  function createEpisodeItem(ep) {
    ep = ep || {};
    var item = document.createElement('a');
    item.className = 'pds-episode-item';

    // 오디오 노벨 리더가 준비된 화는 원문 새 탭 대신 이 사이트 안 리더
    // 페이지로 이동한다 (AudioNovel.md 참고). 준비 안 된 화는 기존과 동일.
    // 절대경로를 쓰는 이유: /official 같은 짧은 주소는 실제로는
    // /page/OfficialPage.html 내용을 그대로 돌려줄 뿐이라 주소창은 계속
    // /official 에 머문다 — 상대경로였으면 그 기준으로 계산돼 엉뚱한 곳
    // (/audioNovelReaderPage.html)으로 튀었다 (_worker.js 참고).
    if (ep.reader) {
      item.href = '/page/audioNovelReaderPage.html?chapter=' + encodeURIComponent(ep.reader);
    } else {
      item.href = ep.link || '#';
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
    }

    // 오디오 노벨이 적용된 화는 카드 전체를 강조한다 — 배경 톤, 제목 앞
    // 헤드폰 아이콘, 우상단 AUDIO 배지 세 가지를 함께 써서 목록을 훑을 때
    // 바로 눈에 띄게 한다 (gridPage.js의 시리즈 카드 리본과는 별개로,
    // 여긴 화 단위 표시).
    if (ep.reader) item.classList.add('is-audio-novel');

    var title = document.createElement('p');
    title.className = 'pds-episode-title';
    var titleInner = document.createElement('span');
    titleInner.className = 'pds-episode-title-inner';
    if (ep.reader) {
      var titleIcon = document.createElement('span');
      titleIcon.className = 'pds-episode-audio-icon';
      titleIcon.textContent = '🎧 ';
      titleInner.appendChild(titleIcon);
    }
    titleInner.appendChild(document.createTextNode((ep.title || t('게시물 이름')) + ' '));
    // 오디오 문학 목록의 장(data.audio)은 원문 글 번호가 따로 없다
    if (ep.dcId != null || !ep.reader) {
      var idSpan = document.createElement('span');
      idSpan.className = 'pds-episode-id';
      idSpan.textContent = '| ' + (ep.dcId != null ? ep.dcId : t('게시물 ID'));
      titleInner.appendChild(idSpan);
    }
    title.appendChild(titleInner);
    item.appendChild(title);

    var link = document.createElement('p');
    link.className = 'pds-episode-link';
    link.textContent = ep.reader ? t('오디오 노벨로 읽기') : (ep.link || t('게시물 링크'));
    item.appendChild(link);

    var badge = document.createElement('span');
    badge.className = 'pds-episode-badge';
    badge.textContent = ep.episodeLabel || t('00 화');
    item.appendChild(badge);

    if (ep.reader) {
      var audioBadge = document.createElement('span');
      audioBadge.className = 'pds-episode-audio-badge';
      audioBadge.textContent = 'AUDIO';
      item.appendChild(audioBadge);
    }

    // PC 목차 줄의 오른쪽 두 칸(글 번호, 이동 화살표). 모바일은 제목 안의
    // .pds-episode-id 와 링크 줄을 그대로 쓰므로 CSS 로 숨긴다.
    if (ep.dcId != null) {
      var dcIdEl = document.createElement('span');
      dcIdEl.className = 'pds-episode-dcid';
      dcIdEl.textContent = '#' + ep.dcId;
      item.appendChild(dcIdEl);
    }
    var arrow = document.createElement('span');
    arrow.className = 'pds-episode-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = ep.reader ? '→' : '↗';
    item.appendChild(arrow);

    return item;
  }

  function close() {
    if (!overlayEl) return;
    closeTagPicker();
    clearMatureUnlockListener();
    overlayEl.classList.remove('is-open');
    unlockScroll();
    // closing only fades the overlay out — the card stays in the document, so
    // the marquee animations would otherwise keep running against an invisible
    // modal until the next open replaced it
    if (marqueeObserver) {
      marqueeObserver.disconnect();
      marqueeObserver = null;
    }
    var live = overlayEl.querySelectorAll('.is-marquee-live');
    for (var i = 0; i < live.length; i++) live[i].classList.remove('is-marquee-live');
  }

  global.PostDetailSeries = {
    open: open,
    close: close
  };
})(window);
