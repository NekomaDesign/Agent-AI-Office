// Xem file nhân viên gửi ngay trong web chat: ảnh, video, SVG, HTML, Markdown, script.
// Kèm nút tải file gốc, tải cả bộ .zip và mở thư mục trên máy. File phục vụ từ outputs/ qua server.mjs.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FILE_RE = /outputs\/[^\s"'`<>()[\]]+/g;
const IMG = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const VID = /\.(mp4|webm|mov)$/i;
const AUD = /\.(mp3|wav|ogg)$/i;
const HTML = /\.html?$/i;
const DOC = /\.(md|txt|py|jsx|js|csv|json)$/i;
const PDF = /\.pdf$/i;
const M3D = /\.(glb|gltf|obj|stl)$/i;
const isDir = (p) => p.endsWith('/') || !/\.[a-z0-9]{1,5}$/i.test(p);

export const fileUrl = (p, download) => `./files/${p.split('/').map(encodeURIComponent).join('/')}${download ? '?download' : ''}`;
const zipUrl = (p) => `./api/zip?dir=${encodeURIComponent(p.replace(/\/+$/, ''))}`;
const baseName = (p) => p.replace(/\/+$/, '').split('/').pop();
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Các file một tin nhắn gửi kèm: trường "files" + mọi đường dẫn outputs/… trong nội dung
export function filesOf(m) {
  const set = new Set(Array.isArray(m.files) ? m.files.map(String) : []);
  for (const x of String(m.text || '').match(FILE_RE) || []) set.add(x.replace(/[.,;:!?…]+$/, ''));
  return [...set].filter((p) => p.startsWith('outputs/') && !p.includes('..'));
}

function actions(p) {
  const dl = isDir(p)
    ? `<a class="att-btn" href="${zipUrl(p)}" download>⬇ Tải cả bộ .zip</a>`
    : `<a class="att-btn" href="${fileUrl(p, true)}" download>⬇ Tải file gốc</a>`;
  return `<span class="att-acts">${dl}<button type="button" class="att-btn" data-open="${esc(p)}">📂 Mở thư mục</button></span>`;
}

function one(p) {
  const name = esc(baseName(p));
  if (isDir(p)) return `<div class="att att-dir" data-dir="${esc(p)}"><header>📁 <b>${name}</b><small class="dir-count">đang đọc…</small>${actions(p)}</header><div class="dir-list"></div></div>`;
  if (IMG.test(p)) return `<figure class="att att-img"><img src="${fileUrl(p)}" alt="${name}" loading="lazy" data-file="${esc(p)}"><figcaption><span>🖼 ${name}</span>${actions(p)}</figcaption></figure>`;
  if (VID.test(p)) return `<figure class="att att-vid"><video src="${fileUrl(p)}" controls preload="metadata"></video><figcaption><span>🎬 ${name}</span>${actions(p)}</figcaption></figure>`;
  if (AUD.test(p)) return `<figure class="att att-aud"><audio src="${fileUrl(p)}" controls preload="metadata"></audio><figcaption><span>🎵 ${name}</span>${actions(p)}</figcaption></figure>`;
  if (HTML.test(p)) return `<figure class="att att-html"><div class="html-frame"><iframe src="${fileUrl(p)}" sandbox loading="lazy" title="${name}"></iframe><button type="button" class="html-cover" data-file="${esc(p)}" aria-label="Phóng to"></button></div><figcaption><span>🌐 ${name}</span>${actions(p)}</figcaption></figure>`;
  if (PDF.test(p)) return `<figure class="att att-pdf"><iframe src="${fileUrl(p)}#toolbar=0&navpanes=0&view=FitH" loading="lazy" title="${name}"></iframe><figcaption><span>📕 ${name}</span><button type="button" class="att-btn" data-file="${esc(p)}">⤢ Mở lớn</button>${actions(p)}</figcaption></figure>`;
  // 3D: ảnh xem trước (nếu có <tên>.png cạnh mô hình) + bấm để xoay xem 3D
  if (M3D.test(p)) return `<figure class="att att-3d"><button type="button" class="m3d-cover" data-file="${esc(p)}"><img src="${fileUrl(p.replace(M3D, '.png'))}" alt="" loading="lazy" class="m3d-thumb"><span class="m3d-badge">🧊 Xem 3D · xoay được</span></button><figcaption><span>🧊 ${name}</span>${actions(p)}</figcaption></figure>`;
  if (DOC.test(p)) return `<div class="att att-doc" data-doc="${esc(p)}"><header>📄 <b>${name}</b>${actions(p)}</header><div class="doc-body">Đang tải…</div><button type="button" class="att-btn doc-more" data-file="${esc(p)}">Xem đầy đủ</button></div>`;
  return `<div class="att att-file"><header>📎 <b>${name}</b>${actions(p)}</header></div>`;
}

