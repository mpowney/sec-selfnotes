import { useEffect, useState } from 'react';
import { Button, Card, MessageBar, MessageBarBody, Spinner, Text, Title2 } from '@fluentui/react-components';
import { api } from './api';
import AuthPage from './AuthPage';
import NotesApp from './NotesApp';
import AdminPage from './AdminPage';
import { signIn, type Session } from './webauthn';

interface State { username: string; credentialId: string; key: CryptoKey | null }

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = window.location.pathname.startsWith('/admin');

  // Restore the server session after a page reload; the master key is memory-only and must be unlocked again.
  useEffect(() => {
    if (isAdmin) return;
    api.authStatus()
      .then((s) => s.authenticated && setState({ username: s.username ?? '', credentialId: s.credentialId ?? '', key: null }))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (isAdmin) return <AdminPage />;
  if (loading) return <Spinner style={{ height: '100%' }} label="Loading..." />;

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    setState(null);
    setError('');
  };

  if (!state) {
    return (
      <AuthPage
        onAuthenticated={(username, s: Session) => setState({ username, credentialId: s.credentialId, key: s.key })}
      />
    );
  }

  if (!state.key) {
    const unlock = async () => {
      setError('');
      setBusy(true);
      try {
        const s = await signIn(state.username);
        setState({ username: state.username, credentialId: s.credentialId, key: s.key });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unlock failed');
      } finally {
        setBusy(false);
      }
    };
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ width: 380 }}>
          <Title2>Sec SelfNotes</Title2>
          <Text>
            Signed in as <strong>{state.username}</strong>. Touch your authenticator to unlock your encrypted notes.
          </Text>
          {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          <Button appearance="primary" disabled={busy} onClick={unlock}>Unlock with authenticator</Button>
          <Button appearance="subtle" disabled={busy} onClick={signOut}>Sign out</Button>
        </Card>
      </div>
    );
  }

  return <NotesApp username={state.username} credentialId={state.credentialId} masterKey={state.key} onSignOut={signOut} />;
}
