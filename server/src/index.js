import { app } from './app.js';
import { config, assertConfig } from './core/config.js';

try { assertConfig(); } catch (e) { console.error(e.message); process.exit(1); }

app.listen(config.port, () => console.log(`API running on http://localhost:${config.port}`));
