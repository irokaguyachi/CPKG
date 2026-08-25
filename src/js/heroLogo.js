(function () {
  var TOP_THRESHOLD = 10;

  // .header-logo 는 position:fixed 라 히어로 상태(body.is-top)로 확대돼도
  // 문서 흐름의 콘텐츠는 그만큼 안 밀려난다 — 그대로 두면 로고가 콘텐츠
  // 위에 그냥 겹친다. [data-hero-space] 요소를 로고 위쪽 여백(화면 맨 위 ~
  // 로고 상단)과 똑같은 크기로 채워서, 위아래 여백이 항상 대칭이 되게 한다.
  // data-hero-space="padding" 이면 그 요소의 padding-top 을, 그 외(기본값)
  // 는 height 를 조절한다 — position:sticky 인 요소(예: .series-toolbar)
  // 앞에는 별도의 빈 spacer 를 두고 height 로 조절해야 스크롤 고정 시
  // 어색해지지 않는다. 스크롤해서 is-top 이 빠지면 0으로 되돌려 CSS
  // 트랜지션으로 자연스럽게 접히게 한다.
  var target = document.querySelector('[data-hero-space]');
  if (!target) return;
  var mode = target.getAttribute('data-hero-space') || 'height';

  function apply(px) {
    var value = px === null ? '' : px + 'px';
    if (mode === 'padding') {
      target.style.paddingTop = value;
    } else {
      target.style.height = value;
    }
  }

  function updateHeroSpace() {
    var logo = document.querySelector('.header-logo');
    if (!logo) return;
    if (!document.body.classList.contains('is-top')) {
      apply(null);
      return;
    }
    apply(null);
    var logoRect = logo.getBoundingClientRect();
    var targetTop = target.getBoundingClientRect().top;
    var desiredTop = logoRect.bottom + logoRect.top;
    apply(Math.max(0, desiredTop - targetTop));
  }

  function onScroll() {
    if (window.scrollY > TOP_THRESHOLD) {
      document.body.classList.remove('is-top');
      updateHeroSpace();
      window.removeEventListener('scroll', onScroll);
    }
  }

  if (window.scrollY <= TOP_THRESHOLD) {
    document.body.classList.add('is-top');
    window.addEventListener('scroll', onScroll, { passive: true });
  } else {
    document.body.classList.remove('is-top');
  }

  requestAnimationFrame(updateHeroSpace);
  window.addEventListener('resize', updateHeroSpace);

  // body.is-top 이 붙는 시점이 로고의 첫 페인트보다 늦으면(스크립트가 DOM
  // 파싱 후 실행되므로 흔하다), 브라우저가 이를 실제 상태 변화로 보고
  // .header-logo 의 0.5초짜리 transform 트랜지션을 재생시킨다. 그러면 위
  // rAF 측정은 로고가 아직 다 안 커진 애니메이션 도중 값을 잴 수 있다 —
  // 트랜지션이 끝나는 순간 최종 크기로 한 번 더 정확히 재보정한다.
  var heroLogo = document.querySelector('.header-logo');
  if (heroLogo) {
    heroLogo.addEventListener('transitionend', function (e) {
      if (e.propertyName === 'transform') updateHeroSpace();
    });
  }
})();
