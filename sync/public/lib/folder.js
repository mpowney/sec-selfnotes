import { htmlToMarkdown } from './html2md.js';
import { makeResolver } from './resolver.js';
import { loadState, saveState, pool, upsertNote } from './sync.js';
import { parseNote } from './markdown.js';

const NOTE_EXT = /\.(md|markdown|txt|html?)$/i;

/** Lists files below a directory handle (File System Access API) as { path, file }. */
export async function listHandle(dir, prefix = '') {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') out.push(...(await listHandle(h, `${prefix}${name}/`)));
    else out.push({ path: prefix + name, get: () => h.getFile() });
  }
  return out;
}

/** Lists files from an <input webkitdirectory> FileList. */
export function listFileList(files) {
  return [...files].map((f) => ({ path: f.webkitRelativePath.split('/').slice(1).join('/') || f.name, get: async () => f }))
    .filter((e) => !e.path.split('/').some((p) => p.startsWith('.')));
}

function normalise(base, rel) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(rel.split(/[?#]/)[0]).split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
const isExternal = (u) => /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u);

async function replaceAsync(str, re, fn) {
  const jobs = []; str.replace(re, (...a) => { jobs.push(fn(...a)); return ''; });
  const res = await Promise.all(jobs.map((j) => j.catch(() => null)));
  let i = 0;
  return str.replace(re, (m) => res[i++] ?? m);
}

/** Imports (or incrementally re-imports) notes from a folder listing. State is keyed by relative path. */
export async function syncFolder(key, listing, log, progress) {
  const state = await loadState(key, 'folder');
  const byPath = new Map(listing.map((e) => [e.path, e]));
  const notes = listing.filter((e) => NOTE_EXT.test(e.path));
  const todo = [];
  for (const e of notes) {
    const f = await e.get();
    const prev = state[e.path];
    if (prev && prev.lastModified === f.lastModified && prev.size === f.size) continue;
    todo.push({ e, f });
  }
  log(`Folder: ${notes.length} notes, ${todo.length} new or changed`);
  let done = 0, failed = 0;
  await pool(todo, 2, async ({ e, f }) => {
    try {
      const segs = e.path.split('/');
      const base = segs.pop().replace(/\.[^.]+$/, '');
      const dirCategory = segs[0] ?? 'imported';
      const lookup = async (u) => {
        if (isExternal(u)) return null;
        const hit = byPath.get(normalise(e.path, u));
        return hit ? hit.get() : null;
      };
      const raw = await f.text();
      const iso = new Date(f.lastModified).toISOString();
      const htmlTitle = /\.html?$/i.test(e.path)
        ? new DOMParser().parseFromString(raw, 'text/html').querySelector('title')?.textContent?.trim() : '';
      log(`  ${e.path}`);
      state[e.path] = {
        ...(await upsertNote(key, state[e.path], {
          title: htmlTitle || base, category: dirCategory, created: iso, modified: iso, log,
          makeBody: async (noteId) => {
            const resolve = makeResolver({ key, noteId, log, lookup });
            if (/\.html?$/i.test(e.path)) return (await htmlToMarkdown(raw, resolve)).markdown;
            const { body } = parseNote(raw);
            const text = /^---\r?\n/.test(raw) ? body : raw;
            return replaceAsync(text, /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, async (m, bang, label, url) => {
              if (isExternal(url) && !url.startsWith('data:')) return m;
              const r = await resolve({ kind: bang ? 'img' : 'file', url, name: label || url.split('/').pop() });
              return r ?? m;
            });
          },
        })),
        lastModified: f.lastModified, size: f.size,
      };
    } catch (err) {
      failed++; log(`  failed: ${e.path}: ${err.message}`);
    }
    progress(++done / todo.length);
  });
  await saveState(key, 'folder', state);
  log(`Folder sync finished: ${todo.length - failed} imported/updated, ${failed} failed`);
}
