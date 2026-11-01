#!/usr/bin/env node
// Xuất mô hình 3D (GLB / OBJ / STL) + ảnh xem trước PNG từ file mô hình three.js trong outputs/.
// Mô hình chạy trong Edge/Chrome ẩn (sandbox trình duyệt, không đụng được file trên máy);
// công cụ chỉ đọc file trong outputs/ và chỉ ghi kết quả vào outputs/.
//
// File mô hình (ví dụ outputs/<taskId>/cup.model.js):
//   export default function build(THREE) {
//     const g = new THREE.Group();
//     g.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 2, 48), new THREE.MeshStandardMaterial({ color: '#e8582c' })));
//     return g;   // có thể là async; được import thêm 'three/addons/...'
//   }
//
//   node office/tools/export-3d.mjs outputs/<taskId>/cup.model.js                  → cup.glb + cup.obj + cup.png
//   node office/tools/export-3d.mjs outputs/<taskId>/cup.model.js --format stl,glb --no-preview
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUTS = path.join(ROOT, 'outputs');
const fail = (msg) => { console.error(`Lỗi: ${msg}`); process.exit(1); };
const inOutputs = (p) => { const abs = path.resolve(ROOT, p); return abs.startsWith(OUTPUTS + path.sep) ? abs : null; };

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const formats = (opt('--format') || 'glb,obj').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const noPreview = flag('--no-preview');
const input = args[0];
if (!input) fail('thiếu file. Dùng: node office/tools/export-3d.mjs outputs/<taskId>/<tên>.model.js [--format glb,obj,stl] [--no-preview]');
for (const f of formats) if (!['glb', 'obj', 'stl'].includes(f)) fail(`định dạng không hỗ trợ: ${f} (chỉ glb, obj, stl)`);

const src = inOutputs(input);
if (!src) fail('chỉ đọc file nằm trong thư mục outputs/');
if (!/\.model\.(m?js)$/i.test(src)) fail('file mô hình phải có đuôi .model.js');
if (!fs.existsSync(src)) fail(`không thấy file ${input}`);
const base = src.replace(/\.model\.m?js$/i, '');

const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const browser = [
  process.env.BROWSER_BIN,
  path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!browser) fail('không tìm thấy Edge hoặc Chrome trên máy');

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/';
const code = Buffer.from(fs.readFileSync(src, 'utf8'), 'utf8').toString('base64');
const page = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_URL}build/three.module.js","three/addons/":"${THREE_URL}examples/jsm/"}}</script></head>
<body><pre id="out"></pre><script type="module">
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
const out = { ok: false, files: {}, info: {} };
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
try {
  const mod = await import('data:text/javascript;base64,${code}');
  const built = await (mod.default || mod.build)(THREE);
  if (!built || !built.isObject3D) throw new Error('hàm build(THREE) phải trả về một THREE.Object3D (Mesh/Group/Scene)');
  const scene = built.isScene ? built : new THREE.Scene().add(built);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
  let tris = 0; scene.traverse((o) => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  out.info = { size: [size.x, size.y, size.z].map((v) => +v.toFixed(3)), triangles: Math.round(tris) };
  const fmts = ${JSON.stringify(formats)};
  if (fmts.includes('glb')) out.files.glb = b64(await new GLTFExporter().parseAsync(scene, { binary: true }));
  if (fmts.includes('obj')) out.files.obj = btoa(unescape(encodeURIComponent(new OBJExporter().parse(scene))));
  if (fmts.includes('stl')) out.files.stl = b64(new STLExporter().parse(scene, { binary: true }).buffer);
  ${noPreview ? '' : `try {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setSize(1024, 1024); r.setClearColor('#f2ede5');
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const c = box.getCenter(new THREE.Vector3()), d = Math.max(size.x, size.y, size.z) || 1;
    const cam = new THREE.PerspectiveCamera(35, 1, d / 100, d * 100);
    cam.position.copy(c).add(new THREE.Vector3(1.2, 0.9, 1.4).multiplyScalar(d * 1.25)); cam.lookAt(c);
    const view = new THREE.Scene(); view.add(scene);
    view.add(new THREE.HemisphereLight('#fff8ee', '#cbbba4', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(3, 5, 4).multiplyScalar(d); view.add(sun);
    r.render(view, cam);
    out.files.png = r.domElement.toDataURL('image/png').split(',')[1];
  } catch (e) { out.info.previewError = String(e.message || e); }`}
  out.ok = true;
} catch (e) { out.error = String(e && e.stack || e); }
document.getElementById('out').textContent = JSON.stringify(out);
</script></body></html>`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nekoma-3d-'));
const pagePath = path.join(profile, 'export.html');
fs.writeFileSync(pagePath, page, 'utf8');
let res;
try {
  res = spawnSync(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`, '--virtual-time-budget=20000',
    '--dump-dom', pathToFileURL(pagePath).href], { timeout: 120000, windowsHide: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
const raw = (res.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/)?.[1];
if (!raw) fail(`trình duyệt không chạy xong mô hình (kiểm tra mạng để tải three.js)${res.error ? ` — ${res.error.message}` : ''}`);
const unesc = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
let result;
try { result = JSON.parse(unesc); } catch { fail('không đọc được kết quả từ trình duyệt'); }
if (!result.ok) fail(`mô hình bị lỗi:\n${result.error}`);

const written = [];
for (const [ext, data] of Object.entries(result.files)) {
  const file = `${base}.${ext}`;
  if (!inOutputs(path.relative(ROOT, file))) continue;
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  written.push(`${path.relative(ROOT, file).split(path.sep).join('/')} (${Math.max(1, Math.round(fs.statSync(file).size / 1024))} KB)`);
}
const i = result.info;
console.log(`Đã xuất ${written.join(', ')}`);
console.log(`Kích thước mô hình: ${i.size.join(' × ')} · ${i.triangles.toLocaleString('vi-VN')} tam giác${i.previewError ? ` · không tạo được ảnh xem trước (${i.previewError})` : ''}`);
