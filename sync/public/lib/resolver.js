import { uploadFile, fileLink } from './files.js';

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/avif': '.avif' };

export function dataUriBlob(uri) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(uri);
  if (!m) throw new Error('Bad data URI');
  const bytes = m[2].includes(';base64')
    ? Uint8Array.from(atob(decodeURIComponent(m[3])), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

async function* iterate(body) {
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

/**
 * Builds the `resolve` callback for htmlToMarkdown / markdown rewriting. Attachments are encrypted and
 * uploaded chunk by chunk, so large files are streamed (when the size is known) rather than buffered.
 * `fetchRemote(url)` (optional) fetches authenticated remote resources; `lookup(url)` (optional) finds local files.
 */
export function makeResolver({ key, noteId, log, fetchRemote, remotePrefix, lookup }) {
  return async ({ kind, url, name }) => {
    try {
      let source, fname = name;
      if (url.startsWith('data:')) {
        source = dataUriBlob(url);
        if (!/\.\w{2,5}$/.test(fname)) fname += EXT[source.type] ?? '';
      } else if (fetchRemote && remotePrefix && url.startsWith(remotePrefix)) {
        const res = await fetchRemote(url);
        const len = Number(res.headers.get('content-length'));
        if (len > 0 && res.body) source = { size: len, stream: iterate(res.body) };
        else source = await res.blob();
        if (!/\.\w{2,5}$/.test(fname)) fname += EXT[res.headers.get('content-type')?.split(';')[0]] ?? '';
      } else if (lookup) {
        const f = await lookup(url);
        if (!f) return null;
        source = f;
        fname = f.name;
      } else {
        return null;
      }
      const id = await uploadFile(key, noteId, source);
      return fileLink(fname, id, kind === 'img');
    } catch (e) {
      log(`  attachment "${name}" failed: ${e.message}`);
      return `⚠ attachment failed: ${name}`;
    }
  };
}
