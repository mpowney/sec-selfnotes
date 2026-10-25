import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger,
  Field, Input, Select, Spinner, Subtitle1, Text, Title3, tokens,
} from '@fluentui/react-components';
import { api, type NoteSummary } from './api';
import { decryptNote, encryptNote } from './crypto';
import { DEFAULT_CATEGORY, deriveTitle, parseNote, serializeNote, type NoteMeta } from './markdown';

const Editor = lazy(() => import('./Editor'));
const PAGE = 50;

interface Open { id: string; meta: NoteMeta; body: string }

export default function NotesApp({ username, masterKey, onSignOut }: {
  username: string; masterKey: CryptoKey; onSignOut: () => void;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const [status, setStatus] = useState('');
  const [newCat, setNewCat] = useState<string | null>(null);
  const [extraCats, setExtraCats] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async (offset: number) => {
    const { notes: page } = await api.listNotes(offset, PAGE);
    setNotes((prev) => (offset === 0 ? page : [...prev, ...page]));
    setHasMore(page.length === PAGE);
  }, []);

  useEffect(() => { load(0).catch((e) => setStatus(e.message)); }, [load]);

  const categories = useMemo(
    () => [...new Set([DEFAULT_CATEGORY, ...extraCats, ...notes.map((n) => n.category)])].sort(),
    [notes, extraCats],
  );

  const select = async (id: string) => {
    window.clearTimeout(timer.current);
    try {
      const n = await api.getNote(id);
      const { meta, body } = parseNote(await decryptNote(masterKey, n.content));
      setOpen({ id, meta: { ...meta, category: n.category }, body });
      setStatus('');
    } catch {
      setStatus('Unable to decrypt this note');
    }
  };

  const save = useCallback(async (o: Open) => {
    const meta = { ...o.meta, title: deriveTitle(o.body), modified: new Date().toISOString() };
    const content = await encryptNote(masterKey, serializeNote(meta, o.body));
    const saved = await api.updateNote(o.id, meta.title, meta.category, content);
    setNotes((prev) => [saved, ...prev.filter((n) => n.noteId !== o.id)]);
    setStatus('Saved');
  }, [masterKey]);

  const change = (next: Open) => {
    setOpen(next);
    setStatus('Saving…');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(next).catch((e) => setStatus(e.message)), 1000);
  };

  const create = async () => {
    const now = new Date().toISOString();
    const meta: NoteMeta = { title: 'Untitled', category: DEFAULT_CATEGORY, created: now, modified: now, tags: [] };
    const created = await api.createNote(meta.title, meta.category, await encryptNote(masterKey, serializeNote(meta, '')));
    setNotes((prev) => [created, ...prev]);
    setOpen({ id: created.noteId, meta, body: '' });
  };

  const remove = async () => {
    if (!open) return;
    await api.deleteNote(open.id);
    setNotes((prev) => prev.filter((n) => n.noteId !== open.id));
    setOpen(null);
    setConfirmDelete(false);
  };

  const moveTo = (category: string) => open && change({ ...open, meta: { ...open.meta, category } });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
        <Title3 style={{ flex: 1 }}>Sec SelfNotes</Title3>
        <Text>{username}</Text>
        <Button onClick={onSignOut}>Sign out</Button>
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside style={{ width: 280, overflowY: 'auto', borderRight: `1px solid ${tokens.colorNeutralStroke2}`, padding: 8 }}>
          <Button appearance="primary" style={{ width: '100%', marginBottom: 8 }} onClick={() => create().catch((e) => setStatus(e.message))}>
            New note
          </Button>
          {categories.map((cat) => {
            const inCat = notes.filter((n) => n.category === cat);
            if (!inCat.length && cat !== open?.meta.category) return null;
            return (
              <div key={cat}>
                <Text weight="semibold" size={200} style={{ display: 'block', padding: '8px 4px 2px', textTransform: 'uppercase' }}>{cat}</Text>
                {inCat.map((n) => (
                  <button
                    key={n.noteId}
                    onClick={() => select(n.noteId)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 0, borderRadius: 4, padding: '6px 8px',
                      background: open?.id === n.noteId ? tokens.colorNeutralBackground1Selected : 'transparent',
                    }}
                  >
                    <Text block truncate wrap={false}>{n.title}</Text>
                    <Text size={100} block>{new Date(n.modifiedAt).toLocaleString()}</Text>
                  </button>
                ))}
              </div>
            );
          })}
          {hasMore && <Button appearance="subtle" onClick={() => load(notes.length)}>Load more</Button>}
        </aside>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: 12, gap: 8 }}>
          {open ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <Field label="Category" style={{ minWidth: 200 }}>
                  <Select value={open.meta.category} onChange={(_, d) => moveTo(d.value)}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <Button onClick={() => setNewCat('')}>New category</Button>
                <span style={{ flex: 1 }} />
                <Text>{status}</Text>
                <Button onClick={() => setConfirmDelete(true)}>Delete</Button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }} data-color-mode="light">
                <Suspense fallback={<Spinner />}>
                  <Editor value={open.body} onChange={(body) => change({ ...open, body })} />
                </Suspense>
              </div>
            </>
          ) : (
            <Subtitle1 style={{ margin: 'auto' }}>{status || 'Select a note or create a new one'}</Subtitle1>
          )}
        </main>
      </div>

      <Dialog open={newCat !== null} onOpenChange={(_, d) => !d.open && setNewCat(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>New category</DialogTitle>
            <DialogContent>
              <Field label="Category name">
                <Input value={newCat ?? ''} maxLength={64} onChange={(_, d) => setNewCat(d.value)} />
              </Field>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement><Button>Cancel</Button></DialogTrigger>
              <Button appearance="primary" disabled={!newCat?.trim()} onClick={() => {
                const name = newCat!.trim();
                setExtraCats((c) => [...c, name]);
                moveTo(name);
                setNewCat(null);
              }}>Create</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(_, d) => setConfirmDelete(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete note?</DialogTitle>
            <DialogContent>This permanently deletes the note and cannot be undone.</DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement><Button>Cancel</Button></DialogTrigger>
              <Button appearance="primary" onClick={() => remove().catch((e) => setStatus(e.message))}>Delete</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
