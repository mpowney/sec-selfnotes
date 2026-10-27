// Thin client for the core API (same origin; the session cookie is shared with the main app).
async function req(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  post: (url, body) => req('POST', url, body ?? {}),
  authStatus: () => req('GET', '/api/auth/status'),
  listNotes: (offset, limit = 200, modifiedSince = 0) =>
    req('GET', `/api/notes?limit=${limit}&offset=${offset}&modifiedSince=${modifiedSince}`),
  getNote: (id) => req('GET', `/api/notes/${id}`),
  metadata: (id) => req('GET', `/api/notes/${id}/metadata`),
  createNote: (title, category, content, createdAt, modifiedAt) =>
    req('POST', '/api/notes', { title, category, content, createdAt, modifiedAt }),
  updateNote: (id, title, category, content) => req('PUT', `/api/notes/${id}`, { title, category, content }),
  startUpload: (noteId) => req('POST', `/api/notes/${noteId}/files`, {}),
  uploadChunk: async (noteId, fileId, index, data) => {
    const res = await fetch(`/api/notes/${noteId}/files/${fileId}/chunks/${index}`, {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
  },
  fileInfo: (noteId, fileId) => req('GET', `/api/notes/${noteId}/files/${fileId}`),
  downloadChunk: async (noteId, fileId, index) => {
    const res = await fetch(`/api/notes/${noteId}/files/${fileId}/chunks/${index}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
  getState: async (key) => {
    try { return (await req('GET', `/api/sync-state/${key}`)).content; } catch (e) { if (e.status === 404) return null; throw e; }
  },
  putState: (key, content) => req('PUT', `/api/sync-state/${key}`, { content }),
};
