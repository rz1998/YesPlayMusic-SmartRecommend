const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  console.log('Health endpoint called!');
  res.json({ status: 'ok' });
});

app.get('/test', (req, res) => {
  console.log('Test endpoint called!');
  res.json({ message: 'Hello' });
});

const server = app.listen(9999, '0.0.0.0', () => {
  console.log('Test server running on port 9999');
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
