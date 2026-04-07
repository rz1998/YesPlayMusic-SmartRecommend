const express = require('express');
const cors = require('cors');
const path = require('path');

const eventsApi = require('./api/events');
const recommendApi = require('./api/recommend');
const profileApi = require('./api/profile');

const app = express();
const PORT = process.env.PORT || 3001;

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

// Initialize database then start server
async function start() {
  try {
    const db = require('./models/db');
    await db.initialize();
    
    app.listen(PORT, () => {
      console.log(`🎵 YesPlayMusic Recommendation Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
