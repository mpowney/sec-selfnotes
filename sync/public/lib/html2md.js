/**
 * Small HTML -> Markdown converter for OneNote pages and Apple Notes exports.
 * `resolve({ kind: 'img'|'file', url, name })` is async and returns a markdown link/image string
 * (e.g. after uploading the resource as an encrypted attachment), or null to drop it.
 */
export async function htmlToMarkdown(html, resolve) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() ?? '';
  const md = (await block(doc.body, resolve, 0)).replace(/\n{3,}/g, '\n\n').trim();
  return { title, markdown: md };
}

const esc = (t) => t.replace(/([\\`*_[\]])/g, '\\$1');

async function kids(node, resolve, depth) {
  let out = '';
  for (const c of node.childNodes) out += await conv(c, resolve, depth);
  return out;
}
async function block(node, resolve, depth) { return kids(node, resolve, depth); }

async function conv(n, resolve, depth) {
  if (n.nodeType === 3) return esc(n.textContent.replace(/\s+/g, ' '));
  if (n.nodeType !== 1) return '';
  const tag = n.tagName.toLowerCase();
  switch (tag) {
    case 'script': case 'style': case 'head': case 'title': return '';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return `\n\n${'#'.repeat(Number(tag[1]))} ${(await kids(n, resolve, depth)).trim()}\n\n`;
    case 'br': return '  \n';
    case 'hr': return '\n\n---\n\n';
    case 'b': case 'strong': { const t = (await kids(n, resolve, depth)).trim(); return t ? `**${t}**` : ''; }
    case 'i': case 'em': { const t = (await kids(n, resolve, depth)).trim(); return t ? `*${t}*` : ''; }
    case 'code': return '`' + n.textContent + '`';
    case 'pre': return '\n\n```\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n';
    case 'blockquote': return '\n\n' + (await kids(n, resolve, depth)).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
    case 'a': {
      const t = (await kids(n, resolve, depth)).trim();
      const href = n.getAttribute('href');
      return href && t ? `[${t}](${href.replace(/[()\\\s]/g, (c) => encodeURIComponent(c))})` : t;
    }
    case 'img': {
      const url = n.getAttribute('data-fullres-src') || n.getAttribute('src') || '';
      const r = url && (await resolve({ kind: 'img', url, name: n.getAttribute('alt') || 'image' }));
      return r ? `\n\n${r}\n\n` : '';
    }
    case 'object': {
      const url = n.getAttribute('data');
      const name = n.getAttribute('data-attachment') || 'attachment';
      const r = url && (await resolve({ kind: 'file', url, name, type: n.getAttribute('type') }));
      return r ? `\n\n${r}\n\n` : '';
    }
    case 'ul': case 'ol': {
      let i = 0, out = '\n';
      for (const li of n.children) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        const bullet = tag === 'ol' ? `${++i}.` : '-';
        const text = (await kids(li, resolve, depth + 1)).trim().replace(/\n/g, '\n' + '  '.repeat(depth + 1));
        out += `${'  '.repeat(depth)}${bullet} ${text}\n`;
      }
      return out + '\n';
    }
    case 'li': return (await kids(n, resolve, depth)).trim() + '\n';
    case 'table': return await table(n, resolve);
    case 'p': {
      const t = (await kids(n, resolve, depth)).trim();
      const todo = n.getAttribute('data-tag') ?? '';
      if (!t) return '\n\n';
      if (todo.startsWith('to-do')) return `\n\n- [${todo.includes('completed') ? 'x' : ' '}] ${t}\n\n`;
      return `\n\n${t}\n\n`;
    }
    case 'div': return `\n${await kids(n, resolve, depth)}\n`;
    default: return kids(n, resolve, depth);
  }
}

async function table(t, resolve) {
  const rows = [];
  for (const tr of t.querySelectorAll('tr')) {
    const cells = [];
    for (const c of tr.children) cells.push((await kids(c, resolve, 0)).trim().replace(/[\\|]/g, '\\$&').replace(/\n+/g, ' '));
    rows.push(cells);
  }
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return `\n\n${line(rows[0])}\n| ${Array(w).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
}
