#!/usr/bin/env node
// Server nhỏ cho văn phòng 3D — không cần cài thư viện, chỉ cần Node.js.
// - Phục vụ giao diện trong thư mục office/
// - GET /api/state: đọc toàn bộ .studio/ (status, tasks, chat, reports) cho văn phòng hiển thị
// - POST /api/chat: anh Nekoma nhắn vào chat chung (hoặc 1 kênh việc) — chỉ ghi lại, không chạy lệnh
// - POST /api/order: anh Nekoma giao việc từ web → Claude Code chạy nền
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import os from 'node:os';

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


// ======================================================================
// NHẬN LỆNH TỪ WEB → gọi Claude Code chạy nền (claude -p) trong thư mục studio
// ======================================================================
const RUN_TIMEOUT_MS = 25 * 60 * 1000;
const ORDER_THREAD = 'dieu-phoi';
const SESSION_FILE = path.join(STUDIO, 'session.json');
const runner = { busy: false, queue: [], current: null, lastError: '', sessionId: null, claudePath: null, claudeVersion: '' };

function findClaude() {
  const home = os.homedir();
  const win = process.platform === 'win32';
  const cands = [];
  if (process.env.CLAUDE_BIN) cands.push(process.env.CLAUDE_BIN);
  if (win) {
    cands.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
    if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'));
  } else {
    cands.push(path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of win ? ['.exe', '.cmd'] : ['']) cands.push(path.join(dir, 'claude' + ext));
  }
  return cands.find((c) => { try { return fss.statSync(c).isFile(); } catch { return false; } }) || null;
}

function spawnClaude(args, opts = {}) {
  const bin = runner.claudePath;
  if (/\.(cmd|bat)$/i.test(bin)) {
    // file .cmd (cài bằng npm) phải chạy qua shell; các tham số ở đây đều là ASCII cố định
    const q = (a) => (/^[\w.:\-\/\\=]+$/.test(a) ? a : `"${a}"`);
    return spawn(`"${bin}"`, args.map(q), { ...opts, shell: true, windowsHide: true });
  }
  return spawn(bin, args, { ...opts, windowsHide: true });
}

async function detectClaude() {
  runner.claudePath = findClaude();
  if (!runner.claudePath) return;
  await new Promise((resolve) => {
    try {
      const c = spawnClaude(['--version']);
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('close', () => { runner.claudeVersion = out.trim(); resolve(); });
      c.on('error', () => resolve());
      setTimeout(resolve, 8000);
    } catch { resolve(); }
  });
}

async function appendChat(thread, msg) {
  await fs.appendFile(path.join(STUDIO, 'chat', `${thread}.jsonl`), JSON.stringify({ ...msg, time: nowIso() }) + '\n', 'utf8');
}

async function loadSession() {
  const s = await readJson(SESSION_FILE, {});
  runner.sessionId = s.sessionId || null;
}
async function saveSession() {
  await fs.writeFile(SESSION_FILE, JSON.stringify({ sessionId: runner.sessionId, updated: nowIso() }, null, 2) + '\n', 'utf8');
}

async function enqueue(text) {
  const job = { id: Date.now().toString(36), text, queuedAt: nowIso() };
  runner.queue.push(job);
  await appendChat(ORDER_THREAD, { from: 'cd', to: 'studio', text });
  pump();
  return job;
}

function pump() {
  if (runner.busy || !runner.queue.length) return;
  const job = runner.queue.shift();
  runJob(job, true).finally(() => { runner.busy = false; runner.current = null; pump(); });
}

const TOOLS = 'Task,Read,Write,Edit,MultiEdit,Glob,Grep,TodoWrite,WebSearch,WebFetch,Bash(date:*),Bash(mkdir:*),Bash(ls:*)';

