#!/usr/bin/env node
// Xuất video MP4 / GIF từ file HTML động (CSS animation, Web Animations, GSAP) trong outputs/.
// Edge/Chrome chạy ẩn, điều khiển qua DevTools: mỗi khung hình dừng mọi animation đúng thời điểm rồi chụp,
// nên không rớt khung dù máy chậm. Khung hình đưa thẳng vào ffmpeg để mã hoá.
// Chỉ đọc file trong outputs/, chỉ ghi .mp4/.gif/PNG vào outputs/.
//
//   node office/tools/render-video.mjs outputs/<taskId>/motion.html                     → motion.mp4
//   node office/tools/render-video.mjs outputs/<taskId>/motion.html --duration 10 --fps 30
//   node office/tools/render-video.mjs outputs/<taskId>/motion.html --gif                → motion.gif (preview nhẹ)
//   node office/tools/render-video.mjs outputs/<taskId>/motion.html --frames             → motion-frames/0001.png…
//
// Khổ: --size WxH, hoặc <meta name="motion-size" content="1440x1080"> (hoặc poster-size), hoặc width/height đầu tiên trong CSS.
// Thời lượng: --duration giây, hoặc <meta name="motion-duration" content="10">, hoặc tự đo từ animation dài nhất.
// Animation chạy bằng JS tự viết (requestAnimationFrame…): định nghĩa window.seek = (ms) => { …vẽ đúng thời điểm ms… }.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUTS = path.join(ROOT, 'outputs');
const fail = (msg) => { console.error(`Lỗi: ${msg}`); process.exit(1); };
const inOutputs = (p) => { const abs = path.resolve(ROOT, p); return abs.startsWith(OUTPUTS + path.sep) ? abs : null; };

// ---- tham số ----
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const sizeArg = opt('--size');
const durArg = opt('--duration');
const fpsArg = opt('--fps');
const outArg = opt('--out');
const wantGif = flag('--gif') || /\.gif$/i.test(outArg || '');
const framesOnly = flag('--frames');
const input = args[0];
if (!input) fail('thiếu file. Dùng: node office/tools/render-video.mjs outputs/<taskId>/motion.html [--duration 10] [--fps 30] [--size 1440x1080] [--gif | --frames] [--out outputs/.../x.mp4]');

const src = inOutputs(input);
if (!src) fail('chỉ xuất được file nằm trong thư mục outputs/');
if (!/\.html?$/i.test(src)) fail('chỉ hỗ trợ file .html');
if (!fs.existsSync(src)) fail(`không thấy file ${input}`);

const ext = wantGif ? '.gif' : '.mp4';
const out = framesOnly
  ? src.replace(/\.html?$/i, '-frames')
  : outArg ? inOutputs(outArg) : src.replace(/\.html?$/i, ext);
if (!out || (!framesOnly && path.extname(out).toLowerCase() !== ext)) fail(`file kết quả phải nằm trong outputs/ và có đuôi ${ext}`);

const fps = fpsArg ? Number(fpsArg) : wantGif ? 15 : 30;
if (!(Number.isInteger(fps) && fps >= 1 && fps <= 60)) fail('--fps phải là số nguyên từ 1 đến 60');

// ---- khổ & thời lượng khai báo trong HTML ----
const text = fs.readFileSync(src, 'utf8');
const meta = (name) => text.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1];
function detectSize() {
  if (sizeArg) return sizeArg;
  const m = meta('motion-size') || meta('poster-size');
  if (m) return m.replace(/\s/g, '');
  const css = text.match(/width:\s*(\d{3,5})px;\s*height:\s*(\d{3,5})px/i);
  return css ? `${css[1]}x${css[2]}` : '1920x1080';
}
const sm = /^(\d{2,4})x(\d{2,4})$/i.exec(detectSize());
if (!sm) fail('--size phải dạng RỘNGxCAO, ví dụ 1440x1080');
const [W, H] = [Number(sm[1]), Number(sm[2])];
if (W > 3840 || H > 3840) fail('khổ video tối đa 3840 px mỗi chiều');
const declared = durArg ?? meta('motion-duration');
if (declared != null && !(Number(declared) > 0 && Number(declared) <= 120)) fail('--duration phải từ 0 đến 120 giây');

// ---- Edge / Chrome, ffmpeg ----
const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const local = process.env.LOCALAPPDATA || '';
const browser = [
  process.env.BROWSER_BIN,
  path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
].find((p) => p && fs.existsSync(p));
if (!browser) fail('không tìm thấy Edge hoặc Chrome trên máy');

// winget cài ffmpeg vào WinGet\Links (server mở trước lúc cài thì PATH chưa có), nên tìm cả ở đó
function findFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dirs = [...(process.env.PATH || '').split(path.delimiter), local && path.join(local, 'Microsoft', 'WinGet', 'Links')];
  for (const d of dirs) if (d && fs.existsSync(path.join(d, exe))) return path.join(d, exe);
  const pkgs = local && path.join(local, 'Microsoft', 'WinGet', 'Packages');
  if (pkgs && fs.existsSync(pkgs)) {
    for (const p of fs.readdirSync(pkgs).filter((n) => /ffmpeg/i.test(n))) {
      const base = path.join(pkgs, p);
      for (const sub of fs.readdirSync(base)) {
        const f = path.join(base, sub, 'bin', exe);
        if (fs.existsSync(f)) return f;
      }
    }
  }
  return null;
}
const ffmpeg = framesOnly ? null : findFfmpeg();
if (!framesOnly && !ffmpeg) fail('máy chưa có ffmpeg để mã hoá video. Dùng --frames để xuất chuỗi ảnh PNG, hoặc nhờ anh Nekoma cài: winget install Gyan.FFmpeg');

