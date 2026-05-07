import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { treeRouter } from './routes/tree.js';
import { decksRouter } from './routes/decks.js';
import { collectionsRouter } from './routes/collections.js';
import { settingsRouter } from './routes/settings.js';
import { notificationsRouter } from './routes/notifications.js';
import { claudeProxyRouter } from './routes/claude-proxy.js';
import { initScheduler } from './services/scheduler.service.js';
import { shutdown as shutdownAnalytics } from './services/analytics.service.js';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/tree', treeRouter);
app.use('/api/v1/decks', decksRouter);
app.use('/api/v1/collections', collectionsRouter);
app.use('/api/v1/nodes', collectionsRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/ai', claudeProxyRouter);

// Health check
app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Error handler (must be last)
app.use(errorHandler);

const host = process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';
const server = app.listen(config.port, host, () => {
  console.log(`[server] Listening on http://${host}:${config.port}`);
  initScheduler().catch(err => {
    console.error('[scheduler] Failed to initialize:', err);
  });
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down.`);
  server.close(async () => {
    await shutdownAnalytics().catch(err => console.error('[analytics] Failed to flush during shutdown:', err));
    process.exit(0);
  });
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
