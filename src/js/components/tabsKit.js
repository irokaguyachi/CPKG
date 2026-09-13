/**
 * ChoKaguya Sliding Tabs Kit
 * - bookmarksPage.js의 "내 북마크"/"북마크 라이브러리"와 changelogPage.js의
 *   "업데이트 로그"/"공지사항"이 완전히 같은 알약 탭 UI
 *   (.bkm-tabs/.bkm-tab, src/css/components/bookmarks.css)를 쓰는데, 예전엔
 *   두 페이지 다 탭이 바뀔 때마다 <a> 전체를 새로 그려서 활성 탭 배경이
 *   그냥 스냅 전환됐다. 실제로 움직이는 인디케이터(.bkm-tab-indicator)를
 *   넣으려면 탭 바 DOM 자체는 한 번만 만들고 활성 상태만 갱신해야 해서,
 *   그 컨테이너 재사용 + 인디케이터 위치 계산을 여기 하나로 묶었다.
 * - 인디케이터가 실제로 움직이는 걸 보여주려면 첫 렌더 때는(아직 아무
 *   탭도 안 눌렸을 때) 트랜지션 없이 바로 자리를 잡아야 한다 — 안 그러면
 *   페이지가 뜰 때마다 인디케이터가 왼쪽 끝에서 슬라이드해 들어오는 것처럼
 *   보인다.
 */
(function (global) {
  // items: [{ key, label, href }]
  // options.onActivate(item): 탭 클릭 시 호출자가 라우팅(pushState 등)을
  //   직접 처리하고 싶을 때만 넘긴다 — bookmarksPage.js처럼 페이지에 이미
  //   전역 링크 가로채기가 있으면 안 넘기고, 그 페이지의 렌더 함수가 끝난
  //   자리에서 setActive()만 불러주면 된다(changelogPage.js는 그런 전역
  //   가로채기가 없어서 onActivate로 직접 라우팅한다).
  function createTabs(items, options) {
    options = options || {};

    var tabsEl = document.createElement('div');
    tabsEl.className = 'bkm-tabs';

    var indicator = document.createElement('div');
    indicator.className = 'bkm-tab-indicator';
    tabsEl.appendChild(indicator);

    var linksByKey = {};
    items.forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'bkm-tab';
      link.href = item.href;
      link.textContent = item.label;
      if (options.onActivate) {
        link.addEventListener('click', function (e) {
          if (link.classList.contains('is-active')) return;
          e.preventDefault();
          options.onActivate(item);
        });
      }
      tabsEl.appendChild(link);
      linksByKey[item.key] = link;
    });

    var firstMove = true;
    function moveIndicatorTo(link) {
      // link.offsetLeft/offsetWidth는 tabsEl(가장 가까운 position 조상)
      // 기준이라, 같은 부모의 자식인 indicator를 absolute로 그 좌표에
      // 그대로 옮기면 된다.
      if (firstMove) {
        // 페이지가 막 뜬 시점의 최초 위치잡기는 슬라이드해 들어오면 안
        // 되니 트랜지션을 잠깐 꺼둔다.
        indicator.style.transition = 'none';
      }
      indicator.style.width = link.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + link.offsetLeft + 'px)';
      if (firstMove) {
        void indicator.offsetWidth; // 강제 리플로우로 "트랜지션 없이" 상태를 확정
        indicator.style.transition = '';
        firstMove = false;
      }
    }

    function setActive(key) {
      Object.keys(linksByKey).forEach(function (k) {
        linksByKey[k].classList.toggle('is-active', k === key);
      });
      var link = linksByKey[key];
      if (link) moveIndicatorTo(link);
    }

    return { el: tabsEl, setActive: setActive };
  }

  global.TabsKit = { createTabs: createTabs };
})(window);
