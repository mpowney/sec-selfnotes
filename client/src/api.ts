export interface NoteSummary {
  noteId: string;
  title: string;
  category: string;
  createdAt: number;
  modifiedAt: number;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface AdminUser {
  id: string;
  username: string;
  createdAt: number;
  lastLoginAt: number | null;
  credentialCount: number;
  noteCount: number;
}

export interface AdminCredential {
  credentialId: string;
  transports: string[];
  createdAt: number;
}

export interface CredentialInfo {
  credentialId: string;
  transports: string[];
  createdAt: number;
  nameEncrypted: string | null;
}

export const adminApi = {
  status: () => req<{ authenticated: boolean; username?: string }>('GET', '/api/admin/status'),
  login: (username: string, password: string) =>
    req<{ success: boolean; username: string }>('POST', '/api/admin/login', { username, password }),
  logout: () => req<{ success: boolean }>('POST', '/api/admin/logout', {}),
  listUsers: () => req<AdminUser[]>('GET', '/api/admin/users'),
  deleteUser: (id: string) => req<{ success: boolean }>('DELETE', `/api/admin/users/${id}`),
  listCredentials: (id: string) => req<AdminCredential[]>('GET', `/api/admin/users/${id}/credentials`),
  revokeCredential: (id: string, credentialId: string) =>
    req<{ success: boolean }>('DELETE', `/api/admin/users/${id}/credentials/${encodeURIComponent(credentialId)}`),
};

export const api = {
  post: <T>(url: string, body?: unknown) => req<T>('POST', url, body ?? {}),
  listNotes: (offset: number, limit = 50) =>
    req<{ notes: NoteSummary[] }>('GET', `/api/notes?limit=${limit}&offset=${offset}`),
  getNote: (id: string) => req<NoteSummary & { content: string }>('GET', `/api/notes/${id}`),
  createNote: (title: string, category: string, content: string) =>
    req<NoteSummary>('POST', '/api/notes', { title, category, content }),
  updateNote: (id: string, title: string, category: string, content: string) =>
    req<NoteSummary>('PUT', `/api/notes/${id}`, { title, category, content }),
  deleteNote: (id: string) => req<{ ok: boolean }>('DELETE', `/api/notes/${id}`),
  logout: () => req<{ ok: boolean }>('POST', '/api/auth/logout', {}),
  authStatus: () => req<{ authenticated: boolean; username?: string; credentialId?: string }>('GET', '/api/auth/status'),
  listCredentials: () => req<{ credentials: CredentialInfo[] }>('GET', '/api/auth/credentials'),
  revokeCredential: (id: string) => req<{ success: boolean }>('DELETE', `/api/auth/credentials/${encodeURIComponent(id)}`),
  nameCredential: (id: string, nameEncrypted: string | null) =>
    req<{ success: boolean }>('PATCH', `/api/auth/credentials/${encodeURIComponent(id)}/name`, { nameEncrypted }),
};
