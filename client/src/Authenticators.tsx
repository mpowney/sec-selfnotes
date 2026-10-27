import { useCallback, useEffect, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input,
  MessageBar, MessageBarBody, Spinner, Text,
} from '@fluentui/react-components';
import { api, type CredentialInfo } from './api';
import { decryptNote } from './crypto';
import { addAuthenticator } from './webauthn';

const transportLabel = (t: string[]) =>
  t.includes('internal') ? 'Platform authenticator' : t.includes('hybrid') ? 'Phone / passkey' : 'Security key';

export default function Authenticators({ masterKey, credentialId, open, onClose }: {
  masterKey: CryptoKey; credentialId: string; open: boolean; onClose: () => void;
}) {
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [revoke, setRevoke] = useState<CredentialInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    const { credentials } = await api.listCredentials();
    setCreds(credentials);
    const out: Record<string, string> = {};
    await Promise.all(credentials.map(async (c) => {
      if (!c.nameEncrypted) return;
      try { out[c.credentialId] = await decryptNote(masterKey, c.nameEncrypted); } catch { /* unreadable name */ }
    }));
    setNames(out);
  }, [masterKey]);

  useEffect(() => {
    if (open) load().catch((e) => setError(e.message));
  }, [open, load]);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setInfo('');
    setBusy(true);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); }
  };

  const label = (c: CredentialInfo) => names[c.credentialId] ?? transportLabel(c.transports);

  return (
    <>
      <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Authenticators</DialogTitle>
            <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {creds.map((c) => (
                <div key={c.credentialId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1 }}>
                    <Text block>{label(c)}</Text>
                    <Text size={100}>Registered {new Date(c.createdAt).toLocaleDateString()}</Text>
                  </span>
                  {c.credentialId === credentialId ? (
                    <Text size={200}>Current session</Text>
                  ) : (
                    <Button size="small" disabled={busy} onClick={() => setRevoke(c)}>Revoke</Button>
                  )}
                </div>
              ))}
              <Field label="Name for new authenticator (optional)" hint="The name is encrypted and only visible to you.">
                <Input value={newName} maxLength={64} placeholder="e.g. Work security key" onChange={(_, d) => setNewName(d.value)} disabled={busy} />
              </Field>
              <Button disabled={busy} onClick={() => run(async () => {
                await addAuthenticator(masterKey, newName);
                setNewName('');
                setInfo('Authenticator added.');
              })}>
                {busy ? <Spinner size="tiny" /> : 'Register another authenticator'}
              </Button>
              {info && <MessageBar intent="success"><MessageBarBody>{info}</MessageBarBody></MessageBar>}
              {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={!!revoke} onOpenChange={(_, d) => !d.open && setRevoke(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Revoke authenticator?</DialogTitle>
            <DialogContent>
              Remove <strong>{revoke && label(revoke)}</strong> from your account? You will no longer be able to sign in with it.
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRevoke(null)}>Cancel</Button>
              <Button appearance="primary" disabled={busy} onClick={() => run(async () => {
                await api.revokeCredential(revoke!.credentialId);
                setRevoke(null);
              })}>Revoke</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
