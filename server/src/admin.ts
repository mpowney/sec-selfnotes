import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { NoteStorage } from './storage.js';

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

/** Creates the default `admin` account on first startup and prints its generated password once. */
export async function initAdminAccount(db: Db): Promise<void> {
  if (db.prepare('SELECT 1 FROM admin_accounts WHERE username = ?').get('admin')) return;
  const password = randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO admin_accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    'admin',
    hash,
    Date.now(),
  );
  console.log('='.repeat(60));
  console.log('  ADMIN ACCOUNT CREATED');
  console.log('  Username: admin');
  console.log(`  Password: ${password}`);
  console.log('  Store this password securely — it will not be shown again.');
  console.log('  Sign in at /admin');
  console.log('='.repeat(60));
}

export function adminRouter(db: Db, storage: NoteStorage): Router {
  const r = Router();

  r.get('/status', (req, res) => {
    res.json(
      req.session.isAdmin ? { authenticated: true, username: req.session.adminUsername } : { authenticated: false },
    );
  });

  r.post('/login', async (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const admin = db
      .prepare('SELECT username, password_hash FROM admin_accounts WHERE username = ?')
      .get(username) as { username: string; password_hash: string } | undefined;
    const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!admin || !valid) return res.status(401).json({ error: 'Invalid credentials' });
    // Admin sessions never carry a user identity, so they are rejected by requireAuth
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        req.session.isAdmin = true;
        req.session.adminUsername = admin.username;
        req.session.save((e) => (e ? reject(e) : resolve()));
      });
    });
    res.json({ success: true, username: admin.username });
  });

  r.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('sid');
      res.json({ success: true });
    });
  });

  r.get('/users', requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.created_at, l.last_login_at,
                (SELECT COUNT(*) FROM credentials c WHERE c.user_id = u.id) AS credential_count,
                (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id) AS note_count
         FROM users u LEFT JOIN user_logins l ON l.user_id = u.id ORDER BY u.created_at DESC`,
      )
      .all() as any[];
    res.json(
      rows.map((u) => ({
        id: u.id,
        username: u.username,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at ?? null,
        credentialCount: u.credential_count,
        noteCount: u.note_count,
      })),
    );
  });

  r.delete('/users/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'User not found' });
    const notes = db.prepare('SELECT note_id, category FROM notes WHERE user_id = ?').all(id) as {
      note_id: string;
      category: string;
    }[];
    for (const n of notes) storage.remove(n.category, n.note_id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id); // cascades to credentials, notes, logins
    res.json({ success: true });
  });

  r.get('/users/:id/credentials', requireAdmin, (req, res) => {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'User not found' });
    }
    const rows = db
      .prepare('SELECT id, transports, created_at FROM credentials WHERE user_id = ? ORDER BY created_at ASC')
      .all(req.params.id) as { id: string; transports: string | null; created_at: number }[];
    res.json(
      rows.map((c) => ({
        credentialId: c.id,
        transports: c.transports ? (JSON.parse(c.transports) as string[]) : [],
        createdAt: c.created_at,
      })),
    );
  });

  r.delete('/users/:id/credentials/:credentialId', requireAdmin, (req, res) => {
    const { id, credentialId } = req.params;
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'User not found' });
    const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE user_id = ?').get(id) as { cnt: number };
    if (cnt <= 1) {
      return res.status(400).json({ error: 'Cannot revoke the last authenticator. Delete the user instead.' });
    }
    const result = db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(credentialId, id);
    if (!result.changes) return res.status(404).json({ error: 'Credential not found' });
    res.json({ success: true });
  });

  return r;
}
