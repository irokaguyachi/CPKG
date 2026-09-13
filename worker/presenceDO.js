import { readJsonLimited } from '../worker/requestBody.js';

// Approximate tab counts, bounded against public API abuse. Client identities
// are daily IP hashes supplied only by statsApi.js; raw IPs are never stored.
const SESSION_TTL_MS = 75000;
const TICK_INTERVAL_MS = 40000;
const SNAPSHOT_INTERVAL_MS = 30000;
const MAX_SESSIONS = 1000;
const MAX_SESSIONS_PER_CLIENT = 20;
const MAX_CLIENTS = 2000;
const MAX_REQUESTS_PER_MINUTE = 60;
const MAX_NEW_SESSIONS_PER_MINUTE = 10;
const SESSION_KEY_RE = /^[a-f0-9]{32}:[a-f0-9]{16}$/;

function dayKeyKST(now) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

export class PresenceDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.clients = new Map();
    this.clientCounts = new Map();
    this.lastCleanupAt = 0;
    this.lastSnapshotAt = 0;
    this.dirty = false;
    this.ready = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get(['sessions', 'peak']);
      const now = Date.now();
      for (const [key, seen] of stored.get('sessions') || []) {
        if (SESSION_KEY_RE.test(key) && typeof seen === 'number' &&
            seen >= now - SESSION_TTL_MS && this.sessions.size < MAX_SESSIONS) {
          const client = key.slice(0, 32);
          const count = this.clientCounts.get(client) || 0;
          if (count >= MAX_SESSIONS_PER_CLIENT) continue;
          this.sessions.set(key, seen);
          this.clientCounts.set(client, count + 1);
        }
      }
      this.peak = stored.get('peak') || {
        day: '', today: 0, todayAt: 0, allTime: 0, allTimeAt: 0
      };
    });
  }

  removeSession(key) {
    if (!this.sessions.delete(key)) return;
    const client = key.slice(0, 32);
    const count = (this.clientCounts.get(client) || 1) - 1;
    if (count) this.clientCounts.set(client, count);
    else this.clientCounts.delete(client);
    this.dirty = true;
  }

  cleanup(now, force = false) {
    // Do not scan every active session on every heartbeat.
    if (!force && now - this.lastCleanupAt < 10000) return;
    this.lastCleanupAt = now;
    for (const [key, seen] of this.sessions) {
      if (seen < now - SESSION_TTL_MS) this.removeSession(key);
    }
    for (const [client, quota] of this.clients) {
      if (now - quota.startedAt >= 60000) this.clients.delete(client);
    }
  }

  allow(client, isNew, now) {
    let quota = this.clients.get(client);
    if (!quota || now - quota.startedAt >= 60000) {
      if (!quota && this.clients.size >= MAX_CLIENTS) return false;
      quota = { startedAt: now, requests: 0, additions: 0 };
      this.clients.set(client, quota);
    }
    if (quota.requests >= MAX_REQUESTS_PER_MINUTE) return false;
    quota.requests++;
    if (isNew && quota.additions >= MAX_NEW_SESSIONS_PER_MINUTE) return false;
    if (isNew) quota.additions++;
    return true;
  }

  async tick(now, forceSave = false) {
    this.cleanup(now, forceSave);
    const online = this.sessions.size;
    const today = dayKeyKST(now);
    if (this.peak.day !== today) {
      this.peak.day = today;
      this.peak.today = 0;
      this.peak.todayAt = 0;
      this.dirty = true;
    }
    if (online > this.peak.today) {
      this.peak.today = online;
      this.peak.todayAt = now;
      this.dirty = true;
    }
    if (online > this.peak.allTime) {
      this.peak.allTime = online;
      this.peak.allTimeAt = now;
      this.dirty = true;
    }
    // Peak and sessions share one batched write, at most once per 30 seconds
    // during requests. Alarm also persists the final empty session snapshot.
    if (this.dirty && (forceSave || now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS)) {
      this.lastSnapshotAt = now;
      this.dirty = false;
      try {
        await this.state.storage.put({ sessions: Array.from(this.sessions), peak: { ...this.peak } });
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    }
    if (online > 0 || this.dirty) {
      if (await this.state.storage.getAlarm() === null) {
        await this.state.storage.setAlarm(now + TICK_INTERVAL_MS);
      }
    }
    return online;
  }

  async alarm() {
    await this.ready;
    await this.tick(Date.now(), true);
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    const now = Date.now();
    if ((url.pathname === '/beat' || url.pathname === '/leave') && request.method === 'POST') {
      const client = request.headers.get('X-Presence-Client') || '';
      if (!/^[a-f0-9]{32}$/.test(client)) return json({ error: 'invalid client' }, 400);
      const parsed = await readJsonLimited(request, 256);
      if (parsed.error) return json({ error: parsed.error }, parsed.status);
      const sid = parsed.value && parsed.value.sid;
      if (typeof sid !== 'string' || !/^[a-f0-9]{16}$/.test(sid)) return json({ error: 'invalid sid' }, 400);
      this.cleanup(now);
      const key = client + ':' + sid;
      const isNew = url.pathname === '/beat' && !this.sessions.has(key);
      if (!this.allow(client, isNew, now)) return json({ error: 'too many requests' }, 429);
      if (url.pathname === '/beat') {
        if (isNew && (this.sessions.size >= MAX_SESSIONS ||
            (this.clientCounts.get(client) || 0) >= MAX_SESSIONS_PER_CLIENT)) {
          return json({ error: 'session limit reached' }, 429);
        }
        this.sessions.set(key, now);
        if (isNew) this.clientCounts.set(client, (this.clientCounts.get(client) || 0) + 1);
        this.dirty = true;
      } else {
        this.removeSession(key);
      }
      return json({ online: await this.tick(now) });
    }
    if (url.pathname === '/stats' && request.method === 'GET') {
      const online = await this.tick(now);
      return json({
        online, peakToday: this.peak.today, peakTodayAt: this.peak.todayAt || null,
        peakAllTime: this.peak.allTime, peakAllTimeAt: this.peak.allTimeAt || null,
        peakDay: this.peak.day || null, serverTime: now
      });
    }
    return json({ error: 'not found' }, 404);
  }
}
