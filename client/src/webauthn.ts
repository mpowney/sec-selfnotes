import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api';
import {
  PRF_SALT, createWrappedMasterKey, encryptNote, isPassphraseWrapped, unwrapMasterKey, unwrapWithPassphrase,
  wrapMasterKey, wrapWithPassphrase,
} from './crypto';

/** Asks for a passphrase using a password-manager friendly field. Resolves to null when cancelled. */
function askPassphrase(message: string, confirm: boolean, username?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000';
    const form = document.createElement('form');
    form.style.cssText = 'background:#fff;color:#000;padding:20px;border-radius:8px;display:flex;flex-direction:column;gap:8px;width:340px;max-width:90vw';
    const text = document.createElement('div');
    text.textContent = message;
    const mk = (autocomplete: string, label: string) => {
      const i = document.createElement('input');
      i.type = 'password';
      i.autocomplete = autocomplete as AutoFill;
      i.placeholder = label;
      i.required = true;
      i.style.cssText = 'padding:6px';
      return i;
    };
    if (username) {
      const u = document.createElement('input');
      u.type = 'text';
      u.value = username;
      u.autocomplete = 'username';
      u.hidden = true;
      form.append(u);
    }
    const pw = mk(confirm ? 'new-password' : 'current-password', 'Passphrase');
    const pw2 = confirm ? mk('new-password', 'Repeat passphrase') : null;
    const err = document.createElement('div');
    err.style.color = '#b10e1c';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = 'Continue';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const done = (v: string | null) => { overlay.remove(); resolve(v); };
    cancel.onclick = () => done(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (pw2 && pw.value !== pw2.value) { err.textContent = 'Passphrases do not match'; return; }
      done(pw.value);
    };
    form.append(text, pw, ...(pw2 ? [pw2] : []), err, ok, cancel);
    overlay.append(form);
    document.body.append(overlay);
    pw.focus();
  });
}

const NO_PRF_MSG =
  'This authenticator (e.g. a Bitwarden passkey) does not support the WebAuthn PRF extension. ' +
  'Choose a passphrase (store it in your password manager) to protect your notes key.';

async function newPassphraseWrap(username: string, masterKey?: CryptoKey) {
  const pass = await askPassphrase(NO_PRF_MSG, true, username);
  if (!pass) throw new Error('A passphrase is required for authenticators without PRF support');
  return wrapWithPassphrase(pass, masterKey);
}

const prfInput = { prf: { eval: { first: PRF_SALT } } };

/** Extracts the PRF secret and removes it so it is never sent to the server. */
function takePrf(response: { clientExtensionResults: Record<string, any> }): ArrayBuffer | undefined {
  const prf = response.clientExtensionResults?.prf;
  const first = prf?.results?.first as ArrayBuffer | undefined;
  if (prf) delete prf.results;
  return first;
}

async function getPrfOutput(credentialId: string): Promise<ArrayBuffer> {
  const opts = {
    challenge: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
    rpId: location.hostname,
    allowCredentials: [{ id: credentialId, type: 'public-key' as const }],
    userVerification: 'preferred' as const,
    extensions: prfInput,
  };
  const out = takePrf(await startAuthentication({ optionsJSON: opts as any }));
  if (!out) throw new Error('This authenticator does not support the WebAuthn PRF extension');
  return out;
}

export async function register(username: string): Promise<Session> {
  const options = await api.post<any>('/api/auth/register', { username });
  options.extensions = { ...options.extensions, ...prfInput };
  const response = await startRegistration({ optionsJSON: options });
  const prf = response.clientExtensionResults?.prf as any;
  let secret: ArrayBuffer | undefined = prf?.results?.first;
  if (prf) delete prf.results;
  secret ??= await getPrfOutput(response.id).catch(() => undefined);
  const { masterKey, wrapped } = secret ? await createWrappedMasterKey(secret) : await newPassphraseWrap(username);
  await api.post('/api/auth/register/verify', { response, wrappedKey: wrapped });
  return { key: masterKey, credentialId: response.id };
}

export async function signIn(username: string): Promise<Session> {
  const options = await api.post<any>('/api/auth/signin/challenge', { username });
  options.extensions = { ...options.extensions, ...prfInput };
  const response = await startAuthentication({ optionsJSON: options });
  const secret = takePrf(response);
  const { wrappedKey, credentialId } = await api.post<{ wrappedKey: string; credentialId: string }>(
    '/api/auth/signin/verify',
    { response },
  );
  if (isPassphraseWrapped(wrappedKey)) {
    const pass = await askPassphrase('Enter the passphrase protecting your notes key.', false, username);
    if (!pass) throw new Error('Passphrase required');
    return { key: await unwrapWithPassphrase(pass, wrappedKey), credentialId };
  }
  if (!secret) throw new Error('This authenticator does not support the WebAuthn PRF extension');
  return { key: await unwrapMasterKey(secret, wrappedKey), credentialId };
}

export interface Session { key: CryptoKey; credentialId: string }

export async function addAuthenticator(masterKey: CryptoKey, name: string): Promise<void> {
  const options = await api.post<any>('/api/auth/add-credential/start');
  options.extensions = { ...options.extensions, ...prfInput };
  const response = await startRegistration({ optionsJSON: options });
  const prf = response.clientExtensionResults?.prf as any;
  let secret: ArrayBuffer | undefined = prf?.results?.first;
  if (prf) delete prf.results;
  secret ??= await getPrfOutput(response.id).catch(() => undefined);
  const wrappedKey = secret
    ? await wrapMasterKey(secret, masterKey)
    : (await newPassphraseWrap('', masterKey)).wrapped;
  const nameEncrypted = name.trim() ? await encryptNote(masterKey, name.trim()) : null;
  await api.post('/api/auth/add-credential/finish', { response, wrappedKey, nameEncrypted });
}
