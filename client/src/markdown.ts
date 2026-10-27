export const DEFAULT_CATEGORY = 'uncategorized';

export interface NoteMeta {
  title: string;
  category: string;
  created: string;
  modified: string;
  tags: string[];
}

/** Metadata lives in YAML-style front matter inside the (encrypted) markdown file. */
export function serializeNote(meta: NoteMeta, body: string): string {
  return [
    '---',
    `title: ${JSON.stringify(meta.title)}`,
    `category: ${JSON.stringify(meta.category)}`,
    `created: ${meta.created}`,
    `modified: ${meta.modified}`,
    `tags: ${JSON.stringify(meta.tags)}`,
    '---',
    '',
    body,
  ].join('\n');
}

export function parseNote(md: string): { meta: NoteMeta; body: string } {
  const now = new Date().toISOString();
  const meta: NoteMeta = { title: 'Untitled', category: DEFAULT_CATEGORY, created: now, modified: now, tags: [] };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?\r?\n?/.exec(md);
  if (!m) return { meta, body: md };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      if (key === 'title' || key === 'category') meta[key] = JSON.parse(raw);
      else if (key === 'tags') meta.tags = JSON.parse(raw);
      else if (key === 'created' || key === 'modified') meta[key] = raw;
    } catch {
      /* ignore malformed line */
    }
  }
  return { meta, body: md.slice(m[0].length) };
}

export function deriveTitle(body: string): string {
  const line = body.split('\n').find((l) => l.trim());
  return (line ?? '').replace(/^#+\s*/, '').trim().slice(0, 100) || 'Untitled';
}
