import { useEffect, useState } from 'react';
import {
  Button, Card, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input,
  MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow,
  Text, Title2, Title3,
} from '@fluentui/react-components';
import { adminApi, type AdminCredential, type AdminUser } from './api';

const fmt = (t: number | null) => (t ? new Date(t).toLocaleString() : 'Never');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

function AdminLogin({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onLogin((await adminApi.login(username.trim(), password)).username);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Card style={{ width: 380 }}>
        <Title2>Sec SelfNotes</Title2>
        <Text weight="semibold" style={{ color: 'var(--colorPaletteRedForeground2)' }}>Admin Portal</Text>
        <Text>Sign in with your admin credentials. On first start the admin password is printed once in the server log.</Text>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Username" required>
            <Input value={username} onChange={(_, d) => setUsername(d.value)} autoComplete="username" autoCapitalize="none" disabled={busy} />
          </Field>
          <Field label="Password" required>
            <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} autoComplete="current-password" disabled={busy} />
          </Field>
          {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          <Button appearance="primary" type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function AdminDashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  const [credUser, setCredUser] = useState<AdminUser | null>(null);
  const [creds, setCreds] = useState<AdminCredential[]>([]);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const load = () => adminApi.listUsers().then(setUsers).catch((e) => setError(errMsg(e)));
  useEffect(() => { void load(); }, []);

  const openCreds = async (u: AdminUser) => {
    setError('');
    setPendingRevoke(null);
    try {
      setCreds(await adminApi.listCredentials(u.id));
      setCredUser(u);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title2>Admin Dashboard</Title2>
        <span>
          <Text>{username} </Text>
          <Button onClick={async () => { await adminApi.logout().catch(() => undefined); onLogout(); }}>Sign out</Button>
        </span>
      </div>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {!users ? <Spinner label="Loading users..." /> : users.length === 0 ? (
        <Text>No users registered yet. The first user can register from the main page.</Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {['Username', 'Created', 'Last login', 'Authenticators', 'Notes', 'Actions'].map((h) => (
                <TableHeaderCell key={h}>{h}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.username}</TableCell>
                <TableCell>{fmt(u.createdAt)}</TableCell>
                <TableCell>{fmt(u.lastLoginAt)}</TableCell>
                <TableCell>{u.credentialCount}</TableCell>
                <TableCell>{u.noteCount}</TableCell>
                <TableCell style={{ whiteSpace: 'nowrap', minWidth: 200 }}>
                  <Button size="small" onClick={() => openCreds(u)}>Authenticators</Button>{' '}
                  <Button size="small" onClick={() => setToDelete(u)}>Delete</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!toDelete} onOpenChange={(_, d) => !d.open && setToDelete(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete user</DialogTitle>
            <DialogContent>
              Delete <b>{toDelete?.username}</b> and all of their notes? This cannot be undone.
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setToDelete(null)}>Cancel</Button>
              <Button appearance="primary" onClick={() => act(async () => {
                await adminApi.deleteUser(toDelete!.id);
                setToDelete(null);
                await load();
              })}>Delete</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={!!credUser} onOpenChange={(_, d) => !d.open && setCredUser(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Authenticators — {credUser?.username}</DialogTitle>
            <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {creds.map((c, i) => (
                <div key={c.credentialId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span>
                    <Title3>Authenticator {i + 1}</Title3><br />
                    <Text size={200}>Added {fmt(c.createdAt)}{c.transports.length ? ` · ${c.transports.join(', ')}` : ''}</Text>
                  </span>
                  {pendingRevoke === c.credentialId ? (
                    <span>
                      <Button size="small" appearance="primary" onClick={() => act(async () => {
                        await adminApi.revokeCredential(credUser!.id, c.credentialId);
                        setPendingRevoke(null);
                        setCreds(await adminApi.listCredentials(credUser!.id));
                        await load();
                      })}>Confirm</Button>{' '}
                      <Button size="small" onClick={() => setPendingRevoke(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <Button size="small" disabled={creds.length <= 1} onClick={() => setPendingRevoke(c.credentialId)}>Revoke</Button>
                  )}
                </div>
              ))}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCredUser(null)}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState<string | null>(null);

  useEffect(() => {
    adminApi.status()
      .then((s) => setAdmin(s.authenticated ? (s.username ?? '') : null))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading..." />;
  if (admin === null) return <AdminLogin onLogin={setAdmin} />;
  return <AdminDashboard username={admin} onLogout={() => setAdmin(null)} />;
}
