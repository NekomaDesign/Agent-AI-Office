#!/usr/bin/env node
// Server nhỏ cho văn phòng 3D — không cần cài thư viện, chỉ cần Node.js.
// - Phục vụ giao diện trong thư mục office/
// - GET /api/state: đọc toàn bộ .studio/ (status, tasks, chat, reports) cho văn phòng hiển thị
// - POST /api/chat: anh Nekoma gửi tin vào chat chung (hoặc 1 kênh task) từ văn phòng
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WEB, '..');
const STUDIO = path.join(ROOT, '.studio');
const AGENTS = ['manager', 'lue', 'brief', 'ink', 'pixel', 'cube', 'frame'];
const COMPANY = 'company';
const START_PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const nowIso = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0'), off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
};

// Tạo sẵn cấu trúc .studio/ nếu thiếu
async function ensureStudio() {
  for (const d of ['status', 'chat', 'reports', 'archive']) await fs.mkdir(path.join(STUDIO, d), { recursive: true });
  await fs.mkdir(path.join(ROOT, 'outputs'), { recursive: true });
  const write = async (f, content) => { if (!fss.existsSync(f)) await fs.writeFile(f, content, 'utf8'); };
  await write(path.join(STUDIO, 'studio.json'), JSON.stringify({ name: 'NEKOMA STUDIO', tagline: 'Creative AI Production Lab', established: '2026', director: 'Nekoma' }, null, 2) + '\n');
  await write(path.join(STUDIO, 'tasks.json'), '[]\n');
  for (const a of AGENTS) {
    await write(path.join(STUDIO, 'status', `${a}.json`), JSON.stringify({ agent: a, state: 'idle', task: '', taskId: '', progress: 0, note: 'Chờ anh giao việc', updated: nowIso() }, null, 2) + '\n');
  }
  await write(path.join(STUDIO, 'chat', `${COMPANY}.jsonl`),
    JSON.stringify({ from: 'manager', to: 'team', text: 'Chào cả nhà, em là Grid — Manager của studio 🧭 Việc lớn anh Nekoma giao cho em, em sẽ chia lại cho từng bạn. Đây là kênh chat chung của cả công ty nha.', time: nowIso() }) + '\n');
  const chats = (await fs.readdir(path.join(STUDIO, 'chat'))).filter((f) => f.endsWith('.jsonl'));
  if (!chats.length) {
    await fs.writeFile(path.join(STUDIO, 'chat', 'studio-welcome.jsonl'),
      JSON.stringify({ from: 'lue', to: 'cd', text: 'Chào anh Nekoma! Studio đã mở cửa 🦆 Cả team đang rảnh, anh giao việc cho ai thì người đó mới bắt tay vào làm nha.', time: nowIso() }) + '\n', 'utf8');
  }
}

async function readJson(f, fallback) {
  try { return JSON.parse((await fs.readFile(f, 'utf8')).replace(/^﻿/, '')); } catch { return fallback; }
}

async function readState() {
  const studio = await readJson(path.join(STUDIO, 'studio.json'), {});
  const agents = {};
  for (const a of AGENTS) agents[a] = await readJson(path.join(STUDIO, 'status', `${a}.json`), { state: 'idle' });
  let tasks = await readJson(path.join(STUDIO, 'tasks.json'), []);
  if (!Array.isArray(tasks)) tasks = Array.isArray(tasks?.tasks) ? tasks.tasks : [];

  const chats = {};
  try {
    for (const f of await fs.readdir(path.join(STUDIO, 'chat'))) {
      if (!f.endsWith('.jsonl')) continue;
      const lines = (await fs.readFile(path.join(STUDIO, 'chat', f), 'utf8')).replace(/^﻿/, '').split(/\r?\n/);
      chats[f.slice(0, -6)] = lines.map((l) => { try { return l.trim() ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
    }
  } catch { /* chưa có */ }

  const reports = [];
  try {
    const files = (await fs.readdir(path.join(STUDIO, 'reports'))).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 30);
    for (const f of files) {
      const m = f.match(/(\d{4}-\d{2}-\d{2})/);
      reports.push({ name: f, date: m ? m[1] : f, content: await fs.readFile(path.join(STUDIO, 'reports', f), 'utf8') });
    }
  } catch { /* chưa có */ }

  return { studio, agents, tasks, chats, reports, serverTime: nowIso() };
}

const readBody = (req, max = 16384) => new Promise((resolve, reject) => {
  let size = 0; const parts = [];
  req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  req.on('error', reject);
});

// Tin của anh Nekoma gửi từ văn phòng → nối 1 dòng vào .studio/chat/<channel>.jsonl
async function postChat(req, res) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': MIME['.json'] }); res.end(JSON.stringify(obj)); };
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(400, { error: 'Dữ liệu không hợp lệ' }); }
  const channel = String(body.channel || COMPANY);
  const text = String(body.text || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(channel)) return json(400, { error: 'Tên kênh không hợp lệ' });
  if (!text || text.length > 2000) return json(400, { error: 'Tin nhắn trống hoặc quá dài' });
  // "@ink …" → gửi riêng cho Ink; "@grid" là tên của manager
  const m = text.match(/@([a-z]+)/i);
  const tag = m ? m[1].toLowerCase() : '';
  const to = tag === 'grid' ? 'manager' : AGENTS.includes(tag) ? tag : 'team';
  const msg = { from: 'cd', to, text, time: nowIso(), via: 'office' };
  await fs.appendFile(path.join(STUDIO, 'chat', `${channel}.jsonl`), JSON.stringify(msg) + '\n', 'utf8');
  json(200, { ok: true, message: msg });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/chat' && req.method === 'POST') return await postChat(req, res);
    if (url.pathname === '/api/state') {
      const body = JSON.stringify(await readState());
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(WEB, '.' + rel);
    if (!file.startsWith(WEB + path.sep) && file !== WEB) { res.writeHead(403); return res.end('Forbidden'); }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Không tìm thấy');
  }
});

function listen(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < START_PORT + 20) listen(port + 1);
    else { console.error('Không mở được server:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log('\n  ┌──────────────────────────────────────────────┐');
    console.log('  │   NEKOMA STUDIO · Agent Office 3D đã mở       │');
    console.log('  └──────────────────────────────────────────────┘');
    console.log(`\n  Văn phòng:  ${url}`);
    console.log(`  Đang đọc:   ${STUDIO}`);
    console.log('\n  Giữ cửa sổ này mở. Giao việc trong Claude Code ở cửa sổ khác.');
    console.log('  Tắt server: bấm Ctrl + C\n');
    if (!process.env.NO_OPEN && !process.argv.includes('--no-open')) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

await ensureStudio();
listen(START_PORT);
