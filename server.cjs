/**
 * Production Web & Autonomous AutoTrader Server for Render / Railway / Cloud Deployment
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const botService = require('./bot-service.cjs');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Activate Autonomous Background Keeper Heartbeat
if (typeof botService.startAutonomousKeeperDaemon === 'function') {
  botService.startAutonomousKeeperDaemon();
}

// 2. Intercept Bot API Routes & Route to bot-service
app.use((req, res, next) => {
  const url = req.url.split('?')[0];
  if (
    url.startsWith('/api/binance/') ||
    url.startsWith('/api/bot/') ||
    url.startsWith('/api/trades') ||
    url.startsWith('/api/positions') ||
    url.startsWith('/api/orders') ||
    url === '/positions/csv' ||
    url === '/orders/csv' ||
    url.startsWith('/autotrade') ||
    url.startsWith('/order/') ||
    url === '/portfolio-balance' ||
    url === '/balance' ||
    url === '/signal' ||
    url === '/cancel' ||
    url === '/close' ||
    url === '/state' ||
    url === '/simulate-keeper-fill' ||
    url === '/update-price' ||
    url === '/halt' ||
    url === '/resume' ||
    url === '/mode' ||
    url === '/preflight' ||
    url === '/wallet-status' ||
    url === '/safety-toggle' ||
    url === '/wallet-config' ||
    url === '/airdrop' ||
    url === '/health' ||
    url === '/ping'
  ) {
    return botService.handleApiRequest(req, res);
  }
  next();
});

// 3. Serve Built Production Frontend from /dist
const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// 4. Serve /public assets (jupiter.js, IDLs, etc.)
app.use(express.static(path.resolve(__dirname, 'public')));

// 5. Client-Side SPA Fallback
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(200).send('Solana Jupiter Perpetuals Sniper Service is running.');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [PRODUCTION SERVER] Running on port ${PORT}`);
  console.log(`⚡ [AUTOTRADE DAEMON] Background price & signal keeper is active`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️ [PRODUCTION SERVER] Port ${PORT} is in use.`);
  } else {
    console.error('❌ [PRODUCTION SERVER] Server error:', err.message);
  }
});