function runJob(job, allowResume) {
  runner.busy = true;
  runner.current = { ...job, startedAt: nowIso() };
  if (!runner.claudePath) {
    runner.lastError = 'not_found';
    return appendChat(ORDER_THREAD, { from: 'studio', to: 'cd', text: 'Em không tìm thấy Claude Code trên máy anh 😥 Anh cài lại bằng lệnh: irm https://claude.ai/install.ps1 | iex — rồi tắt và mở lại start-studio.bat nha.' });
  }
  const prompt = `${job.text}\n\n---\n(Tin nhắn này anh Nekoma gửi từ ô lệnh trong văn phòng 3D. Bạn đang chạy ở chế độ nền nên KHÔNG hỏi lại được giữa chừng: nếu thiếu thông tin thì ghi trạng thái blocked và nhắn anh trong chat như CLAUDE.md quy định. Tuân thủ QUY TẮC VÀNG và GIAO THỨC STUDIO. Cuối cùng trả lời anh 1–3 câu ngắn bằng tiếng Việt: ai đã nhận việc gì, kết quả ở đâu.)`;
  const args = ['-p', 'Lam theo yeu cau cua anh Nekoma trong noi dung ben duoi.', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS];
  if (allowResume && runner.sessionId) args.push('--resume', runner.sessionId);

  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try { child = spawnClaude(args, { cwd: ROOT, env: process.env }); }
    catch (e) { runner.lastError = String(e.message); appendChat(ORDER_THREAD, { from: 'studio', to: 'cd', text: `Em không chạy được Claude Code: ${e.message}` }).then(resolve); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', async (e) => { clearTimeout(timer); runner.lastError = e.message; await appendChat(ORDER_THREAD, { from: 'studio', to: 'cd', text: `Em không chạy được Claude Code: ${e.message}` }); resolve(); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop()); } catch {}
      if (json && json.session_id) { runner.sessionId = json.session_id; await saveSession(); }
      if (json && !json.is_error && typeof json.result === 'string') {
        runner.lastError = '';
        await appendChat(ORDER_THREAD, { from: 'studio', to: 'cd', text: json.result.trim() || 'Dạ xong rồi anh.' });
        return resolve();
      }
      const msg = (json && json.result) || err || out || `mã lỗi ${code}`;
      // phiên cũ không còn → thử lại với phiên mới
      if (allowResume && runner.sessionId && /session|conversation|resume/i.test(msg)) {
        runner.sessionId = null; await saveSession();
        await runJob(job, false);
        return resolve();
      }
      runner.lastError = String(msg).slice(0, 400);
      const hint = /log ?in|auth|credential|api key/i.test(msg) ? ' Có vẻ Claude Code chưa đăng nhập: anh mở PowerShell, gõ claude để đăng nhập một lần nha.' : '';
      await appendChat(ORDER_THREAD, { from: 'studio', to: 'cd', text: `Em gặp lỗi khi xử lý lệnh này 😥 ${String(msg).trim().slice(0, 300)}${hint}` });
      resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}

function runnerState() {
  return {
    available: !!runner.claudePath,
    version: runner.claudeVersion,
    busy: runner.busy,
    queue: runner.queue.length,
    startedAt: runner.current?.startedAt || null,
    currentText: runner.current?.text || '',
    lastError: runner.lastError,
    session: !!runner.sessionId,
  };
}

// chặn trang web lạ gọi API (chỉ chấp nhận từ chính văn phòng trên localhost)
function sameOrigin(req) {
  if (req.headers['x-studio'] !== '1') return false;
  const o = req.headers.origin;
  if (!o) return true;
  try { const u = new URL(o); return u.hostname === 'localhost' || u.hostname === '127.0.0.1'; } catch { return false; }
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { b += c; if (b.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

// Tin anh Nekoma nhắn trong chat → nối 1 dòng vào .studio/chat/<channel>.jsonl
async function postChat(req, res) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': MIME['.json'] }); res.end(JSON.stringify(obj)); };
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(400, { ok: false, error: 'Dữ liệu không hợp lệ' }); }
  const channel = String(body.channel || COMPANY);
  const text = String(body.text || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(channel) || channel === ORDER_THREAD) return json(400, { ok: false, error: 'Tên kênh không hợp lệ' });
  if (!text || text.length > 2000) return json(400, { ok: false, error: 'Tin nhắn trống hoặc quá dài' });
  // "@ink …" → gửi riêng cho Ink; "@grid" là tên của manager
  const m = text.match(/@([a-z]+)/i);
  const tag = m ? m[1].toLowerCase() : '';
  const to = tag === 'grid' ? 'manager' : AGENTS.includes(tag) ? tag : 'team';
  const msg = { from: 'cd', to, text, via: 'office' };
  await appendChat(channel, msg);
  json(200, { ok: true, message: { ...msg, time: nowIso() } });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/state') {
      const body = JSON.stringify({ ...(await readState()), runner: runnerState() });
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(403); return res.end('Forbidden'); }
      return await postChat(req, res);
    }
    if (url.pathname === '/api/order' || url.pathname === '/api/session/new') {
      if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(403); return res.end('Forbidden'); }
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': MIME['.json'] }); res.end(JSON.stringify(obj)); };
      if (url.pathname === '/api/session/new') {
        runner.sessionId = null; await saveSession();
        await appendChat(ORDER_THREAD, { from: 'studio', to: 'cd', text: 'Đã mở phiên làm việc mới. Em sẽ không nhớ ngữ cảnh các lệnh trước nữa ạ.' });
        return send(200, { ok: true });
      }
      let text = '';
      try { text = String(JSON.parse(await readBody(req)).text || '').trim(); } catch { return send(400, { ok: false, error: 'bad_json' }); }
      if (!text) return send(400, { ok: false, error: 'empty' });
      if (text.length > 8000) return send(400, { ok: false, error: 'too_long' });
      const job = await enqueue(text);
      return send(200, { ok: true, id: job.id, queue: runner.queue.length });
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
    console.log(runner.claudePath ? `  Claude Code: ${runner.claudePath} ${runner.claudeVersion}` : '  ⚠ Chưa tìm thấy Claude Code — ô gõ lệnh trên web sẽ chưa dùng được.');
    console.log('\n  Giữ cửa sổ này mở. Gõ lệnh ngay trong văn phòng (Chat công ty → ⚡ Giao việc).');
    console.log('  Tắt server: bấm Ctrl + C\n');
    if (!process.env.NO_OPEN && !process.argv.includes('--no-open')) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

await ensureStudio();
await loadSession();
await detectClaude();
listen(START_PORT);
