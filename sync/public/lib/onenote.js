import { htmlToMarkdown } from './html2md.js';
import { makeResolver } from './resolver.js';
import { loadState, saveState, pool, upsertNote } from './sync.js';
import { cleanCategory } from './markdown.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Notes.Read offline_access';
const TOKEN_KEY = 'ms-token';
const rand = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class OneNote {
  constructor(cfg) {
    this.cfg = cfg;
    this.redirect = `${location.origin}${cfg.basePath}/`;
    this.authority = `https://login.microsoftonline.com/${cfg.msTenant}/oauth2/v2.0`;
    this.tok = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
  }
  get signedIn() { return !!this.tok; }

  /** OAuth2 authorization-code flow with PKCE; tokens never leave the browser. */
  async login() {
    const verifier = rand(48), state = rand(16);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('ms-pkce', JSON.stringify({ verifier, state }));
    const p = new URLSearchParams({ client_id: this.cfg.msClientId, response_type: 'code', redirect_uri: this.redirect, response_mode: 'query', scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state });
    location.assign(`${this.authority}/authorize?${p}`);
  }

  /** Completes the redirect, if any. Returns true when a login was processed. */
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return false;
    const saved = JSON.parse(sessionStorage.getItem('ms-pkce') ?? 'null');
    sessionStorage.removeItem('ms-pkce');
    history.replaceState(null, '', this.redirect);
    if (q.has('error')) throw new Error(`Microsoft sign-in failed: ${q.get('error_description') ?? q.get('error')}`);
    if (!saved || saved.state !== q.get('state')) throw new Error('Microsoft sign-in state mismatch');
    await this.#token({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: saved.verifier, redirect_uri: this.redirect });
    return true;
  }

  async #token(params) {
    const res = await fetch(`${this.authority}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.msClientId, scope: SCOPE, ...params }),
    });
    const j = await res.json();
    if (!res.ok) { this.logout(); throw new Error(j.error_description ?? 'Token request failed'); }
    this.tok = { access: j.access_token, refresh: j.refresh_token ?? this.tok?.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.tok));
  }
  logout() { this.tok = null; sessionStorage.removeItem(TOKEN_KEY); }

  async fetch(url, tries = 0) {
    if (!this.tok) throw new Error('Not signed in to Microsoft');
    if (Date.now() > this.tok.exp) await this.#token({ grant_type: 'refresh_token', refresh_token: this.tok.refresh });
    const res = await fetch(url.startsWith('http') ? url : GRAPH + url, { headers: { Authorization: 'Bearer ' + this.tok.access } });
    if ((res.status === 429 || res.status === 503 || res.status === 504) && tries < 6) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** tries;
      await sleep(Math.min(wait, 120) * 1000);
      return this.fetch(url, tries + 1);
    }
    if (!res.ok) throw new Error(`Graph ${res.status} for ${url.replace(GRAPH, '').slice(0, 80)}`);
    return res;
  }

  async *pages(url) {
    while (url) {
      const j = await (await this.fetch(url)).json();
      yield* j.value;
      url = j['@odata.nextLink'];
    }
  }

  /** Imports new/changed pages. Incremental via a per-section watermark (pages are listed newest first). */
  async sync(key, log, progress) {
    const state = await loadState(key, 'onenote');
    state.sections ??= {}; state.pages ??= {};
    const sections = [];
    for await (const s of this.pages(`/me/onenote/sections?$top=100&$select=id,displayName&$expand=parentNotebook($select=displayName)`)) sections.push(s);
    log(`OneNote: ${sections.length} sections`);
    let done = 0, imported = 0, failed = 0;
    let si = 0;
    for (const s of sections) {
      progress(si++ / sections.length);
      const category = cleanCategory(`${s.parentNotebook?.displayName ?? 'OneNote'} - ${s.displayName}`);
      const mark = state.sections[s.id] ?? '';
      const todo = [];
      let newest = '';
      for await (const p of this.pages(`/me/onenote/sections/${s.id}/pages?$top=100&$orderby=lastModifiedDateTime desc&$select=id,title,createdDateTime,lastModifiedDateTime`)) {
        if (!newest) newest = p.lastModifiedDateTime;
        if (mark && p.lastModifiedDateTime <= mark) break;
        if (state.pages[p.id]?.remoteModified === p.lastModifiedDateTime) continue;
        todo.push(p);
      }
      let sectionFailed = false;
      await pool(todo, 3, async (p) => {
        try {
          log(`  ${category}: ${p.title || 'Untitled'}`);
          const html = await (await this.fetch(`/me/onenote/pages/${p.id}/content`)).text();
          const entry = state.pages[p.id];
          const result = await upsertNote(key, entry, {
            title: p.title || 'Untitled', category, created: p.createdDateTime, modified: p.lastModifiedDateTime, log,
            makeBody: async (noteId) => {
              const resolve = makeResolver({ key, noteId, log, fetchRemote: (u) => this.fetch(u), remotePrefix: GRAPH });
              return (await htmlToMarkdown(html, resolve)).markdown;
            },
          });
          state.pages[p.id] = { ...result, remoteModified: p.lastModifiedDateTime };
          imported++;
        } catch (e) {
          failed++; sectionFailed = true;
          log(`  failed: ${p.title}: ${e.message}`);
        }
        ++done;
      });
      if (!sectionFailed && newest) state.sections[s.id] = newest;
      await saveState(key, 'onenote', state);
    }
    log(`OneNote sync finished: ${imported} imported/updated, ${failed} failed`);
  }
}
