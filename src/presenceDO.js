/**
 * PresenceDO — 실시간 동시 접속자 수와 피크를 집계하는 Durable Object.
 *
 * 왜 Durable Object인가:
 * - Cloudflare가 기본 제공하는 어떤 분석 데이터셋에도 "지금 몇 명이 보고
 *   있는가"라는 개념이 없다. 이 수치는 여러 요청에 걸쳐 살아 있는 상태를
 *   한곳에 모아야 나오는데, 그 "한곳"이 바로 이 DO다(계정 전체에서 인스턴스
 *   하나만 쓴다 — statsApi.js가 항상 같은 이름 "global"로 부른다).
 * - 무료 요금제에서도 쓸 수 있는 SQLite 스토리지 백엔드로 띄운다
 *   (wrangler.toml의 [[migrations]] new_sqlite_classes 참고).
 *
 * 동작 개요:
 * - 브라우저(presence.js)가 30초마다 익명 세션 ID로 /beat 를 친다.
 * - 세션 맵은 메모리에만 둔다(sid -> 마지막 하트비트 시각). SESSION_TTL_MS
 *   안에 다시 안 들어오면 접속이 끊긴 것으로 보고 만료시킨다.
 * - 피크(오늘/역대)는 값이 바뀔 때마다 storage에 기록한다 — DO가 메모리에서
 *   밀려나도 피크만은 잃지 않게 한다. 반대로 세션 맵은 밀려나면 잠깐 0에서
 *   다시 차오르는데, 취미 사이트의 지표로는 충분히 감수할 만하다.
 * - alarm으로 40초마다 스스로 깨어나 만료 세션을 걷어내고, 하트비트가 아예
 *   없는 동안에도 현재 접속자 수가 실제로 0까지 내려가게 한다.
 *
 * 날짜 경계는 한국 시간(UTC+9) 기준이다 — "오늘의 피크"는 한국 사용자가
 * 기대하는 하루 단위여야 한다.
 */

// 하트비트 주기(클라이언트 30초)에 두 번의 누락과 지연 여유를 더한 값.
var SESSION_TTL_MS = 75 * 1000;
// alarm 재예약 간격. 트래픽이 없어도 이 주기로 현재 접속자 수가 감소한다.
var TICK_INTERVAL_MS = 40 * 1000;
// 세션 ID 형태 방어(클라이언트는 16자 hex를 보낸다).
var SID_RE = /^[a-f0-9]{8,64}$/;

function dayKeyKST(nowMs) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export class PresenceDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // sid -> 마지막 하트비트 epoch ms. 첫 요청에서 storage로부터 복원한다.
    this.sessions = null;
    this.peak = null;
    this.loaded = false;
    // storage put을 매 beat마다 하지 않도록, 세션 스냅샷은 이 시각 이후에만 저장한다.
    this.lastSnapshotAt = 0;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    // blockConcurrencyWhile로 감싸 초기화 도중 다른 요청이 끼어들지 않게 한다.
    await this.state.blockConcurrencyWhile(async () => {
      if (this.loaded) return;
      var stored = await this.state.storage.get(['sessions', 'peak']);
      var savedSessions = stored.get('sessions');
      this.sessions = new Map(Array.isArray(savedSessions) ? savedSessions : []);
      this.peak = stored.get('peak') || {
        day: '', today: 0, todayAt: 0, allTime: 0, allTimeAt: 0
      };
      this.loaded = true;
    });
  }

  // 만료 세션 정리 + 날짜 경계 처리 + 피크 갱신. 모든 진입점이 먼저 부른다.
  // 반환값: 정리 후 현재 접속자 수.
  async tick(nowMs) {
    var now = nowMs || Date.now();
    var cutoff = now - SESSION_TTL_MS;
    for (var entry of this.sessions) {
      if (entry[1] < cutoff) this.sessions.delete(entry[0]);
    }

    var online = this.sessions.size;
    var peakChanged = false;

    var today = dayKeyKST(now);
    if (this.peak.day !== today) {
      this.peak.day = today;
      this.peak.today = 0;
      this.peak.todayAt = 0;
      peakChanged = true;
    }
    if (online > this.peak.today) {
      this.peak.today = online;
      this.peak.todayAt = now;
      peakChanged = true;
    }
    if (online > this.peak.allTime) {
      this.peak.allTime = online;
      this.peak.allTimeAt = now;
      peakChanged = true;
    }
    if (peakChanged) {
      await this.state.storage.put('peak', this.peak);
    }

    // 세션 맵 스냅샷은 자주 쓰지 않는다 — DO가 살아 있는 한 메모리 맵이
    // 진실이고, 스냅샷은 강제 퇴거 후 복구용 근사치일 뿐이다.
    if (online > 0 && now - this.lastSnapshotAt > 30 * 1000) {
      await this.state.storage.put('sessions', Array.from(this.sessions));
      this.lastSnapshotAt = now;
    }

    // 아직 접속자가 있으면 다음 tick을 예약해 수치가 계속 감소하도록 한다.
    if (online > 0) {
      var currentAlarm = await this.state.storage.getAlarm();
      if (currentAlarm === null) {
        await this.state.storage.setAlarm(now + TICK_INTERVAL_MS);
      }
    }
    return online;
  }

  async alarm() {
    await this.ensureLoaded();
    await this.tick(Date.now());
    // tick 안에서 접속자가 남아 있으면 알아서 다음 alarm을 잡는다.
  }

  async fetch(request) {
    await this.ensureLoaded();
    var url = new URL(request.url);
    var now = Date.now();

    if (url.pathname === '/beat' && request.method === 'POST') {
      var sid = null;
      try {
        var body = await request.json();
        sid = body && typeof body.sid === 'string' ? body.sid : null;
      } catch (e) {
        sid = null;
      }
      if (!sid || !SID_RE.test(sid)) {
        return new Response(JSON.stringify({ error: 'invalid sid' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      this.sessions.set(sid, now);
      var online = await this.tick(now);
      return new Response(JSON.stringify({ online: online }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/leave' && request.method === 'POST') {
      // pagehide에서 sendBeacon으로 보내는 명시적 이탈 신호(있으면 더 빠르게
      // 반영, 없어도 TTL로 정리되므로 필수는 아니다).
      try {
        var lb = await request.json();
        if (lb && typeof lb.sid === 'string') this.sessions.delete(lb.sid);
      } catch (e) {}
      var n = await this.tick(now);
      return new Response(JSON.stringify({ online: n }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      var cur = await this.tick(now);
      return new Response(JSON.stringify({
        online: cur,
        peakToday: this.peak.today,
        peakTodayAt: this.peak.todayAt || null,
        peakAllTime: this.peak.allTime,
        peakAllTimeAt: this.peak.allTimeAt || null,
        peakDay: this.peak.day || null,
        serverTime: now
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }
}
