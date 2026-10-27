import express from 'express';
import type { Config } from './config.js';

/**
 * Static host for the browser-side sync tool. It never sees note plaintext or keys: all
 * decryption/encryption happens in the browser, which talks to the core API (/api) directly.
 */
export function createApp(cfg: Config) {
  const app = express();
  app.disable('x-powered-by');
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join('; '),
    );
    next();
  });

  router.get('/health', (_req, res) => res.json({ ok: true }));
  router.get('/config.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      basePath: cfg.basePath,
      msClientId: cfg.msClientId || null,
      msTenant: cfg.msTenant,
    });
  });
  router.use('/vendor', express.static(cfg.vendorDir, { index: false }));
  router.use(express.static(cfg.publicDir));

  app.get(cfg.basePath || '/', (req, res, next) => {
    if (cfg.basePath && !req.originalUrl.split('?')[0].endsWith('/')) {
      const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return res.redirect(301, `${cfg.basePath}/${q}`);
    }
    next();
  });
  app.use(cfg.basePath || '/', router);
  return app;
}
