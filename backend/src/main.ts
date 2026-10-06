import { createApp } from './app.js';
import { APP_CONFIG, type AppConfig } from './config.js';

const app = await createApp();
await app.listen(app.get<AppConfig>(APP_CONFIG).PORT, '0.0.0.0');
