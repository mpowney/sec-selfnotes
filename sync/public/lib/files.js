import { CHUNK, aadFor, decryptRaw, encryptRaw } from './crypto.js';
import { api } from './api.js';

/**
 * Encrypts and uploads a file in 16 MiB chunks. `source` is a Blob/File (random access) or
 * { size, stream } where stream is an async iterable of Uint8Array. The chunk count is part of each
 * chunk's AAD, so the total size must be known up front (callers fall back to a Blob when it is not).
 */
export async function uploadFile(key, noteId, source, onProgress) {
  const size = source.size;
  const total = Math.max(1, Math.ceil(size / CHUNK));
  const { fileId } = await api.startUpload(noteId);
  let index = 0;
  const put = async (plain) => {
    await api.uploadChunk(noteId, fileId, index, await encryptRaw(key, plain, aadFor(fileId, index, total)));
    index++;
    onProgress?.(index / total);
  };
  if (typeof source.slice === 'function') {
    for (let i = 0; i < total; i++) await put(new Uint8Array(await source.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()));
  } else {
    let buf = new Uint8Array(0);
    let seen = 0;
    for await (const part of source.stream) {
      seen += part.length;
      const merged = new Uint8Array(buf.length + part.length);
      merged.set(buf); merged.set(part, buf.length);
      buf = merged;
      while (buf.length >= CHUNK && index < total - 1) { await put(buf.slice(0, CHUNK)); buf = buf.slice(CHUNK); }
    }
    if (seen !== size) throw new Error('Size mismatch while streaming');
    await put(buf);
  }
  return fileId;
}

/** Yields decrypted plaintext chunks of an uploaded file. */
export async function* downloadFile(key, noteId, fileId) {
  const { chunks } = await api.fileInfo(noteId, fileId);
  for (let i = 0; i < chunks; i++) {
    yield await decryptRaw(key, await api.downloadChunk(noteId, fileId, i), aadFor(fileId, i, chunks));
  }
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
export const fileLink = (name, fileId, forceImage) =>
  `${forceImage || IMAGE_EXT.test(name) ? '!' : ''}[${name.replace(/[[\]()<>]/g, '_')}](sec-file:${fileId})`;
