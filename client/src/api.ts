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
};
