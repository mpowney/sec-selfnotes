import { useState } from 'react';
import {
  Button, Card, Field, Input, MessageBar, MessageBarBody, Tab, TabList, Title2, Text,
} from '@fluentui/react-components';
import { register, signIn, type Session } from './webauthn';

export default function AuthPage({ onAuthenticated }: { onAuthenticated: (username: string, session: Session) => void }) {
  const [tab, setTab] = useState<'signin' | 'register'>('signin');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const name = username.trim();
      const result = tab === 'register' ? await register(name) : await signIn(name);
      onAuthenticated(name, result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Card style={{ width: 380 }}>
        <Title2>Sec SelfNotes</Title2>
        <Text>End-to-end encrypted notes, secured with your YubiKey.</Text>
        <TabList selectedValue={tab} onTabSelect={(_, d) => { setTab(d.value as typeof tab); setError(''); }}>
          <Tab value="signin">Sign in</Tab>
          <Tab value="register">Register</Tab>
        </TabList>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Username" required>
            <Input value={username} onChange={(_, d) => setUsername(d.value)} autoComplete="username webauthn" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
          {error && (
            <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>
          )}
          <Button appearance="primary" type="submit" disabled={busy || !username.trim()}>
            {tab === 'register' ? 'Register with YubiKey' : 'Sign in with YubiKey'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
