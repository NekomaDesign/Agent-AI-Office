#!/usr/bin/env node
// Server nhỏ cho văn phòng 3D — không cần cài thư viện, chỉ cần Node.js.
// - Phục vụ giao diện trong thư mục office/
// - GET /api/state: đọc toàn bộ .studio/ (status, tasks, chat, reports) cho văn phòng hiển thị
// - POST /api/chat: anh Nekoma nhắn vào chat chung (hoặc 1 kênh việc) — chỉ ghi lại, không chạy lệnh
// - POST /api/order: anh Nekoma giao việc từ web → Claude Code chạy nền
// - GET /files/outputs/...: xem trực tiếp / tải file nhân viên gửi · GET /api/zip: tải cả thư mục · POST /api/open-folder
// - Ghi usage mỗi lần Claude chạy nền vào .studio/usage.jsonl (hiện trên giao diện)
// - Tám chuyện: nhân viên nhắn nhau theo kịch bản office/chatter.json (không tốn lượt Claude) · POST /api/chatter bật/tắt
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
const OUTPUTS = path.join(ROOT, 'outputs');

const START_PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.jsx': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf', '.obj': 'text/plain; charset=utf-8', '.stl': 'model/stl', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.zip': 'application/zip', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
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
  const job = { id: Date.now().toString(36), kind: 'order', text, queuedAt: nowIso() };
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

// node office/tools/render-png.mjs: xuất PNG từ HTML/SVG, chỉ đọc/ghi trong outputs/ (anh Nekoma đã cho phép)
const TOOLS = 'Task,Read,Write,Edit,MultiEdit,Glob,Grep,TodoWrite,WebSearch,WebFetch,Bash(date:*),Bash(mkdir:*),Bash(ls:*),Bash(node office/tools/render-png.mjs:*),PowerShell(node office/tools/render-png.mjs *),' +
  // xuất PNG/PDF và mô hình 3D — chỉ đọc/ghi trong outputs/ (anh Nekoma đã cho phép)
  'Bash(node office/tools/render.mjs:*),PowerShell(node office/tools/render.mjs *),Bash(node office/tools/export-3d.mjs:*),PowerShell(node office/tools/export-3d.mjs *)';

