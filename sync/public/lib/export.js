import { api } from './api.js';
import { decryptText } from './crypto.js';
import { downloadFile } from './files.js';
import { parseNote } from './markdown.js';
import { ZipWriter } from './zip.js';

const safe = (s) => s.replace(/[^\w.\- ]+/g, '_').trim().slice(0, 80) || 'untitled';

/** Writer backed by a directory handle: unlimited file size, nested folders. */
export function dirWriter(root) {
  return {
    async write(path, chunks) {
      let dir = root;
      const parts = path.split('/');
      const name = parts.pop();
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      try { for await (const c of chunks) await w.write(c); } finally { await w.close(); }
    },
    async close() {},
  };
}

/** Writer producing a ZIP, streamed to a save-file picker when available, otherwise buffered as a Blob. */
export async function zipWriter(name = 'sec-selfnotes-export.zip') {
  let sink, finish;
  if (window.showSaveFilePicker) {
    const w = await (await window.showSaveFilePicker({ suggestedName: name })).createWritable();
    sink = (c) => w.write(c); finish = () => w.close();
  } else {
    const parts = [];
    sink = (c) => { parts.push(c); }; 
    finish = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(parts, { type: 'application/zip' })); a.download = name; a.click(); };
  }
  const zip = new ZipWriter(sink);
  return { write: (path, chunks) => zip.addFile(path, chunks), close: async () => { await zip.close(); await finish(); } };
}

async function* once(bytes) { yield bytes; }

export async function exportAll(key, writer, log, progress) {
  let offset = 0, total = Infinity, n = 0;
  const used = new Set();
  while (offset < total) {
    const page = await api.listNotes(offset, 100);
    total = page.total;
    if (!page.notes.length) break;
    for (const meta of page.notes) {
      const full = await api.getNote(meta.noteId);
      const { meta: fm, body } = parseNote(await decryptText(key, full.content));
      const dir = safe(meta.category);
      const refs = [];
      const text = body.replace(/\[([^\]]*)\]\(sec-file:([0-9a-f-]{36})(?:#w=\d+)?\)/g, (_m, label, id) => {
        const rel = `attachments/${id.slice(0, 8)}-${safe(label)}`;
        refs.push({ id, path: `${dir}/${rel}` });
        return `[${label}](${encodeURI(rel)})`;
      });
      const stem = `${safe(meta.title)}-${meta.noteId.slice(0, 8)}`;
      const fmText = `---\ntitle: ${JSON.stringify(fm.title)}\ncategory: ${JSON.stringify(fm.category)}\ncreated: ${fm.created}\nmodified: ${fm.modified}\ntags: ${JSON.stringify(fm.tags)}\n---\n\n`;
      await writer.write(`${dir}/${stem}.md`, once(new TextEncoder().encode(fmText + text)));
      for (const r of refs) {
        if (used.has(r.path)) continue;
        used.add(r.path);
        try { await writer.write(r.path, downloadFile(key, meta.noteId, r.id)); } catch (e) { log(`  attachment ${r.id} failed: ${e.message}`); }
      }
      progress(++n / total);
    }
    offset += page.notes.length;
  }
  await writer.close();
  log(`Exported ${n} notes`);
}
