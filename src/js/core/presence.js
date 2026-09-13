/**
 * presence.js — 이 탭이 "지금 보고 있는 중"이라고 서버에 알리는 하트비트.
 *
 * 25초마다 /api/presence/beat 에 익명 세션 ID를 보낸다. 서버(PresenceDO)는
 * 일정 시간 안에 다시 소식이 없는 세션을 접속 종료로 보고 걷어낸다. 이렇게
 * 모인 현재 접속자 수와 그 피크를 관리자 통계 페이지(/stats)에서 본다.
 *
 * 설계 메모:
 * - 세션 ID는 sessionStorage에 둔다 → 새로고침해도 같은 탭이면 같은 세션,
 *   새 탭은 새 세션. "동시에 열려 있는 화면 수"를 세는 게 목적이라 이게 맞다.
 * - 개인 정보를 전혀 담지 않는다(그냥 난수 16자리 hex). 서버도 IP 같은 걸
 *   저장하지 않고 살아 있는 세션 개수만 센다.
 * - 통계는 부가 기능이다. 네트워크 실패든 뭐든 조용히 넘어가고 페이지 동작에
 *   절대 영향을 주지 않는다.
 */
(function () {
  'use strict';

  var BEAT_INTERVAL_MS = 25 * 1000;
  var SID_KEY = 'cpkg_presence_sid';

  var sid;
  try {
    sid = sessionStorage.getItem(SID_KEY);
    if (!sid || !/^[a-f0-9]{16}$/.test(sid)) {
      var buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      sid = '';
      for (var i = 0; i < buf.length; i++) sid += buf[i].toString(16).padStart(2, '0');
      sessionStorage.setItem(SID_KEY, sid);
    }
  } catch (e) {
    // sessionStorage를 못 쓰는 환경(사생활 보호 모드 등) — 메모리 값으로 대체.
    sid = String(Math.random()).slice(2, 10) + String(Math.random()).slice(2, 10);
  }

  var lastBeatAt = 0;

  function beat() {
    // 너무 잦은 중복 호출 방지(가시성 변경과 인터벌이 겹칠 때).
    var now = Date.now();
    if (now - lastBeatAt < 5000) return;
    lastBeatAt = now;
    try {
      fetch('/api/presence/beat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: sid }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function leave() {
    try {
      var body = JSON.stringify({ sid: sid });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/presence/leave', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/presence/leave', { method: 'POST', body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }

  beat();
  var timer = setInterval(beat, BEAT_INTERVAL_MS);

  document.addEventListener('visibilitychange', function () {
    // 탭이 백그라운드면 브라우저가 setInterval을 분당 1회까지 늦춘다. 다시
    // 보이는 순간 즉시 한 번 쳐서 만료로 빠졌던 세션을 되살린다.
    if (document.visibilityState === 'visible') beat();
  });

  window.addEventListener('pagehide', leave);
  window.addEventListener('beforeunload', function () {
    clearInterval(timer);
  });
})();
