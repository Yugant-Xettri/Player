const express = require('express');
const app = express();

app.all('*', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'API is working on Vercel',
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method
  });
});

module.exports = app;
