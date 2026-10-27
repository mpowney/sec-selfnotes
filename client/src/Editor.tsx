import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MDEditor, { commands, type ICommand } from '@uiw/react-md-editor';
import { api } from './api';
import { decryptRaw, encryptRaw } from './crypto';

const SCHEME = 'sec-file:';
const CHUNK = 16 * 1024 * 1024;
const MAX_BYTES = 20 * 1024 * 1024 * 1024;
const aadFor = (fileId: string, index: number, total: number) => `${fileId}:${index}:${total}`;

/** Streams the encrypted chunks of an uploaded file, yielding decrypted plaintext in order. */
async function* readFile(noteId: string, masterKey: CryptoKey, fileId: string) {
  const { chunks } = await api.fileInfo(noteId, fileId);
  if (!chunks) throw new Error('Empty file');
  for (let i = 0; i < chunks; i++) {
    yield await decryptRaw(masterKey, await api.downloadChunk(noteId, fileId, i), aadFor(fileId, i, chunks));
  }
}
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
};
const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const imageType = (name: string) => IMAGE_TYPES[ext(name)];
const parseRef = (url: string) => {
  const m = /^sec-file:([0-9a-f-]{36})(?:#w=(\d+))?$/.exec(url);
  return m ? { id: m[1], width: m[2] ? Number(m[2]) : undefined } : null;
};

/** Fetches and decrypts an uploaded file, caching the decrypted bytes per file id. */
function useDecrypted(noteId: string, masterKey: CryptoKey, fileId: string, type: string) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | undefined;
    (async () => {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for await (const part of readFile(noteId, masterKey, fileId)) parts.push(part);
      return parts;
    })()
      .then((parts) => {
        objectUrl = URL.createObjectURL(new Blob(parts, { type }));
        if (revoked) URL.revokeObjectURL(objectUrl);
        else setUrl(objectUrl);
      })
      .catch(() => !revoked && setFailed(true));
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [noteId, masterKey, fileId, type]);
  return { url, failed };
}

/** Maps a viewport point to a character offset in the textarea by hit-testing an invisible mirror of it. */
function offsetAtPoint(ta: HTMLTextAreaElement | null, x: number, y: number): number | null {
  if (!ta) return null;
  const r = ta.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return ta.selectionStart;
  const mirror = document.createElement('div');
  const cs = getComputedStyle(ta);
  for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize', 'textIndent'] as const) {
    mirror.style[p] = cs[p];
  }
  Object.assign(mirror.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    overflow: 'hidden', opacity: '0', zIndex: '2147483647', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  });
  mirror.textContent = ta.value + '\u200b';
  document.body.appendChild(mirror);
  mirror.scrollTop = ta.scrollTop;
  try {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const pos = d.caretPositionFromPoint?.(x, y);
    const range = pos ? null : d.caretRangeFromPoint?.(x, y);
    const node = pos?.offsetNode ?? range?.startContainer;
    const offset = pos?.offset ?? range?.startOffset;
    if (node && offset !== undefined && mirror.contains(node)) return Math.min(offset, ta.value.length);
  } finally {
    mirror.remove();
  }
  return ta.selectionStart;
}

const box: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid #c8c6c4',
  borderRadius: 6, background: '#f5f5f5', color: 'inherit', textDecoration: 'none', cursor: 'pointer',
};

