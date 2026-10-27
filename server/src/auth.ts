import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import type { Config } from './config.js';
import type { Db } from './db.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    credentialId?: string;
    isAdmin?: boolean;
    adminUsername?: string;
    challenge?: string;
    pendingUser?: { id: string; username: string };
  }
}

const USERNAME_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const MAX_WRAPPED_KEY = 1024;

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function startSession(req: Request, userId: string, username: string, credentialId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.username = username;
      req.session.credentialId = credentialId;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

export function authRouter(cfg: Config, db: Db): Router {
  const r = Router();

  r.post('/register', async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Invalid username' });
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'Username already registered' });
    }
    const userId = randomUUID();
    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpID,
      userName: username,
      userID: randomBytes(32),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    req.session.challenge = options.challenge;
    req.session.pendingUser = { id: userId, username };
    res.json(options);
  });

  r.post('/register/verify', async (req, res) => {
    const { challenge, pendingUser } = req.session;
    const wrappedKey = req.body?.wrappedKey;
    if (!challenge || !pendingUser) return res.status(400).json({ error: 'No registration in progress' });
    if (typeof wrappedKey !== 'string' || !wrappedKey || wrappedKey.length > MAX_WRAPPED_KEY) {
      return res.status(400).json({ error: 'Invalid wrapped key' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge: challenge,
        expectedOrigin: cfg.rpOrigin,
        expectedRPID: cfg.rpID,
      });
    } catch {
      return res.status(400).json({ error: 'Registration verification failed' });
    }
    if (!verification.verified) return res.status(400).json({ error: 'Registration verification failed' });
    const { credential } = verification.registrationInfo;
    try {
      db.transaction(() => {
        const now = Date.now();
        db.prepare('INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)').run(
          pendingUser.id,
          pendingUser.username,
          now,
        );
        db.prepare(
          'INSERT INTO credentials (id, user_id, public_key, counter, transports, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          credential.id,
          pendingUser.id,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports ?? []),
          wrappedKey,
          now,
        );
        db.prepare('INSERT OR REPLACE INTO user_logins (user_id, last_login_at) VALUES (?, ?)').run(
          pendingUser.id,
          now,
        );
      })();
    } catch {
      return res.status(409).json({ error: 'Username or credential already registered' });
    }
    await startSession(req, pendingUser.id, pendingUser.username, credential.id);
    res.json({ username: pendingUser.username, credentialId: credential.id });
  });

  r.post('/signin/challenge', async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;
    if (username) {
      const rows = db
        .prepare(
          'SELECT c.id, c.transports FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.username = ?',
        )
        .all(username) as { id: string; transports: string | null }[];
      allowCredentials = rows.map((c) => ({
        id: c.id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      }));
    }
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID,
      userVerification: 'preferred',
      allowCredentials,
    });
    req.session.challenge = options.challenge;
    res.json(options);
  });

  r.post('/signin/verify', async (req, res) => {
    const { challenge } = req.session;
    const response = req.body?.response;
    if (!challenge || !response?.id) return res.status(400).json({ error: 'No sign-in in progress' });
    const cred = db
      .prepare(
        'SELECT c.id, c.public_key, c.counter, c.transports, c.wrapped_key, u.id AS user_id, u.username FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?',
      )
      .get(response.id) as
      | {
          id: string;
          public_key: Buffer;
          counter: number;
          transports: string | null;
          wrapped_key: string;
          user_id: string;
          username: string;
        }
      | undefined;
    if (!cred) return res.status(401).json({ error: 'Authentication failed' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: cfg.rpOrigin,
        expectedRPID: cfg.rpID,
        credential: {
          id: cred.id,
          publicKey: new Uint8Array(cred.public_key),
          counter: cred.counter,
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
      });
    } catch {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    if (!verification.verified) return res.status(401).json({ error: 'Authentication failed' });
    db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      cred.id,
    );
    db.prepare('INSERT OR REPLACE INTO user_logins (user_id, last_login_at) VALUES (?, ?)').run(
      cred.user_id,
      Date.now(),
    );
    await startSession(req, cred.user_id, cred.username, cred.id);
    res.json({ username: cred.username, wrappedKey: cred.wrapped_key, credentialId: cred.id });
  });

  r.get('/status', (req, res) => {
    if (!req.session.userId) return res.json({ authenticated: false });
    res.json({ authenticated: true, username: req.session.username, credentialId: req.session.credentialId });
  });

  r.get('/credentials', requireAuth, (req, res) => {
    const rows = db
      .prepare(
        'SELECT id, transports, created_at, name_encrypted FROM credentials WHERE user_id = ? ORDER BY created_at ASC',
      )
      .all(req.session.userId) as {
      id: string;
      transports: string | null;
      created_at: number;
      name_encrypted: string | null;
    }[];
    res.json({
      credentials: rows.map((c) => ({
        credentialId: c.id,
        transports: c.transports ? (JSON.parse(c.transports) as string[]) : [],
        createdAt: c.created_at,
        nameEncrypted: c.name_encrypted,
      })),
    });
  });

  r.delete('/credentials/:credentialId', requireAuth, (req, res) => {
    const { credentialId } = req.params;
    if (credentialId === req.session.credentialId) {
      return res.status(400).json({ error: 'Cannot revoke the authenticator used for the current session' });
    }
    if (!db.prepare('SELECT 1 FROM credentials WHERE id = ? AND user_id = ?').get(credentialId, req.session.userId)) {
      return res.status(404).json({ error: 'Credential not found' });
    }
    const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE user_id = ?').get(req.session.userId) as {
      cnt: number;
    };
    if (cnt <= 1) {
      return res.status(400).json({ error: 'Cannot revoke the last authenticator. Delete your account instead.' });
    }
    db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(credentialId, req.session.userId);
    res.json({ success: true });
  });

  r.patch('/credentials/:credentialId/name', requireAuth, (req, res) => {
    const name = req.body?.nameEncrypted ?? null;
    if (name !== null && (typeof name !== 'string' || name.length > MAX_WRAPPED_KEY)) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    const result = db
      .prepare('UPDATE credentials SET name_encrypted = ? WHERE id = ? AND user_id = ?')
      .run(name, req.params.credentialId, req.session.userId);
    if (!result.changes) return res.status(404).json({ error: 'Credential not found' });
    res.json({ success: true });
  });

  r.post('/add-credential/start', requireAuth, async (req, res) => {
    const rows = db
      .prepare('SELECT id, transports FROM credentials WHERE user_id = ?')
      .all(req.session.userId) as { id: string; transports: string | null }[];
    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpID,
      userName: req.session.username as string,
      userID: randomBytes(32),
      attestationType: 'none',
      excludeCredentials: rows.map((c) => ({
        id: c.id,
        transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransport[]) : undefined,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    req.session.challenge = options.challenge;
    res.json(options);
  });

  r.post('/add-credential/finish', requireAuth, async (req, res) => {
    const { challenge } = req.session;
    const { wrappedKey, nameEncrypted } = req.body ?? {};
    if (!challenge) return res.status(400).json({ error: 'No registration in progress' });
    if (typeof wrappedKey !== 'string' || !wrappedKey || wrappedKey.length > MAX_WRAPPED_KEY) {
      return res.status(400).json({ error: 'Invalid wrapped key' });
    }
    if (nameEncrypted != null && (typeof nameEncrypted !== 'string' || nameEncrypted.length > MAX_WRAPPED_KEY)) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge: challenge,
        expectedOrigin: cfg.rpOrigin,
        expectedRPID: cfg.rpID,
      });
    } catch {
      return res.status(400).json({ error: 'Registration verification failed' });
    }
    if (!verification.verified) return res.status(400).json({ error: 'Registration verification failed' });
    const { credential } = verification.registrationInfo;
    try {
      db.prepare(
        'INSERT INTO credentials (id, user_id, public_key, counter, transports, wrapped_key, name_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        credential.id,
        req.session.userId,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        wrappedKey,
        nameEncrypted ?? null,
        Date.now(),
      );
    } catch {
      return res.status(409).json({ error: 'Credential already registered' });
    }
    delete req.session.challenge;
    res.json({ success: true, credentialId: credential.id });
  });

  r.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('sid');
      res.json({ ok: true });
    });
  });

  return r;
}
