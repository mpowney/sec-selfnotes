import { api } from './api.js';
import { decryptText, encryptText } from './crypto.js';
import { serializeNote, cleanCategory, cleanTitle } from './markdown.js';

export async function loadState(key, name) {
  const c = await api.getState(name);
  if (!c) return {};
  try { return JSON.parse(await decryptText(key, c)); } catch { return {}; }
}
export const saveState = async (key, name, state) => api.putState(name, await encryptText(key, JSON.stringify(state)));

/** Runs fn over items with bounded concurrency. */
export async function pool(items, limit, fn) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let n = it.next(); !n.done; n = it.next()) await fn(n.value);
  }));
}

/**
 * Creates or updates the note mapped by `entry`. `makeBody(noteId)` returns the markdown and may upload
 * attachments against that note id. If the user edited the mapped note locally since the last sync,
 * the remote version is saved as a separate "conflict" note instead of overwriting local work.
 * Returns the new mapping entry (caller adds source-specific fields).
 */
export async function upsertNote(key, entry, { title, category, created, modified, tags, makeBody, log }) {
  title = cleanTitle(title); category = cleanCategory(category);
  const meta = (body, t) => encryptText(key, serializeNote({ title: t, category, created, modified, tags: tags ?? [] }, body));
  let noteId = entry?.noteId;
  let conflict = false;
  if (noteId) {
    try {
      const m = await api.metadata(noteId);
      if (m.modifiedAt > entry.localModified) conflict = true;
    } catch (e) {
      if (e.status !== 404) throw e;
      noteId = undefined; // deleted locally: recreate
    }
  }
  if (conflict) {
    log(`  conflict: "${title}" was edited locally; saving remote copy separately`);
    const t = cleanTitle(`${title} (conflict ${new Date().toISOString().slice(0, 10)})`);
    const created2 = await api.createNote(t, category, await meta('(importing…)', t), Date.parse(created) || undefined, Date.parse(modified) || undefined);
    const body = await makeBody(created2.noteId);
    await api.updateNote(created2.noteId, t, category, await meta(body, t));
    return { ...entry };
  }
  if (!noteId) {
    const n = await api.createNote(title, category, await meta('(importing…)', title), Date.parse(created) || undefined, Date.parse(modified) || undefined);
    noteId = n.noteId;
  }
  const body = await makeBody(noteId);
  const saved = await api.updateNote(noteId, title, category, await meta(body, title));
  return { noteId, localModified: saved.modifiedAt };
}
