import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
createApp(cfg, db).listen(cfg.port, () => console.log(`sec-selfnotes listening on :${cfg.port}`));
