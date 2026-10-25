import { useState } from 'react';
import { api } from './api';
import AuthPage from './AuthPage';
import NotesApp from './NotesApp';

export default function App() {
  const [session, setSession] = useState<{ username: string; key: CryptoKey } | null>(null);

  if (!session) return <AuthPage onAuthenticated={(username, key) => setSession({ username, key })} />;
  return (
    <NotesApp
      username={session.username}
      masterKey={session.key}
      onSignOut={async () => {
        await api.logout().catch(() => undefined);
        setSession(null);
      }}
    />
  );
}
