const express = require('express');
const cors = require('cors');
const path = require('path');
const net = require('net');

const eventsApi = require('./api/events');
const recommendApi = require('./api/recommend');
const profileApi = require('./api/profile');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/event', eventsApi);
app.use('/api/recommend', recommendApi);
app.use('/api/user', profileApi);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// ── Port auto-migration ──────────────────────────────────────────────
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const timer = setTimeout(() => {
      server.close();
      resolve(false);
    }, 1000);
    server.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    server.once('listen', () => {
      clearTimeout(timer);
      server.close();
      resolve(true);
    });
    server.listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(startPort, maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    const port = startPort + i;
    console.log(`🔍 Checking port ${port}...`);
    const available = await isPortAvailable(port);
    console.log(`Port ${port} available: ${available}`);
    if (available) {
      return port;
    }
    console.log(`⚠ Port ${port} is in use, trying ${port + 1}...`);
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + maxTries - 1}`);
}

// Initialize database then start server
async function start() {
  try {
    const db = require('./models/db');
    await db.initialize();

    const START_PORT = parseInt(process.env.PORT || '3001', 10);
    // Skip port check - just use START_PORT directly
    const PORT = START_PORT;
    console.log(`🚀 Starting server directly on port ${PORT}...`);

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎵 ai-musicplayer Recommendation Server running on port ${PORT}`);
      if (process.send) {
        process.send({ type: 'ready', port: PORT });
      }
    });
    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize database on module load (so require() gives a ready app)
const db = require('./models/db');
const dbReady = db.initialize().catch(err => {
  console.error('[Server] DB init error:', err.message);
});

// Export app for testing (don't auto-start when imported as module)
// Support both CommonJS require() and ES module import default export
module.exports = app;
module.exports.default = app;
module.exports.dbReady = dbReady;

// Auto-start only when run directly (not when imported as module)
if (require.main === module) {
  start();
}
