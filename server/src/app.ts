import express from 'express';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { adminRouter } from './admin.js';
import { notesRouter } from './notes.js';
import { NoteStorage } from './storage.js';
import { SqliteSessionStore } from './sessionStore.js';

export function createApp(cfg: Config, db: Db) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.isProd) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/admin', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
  // CSRF defence in addition to SameSite=strict cookies: state-changing requests must come from our origin
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== cfg.rpOrigin) {
      return res.status(403).json({ error: 'Invalid origin' });
    }
    next();
  });
  app.use(express.json({ limit: '30mb' }));
  app.use(
    session({
      name: 'sid',
      secret: cfg.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new SqliteSessionStore(db),
      cookie: { httpOnly: true, sameSite: 'strict', secure: cfg.isProd, maxAge: 8 * 3600_000 },
    }),
  );

  const storage = new NoteStorage(cfg);
  const { removed, orphans } = storage.reconcile(db);
  if (removed || orphans) console.log(`Note scan: removed ${removed} stale rows, found ${orphans} untracked files`);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter(cfg, db));
  app.use('/api/admin', adminRouter(db, storage));
  app.use('/api', requireAuth, notesRouter(db, storage));

  if (fs.existsSync(cfg.clientDir)) {
    app.use(express.static(cfg.clientDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(cfg.clientDir, 'index.html')));
  }
  return app;
}