// ---- DevTools ----
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nekoma-video-'));
const proc = spawn(browser, ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

let ws, seq = 0;
const pending = new Map();
const listeners = new Set();
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
const waitEvent = (name, ms = 30000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { listeners.delete(fn); reject(new Error(`hết giờ chờ ${name}`)); }, ms);
  const fn = (m) => { if (m.method === name) { clearTimeout(t); listeners.delete(fn); resolve(m.params); } };
  listeners.add(fn);
});

async function connect() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(portFile)) throw new Error('trình duyệt không mở được cổng DevTools');
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('không kết nối được DevTools')); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
    } else for (const fn of listeners) fn(m);
  };
}

// chạy trong trang: dừng mọi animation tại đúng ms rồi chờ trình duyệt vẽ xong
const SEEK = `async (ms) => {
  if (typeof window.seek === 'function') await window.seek(ms);
  if (window.gsap?.globalTimeline) { window.gsap.globalTimeline.pause(); window.gsap.globalTimeline.time(ms / 1000, false); }
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  await Promise.all([...document.querySelectorAll('video')].map((v) => new Promise((r) => {
    v.pause(); if (Math.abs(v.currentTime - ms / 1000) < 0.001) return r();
    v.addEventListener('seeked', r, { once: true }); v.currentTime = ms / 1000; setTimeout(r, 2000);
  })));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}`;
// thời lượng tự đo: điểm kết thúc xa nhất của các animation hữu hạn
const MEASURE = `(() => {
  let end = 0, infinite = false;
  for (const a of document.getAnimations()) {
    const t = a.effect?.getComputedTiming?.();
    if (!t) continue;
    if (t.endTime === Infinity) infinite = true; else end = Math.max(end, t.endTime);
  }
  if (window.gsap?.globalTimeline) end = Math.max(end, window.gsap.globalTimeline.totalDuration() * 1000);
  return { end, infinite };
})()`;

const tmpOut = path.join(profile, 'out' + ext);
let enc = null;
try {
  await connect();
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`lỗi trong trang: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = waitEvent('Page.loadEventFired', 60000);
  await cmd('Page.navigate', { url: pathToFileURL(src).href });
  await loaded;
  await evaluate('document.fonts.ready.then(() => true)');
  await evaluate(`(${SEEK})(0)`);

  let seconds = Number(declared);
  if (!(seconds > 0)) {
    const { end, infinite } = await evaluate(MEASURE);
    seconds = end > 0 ? Math.min(end / 1000, 120) : infinite ? 5 : 0;
    if (!seconds) throw new Error('trang không có animation nào. Thêm --duration hoặc <meta name="motion-duration" content="10">');
    if (infinite && end <= 0) console.error('Animation lặp vô hạn, không đo được độ dài — xuất 5 giây. Dùng --duration để chỉnh.');
  }
  const total = Math.max(1, Math.round(seconds * fps));

  if (framesOnly) {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
  } else {
    // yuv420p cần cạnh chẵn; GIF dùng bảng màu riêng cho đẹp
    const vf = wantGif
      ? `scale=${Math.min(W, 960)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`
      : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const codec = wantGif ? ['-loop', '0'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    enc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-vf', vf, ...codec, tmpOut], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    enc.stderrText = '';
    enc.stderr.on('data', (d) => { enc.stderrText += d; });
    enc.done = new Promise((resolve) => enc.on('close', resolve));
  }

  for (let i = 0; i < total; i++) {
    await evaluate(`(${SEEK})(${(i * 1000) / fps})`);
    const { data } = await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    const png = Buffer.from(data, 'base64');
    if (framesOnly) fs.writeFileSync(path.join(out, `${String(i + 1).padStart(4, '0')}.png`), png);
    else if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
    if ((i + 1) % (fps * 2) === 0) console.error(`… ${i + 1}/${total} khung`);
  }

  const rel = path.relative(ROOT, out).split(path.sep).join('/');
  if (framesOnly) {
    console.log(`Đã xuất ${rel}/ · ${total} khung PNG ${W}x${H} · ${fps} fps · ${seconds} giây`);
  } else {
    enc.stdin.end();
    const code = await enc.done;
    if (code !== 0 || !fs.existsSync(tmpOut)) throw new Error(`ffmpeg không mã hoá được video${enc.stderrText ? `: ${enc.stderrText.trim().split('\n').pop()}` : ''}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(tmpOut, out);
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`Đã xuất ${rel} · ${wantGif ? 'GIF' : 'MP4 H.264'} ${wantGif ? Math.min(W, 960) : W}px · ${fps} fps · ${seconds} giây · ${total} khung · ${kb} KB`);
  }
} catch (e) {
  console.error(`Lỗi: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (enc && enc.exitCode == null) enc.kill();
  if (ws?.readyState === WebSocket.OPEN) await Promise.race([send('Browser.close').catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  try { ws?.close(); } catch {}
  proc.kill();
  await new Promise((r) => setTimeout(r, 500)); // chờ trình duyệt nhả file hồ sơ rồi mới xoá
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
