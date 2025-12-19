const express = require('express');
const app = express();

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    message: 'Anime Embed Player API on Vercel',
    version: '1.0.0'
  });
});

// Health check - Vercel strips /api prefix, so this handles /api/health as /health
app.get('/health', (req, res) => {
  res.json({ alive: true, timestamp: new Date().toISOString() });
});

// Stream endpoint - handles /api/stream as /stream
app.get('/stream', async (req, res) => {
  try {
    const { id, server } = req.query;
    res.json({
      success: true,
      id: id || 'test-id',
      server: server || 'hd-2',
      data: {
        sub: { type: 'sub', link: { file: null }, tracks: [] },
        dub: {}
      },
      message: 'Stream API working on Vercel!'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Multi-server stream - handles /api/stream/type/id as /stream/type/id
app.get('/stream/:type/:tvId/ep/:epid', (req, res) => {
  const { type, tvId, epid } = req.params;
  res.json({
    success: true,
    contentType: type,
    contentId: tvId,
    episode: epid,
    servers: []
  });
});

app.get('/stream/:type/:tvId', (req, res) => {
  const { type, tvId } = req.params;
  res.json({
    success: true,
    contentType: type,
    contentId: tvId,
    servers: []
  });
});

// Catch all
app.all('*', (req, res) => {
  res.json({ 
    message: 'API endpoint not found',
    path: req.path,
    method: req.method
  });
});

module.exports = app;
