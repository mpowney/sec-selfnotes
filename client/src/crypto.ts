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

/** Wraps an existing master key for an additional authenticator's PRF output. */
export async function wrapMasterKey(prfOutput: ArrayBuffer, masterKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrappingKey(prfOutput), raw);
  return b64(concat(iv, new Uint8Array(ct)));
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
  crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

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
/** Encrypts to the raw SCE1 byte layout. `aad` binds the ciphertext to its context (e.g. file chunk position). */
export async function encryptRaw(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const params: AesGcmParams = { name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) };
  const ct = await crypto.subtle.encrypt(params, key, bytes);
  return concat(MAGIC, iv, new Uint8Array(ct));
}

export async function decryptRaw(key: CryptoKey, data: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  if (dec.decode(data.subarray(0, 4)) !== 'SCE1') throw new Error('Not an SCE1 blob');
  const params: AesGcmParams = {
    name: 'AES-GCM', iv: data.subarray(4, 4 + IV_LEN), ...(aad ? { additionalData: enc.encode(aad) } : {}),
  };
  return new Uint8Array(await crypto.subtle.decrypt(params, key, data.subarray(4 + IV_LEN)));
}

export const encryptBytes = async (key: CryptoKey, bytes: Uint8Array<ArrayBuffer>) => b64(await encryptRaw(key, bytes));
export const decryptBytes = (key: CryptoKey, content: string) => decryptRaw(key, unb64(content));

export const encryptNote = (key: CryptoKey, markdown: string) => encryptBytes(key, enc.encode(markdown));

export async function decryptNote(key: CryptoKey, content: string): Promise<string> {
  return dec.decode(await decryptBytes(key, content));
}

const PW_PREFIX = 'pw1:';
const PW_ITERATIONS = 600_000;

export const isPassphraseWrapped = (wrapped: string): boolean => wrapped.startsWith(PW_PREFIX);

async function passphraseSecret(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PW_ITERATIONS }, base, 256);
}

/** Wraps the master key (new or existing) with a passphrase, e.g. one kept in a password manager such as Bitwarden. */
export async function wrapWithPassphrase(passphrase: string, masterKey?: CryptoKey): Promise<{ masterKey: CryptoKey; wrapped: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const secret = await passphraseSecret(passphrase, salt);
  const res = masterKey
    ? { masterKey, wrapped: await wrapMasterKey(secret, masterKey) }
    : await createWrappedMasterKey(secret);
  return { masterKey: res.masterKey, wrapped: `${PW_PREFIX}${b64(salt)}:${res.wrapped}` };
}

export async function unwrapWithPassphrase(passphrase: string, wrapped: string): Promise<CryptoKey> {
  const [, salt, inner] = wrapped.split(':');
  return unwrapMasterKey(await passphraseSecret(passphrase, unb64(salt)), inner);
}
