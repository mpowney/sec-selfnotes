import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { initAdminAccount } from './admin.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
await initAdminAccount(db);
createApp(cfg, db).listen(cfg.port, () => console.log(`sec-selfnotes listening on :${cfg.port}`));
