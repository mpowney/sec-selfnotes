// Mirrors client/src/crypto.ts (SCE1 format, per-chunk AAD). Keep in sync with the core client.
const enc = new TextEncoder();
const dec = new TextDecoder();
const IV_LEN = 12;
export const PRF_SALT = enc.encode('sec-selfnotes-prf-v1');
export const CHUNK = 16 * 1024 * 1024;
export const aadFor = (fileId, index, total) => `${fileId}:${index}:${total}`;

export const b64 = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function wrappingKey(prf) {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('sec-selfnotes-wrap-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function unwrapMasterKey(prf, wrapped) {
  const data = unb64(wrapped);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, IV_LEN) }, await wrappingKey(prf), data.subarray(IV_LEN));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptRaw(key, bytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, bytes));
  const out = new Uint8Array(4 + IV_LEN + ct.length);
  out.set(enc.encode('SCE1'), 0); out.set(iv, 4); out.set(ct, 4 + IV_LEN);
  return out;
}

export async function decryptRaw(key, data, aad) {
  if (dec.decode(data.subarray(0, 4)) !== 'SCE1') throw new Error('Not an SCE1 blob');
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(4, 4 + IV_LEN), ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, data.subarray(4 + IV_LEN)));
}

export const encryptText = async (key, text) => b64(await encryptRaw(key, enc.encode(text)));
export const decryptText = async (key, content) => dec.decode(await decryptRaw(key, unb64(content)));
