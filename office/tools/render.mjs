#!/usr/bin/env node
// Xuất PNG hoặc PDF từ file HTML/SVG trong outputs/ bằng Edge/Chrome chạy ẩn (headless).
// Chỉ đọc file trong outputs/, chỉ ghi .png/.pdf vào outputs/, tham số trình duyệt cố định —
// nên có thể cấp quyền riêng cho công cụ này thay vì cho agent chạy msedge.exe tuỳ ý.
//
//   node office/tools/render.mjs outputs/<taskId>/poster.html                    → poster.png
//   node office/tools/render.mjs outputs/<taskId>/poster.html --pdf              → poster.pdf (đúng khổ thiết kế)
//   node office/tools/render.mjs outputs/<taskId>/poster.html --pdf --page a4    → PDF khổ A4, tự co nội dung
//   node office/tools/render.mjs outputs/<taskId>/poster.svg --scale 2 --out outputs/<taskId>/poster@2x.png
//
// Khổ thiết kế: --size WxH, hoặc <meta name="poster-size" content="WxH"> trong HTML, hoặc width/height của SVG,
// hoặc cặp width/height (px) đầu tiên trong CSS của HTML. Không đoán được thì dùng 1080x1350.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
const scaleArg = opt('--scale');
const outArg = opt('--out');
const pageArg = opt('--page');
const wantPdf = flag('--pdf') || /\.pdf$/i.test(outArg || '');
const input = args[0];
if (!input) fail('thiếu file. Dùng: node office/tools/render.mjs outputs/<taskId>/poster.html [--pdf] [--page a4] [--size 1080x1350] [--scale 2] [--out outputs/.../x.png]');

const src = inOutputs(input);
if (!src) fail('chỉ xuất được file nằm trong thư mục outputs/');
if (!/\.(html?|svg)$/i.test(src)) fail('chỉ hỗ trợ file .html hoặc .svg');
if (!fs.existsSync(src)) fail(`không thấy file ${input}`);

const ext = wantPdf ? '.pdf' : '.png';
const out = outArg ? inOutputs(outArg) : src.replace(/\.(html?|svg)$/i, ext);
if (!out || path.extname(out).toLowerCase() !== ext) fail(`file kết quả phải nằm trong outputs/ và có đuôi ${ext}`);

const scale = scaleArg ? Number(scaleArg) : 1;
if (!(scale >= 0.25 && scale <= 4)) fail('--scale phải từ 0.25 đến 4');

// khổ giấy PDF (px ở 96 dpi)
const PAGES = { a5: [559, 794], a4: [794, 1123], a3: [1123, 1587], a2: [1587, 2245], letter: [816, 1056] };
const page = pageArg ? PAGES[pageArg.toLowerCase()] : null;
if (pageArg && !page) fail(`--page chỉ nhận: ${Object.keys(PAGES).join(', ')}`);

// ---- khổ thiết kế ----
const text = fs.readFileSync(src, 'utf8');
function detectSize() {
  if (sizeArg) return sizeArg;
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

// ---- Edge / Chrome ----
export function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    process.env.BROWSER_BIN,
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  ].find((p) => p && fs.existsSync(p));
}
const browser = findBrowser();
if (!browser) fail('không tìm thấy Edge hoặc Chrome trên máy');

// hồ sơ trình duyệt tạm, không đụng tới Edge anh đang mở
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nekoma-render-'));
const tmpOut = path.join(profile, 'out' + ext);
const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--virtual-time-budget=4000'];

let wrapper = null; // file HTML tạm (cùng thư mục để ảnh/font tương đối vẫn tải được) khi in PDF
let res;
try {
  if (wantPdf) {
    const [pw, ph] = page || [W, H];
    const zoom = page ? Math.min(pw / W, ph / H) : 1;
    const pageCss = `<style>@page{size:${pw}px ${ph}px;margin:0}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}${page ? `html{zoom:${zoom}}` : ''}</style>`;
    const html = /\.svg$/i.test(src)
      ? `<!doctype html><html><head><meta charset="utf-8">${pageCss}</head><body><img src="${encodeURIComponent(path.basename(src))}" style="display:block;width:${W}px;height:${H}px"></body></html>`
      : (/<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (h) => h + pageCss) : pageCss + text);
    wrapper = path.join(path.dirname(src), `.render-${process.pid}.html`);
    fs.writeFileSync(wrapper, html, 'utf8');
    res = spawnSync(browser, [...common, `--print-to-pdf=${tmpOut}`, '--no-pdf-header-footer', '--print-to-pdf-no-header', pathToFileURL(wrapper).href],
      { timeout: 120000, windowsHide: true, encoding: 'utf8' });
  } else {
    res = spawnSync(browser, [...common, `--window-size=${W},${H}`, `--force-device-scale-factor=${scale}`, `--screenshot=${tmpOut}`, pathToFileURL(src).href],
      { timeout: 90000, windowsHide: true, encoding: 'utf8' });
  }
  if (!fs.existsSync(tmpOut)) fail(`trình duyệt không xuất được file${res?.error ? ` (${res.error.message})` : ''}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(tmpOut, out);
} finally {
  if (wrapper) fs.rmSync(wrapper, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
const kb = Math.round(fs.statSync(out).size / 1024);
const rel = path.relative(ROOT, out).split(path.sep).join('/');
console.log(wantPdf
  ? `Đã xuất ${rel} · PDF ${page ? pageArg.toUpperCase() : `${W}x${H} px`} · ${kb} KB`
  : `Đã xuất ${rel} · ${Math.round(W * scale)}x${Math.round(H * scale)} px · ${kb} KB`);
