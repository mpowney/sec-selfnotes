import { api } from './lib/api.js';
import { PRF_SALT, unwrapMasterKey } from './lib/crypto.js';
import { OneNote } from './lib/onenote.js';
import { listHandle, listFileList, syncFolder } from './lib/folder.js';
import { exportAll, dirWriter, zipWriter } from './lib/export.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log'), bar = $('bar');
const log = (m) => { logEl.textContent += `${new Date().toLocaleTimeString()} ${m}\n`; logEl.scrollTop = logEl.scrollHeight; };
const progress = (v) => { bar.value = v; };
let key = null, cfg, ms, dirHandle;
const timers = {};
const busy = new Set();

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function setLocked(locked) { document.body.classList.toggle('locked', locked); }

/** Same WebAuthn PRF unlock as the main app (same RP ID because we share its host name). */
async function unlock() {
  const username = $('username').value.trim();
  const { startAuthentication } = window.SimpleWebAuthnBrowser;
  const options = await api.post('/api/auth/signin/challenge', { username });
  options.extensions = { ...options.extensions, prf: { eval: { first: PRF_SALT } } };
  const response = await startAuthentication({ optionsJSON: options });
  const prf = response.clientExtensionResults?.prf;
  const secret = prf?.results?.first;
  if (prf) delete prf.results;
  if (!secret) throw new Error('This authenticator does not support the WebAuthn PRF extension');
  const { wrappedKey } = await api.post('/api/auth/signin/verify', { response });
  key = await unwrapMasterKey(secret, wrappedKey);
  $('who').textContent = `Unlocked as ${username}`;
  setLocked(false);
}

async function guarded(name, fn) {
  if (busy.has(name)) return;
  busy.add(name);
  try { await fn(); } catch (e) { log(`${name} error: ${e.message}`); } finally { busy.delete(name); progress(0); }
}

function schedule(name, enabled, minutes, fn) {
  clearInterval(timers[name]);
  if (enabled) timers[name] = setInterval(() => guarded(name, fn), Math.max(1, Number(minutes) || 1) * 60_000);
}

const runOneNote = () => guarded('OneNote', () => ms.sync(key, log, progress));
const runFolder = async () => {
  if (!dirHandle) return;
  if ((await dirHandle.queryPermission({ mode: 'read' })) !== 'granted') throw new Error('Folder permission lost; choose it again');
  await syncFolder(key, await listHandle(dirHandle), log, progress);
};

async function main() {
  setLocked(true);
  cfg = await (await fetch('config.json')).json();
  const st = await api.authStatus().catch(() => ({ authenticated: false }));
  if (!st.authenticated) log('Not signed in. Open the main app, sign in, then reload this page and unlock.');
  else if (st.username) $('username').value = st.username;

  if (cfg.msClientId) {
    ms = new OneNote(cfg);
    try { if (await ms.handleRedirect()) log('Signed in to Microsoft.'); } catch (e) { log(e.message); }
    $('msStatus').textContent = ms.signedIn ? 'Signed in to Microsoft.' : 'Not signed in to Microsoft.';
    $('msLogin').onclick = () => ms.login();
    $('msImport').disabled = !ms.signedIn;
    $('msImport').onclick = runOneNote;
    $('msAuto').onchange = () => schedule('OneNote', $('msAuto').checked, $('msEvery').value, runOneNote);
  } else {
    $('msStatus').textContent = 'OneNote import is disabled: set MS_CLIENT_ID on the sync service (see sync/README.md).';
    $('msLogin').disabled = true;
  }

  $('signin').onclick = () => guarded('Unlock', unlock);

  $('pickDir').onclick = () => guarded('Folder', async () => {
    if (!window.showDirectoryPicker) throw new Error('Folder watching needs a Chromium-based browser; use the one-off picker');
    dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    await runFolder();
  });
  $('pickFiles').onchange = (e) => guarded('Folder', () => syncFolder(key, listFileList(e.target.files), log, progress));
  $('dirAuto').onchange = () => schedule('Folder', $('dirAuto').checked, $('dirEvery').value, runFolder);

  $('exportDir').onclick = () => guarded('Export', async () => {
    if (!window.showDirectoryPicker) throw new Error('Folder export needs a Chromium-based browser; use .zip');
    await exportAll(key, dirWriter(await window.showDirectoryPicker({ mode: 'readwrite' })), log, progress);
  });
  $('exportZip').onclick = () => guarded('Export', async () => exportAll(key, await zipWriter(), log, progress));
  window.addEventListener('beforeunload', () => { key = null; });
}
main().catch((e) => log(`Startup error: ${e.message}`));
