const enc = new TextEncoder();
const dec = new TextDecoder();
const MAGIC = enc.encode('SCE1');
const IV_LEN = 12;

export const PRF_SALT = enc.encode('sec-selfnotes-prf-v1');

export const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function wrappingKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('sec-selfnotes-wrap-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Generates a fresh master key and wraps it with a key derived from the authenticator's PRF output. */
export async function createWrappedMasterKey(prfOutput: ArrayBuffer): Promise<{ masterKey: CryptoKey; wrapped: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrappingKey(prfOutput), raw);
  const wrapped = b64(concat(iv, new Uint8Array(ct)));
  return { masterKey: await importMaster(raw), wrapped };
}

export async function unwrapMasterKey(prfOutput: ArrayBuffer, wrapped: string): Promise<CryptoKey> {
  const data = unb64(wrapped);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, IV_LEN) },
    await wrappingKey(prfOutput),
    data.subarray(IV_LEN),
  );
  return importMaster(new Uint8Array(raw));
}

const importMaster = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** SCE1 format: [magic "SCE1"][12-byte IV][AES-256-GCM ciphertext+tag], returned base64 encoded. */
export async function encryptNote(key: CryptoKey, markdown: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(markdown));
  return b64(concat(MAGIC, iv, new Uint8Array(ct)));
}

export async function decryptNote(key: CryptoKey, content: string): Promise<string> {
  const data = unb64(content);
  if (dec.decode(data.subarray(0, 4)) !== 'SCE1') throw new Error('Not an SCE1 blob');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(4, 4 + IV_LEN) }, key, data.subarray(4 + IV_LEN));
  return dec.decode(pt);
}
