import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { isSce1 } from './crypto.js';
import { CHUNK_BYTES, DEFAULT_CATEGORY, MAX_CHUNKS, NoteStorage, UUID_RE } from './storage.js';

interface NoteRow {
  note_id: string;
  title: string;
  category: string;
  created_at: number;
  modified_at: number;
}

const toMeta = (n: NoteRow) => ({
  noteId: n.note_id,
  title: n.title,
  category: n.category,
  createdAt: n.created_at,
  modifiedAt: n.modified_at,
});

const MAX_TITLE = 200;
const MAX_CATEGORY = 64;

function parseMeta(body: any): { title: string; category: string } | { error: string } {
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  const category =
    typeof body?.category === 'string' && body.category.trim() ? body.category.trim() : DEFAULT_CATEGORY;
  if (category.length > MAX_CATEGORY) return { error: 'Category too long' };
  return { title: title || 'Untitled', category };
}

function parseContent(body: any): Buffer | null {
  if (typeof body?.content !== 'string') return null;
  const buf = Buffer.from(body.content, 'base64');
  // The server only ever stores client-encrypted (SCE1) content.
  return isSce1(buf) ? buf : null;
}

export function notesRouter(db: Db, storage: NoteStorage): Router {
  const r = Router();

  const find = (userId: string, noteId: string) =>
    UUID_RE.test(noteId)
      ? (db.prepare('SELECT * FROM notes WHERE note_id = ? AND user_id = ?').get(noteId, userId) as
          | NoteRow
          | undefined)
      : undefined;

  r.get('/categories', (req, res) => {
    const rows = db
      .prepare('SELECT category, COUNT(*) AS count FROM notes WHERE user_id = ? GROUP BY category ORDER BY category')
      .all(req.session.userId) as { category: string; count: number }[];
    res.json({ categories: rows });
  });

  r.get('/notes', (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    // Incremental listing for sync clients: only notes modified after this epoch-ms timestamp.
    const since = Math.max(parseInt(String(req.query.modifiedSince ?? '0'), 10) || 0, 0);
    const where = ['user_id = ?', 'modified_at > ?'];
    const args: (string | number)[] = [req.session.userId!, since];
    if (category) {
      where.push('category = ?');
      args.push(category);
    }
    const clause = where.join(' AND ');
    const rows = db
      .prepare(`SELECT * FROM notes WHERE ${clause} ORDER BY modified_at DESC, note_id LIMIT ? OFFSET ?`)
      .all(...args, limit, offset) as NoteRow[];
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM notes WHERE ${clause}`).get(...args) as {
      total: number;
    };
    res.json({ notes: rows.map(toMeta), limit, offset, total });
  });

  r.get('/notes/:noteId/metadata', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json(toMeta(note));
  });

  r.get('/notes/:noteId', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    try {
      const content = storage.read(note.category, note.note_id).toString('base64');
      res.json({ ...toMeta(note), content });
    } catch {
      res.status(500).json({ error: 'Failed to read note' });
    }
  });

  r.post('/notes', (req, res) => {
    const meta = parseMeta(req.body);
    if ('error' in meta) return res.status(400).json(meta);
    const content = parseContent(req.body);
    if (!content) return res.status(400).json({ error: 'content must be base64 SCE1 data' });
    const noteId = randomUUID();
    const now = Date.now();
    // Importers may preserve original timestamps (epoch ms, not in the future).
    const ts = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= now ? (v as number) : now);
    const createdAt = ts(req.body?.createdAt);
    const modifiedAt = Math.max(createdAt, ts(req.body?.modifiedAt));
    storage.write(meta.category, noteId, content);
    db.prepare(
      'INSERT INTO notes (note_id, user_id, title, category, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(noteId, req.session.userId, meta.title, meta.category, createdAt, modifiedAt);
    res.status(201).json(toMeta(find(req.session.userId!, noteId)!));
  });

  r.put('/notes/:noteId', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const meta = parseMeta(req.body);
    if ('error' in meta) return res.status(400).json(meta);
    const content = parseContent(req.body);
    if (!content) return res.status(400).json({ error: 'content must be base64 SCE1 data' });
    storage.move(note.category, meta.category, note.note_id);
    storage.write(meta.category, note.note_id, content);
    db.prepare('UPDATE notes SET title = ?, category = ?, modified_at = ? WHERE note_id = ?').run(
      meta.title,
      meta.category,
      Date.now(),
      note.note_id,
    );
    res.json(toMeta(find(req.session.userId!, note.note_id)!));
  });

  r.post('/notes/:noteId/files', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const fileId = randomUUID();
    storage.initUpload(note.category, note.note_id, fileId);
    res.status(201).json({ fileId });
  });

  r.put(
    '/notes/:noteId/files/:fileId/chunks/:index',
    express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES + 1024 }),
    (req, res) => {
      const note = find(req.session.userId!, req.params.noteId);
      if (!note || !UUID_RE.test(req.params.fileId)) return res.status(404).json({ error: 'File not found' });
      const index = Number(req.params.index);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) return res.status(400).json({ error: 'Invalid chunk' });
      if (!isSce1(body)) return res.status(400).json({ error: 'chunk must be SCE1 data' });
      try {
        storage.writeChunk(note.category, note.note_id, req.params.fileId, index, body);
        res.json({ ok: true });
      } catch {
        res.status(404).json({ error: 'File not found' });
      }
    },
  );

  r.get('/notes/:noteId/files/:fileId', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note || !UUID_RE.test(req.params.fileId)) return res.status(404).json({ error: 'File not found' });
    try {
      res.json({ chunks: storage.chunkCount(note.category, note.note_id, req.params.fileId) });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  r.get('/notes/:noteId/files/:fileId/chunks/:index', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note || !UUID_RE.test(req.params.fileId)) return res.status(404).json({ error: 'File not found' });
    try {
      res.type('application/octet-stream').send(
        storage.readChunk(note.category, note.note_id, req.params.fileId, Number(req.params.index)),
      );
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Opaque, client-encrypted (SCE1) sync bookkeeping (e.g. source-id -> note-id maps) used by the sync service UI.
  const STATE_KEY_RE = /^[a-z0-9-]{1,64}$/;
  r.get('/sync-state/:key', (req, res) => {
    if (!STATE_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Invalid key' });
    const row = db
      .prepare('SELECT content, updated_at FROM sync_state WHERE user_id = ? AND key = ?')
      .get(req.session.userId, req.params.key) as { content: string; updated_at: number } | undefined;
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ content: row.content, updatedAt: row.updated_at });
  });

  r.put('/sync-state/:key', (req, res) => {
    if (!STATE_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Invalid key' });
    const content = parseContent(req.body);
    if (!content) return res.status(400).json({ error: 'content must be base64 SCE1 data' });
    if (content.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'State too large' });
    db.prepare(
      `INSERT INTO sync_state (user_id, key, content, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    ).run(req.session.userId, req.params.key, content.toString('base64'), Date.now());
    res.json({ ok: true });
  });

  r.delete('/notes/:noteId', (req, res) => {
    const note = find(req.session.userId!, req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    storage.remove(note.category, note.note_id);
    db.prepare('DELETE FROM notes WHERE note_id = ?').run(note.note_id);
    res.json({ ok: true });
  });

  return r;
}
