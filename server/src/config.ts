import path from 'node:path';

const isProd = process.env.NODE_ENV === 'production';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} environment variable is required`);
  return v;
}

export function loadConfig() {
  const keyHex = required('SYSTEM_ENCRYPTION_KEY');
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('SYSTEM_ENCRYPTION_KEY must be a 32-byte hex-encoded key (64 hex chars)');
  }
  const port = Number(process.env.PORT ?? 4000);
  const rpID = process.env.WEBAUTHN_ID ?? 'localhost';
  return {
    isProd,
    port,
    systemKey: Buffer.from(keyHex, 'hex'),
    sessionSecret: required('SESSION_SECRET'),
    rpID,
    rpOrigin: process.env.WEBAUTHN_ORIGIN ?? `http://${rpID}:${port}`,
    rpName: process.env.WEBAUTHN_NAME ?? 'Sec SelfNotes',
    dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
    clientDir: path.resolve(process.env.CLIENT_DIR ?? '../client/dist'),
  };
}

export type Config = ReturnType<typeof loadConfig>;