function runJob(job, allowResume) {
  runner.busy = true;
  runner.current = { ...job, startedAt: nowIso() };
  const thread = job.thread || ORDER_THREAD;
  if (!runner.claudePath) {
    runner.lastError = 'not_found';
    return appendChat(thread, { from: 'studio', to: 'cd', text: 'Em không tìm thấy Claude Code trên máy anh 😥 Anh cài lại bằng lệnh: irm https://claude.ai/install.ps1 | iex — rồi tắt và mở lại start-studio.bat nha.' });
  }
  const prompt = job.prompt || `${job.text}\n\n---\n(Tin nhắn này anh Nekoma gửi từ ô lệnh trong văn phòng 3D. Bạn đang chạy ở chế độ nền nên KHÔNG hỏi lại được giữa chừng: nếu thiếu thông tin thì ghi trạng thái blocked và nhắn anh trong chat như CLAUDE.md quy định. Tuân thủ QUY TẮC VÀNG và GIAO THỨC STUDIO. Cuối cùng trả lời anh 1–3 câu ngắn bằng tiếng Việt: ai đã nhận việc gì, kết quả ở đâu.)`;
  const args = ['-p', 'Lam theo yeu cau cua anh Nekoma trong noi dung ben duoi.', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS];
  if (allowResume && runner.sessionId) args.push('--resume', runner.sessionId);

  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try { child = spawnClaude(args, { cwd: ROOT, env: process.env }); }
    catch (e) { runner.lastError = String(e.message); appendChat(thread, { from: 'studio', to: 'cd', text: `Em không chạy được Claude Code: ${e.message}` }).then(resolve); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', async (e) => { clearTimeout(timer); runner.lastError = e.message; await appendChat(thread, { from: 'studio', to: 'cd', text: `Em không chạy được Claude Code: ${e.message}` }); resolve(); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop()); } catch {}
      if (json && json.session_id) { runner.sessionId = json.session_id; await saveSession(); }
      await logUsage(job, json, code, err || out);
      if (json && !json.is_error && typeof json.result === 'string') {
        runner.lastError = '';
        // kênh # all: các bạn tự nhắn trả lời vào kênh, không cần thêm lời của bộ chạy
        if (job.kind !== 'chat') await appendChat(thread, { from: 'studio', to: 'cd', text: json.result.trim() || 'Dạ xong rồi anh.' });
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
      const hint = /log ?in|auth|credential|api key/i.test(msg) ? ' Có vẻ Claude Code chưa đăng nhập: anh mở PowerShell, gõ claude để đăng nhập một lần nha.'
        : /limit|resets/i.test(msg) ? ' Gói Claude đang hết lượt dùng, tới giờ reset thì anh gửi lại nha.' : '';
      await appendChat(thread, { from: 'studio', to: 'cd', text: `Em gặp lỗi khi xử lý lệnh này 😥 ${String(msg).trim().slice(0, 300)}${hint}` });
      resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}

// ======================================================================
// USAGE — mỗi lần Claude chạy nền ghi 1 dòng vào .studio/usage.jsonl
// (chỉ tính phần văn phòng gọi Claude; gói Pro không có API công khai cho % hạn mức)
// ======================================================================
const USAGE_FILE = path.join(STUDIO, 'usage.jsonl');
const usage = { limit: null, cache: null, at: 0 };
async function logUsage(job, json, code, rawErr) {
  const u = json?.usage || {};
  const errText = json?.is_error || !json ? String(json?.result || rawErr || `mã lỗi ${code}`) : '';
  const limited = /limit|resets?|quota|usage/i.test(errText) && /limit/i.test(errText);
  const row = {
    time: nowIso(), kind: job.kind || 'order', ok: !!json && !json.is_error, text: String(job.text || '').slice(0, 80),
    cost: Number(json?.total_cost_usd) || 0, input: u.input_tokens || 0, output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
    durationMs: json?.duration_ms || 0, turns: json?.num_turns || 0, models: Object.keys(json?.modelUsage || {}),
    ...(errText ? { error: errText.slice(0, 200) } : {}), ...(limited ? { limited: true } : {}),
  };
  usage.limit = limited ? { text: errText.slice(0, 200), at: row.time, reset: errText.match(/resets?\s+([^·(\n]+?)(\s*\(|$)/i)?.[1]?.trim() || '' } : row.ok ? null : usage.limit;
  usage.cache = null;
  await fs.appendFile(USAGE_FILE, JSON.stringify(row) + '\n', 'utf8');
}
async function usageSummary() {
  if (usage.cache && Date.now() - usage.at < 5000) return usage.cache;
  let rows = [];
  try { rows = (await fs.readFile(USAGE_FILE, 'utf8')).split(/\r?\n/).map((l) => { try { return l.trim() ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean); } catch { /* chưa có */ }
  const day = nowIso().slice(0, 10);
  const sum = (list) => list.reduce((a, r) => ({ runs: a.runs + 1, ok: a.ok + (r.ok ? 1 : 0), tokens: a.tokens + r.input + r.output + r.cacheRead + r.cacheWrite, output: a.output + r.output, cost: a.cost + r.cost, ms: a.ms + r.durationMs }), { runs: 0, ok: 0, tokens: 0, output: 0, cost: 0, ms: 0 });
  const since = (h) => rows.filter((r) => Date.now() - new Date(r.time).getTime() < h * 3600e3);
  // nhớ thông báo hết lượt gần nhất kể cả sau khi khởi động lại server
  const lastLimit = [...rows].reverse().find((r) => r.limited);
  const lastOk = [...rows].reverse().find((r) => r.ok);
  const limit = usage.limit || (lastLimit && (!lastOk || lastLimit.time > lastOk.time) ? { text: lastLimit.error, at: lastLimit.time, reset: lastLimit.error?.match(/resets?\s+([^·(\n]+?)(\s*\(|$)/i)?.[1]?.trim() || '' } : null);
  usage.cache = { today: sum(rows.filter((r) => r.time.slice(0, 10) === day)), last5h: sum(since(5)), last7d: sum(since(24 * 7)), total: sum(rows), recent: rows.slice(-12).reverse(), limit };
  usage.at = Date.now();
  return usage.cache;
}

let chatterOn = true;
function runnerState() {
  return {
    available: !!runner.claudePath,
    version: runner.claudeVersion,
    busy: runner.busy,
    queue: runner.queue.length,
    startedAt: runner.current?.startedAt || null,
    currentText: runner.current?.text || '',
    currentKind: runner.current?.kind || '',
    lastError: runner.lastError,
    session: !!runner.sessionId,
    chatter: chatterOn,
  };
}

// ======================================================================
// TÁM CHUYỆN — nhân viên nhắn nhau theo kịch bản office/chatter.json, kể cả khi không có việc.
// Không gọi Claude, không tạo task. Ghi vào .studio/chat/tam-chuyen.jsonl (kênh ☕ Tám chuyện).
// ======================================================================
const CHATTER_THREAD = 'tam-chuyen';
const chatter = { timer: null, playing: false, last: [] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
async function chatterConfig() {
  const studio = await readJson(path.join(STUDIO, 'studio.json'), {});
  const script = await readJson(path.join(WEB, 'chatter.json'), { threads: [] });
  return { enabled: studio.chatter?.enabled !== false, script };
}
async function chatterContext() {
  const agents = {};
  for (const a of AGENTS) agents[a] = await readJson(path.join(STUDIO, 'status', `${a}.json`), { state: 'idle' });
  const tasks = await readJson(path.join(STUDIO, 'tasks.json'), []);
  const short = (t) => String(t || '').replace(/^[^·]*·\s*/, '').slice(0, 60);
  const busy = AGENTS.filter((a) => agents[a].state === 'working');
  return {
    agents, busy,
    has: {
      any: true, idle: !busy.length, busy: !!busy.length,
      review: Array.isArray(tasks) && tasks.some((t) => t.state === 'manager_review'),
      final: Array.isArray(tasks) && tasks.some((t) => t.state === 'waiting_review'),
      blocked: AGENTS.some((a) => agents[a].state === 'blocked'),
    },
    fill(text) {
      return text.replace(/\{task:(\w+)\}/g, (_, id) => short(agents[id]?.task) || 'việc đang làm')
        .replace(/\{busyTask\}/g, () => short(agents[busy[0]]?.task) || 'task mới');
    },
  };
}
function threadOk(t, ctx) {
  const w = t.when || 'any';
  if (w.startsWith('working:')) return ctx.agents[w.slice(8)]?.state === 'working';
  if (w.startsWith('state:')) { const [, id, st] = w.split(':'); return ctx.agents[id]?.state === st; }
  return !!ctx.has[w];
}
async function playChatter() {
  if (chatter.playing) return;
  const { enabled, script } = await chatterConfig();
  if (!enabled || !script.threads?.length) return;
  const ctx = await chatterContext();
  // ưu tiên chuyện đúng bối cảnh (có người đang làm, chờ duyệt…), tránh lặp lại mấy đoạn vừa nói
  const ok = script.threads.map((t, i) => ({ t, i })).filter(({ t, i }) => threadOk(t, ctx) && !chatter.last.includes(i));
  const ctxual = ok.filter(({ t }) => (t.when || 'any') !== 'any');
  const chosen = ctxual.length && Math.random() < 0.55 ? pick(ctxual) : pick(ok.length ? ok : script.threads.map((t, i) => ({ t, i })));
  if (!chosen) return;
  chatter.last = [chosen.i, ...chatter.last].slice(0, Math.min(12, Math.floor(script.threads.length / 2)));
  chatter.playing = true;
  const [gapMin, gapMax] = script.settings?.lineGapSec || [4, 9];
  for (const [from, to, text] of chosen.t.lines) {
    if (!AGENTS.includes(from)) continue;
    await appendChat(CHATTER_THREAD, { from, to: to === 'team' || AGENTS.includes(to) ? to : 'team', text: ctx.fill(text), sim: true });
    await new Promise((r) => setTimeout(r, (gapMin + Math.random() * (gapMax - gapMin)) * 1000));
  }
  chatter.playing = false;
  await trimChatter();
}
// kênh giả lập: giữ 300 tin gần nhất cho nhẹ
async function trimChatter() {
  const f = path.join(STUDIO, 'chat', `${CHATTER_THREAD}.jsonl`);
  try {
    const lines = (await fs.readFile(f, 'utf8')).split(/\r?\n/).filter(Boolean);
    if (lines.length > 400) await fs.writeFile(f, lines.slice(-300).join('\n') + '\n', 'utf8');
  } catch { /* chưa có */ }
}
async function scheduleChatter(first) {
  clearTimeout(chatter.timer);
  const { script } = await chatterConfig();
  const [min, max] = [script.settings?.minSec || 50, script.settings?.maxSec || 140];
  chatter.timer = setTimeout(async () => { try { await playChatter(); } catch { chatter.playing = false; } scheduleChatter(); }, (first ? 8 : min + Math.random() * (max - min)) * 1000);
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

// @grid, @ink… → id agent; @all / @team / @cả → cả team
function parseTags(text) {
  const ids = new Set(); let all = false;
  for (const m of text.matchAll(/@([a-zà-ỹ]+)/gi)) {
    const t = m[1].toLowerCase();
    if (['all', 'team', 'cả', 'ca'].includes(t)) all = true;
    else if (t === 'grid' || t === 'manager') ids.add('manager');
    else if (AGENTS.includes(t)) ids.add(t);
  }
  return { ids: [...ids], all };
}

function chatJob(channel, text, tags) {
  const who = tags.all ? 'cả team (@all) — Grid trả lời thay mặt team' : tags.ids.join(', ');
  const prompt = `Anh Nekoma vừa nhắn trong kênh # all của công ty (file .studio/chat/${channel}.jsonl):\n\n"${text}"\n\n` +
    `Người được gọi: ${who}.\n\nViệc của bạn: để đúng người trả lời anh NGAY TRONG KÊNH NÀY.\n` +
    `- Mỗi người được gọi viết 1 tin trả lời, đúng giọng và vai trò của người đó (xem .claude/agents/<id>.md): THÊM 1 dòng JSON vào .studio/chat/${channel}.jsonl dạng {"from":"<id>","to":"cd","text":"...","time":"<giờ VN ISO>"}. Lấy giờ bằng lệnh date.\n` +
    `- @all: Grid (id manager) trả lời trước thay mặt cả team; chỉ thêm tối đa 2 bạn liên quan trực tiếp.\n` +
    `- Nếu là câu hỏi / trò chuyện: trả lời ngắn gọn, thân thiện, không tạo task.\n` +
    `- Nếu là giao việc: làm như anh gọi tên trực tiếp (QUY TẮC VÀNG, QUY TRÌNH MANAGER, LUỒNG DUYỆT trong CLAUDE.md), vẫn nhắn xác nhận trong kênh này. Khi gửi file cho anh thì thêm trường "files": ["outputs/..."] vào dòng chat.\n` +
    `- Không hỏi lại giữa chừng được. Cuối cùng trả lời 1 câu ngắn (không hiển thị cho anh).`;
  const job = { id: Date.now().toString(36), kind: 'chat', thread: channel, text, prompt, queuedAt: nowIso() };
  runner.queue.push(job);
  pump();
  return job;
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
  // "@ink …" → gửi riêng cho Ink; "@grid" là manager; @all là cả team
  const tags = parseTags(text);
  const to = !tags.all && tags.ids.length === 1 ? tags.ids[0] : 'team';
  const msg = { from: 'cd', to, text, via: 'office' };
  await appendChat(channel, msg);
  // ở kênh # all, có tag ai đó hoặc @all → Claude Code chạy nền để người đó trả lời
  let reply = false;
  if (channel === COMPANY && (tags.all || tags.ids.length) && runner.claudePath) { chatJob(channel, text, tags); reply = true; }
  json(200, { ok: true, reply, queue: runner.queue.length, message: { ...msg, time: nowIso() } });
}

// đường dẫn "outputs/..." → đường dẫn thật, chặn đi ra ngoài thư mục outputs/
function outputsPath(rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean.startsWith('outputs/') && clean !== 'outputs') return null;
  const abs = path.resolve(ROOT, clean);
  return abs === OUTPUTS || abs.startsWith(OUTPUTS + path.sep) ? abs : null;
}
const attachName = (name) => `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

async function serveOutput(req, res, abs, download) {
  const st = await fs.stat(abs);
  if (!st.isFile()) { res.writeHead(404); return res.end(); }
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const head = {
    'Content-Type': type, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    // file do agent tạo: cấm chạy script khi mở thẳng (svg/html)
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:",
  };
  if (/\.pdf$/i.test(abs)) delete head['Content-Security-Policy'];
  if (download) head['Content-Disposition'] = attachName(path.basename(abs));
  // tua video cần Range
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && !download) {
    let a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : st.size - 1;
    if (!m[1] && m[2]) { a = Math.max(0, st.size - +m[2]); b = st.size - 1; }
    if (a >= st.size || a > b) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    b = Math.min(b, st.size - 1);
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
    return fss.createReadStream(abs, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { ...head, 'Content-Length': st.size });
  fss.createReadStream(abs).pipe(res);
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(abs, base));
    else { const st = await fs.stat(abs); out.push({ path: path.relative(ROOT, abs).split(path.sep).join('/'), name: path.relative(base, abs).split(path.sep).join('/'), size: st.size, mtime: st.mtime.toISOString() }); }
  }
  return out;
}

// ZIP không nén (store) — đủ cho file thiết kế, không cần thư viện ngoài
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function zipFolder(dir) {
  const files = await listFiles(dir);
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = await fs.readFile(path.join(ROOT, f.path));
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);
    const d = new Date(f.mtime);
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, name, data); central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cenBuf = Buffer.concat(central);
  const endRec = Buffer.alloc(22);
  endRec.writeUInt32LE(0x06054b50, 0); endRec.writeUInt16LE(files.length, 8); endRec.writeUInt16LE(files.length, 10);
  endRec.writeUInt32LE(cenBuf.length, 12); endRec.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, endRec]);
}

function openInExplorer(abs, isFile) {
  if (process.platform === 'win32') spawn('explorer.exe', isFile ? [`/select,${abs}`] : [abs], { detached: true, windowsHide: false }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', isFile && process.platform === 'darwin' ? ['-R', abs] : [isFile ? path.dirname(abs) : abs], { detached: true }).unref();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/state') {
      chatterOn = (await chatterConfig()).enabled;
      const body = JSON.stringify({ ...(await readState()), runner: runnerState(), usage: await usageSummary() });
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (url.pathname.startsWith('/files/')) {
      const abs = outputsPath(decodeURIComponent(url.pathname.slice(7)));
      if (!abs) { res.writeHead(403); return res.end('Forbidden'); }
      return await serveOutput(req, res, abs, url.searchParams.has('download'));
    }
    if (url.pathname === '/api/files') {
      const abs = outputsPath(url.searchParams.get('dir'));
      if (!abs) { res.writeHead(403); return res.end('Forbidden'); }
      let files = [];
      try { files = await listFiles(abs); } catch { /* chưa có thư mục */ }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ dir: path.relative(ROOT, abs).split(path.sep).join('/'), files }));
    }
    if (url.pathname === '/api/zip') {
      const abs = outputsPath(url.searchParams.get('dir'));
      if (!abs || abs === OUTPUTS) { res.writeHead(403); return res.end('Forbidden'); }
      const buf = await zipFolder(abs);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Content-Disposition': attachName(path.basename(abs) + '.zip') });
      return res.end(buf);
    }
    if (url.pathname === '/api/open-folder') {
      if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(403); return res.end('Forbidden'); }
      let rel = '';
      try { rel = JSON.parse(await readBody(req)).path; } catch {}
      const abs = outputsPath(rel);
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': MIME['.json'] }); res.end(JSON.stringify(obj)); };
      if (!abs) return send(403, { ok: false, error: 'Chỉ mở được thư mục trong outputs/' });
      let st; try { st = await fs.stat(abs); } catch { return send(404, { ok: false, error: 'Không tìm thấy' }); }
      openInExplorer(abs, st.isFile());
      return send(200, { ok: true, path: abs });
    }
    if (url.pathname === '/api/chatter') {
      if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(403); return res.end('Forbidden'); }
      let on = true;
      try { on = !!JSON.parse(await readBody(req)).enabled; } catch {}
      const f = path.join(STUDIO, 'studio.json');
      const studio = await readJson(f, {});
      studio.chatter = { ...(studio.chatter || {}), enabled: on };
      await fs.writeFile(f, JSON.stringify(studio, null, 2) + '\n', 'utf8');
      chatterOn = on;
      if (on) scheduleChatter(true);
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true, enabled: on }));
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
scheduleChatter(true);
await loadSession();
await detectClaude();
listen(START_PORT);
