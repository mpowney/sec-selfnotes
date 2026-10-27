// Mirrors client/src/markdown.ts (front-matter format used inside the encrypted note).
export const DEFAULT_CATEGORY = 'uncategorized';

export function serializeNote(meta, body) {
  return ['---', `title: ${JSON.stringify(meta.title)}`, `category: ${JSON.stringify(meta.category)}`,
    `created: ${meta.created}`, `modified: ${meta.modified}`, `tags: ${JSON.stringify(meta.tags ?? [])}`, '---', '', body].join('\n');
}

export function parseNote(md) {
  const now = new Date().toISOString();
  const meta = { title: 'Untitled', category: DEFAULT_CATEGORY, created: now, modified: now, tags: [] };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?\r?\n?/.exec(md);
  if (!m) return { meta, body: md };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), raw = line.slice(i + 1).trim();
    try {
      if (k === 'title' || k === 'category') meta[k] = JSON.parse(raw);
      else if (k === 'tags') meta.tags = JSON.parse(raw);
      else if (k === 'created' || k === 'modified') meta[k] = raw;
    } catch { /* ignore */ }
  }
  return { meta, body: md.slice(m[0].length) };
}

export const cleanCategory = (s) => (s || DEFAULT_CATEGORY).replace(/[\\/]+/g, ' ').trim().slice(0, 64) || DEFAULT_CATEGORY;
export const cleanTitle = (s) => (s || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
