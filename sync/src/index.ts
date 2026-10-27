import { createApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
createApp(cfg).listen(cfg.port, () => console.log(`Sync service listening on :${cfg.port}${cfg.basePath}`));