export function attachHtml(paths) {
  return paths.length ? `<div class="atts">${paths.map(one).join('')}</div>` : '';
}

// ---- tải nội dung (có bộ nhớ đệm ngắn để chat làm mới 3 giây/lần không gọi lại liên tục) ----
const cache = new Map();
async function cached(key, fn, ttl = 15000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.val;
  const val = await fn();
  cache.set(key, { at: Date.now(), val });
  return val;
}
const getText = (p) => cached('t:' + p, async () => { const r = await fetch(fileUrl(p)); if (!r.ok) throw new Error(r.status); return r.text(); });
const getDir = (p) => cached('d:' + p, async () => { const r = await fetch(`./api/files?dir=${encodeURIComponent(p.replace(/\/+$/, ''))}`); if (!r.ok) throw new Error(r.status); return (await r.json()).files; });

function renderDoc(p, text, maxLines) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const cut = maxLines && lines.length > maxLines;
  const shown = (cut ? lines.slice(0, maxLines) : lines).join('\n');
  return (/\.md$/i.test(p) ? `<div class="md">${md(shown)}</div>` : `<pre>${esc(shown)}</pre>`) + (cut ? '<div class="doc-fade"></div>' : '');
}

function dirItems(files) {
  return files.map((f) => {
    const p = f.path;
    if (IMG.test(p)) return `<button type="button" class="dir-thumb" data-file="${esc(p)}" title="${esc(f.name)}"><img src="${fileUrl(p)}" alt="" loading="lazy"><span>${esc(f.name)}</span></button>`;
    const icon = VID.test(p) ? '🎬' : HTML.test(p) ? '🌐' : PDF.test(p) ? '📕' : M3D.test(p) ? '🧊' : DOC.test(p) ? '📄' : '📎';
    return `<span class="dir-file"><button type="button" class="link" data-file="${esc(p)}">${icon} ${esc(f.name)}</button><small>${kb(f.size)}</small><a href="${fileUrl(p, true)}" download title="Tải file gốc">⬇</a></span>`;
  }).join('');
}

// Điền nội dung cho các thẻ file vừa được vẽ (đọc Markdown, liệt kê thư mục)
export function hydrate(root) {
  // ảnh xem trước 3D không có thì ẩn đi, chỉ để nút "Xem 3D"
  root.querySelectorAll('img.m3d-thumb:not([data-ready])').forEach((im) => { im.dataset.ready = '1'; im.addEventListener('error', () => im.remove(), { once: true }); });
  root.querySelectorAll('[data-doc]:not([data-ready])').forEach(async (el) => {
    el.dataset.ready = '1';
    const p = el.dataset.doc;
    try { el.querySelector('.doc-body').innerHTML = renderDoc(p, await getText(p), 14); }
    catch { el.querySelector('.doc-body').innerHTML = '<span class="hint">Chưa đọc được file (có thể đã bị đổi tên hoặc xoá).</span>'; }
  });
  root.querySelectorAll('[data-dir]:not([data-ready])').forEach(async (el) => {
    el.dataset.ready = '1';
    const p = el.dataset.dir;
    try {
      const files = await getDir(p);
      el.querySelector('.dir-count').textContent = files.length ? `${files.length} file` : 'chưa có file';
      el.querySelector('.dir-list').innerHTML = dirItems(files);
    } catch { el.querySelector('.dir-count').textContent = 'không đọc được'; }
  });
}

// ---- cửa sổ xem phóng to ----
let modal = null;
function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  modal.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><button type="button" class="modal-x" aria-label="Đóng">×</button><div class="modal-body"></div></div>';
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.modal-x')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  document.body.appendChild(modal);
  return modal;
}
export function closeModal() { if (modal) { modal.hidden = true; modal.querySelector('.modal-body').innerHTML = ''; } }
export function openModal(html, wide) {
  const m = ensureModal();
  m.querySelector('.modal-card').classList.toggle('wide', !!wide);
  const body = m.querySelector('.modal-body');
  body.innerHTML = html;
  m.hidden = false;
  hydrate(body);
  return body;
}

