import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** Magic of the client-side E2E blob: [SCE1][12-byte IV][AES-256-GCM ciphertext+tag] */
export const SCE1_MAGIC = Buffer.from('SCE1');
/** Magic of the server-side layer written to disk: [SSE1][12-byte IV][ciphertext+tag] */
const SSE1_MAGIC = Buffer.from('SSE1');
const IV_LEN = 12;
const TAG_LEN = 16;

export function isSce1(buf: Buffer): boolean {
  return buf.length >= SCE1_MAGIC.length + IV_LEN + TAG_LEN && buf.subarray(0, 4).equals(SCE1_MAGIC);
}

/** Layer 1: per-file key derived with HKDF-SHA256 from the system key and the note id. */
export function deriveFileKey(systemKey: Buffer, noteId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', systemKey, Buffer.from(noteId), 'sec-selfnotes-file-v1', 32));
}

export function serverEncrypt(systemKey: Buffer, noteId: string, data: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', deriveFileKey(systemKey, noteId), iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([SSE1_MAGIC, iv, ct]);
}

export function serverDecrypt(systemKey: Buffer, noteId: string, data: Buffer): Buffer {
  if (data.length < 4 + IV_LEN + TAG_LEN || !data.subarray(0, 4).equals(SSE1_MAGIC)) {
    throw new Error('Invalid server-encrypted file');
  }
  const iv = data.subarray(4, 4 + IV_LEN);
  const tag = data.subarray(data.length - TAG_LEN);
  const ct = data.subarray(4 + IV_LEN, data.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', deriveFileKey(systemKey, noteId), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
