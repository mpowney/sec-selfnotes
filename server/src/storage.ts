import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { serverDecrypt, serverEncrypt } from './crypto.js';

export const DEFAULT_CATEGORY = 'uncategorized';

/** Maps a category name to a safe directory name (prevents path traversal). */
export function categoryDir(category: string): string {
  const slug = category
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || DEFAULT_CATEGORY;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class NoteStorage {
  private root: string;
  constructor(private cfg: Config) {
    this.root = path.join(cfg.dataDir, 'notes');
    fs.mkdirSync(this.root, { recursive: true });
  }

  filePath(category: string, noteId: string): string {
    if (!UUID_RE.test(noteId)) throw new Error('Invalid note id');
    const file = path.join(this.root, categoryDir(category), `${noteId}.md`);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Invalid path');
    return file;
  }

  write(category: string, noteId: string, sce1: Buffer): void {
    const file = this.filePath(category, noteId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, serverEncrypt(this.cfg.systemKey, noteId, sce1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  read(category: string, noteId: string): Buffer {
    return serverDecrypt(this.cfg.systemKey, noteId, fs.readFileSync(this.filePath(category, noteId)));
  }

  remove(category: string, noteId: string): void {
    fs.rmSync(this.filePath(category, noteId), { force: true });
    fs.rmSync(path.dirname(this.uploadsDir(category, noteId)), { recursive: true, force: true });
  }

  /** Per-note uploads folder: <category>/<noteId>/uploads */
  uploadsDir(category: string, noteId: string): string {
    return path.join(path.dirname(this.filePath(category, noteId)), noteId, 'uploads');
  }

  private uploadPath(category: string, noteId: string, fileId: string): string {
    if (!UUID_RE.test(fileId)) throw new Error('Invalid file id');
    return path.join(this.uploadsDir(category, noteId), fileId);
  }

  writeUpload(category: string, noteId: string, fileId: string, sce1: Buffer): void {
    const file = this.uploadPath(category, noteId, fileId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, serverEncrypt(this.cfg.systemKey, `${noteId}/${fileId}`, sce1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  readUpload(category: string, noteId: string, fileId: string): Buffer {
    return serverDecrypt(
      this.cfg.systemKey,
      `${noteId}/${fileId}`,
      fs.readFileSync(this.uploadPath(category, noteId, fileId)),
    );
  }

  move(oldCategory: string, newCategory: string, noteId: string): void {
    const from = this.filePath(oldCategory, noteId);
    const to = this.filePath(newCategory, noteId);
    if (from === to) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    const upFrom = path.dirname(this.uploadsDir(oldCategory, noteId));
    if (fs.existsSync(upFrom)) fs.renameSync(upFrom, path.dirname(this.uploadsDir(newCategory, noteId)));
  }

  /**
   * Scans the notes directory on startup. Note contents are encrypted so metadata cannot
   * be recovered from files; DB rows whose files are gone are dropped and orphan files are reported.
   */
  reconcile(db: Db): { removed: number; orphans: number } {
    const onDisk = new Set<string>();
    for (const dir of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(this.root, dir.name))) {
        if (f.endsWith('.md')) onDisk.add(f.slice(0, -3));
      }
    }
    const rows = db.prepare('SELECT note_id, category FROM notes').all() as { note_id: string; category: string }[];
    const known = new Set(rows.map((r) => r.note_id));
    let removed = 0;
    for (const r of rows) {
      if (!fs.existsSync(this.filePath(r.category, r.note_id))) {
        db.prepare('DELETE FROM notes WHERE note_id = ?').run(r.note_id);
        removed++;
      }
    }
    const orphans = [...onDisk].filter((id) => !known.has(id)).length;
    return { removed, orphans };
  }
}