export async function openViewer(p) {
  const name = esc(baseName(p));
  const head = `<div class="viewer-head"><b>${isDir(p) ? '📁' : '📄'} ${name}</b><small>${esc(p)}</small>${actions(p)}</div>`;
  if (isDir(p)) return openModal(head + one(p), true);
  if (IMG.test(p)) return openModal(head + `<div class="viewer-media"><img src="${fileUrl(p)}" alt="${name}"></div>`, true);
  if (VID.test(p)) return openModal(head + `<div class="viewer-media"><video src="${fileUrl(p)}" controls autoplay></video></div>`, true);
  if (HTML.test(p)) return openModal(head + `<iframe class="viewer-frame" src="${fileUrl(p)}" sandbox title="${name}"></iframe>`, true);
  if (PDF.test(p)) return openModal(head + `<iframe class="viewer-frame" src="${fileUrl(p)}" title="${name}"></iframe>`, true);
  if (M3D.test(p)) {
    const body = openModal(head + '<div class="viewer-3d"><span class="hint">Đang tải mô hình 3D…</span></div><p class="hint">Kéo để xoay · lăn chuột để phóng to · chuột phải để dời</p>', true);
    return show3D(body.querySelector('.viewer-3d'), p);
  }
  const body = openModal(head + '<div class="viewer-doc">Đang tải…</div>', true);
  try { body.querySelector('.viewer-doc').innerHTML = renderDoc(p, await getText(p)); }
  catch { body.querySelector('.viewer-doc').innerHTML = '<span class="hint">Không đọc được file này trên web — anh bấm "Tải file gốc" để mở bằng phần mềm trên máy.</span>'; }
}

// Trình xem 3D trong cửa sổ: GLB/GLTF/OBJ/STL, xoay bằng chuột. Dừng vẽ khi đóng cửa sổ.
async function show3D(box, p) {
  try {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const ext = p.split('.').pop().toLowerCase();
    let object;
    if (ext === 'glb' || ext === 'gltf') {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      object = (await new GLTFLoader().loadAsync(fileUrl(p))).scene;
    } else if (ext === 'obj') {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      object = await new OBJLoader().loadAsync(fileUrl(p));
      object.traverse((o) => { if (o.isMesh && (!o.material || o.material.type === 'MeshPhongMaterial')) o.material = new THREE.MeshStandardMaterial({ color: '#d9cfc0', roughness: 0.6 }); });
    } else {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      const geo = await new STLLoader().loadAsync(fileUrl(p));
      geo.computeVertexNormals();
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#d9cfc0', roughness: 0.6 }));
    }
    box.innerHTML = '';
    const w = box.clientWidth || 800, h = Math.min(window.innerHeight - 220, 620);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor('#f2ede5');
    box.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(object);
    scene.add(new THREE.HemisphereLight('#fff8ee', '#cbbba4', 1.5));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    scene.add(sun);
    const bbox = new THREE.Box3().setFromObject(object);
    const c = bbox.getCenter(new THREE.Vector3()), size = bbox.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) || 1;
    sun.position.set(3, 5, 4).multiplyScalar(d);
    const cam = new THREE.PerspectiveCamera(35, w / h, d / 100, d * 100);
    cam.position.copy(c).add(new THREE.Vector3(1.2, 0.9, 1.4).multiplyScalar(d * 1.25));
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.copy(c); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
    renderer.domElement.addEventListener('pointerdown', () => (controls.autoRotate = false), { once: true });
    let tris = 0; object.traverse((o) => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    box.insertAdjacentHTML('beforeend', `<small class="m3d-info">${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} · ${Math.round(tris).toLocaleString('vi-VN')} tam giác</small>`);
    const loop = () => {
      if (!box.isConnected) { renderer.dispose(); return; } // cửa sổ đã đóng
      controls.update(); renderer.render(scene, cam); requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    box.innerHTML = `<span class="hint">Không mở được mô hình 3D (${esc(e.message || e)}). Anh bấm "Tải file gốc" để mở bằng phần mềm 3D trên máy.</span>`;
  }
}

// Markdown tối giản (báo cáo của Lue, file .md nhân viên gửi)
export function md(src = '') {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let html = '', list = null, code = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    if (/^```/.test(l)) { if (code === null) { close(); code = ''; } else { html += `<pre>${esc(code)}</pre>`; code = null; } continue; }
    if (code !== null) { code += l + '\n'; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { close(); const n = Math.min(m[1].length, 3); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (/^\s*\|/.test(l)) { close(); if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) html += `<div class="md-row">${l.split('|').slice(1, -1).map((c) => `<span>${inline(c.trim())}</span>`).join('')}</div>`; }
    else if (!l.trim()) close();
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  if (code !== null) html += `<pre>${esc(code)}</pre>`;
  close();
  return html;
}