function FileBox({ noteId, masterKey, fileId, name }: { noteId: string; masterKey: CryptoKey; fileId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const download = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const picker = (window as unknown as {
        showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;
      }).showSaveFilePicker;
      if (picker) {
        // Stream straight to disk so very large files never sit fully in memory.
        const writer = (await (await picker({ suggestedName: name })).createWritable()).getWriter();
        for await (const part of readFile(noteId, masterKey, fileId)) await writer.write(part);
        await writer.close();
      } else {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        for await (const part of readFile(noteId, masterKey, fileId)) parts.push(part);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <a href="#" role="button" onClick={download} style={box} title="Download">
      <span aria-hidden>{busy ? '⏳' : '📄'}</span>
      <span>{name}</span>
    </a>
  );
}

function EncryptedImage({ noteId, masterKey, fileId, name, width, onResize }: {
  noteId: string; masterKey: CryptoKey; fileId: string; name: string; width?: number; onResize: (id: string, w?: number) => void;
}) {
  const { url, failed } = useDecrypted(noteId, masterKey, fileId, imageType(name) ?? 'image/png');
  if (failed) return <span style={box}>🖼️ {name} (unavailable)</span>;
  if (!url) return <span style={box}>🖼️ Loading {name}…</span>;
  return (
    <span style={{ display: 'inline-block', maxWidth: '100%' }}>
      <img src={url} alt={name} style={{ width: width ? `${width}px` : undefined, maxWidth: '100%', display: 'block' }} />
      <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        Size
        <input
          type="range" min={50} max={1600} step={10} value={width ?? 400}
          onChange={(e) => onResize(fileId, Number(e.target.value))}
        />
        <button type="button" onClick={() => onResize(fileId, undefined)}>Reset</button>
      </label>
    </span>
  );
}

export default function Editor({ value, onChange, noteId, masterKey }: {
  value: string; onChange: (v: string) => void; noteId: string; masterKey: CryptoKey;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const caret = useRef<number | null>(null);
  const [msg, setMsg] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = useCallback(async (files: File[], at: number | null) => {
    let md = '';
    for (const f of files) {
      if (f.size > MAX_BYTES) { setMsg(`${f.name} is larger than 20 GB`); continue; }
      try {
        const { fileId } = await api.startUpload(noteId);
        const total = Math.max(1, Math.ceil(f.size / CHUNK));
        for (let i = 0; i < total; i++) {
          setMsg(`Uploading ${f.name}… ${Math.round((i / total) * 100)}%`);
          const plain = new Uint8Array(await f.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer());
          await api.uploadChunk(noteId, fileId, i, await encryptRaw(masterKey, plain, aadFor(fileId, i, total)));
        }
        const name = f.name.replace(/[[\]()<>]/g, '_');
        md += `${imageType(f.name) ? '!' : ''}[${name}](${SCHEME}${fileId})\n\n`;
        setMsg('');
      } catch (e) {
        setMsg(`Upload failed: ${(e as Error).message}`);
      }
    }
    if (!md) return;
    const v = valueRef.current;
    const pos = Math.min(at ?? v.length, v.length);
    onChange(v.slice(0, pos) + md + v.slice(pos));
  }, [masterKey, noteId, onChange]);

  const textarea = () => wrap.current?.querySelector('textarea') ?? null;

  const attach: ICommand = useMemo(() => ({
    name: 'attach',
    keyCommand: 'attach',
    buttonProps: { 'aria-label': 'Attach file at cursor', title: 'Attach file at cursor' },
    icon: <span style={{ fontSize: 12, padding: '0 4px' }}>📎 Attach</span>,
    execute: (state) => {
      caret.current = state.selection.end;
      picker.current?.click();
    },
  }), []);

  const resize = useCallback((id: string, w?: number) => {
    const re = new RegExp(`${SCHEME}${id}(#w=\\d+)?`, 'g');
    onChange(valueRef.current.replace(re, `${SCHEME}${id}${w ? `#w=${w}` : ''}`));
  }, [onChange]);

  const components = useMemo(() => ({
    img: (p: React.ImgHTMLAttributes<HTMLImageElement>) => {
      const ref = typeof p.src === 'string' ? parseRef(p.src) : null;
      return ref
        ? <EncryptedImage noteId={noteId} masterKey={masterKey} fileId={ref.id} name={p.alt ?? 'image'} width={ref.width} onResize={resize} />
        : <img {...p} />;
    },
    a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const ref = typeof p.href === 'string' ? parseRef(p.href) : null;
      if (!ref) return <a {...p} target="_blank" rel="noopener noreferrer" />;
      const name = typeof p.children === 'string' ? p.children : 'file';
      return imageType(name)
        ? <EncryptedImage noteId={noteId} masterKey={masterKey} fileId={ref.id} name={name} width={ref.width} onResize={resize} />
        : <FileBox noteId={noteId} masterKey={masterKey} fileId={ref.id} name={name} />;
    },
  }), [noteId, masterKey, resize]);

  return (
    <div
      ref={wrap}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', outline: dragging ? '2px dashed #0f6cbd' : undefined }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        upload(files, offsetAtPoint(textarea(), e.clientX, e.clientY));
      }}
    >
      <input
        ref={picker} type="file" multiple hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) upload(files, caret.current);
        }}
      />
      {msg && <div role="status" style={{ fontSize: 12, padding: 4 }}>{msg}</div>}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MDEditor
          value={value}
          onChange={(v) => onChange(v ?? '')}
          preview="live"
          height="100%"
          style={{ height: '100%' }}
          commands={[...commands.getCommands(), commands.divider, attach]}
          previewOptions={{ components }}
        />
      </div>
    </div>
  );
}
