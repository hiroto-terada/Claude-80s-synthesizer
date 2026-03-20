#!/usr/bin/env node
/**
 * FM-80 Synthesizer — Local Server
 *
 * 静的ファイル配信 + WebSocket イベントリレー。
 * iPhone (コントローラー) で演奏した音楽イベントを
 * PC の VJ Display ページへリアルタイム中継する。
 *
 * 使い方:
 *   npm install
 *   node server.js
 *
 * コントローラー (iPhone など): http://[PC の IP]:3000/
 * VJ Display    (PC)         : http://localhost:3000/vj-display.html
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
};

// ── Static file server ──────────────────────────────────────
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';

  const file = path.join(__dirname, p);
  // Safety: prevent directory traversal
  if (!file.startsWith(__dirname)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket relay (all messages broadcast to every other client) ──
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('message', raw => {
    const msg = raw.toString();
    for (const c of clients) {
      if (c !== ws && c.readyState === 1) c.send(msg);
    }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ── Start ───────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = Object.values(require('os').networkInterfaces()).flat();
  const ip = nets.find(n => n.family === 'IPv4' && !n.internal)?.address ?? 'localhost';

  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║   FM-80 Synthesizer Server       ║');
  console.log('  ╚══════════════════════════════════╝\n');
  console.log(`  コントローラー  →  http://localhost:${PORT}/`);
  console.log(`  VJ Display     →  http://localhost:${PORT}/vj-display.html`);
  console.log(`\n  iPhone / LAN   →  http://${ip}:${PORT}/`);
  console.log('\n  Ctrl+C で停止\n');
});
