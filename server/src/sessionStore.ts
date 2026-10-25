import session from 'express-session';
import type { Db } from './db.js';

export class SqliteSessionStore extends session.Store {
  constructor(private db: Db) {
    super();
    setInterval(() => this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600_000).unref();
  }
  get(sid: string, cb: (err?: unknown, s?: session.SessionData | null) => void) {
    try {
      const row = this.db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid) as
        | { data: string; expires: number }
        | undefined;
      cb(null, row && row.expires > Date.now() ? JSON.parse(row.data) : null);
    } catch (e) {
      cb(e);
    }
  }
  set(sid: string, s: session.SessionData, cb?: (err?: unknown) => void) {
    try {
      const expires = s.cookie?.expires ? new Date(s.cookie.expires).getTime() : Date.now() + 86400_000;
      this.db
        .prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(s), expires);
      cb?.();
    } catch (e) {
      cb?.(e);
    }
  }
  destroy(sid: string, cb?: (err?: unknown) => void) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.();
    } catch (e) {
      cb?.(e);
    }
  }
}
