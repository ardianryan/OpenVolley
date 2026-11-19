import { createApp } from './app';
import { seedDefaults } from './db';
import { printOpenVolleyBanner } from './lib/banner';
import { startBackupScheduler } from './services/backup';

await seedDefaults();
startBackupScheduler();

const app = createApp();
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

printOpenVolleyBanner({ port, hostname, isProduction });

export default {
  port,
  hostname,
  fetch: app.fetch,
};
