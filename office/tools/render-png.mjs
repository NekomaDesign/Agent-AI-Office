#!/usr/bin/env node
// Xuất PNG từ file HTML/SVG trong outputs/ bằng Edge/Chrome chạy ẩn (headless).
// Chỉ đọc file trong outputs/, chỉ ghi PNG vào outputs/, tham số trình duyệt cố định —
// nên có thể cấp quyền riêng cho công cụ này thay vì cho agent chạy msedge.exe tuỳ ý.
//
//   node office/tools/render-png.mjs outputs/<taskId>/poster.html
//   node office/tools/render-png.mjs outputs/<taskId>/poster.svg --size 1080x1350 --scale 2 --out outputs/<taskId>/poster@2x.png
//
// Khổ ảnh: --size WxH, hoặc <meta name="poster-size" content="WxH"> trong HTML, hoặc width/height của SVG,
// hoặc cặp width/height (px) đầu tiên trong CSS của HTML. Không đoán được thì dùng 1080x1350.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUTS = path.join(ROOT, 'outputs');
const fail = (msg) => { console.error(`Lỗi: ${msg}`); process.exit(1); };

function inOutputs(p) {
  const abs = path.resolve(ROOT, p);
  return abs.startsWith(OUTPUTS + path.sep) ? abs : null;
}

// ---- đọc tham số ----
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const sizeArg = opt('--size');
const scaleArg = opt('--scale');
const outArg = opt('--out');
const input = args[0];
if (!input) fail('thiếu file. Dùng: node office/tools/render-png.mjs outputs/<taskId>/poster.html [--size 1080x1350] [--scale 2] [--out outputs/.../x.png]');

const src = inOutputs(input);
if (!src) fail('chỉ xuất được file nằm trong thư mục outputs/');
if (!/\.(html?|svg)$/i.test(src)) fail('chỉ hỗ trợ file .html hoặc .svg');
if (!fs.existsSync(src)) fail(`không thấy file ${input}`);

const out = outArg ? inOutputs(outArg) : src.replace(/\.(html?|svg)$/i, '.png');
if (!out || !/\.png$/i.test(out)) fail('file PNG phải nằm trong outputs/ và có đuôi .png');

const scale = scaleArg ? Number(scaleArg) : 1;
if (!(scale >= 0.25 && scale <= 4)) fail('--scale phải từ 0.25 đến 4');

// ---- khổ ảnh ----
function detectSize() {
  if (sizeArg) return sizeArg;
  const text = fs.readFileSync(src, 'utf8');
  const meta = text.match(/<meta[^>]+name=["']poster-size["'][^>]+content=["'](\d+)\s*x\s*(\d+)["']/i);
  if (meta) return `${meta[1]}x${meta[2]}`;
  if (/\.svg$/i.test(src)) {
    const tag = text.match(/<svg[^>]*>/i)?.[0] || '';
    const w = tag.match(/\swidth=["']([\d.]+)(px)?["']/i)?.[1];
    const h = tag.match(/\sheight=["']([\d.]+)(px)?["']/i)?.[1];
    if (w && h) return `${Math.round(w)}x${Math.round(h)}`;
    const vb = tag.match(/viewBox=["'][\d.\s-]+?\s([\d.]+)\s+([\d.]+)["']/i);
    if (vb) return `${Math.round(vb[1])}x${Math.round(vb[2])}`;
  } else {
    const css = text.match(/width:\s*(\d{3,5})px;\s*height:\s*(\d{3,5})px/i);
    if (css) return `${css[1]}x${css[2]}`;
  }
  return '1080x1350';
}
const m = /^(\d{2,5})x(\d{2,5})$/i.exec(detectSize());
if (!m) fail('--size phải dạng RỘNGxCAO, ví dụ 1080x1350');
const [W, H] = [Number(m[1]), Number(m[2])];
if (W > 8000 || H > 8000) fail('khổ tối đa 8000x8000 px');

// ---- tìm Edge / Chrome ----
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

// ---- chụp ----
// hồ sơ trình duyệt tạm, không đụng tới Edge anh đang mở
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nekoma-render-'));
const tmpPng = path.join(profile, 'shot.png');
const res = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, `--force-device-scale-factor=${scale}`,
  '--virtual-time-budget=4000', // chờ font/ảnh tải xong
  `--screenshot=${tmpPng}`, pathToFileURL(src).href,
], { timeout: 90000, windowsHide: true, encoding: 'utf8' });

try {
  if (!fs.existsSync(tmpPng)) fail(`trình duyệt không xuất được ảnh${res.error ? ` (${res.error.message})` : ''}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(tmpPng, out);
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`Đã xuất ${path.relative(ROOT, out).split(path.sep).join('/')} · ${Math.round(W * scale)}x${Math.round(H * scale)} px · ${kb} KB`);
