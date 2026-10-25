import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api';
import { PRF_SALT, createWrappedMasterKey, unwrapMasterKey } from './crypto';

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

export async function register(username: string): Promise<CryptoKey> {
  const options = await api.post<any>('/api/auth/register', { username });
  options.extensions = { ...options.extensions, ...prfInput };
  const response = await startRegistration({ optionsJSON: options });
  const prf = response.clientExtensionResults?.prf as any;
  let secret: ArrayBuffer | undefined = prf?.results?.first;
  if (prf) delete prf.results;
  secret ??= await getPrfOutput(response.id);
  const { masterKey, wrapped } = await createWrappedMasterKey(secret);
  await api.post('/api/auth/register/verify', { response, wrappedKey: wrapped });
  return masterKey;
}

export async function signIn(username: string): Promise<CryptoKey> {
  const options = await api.post<any>('/api/auth/signin/challenge', { username });
  options.extensions = { ...options.extensions, ...prfInput };
  const response = await startAuthentication({ optionsJSON: options });
  const secret = takePrf(response);
  if (!secret) throw new Error('This authenticator does not support the WebAuthn PRF extension');
  const { wrappedKey } = await api.post<{ wrappedKey: string }>('/api/auth/signin/verify', { response });
  return unwrapMasterKey(secret, wrappedKey);
}
