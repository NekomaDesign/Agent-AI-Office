// Văn phòng 3D: phòng cắt lớp kiểu "dollhouse", ánh sáng mềm, mỗi agent một góc theo nghề.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AGENTS, CD, PEOPLE, STATES } from './agents.js';

// ---------- Bảng màu (lấy cảm hứng từ reference: kem ấm, cam, xanh lá, đỏ kệ, vàng) ----------
const P = {
  floor: '#e9e2d6', slab: '#d9cfc0', slabDark: '#c9bead', wall: '#f6f2ec', trim: '#e4dbcf',
  wood: '#c09066', woodDark: '#8d6442', black: '#26241f', white: '#fbf9f5', cream: '#efe4cf',
  orange: '#e8582c', green: '#2f7a50', red: '#d73c2c', yellow: '#f2c230', blue: '#3a5bd9',
  grey: '#bdb5a9', metal: '#a7abb0', leaf: '#3f8a4f', leafDark: '#2d6b3c', pot: '#e9e3d8',
  skin: '#efc4a0', pants: '#3b3e48',
};

const ROOM = { w: 22, d: 16, wallH: 4.4, wallT: 0.3, slab: 0.75 };
const X0 = -ROOM.w / 2, X1 = ROOM.w / 2, Z0 = -ROOM.d / 2, Z1 = ROOM.d / 2;
const PLATFORM = { x0: 5.2, x1: X1, z0: Z0, z1: -2.4, h: 0.9 };

// Vị trí ghế của từng người + hướng nhìn (yaw: 0 = nhìn vào tường sau, π/2 = nhìn tường trái, π = nhìn ra ngoài)
const STATIONS = {
  kuma:  { x: -8.0, y: 0, z: -6.65, yaw: 0 },
  brief: { x: -3.6, y: 0, z: -6.65, yaw: 0 },
  ink:   { x: -9.65, y: 0, z: -1.6, yaw: Math.PI / 2 },
  pixel: { x: -6.2, y: 0, z: 3.35, yaw: 0 },
  cube:  { x: 0.4, y: 0, z: 0.9, yaw: 0 },
  frame: { x: 4.4, y: 0, z: 2.4, yaw: 0 },
  cd:    { x: 8.3, y: PLATFORM.h, z: -5.3, yaw: Math.PI },
};

// ---------- tiện ích dựng hình ----------
const _mats = new Map();
function M(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }));
  return _mats.get(key);
}
function shade(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function box(w, h, d, color, o = {}) {
  const r = Math.min(o.r ?? 0.035, Math.min(w, h, d) / 2 - 0.002);
  const g = r > 0.006 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return shade(new THREE.Mesh(g, o.mat || M(color, o.m)));
}
function cyl(rt, rb, h, color, o = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 24);
  g.translate(0, h / 2, 0);
  return shade(new THREE.Mesh(g, o.mat || M(color, o.m)));
}
function sph(r, color, o = {}) {
  return shade(new THREE.Mesh(new THREE.SphereGeometry(r, o.seg || 24, o.seg ? o.seg * 0.7 : 16), o.mat || M(color, o.m)));
}
function capsule(r, len, mat) {
  return shade(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat));
}
function put(o, x, y, z, ry = 0) { o.position.set(x, y, z); o.rotation.y = ry; return o; }
function grp(...kids) { const g = new THREE.Group(); kids.forEach((k) => g.add(k)); return g; }

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, ctx, canvas: c };
}
function texPlane(w, h, tex, o = {}) {
  const mat = o.basic
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: !!o.transparent, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: o.rough ?? 0.9, transparent: !!o.transparent, alphaTest: o.transparent ? 0.02 : 0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = !o.basic;
  return m;
}

const FONT = "'Be Vietnam Pro', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ======================================================================
export function createWorld(container, { onSelect, onOpenChat }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'label-layer';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  // Camera isometric
  const FRUSTUM = 24;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  const HOME = { target: new THREE.Vector3(0.4, 1.3, 0.2), offset: new THREE.Vector3(34, 30, 34), zoom: 1 };
  camera.position.copy(HOME.target).add(HOME.offset);
  camera.zoom = HOME.zoom;

  const controls = new OrbitControls(camera, labels.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minZoom = 0.6; controls.maxZoom = 4;
  controls.minPolarAngle = 0.62; controls.maxPolarAngle = 1.2;
  controls.minAzimuthAngle = Math.PI / 4 - 0.65; controls.maxAzimuthAngle = Math.PI / 4 + 0.65;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.update();

  // Ánh sáng
  scene.add(new THREE.HemisphereLight('#fff8ee', '#d8c9b4', 1.15));
  const sun = new THREE.DirectionalLight('#fff0db', 2.4);
  sun.position.set(-9, 26, 16);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#ffe2c4', 0.5);
  fill.position.set(20, 10, 4);
  scene.add(fill);

  const world = new THREE.Group();
  scene.add(world);
  const tickers = []; // hàm cập nhật mỗi frame

  buildRoom(world, tickers);
  const board = buildBigScreen(world);
  buildDecor(world, tickers);
  const lounge = buildLounge(world);

  // Nhãn "Phòng hội thoại" trên khu lounge
  const loungeTag = document.createElement('button');
  loungeTag.className = 'zone-tag';
  loungeTag.innerHTML = '<span class="zt-eyebrow">KHU H</span><b>Phòng hội thoại</b><span class="zt-count">0 tin</span>';
  loungeTag.addEventListener('click', () => onOpenChat && onOpenChat());
  const loungeLabel = new CSS2DObject(loungeTag);
  loungeLabel.position.set(lounge.x, 2.6, lounge.z);
  world.add(loungeLabel);

  // Trạm làm việc
  const stations = {};
  for (const person of [...AGENTS, CD]) {
    stations[person.id] = buildStation(person, STATIONS[person.id], world, onSelect);
  }

  // ---------- chọn bằng click trên mô hình ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  labels.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  labels.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(Object.values(stations).map((s) => s.root), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.personId) o = o.parent;
      if (o) { onSelect(o.userData.personId); return; }
    }
  });

  // ---------- camera focus ----------
  let anim = null;
  function flyTo(target, zoom) {
    anim = { t: 0, fromT: controls.target.clone(), toT: target.clone(), fromZ: camera.zoom, toZ: zoom, fromP: camera.position.clone() };
  }
  const api = {
    focusPerson(id) {
      const s = stations[id]; if (!s) return;
      const p = new THREE.Vector3(); s.root.getWorldPosition(p);
      p.y += 1.1;
      flyTo(p, 2.3);
    },
    focusBoard() { flyTo(new THREE.Vector3(board.pos.x, board.pos.y - 0.4, board.pos.z + 2), 2.4); },
    resetView() {
      anim = { t: 0, fromT: controls.target.clone(), toT: HOME.target.clone(), fromZ: camera.zoom, toZ: HOME.zoom, fromP: camera.position.clone(), toP: HOME.target.clone().add(HOME.offset) };
    },
    select(id) { for (const [k, s] of Object.entries(stations)) s.setSelected(k === id); },
    update(data) {
      for (const a of AGENTS) stations[a.id].setStatus(data.agents[a.id]);
      const anyWorking = AGENTS.some((a) => data.agents[a.id].state === 'working');
      const waiting = AGENTS.filter((a) => data.agents[a.id].state === 'waiting_review').length;
      stations.cd.setStatus({ state: waiting ? 'waiting_review' : anyWorking ? 'working' : 'idle', cd: true, waiting });
      board.setData(data);
      const total = Object.values(data.chats).reduce((n, c) => n + c.length, 0);
      loungeTag.querySelector('.zt-count').textContent = `${total} tin`;
    },
    say(id, text) { stations[id] && stations[id].say(text); },
    setPaused(p) { paused = p; labels.domElement.style.visibility = p ? 'hidden' : 'visible'; },
  };

  // ---------- resize + loop ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    const aspect = w / Math.max(h, 1);
    const f = aspect < 1 ? FRUSTUM * 1.35 : FRUSTUM;
    camera.left = (-f * aspect) / 2; camera.right = (f * aspect) / 2;
    camera.top = f / 2; camera.bottom = -f / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let paused = false;
  const clock = new THREE.Clock();
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / 0.9);
      const k = ease(anim.t);
      const tgt = anim.fromT.clone().lerp(anim.toT, k);
      if (anim.toP) camera.position.copy(anim.fromP.clone().lerp(anim.toP, k));
      else camera.position.copy(anim.fromP.clone().add(tgt.clone().sub(anim.fromT)));
      controls.target.copy(tgt);
      camera.zoom = THREE.MathUtils.lerp(anim.fromZ, anim.toZ, k);
      camera.updateProjectionMatrix();
      if (anim.t >= 1) anim = null;
    }
    controls.update();
    if (paused) return;
    for (const f of tickers) f(t, dt);
    for (const s of Object.values(stations)) s.tick(t, dt);
    board.tick(t);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return api;
}

// ======================================================================
// PHÒNG
function buildRoom(world, tickers) {
  const T = ROOM.wallT;
  // Đế phòng (slab) + sàn
  const slab = box(ROOM.w + T, ROOM.slab, ROOM.d + T, P.slab, { r: 0.12 });
  put(slab, -T / 2, -ROOM.slab, -T / 2);
  world.add(slab);
  const lip = box(ROOM.w + T + 0.06, 0.08, ROOM.d + T + 0.06, P.slabDark, { r: 0.03 });
  put(lip, -T / 2, -ROOM.slab - 0.02, -T / 2);
  world.add(lip);

  const floorTex = canvasTex(1100, 800, (ctx, w, h) => {
    ctx.fillStyle = P.floor; ctx.fillRect(0, 0, w, h);
    // vệt bê tông mài nhẹ
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '160,140,115'},${Math.random() * 0.05})`;
      const r = Math.random() * 9 + 1;
      ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150,130,105,0.16)'; ctx.lineWidth = 1.5;
    const step = w / 11;
    for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  });
  const floor = texPlane(ROOM.w, ROOM.d, floorTex.tex, { rough: 0.55 });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  world.add(floor);

  // Tường sau + tường trái (cắt lớp)
  const back = box(ROOM.w + T, ROOM.wallH, T, P.wall, { r: 0.04 });
  put(back, -T / 2, 0, Z0 - T / 2);
  const left = box(T, ROOM.wallH, ROOM.d, P.wall, { r: 0.04 });
  put(left, X0 - T / 2, 0, 0);
  world.add(back, left);
  // nẹp chân tường + mép trên
  const sb1 = box(ROOM.w, 0.14, 0.04, P.trim, { r: 0.01 }); put(sb1, 0, 0, Z0 + 0.02);
  const sb2 = box(0.04, 0.14, ROOM.d, P.trim, { r: 0.01 }); put(sb2, X0 + 0.02, 0, 0);
  const cap1 = box(ROOM.w + T + 0.04, 0.07, T + 0.04, '#e7ded2', { r: 0.02 }); put(cap1, -T / 2, ROOM.wallH, Z0 - T / 2);
  const cap2 = box(T + 0.04, 0.07, ROOM.d + 0.04, '#e7ded2', { r: 0.02 }); put(cap2, X0 - T / 2, ROOM.wallH, 0);
  world.add(sb1, sb2, cap1, cap2);

  // Biển nền phía trước đế
  const plaque = canvasTex(2048, 64, (ctx, w, h) => {
    ctx.fillStyle = '#c9bead'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6f6455'; ctx.font = `600 30px ${MONO}`; ctx.textBaseline = 'middle';
    ctx.fillText('NEKOMA STUDIO  ·  TẦNG 01  ·  XƯỞNG SẢN XUẤT SÁNG TẠO AI  ·  EST. 2026', 40, h / 2 + 2);
    ctx.textAlign = 'right'; ctx.fillText('A → B → C → D → E → F → G → H', w - 40, h / 2 + 2);
  });
  const front = texPlane(ROOM.w, ROOM.w * 64 / 2048, plaque.tex);
  front.position.set(-T / 2, -ROOM.slab / 2, Z1 + 0.005);
  world.add(front);

  // Cửa sổ tường trái
  buildWindow(world, X0 + 0.01, 2.2, 1.9, Math.PI / 2, 2.6, 2.0);
  // Cửa ra vào màu cam (tường trái)
  const door = box(0.08, 2.5, 1.25, P.orange, { r: 0.02, m: { roughness: 0.6 } });
  put(door, X0 + 0.04, 0, -5.6);
  const knob = sph(0.05, P.metal, { m: { metalness: 0.8, roughness: 0.3 } }); put(knob, X0 + 0.12, 1.2, -5.15);
  const doorFrame = box(0.05, 2.6, 1.4, P.trim, { r: 0.01 }); put(doorFrame, X0 + 0.02, 0, -5.6);
  world.add(doorFrame, door, knob);

  // Biển tên studio trên tường trái
  const sign = canvasTex(1400, 360, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = P.black; ctx.textBaseline = 'alphabetic';
    ctx.font = `800 150px ${FONT}`; ctx.fillText('NEKOMA', 8, 160);
    ctx.font = `800 150px ${FONT}`; ctx.fillStyle = P.orange; ctx.fillText('STUDIO', 8, 300);
    ctx.fillStyle = '#6b6357'; ctx.font = `600 34px ${MONO}`;
    ctx.fillText('CREATIVE AI PRODUCTION LAB · EST. 2026', 640, 290);
  });
  const signMesh = texPlane(4.2, 1.08, sign.tex, { transparent: true });
  signMesh.rotation.y = Math.PI / 2;
  signMesh.position.set(X0 + 0.02, 3.35, -1.6);
  world.add(signMesh);

  // Tầng lửng của Creative Director
  const pf = PLATFORM;
  const pw = pf.x1 - pf.x0, pd = pf.z1 - pf.z0;
  const plat = box(pw, pf.h, pd, '#e2d9cb', { r: 0.05 });
  put(plat, (pf.x0 + pf.x1) / 2, 0, (pf.z0 + pf.z1) / 2);
  const platTop = box(pw - 0.1, 0.02, pd - 0.1, '#c79c70', { r: 0.01, m: { roughness: 0.55 } });
  put(platTop, (pf.x0 + pf.x1) / 2, pf.h, (pf.z0 + pf.z1) / 2);
  world.add(plat, platTop);
  // bậc thang
  for (let i = 0; i < 3; i++) {
    const s = box(1.4, (pf.h / 3) * (i + 1), 0.42, '#d8ccba', { r: 0.03 });
    put(s, 6.2, 0, pf.z1 + 0.42 * (3 - i) - 0.21);
    world.add(s);
  }
  // lan can kính
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#dff1f5', roughness: 0.05, transparent: true, opacity: 0.25, metalness: 0 });
  const rail1 = box(pw - 1.8, 0.75, 0.04, null, { mat: glassMat, r: 0.01 }); rail1.castShadow = false;
  put(rail1, pf.x0 + 1.8 + (pw - 1.8) / 2, pf.h, pf.z1 - 0.05);
  const rail2 = box(0.04, 0.75, pd, null, { mat: glassMat, r: 0.01 }); rail2.castShadow = false;
  put(rail2, pf.x0 + 0.05, pf.h, (pf.z0 + pf.z1) / 2);
  const bar1 = box(pw - 1.8, 0.05, 0.07, P.black, { r: 0.02 }); put(bar1, pf.x0 + 1.8 + (pw - 1.8) / 2, pf.h + 0.75, pf.z1 - 0.05);
  const bar2 = box(0.07, 0.05, pd, P.black, { r: 0.02 }); put(bar2, pf.x0 + 0.05, pf.h + 0.75, (pf.z0 + pf.z1) / 2);
  world.add(rail1, rail2, bar1, bar2);

  // Nhãn khu trên sàn
  const zones = [
    ['G · TRỢ LÝ', -8.0, -5.3, 0], ['A · NHẬN BRIEF', -3.6, -5.3, 0], ['F · BÀN CHỮ', -8.3, -1.6, Math.PI / 2],
    ['C · PHÒNG KÍNH 2D', -6.2, 5.05, 0], ['D · XƯỞNG 3D', 0.4, 2.2, 0], ['E · GÓC MOTION', 4.4, 3.7, 0],
    ['H · PHÒNG HỘI THOẠI', 7.4, 7.55, 0],
  ];
  for (const [txt, x, z, ry] of zones) {
    const t = canvasTex(512, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(80,68,52,0.55)'; ctx.font = `700 30px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(txt, w / 2, h / 2);
    });
    const m = texPlane(2.4, 0.3, t.tex, { transparent: true });
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry;
    m.position.set(x, 0.01, z);
    m.receiveShadow = true;
    world.add(m);
    (world.userData.zoneDecals ||= []).push(t);
  }
}

function buildWindow(world, x, y, z, ry, w, h) {
  const g = new THREE.Group();
  const frame = box(w + 0.2, h + 0.2, 0.08, P.white, { r: 0.02 }); frame.position.y = -0.1;
  const sky = canvasTex(256, 256, (ctx, cw, ch) => {
    const gr = ctx.createLinearGradient(0, 0, 0, ch);
    gr.addColorStop(0, '#bfe0f0'); gr.addColorStop(0.65, '#f4e6cf'); gr.addColorStop(1, '#f9d9b0');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(70,130,80,0.75)';
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(20 + i * 30, ch - 20 - Math.random() * 30, 26, 46, 0, 0, Math.PI * 2); ctx.fill(); }
  });
  const pane = texPlane(w, h, sky.tex, { basic: true });
  pane.position.set(0, h / 2 - 0.1 + 0.1, 0.045);
  g.add(frame, pane);
  for (const xx of [-w / 6, w / 6]) { const mull = box(0.05, h, 0.04, P.white, { r: 0.01 }); put(mull, xx, -0.0, 0.06); g.add(mull); }
  const mullH = box(w, 0.05, 0.04, P.white, { r: 0.01 }); put(mullH, 0, h * 0.55, 0.06); g.add(mullH);
  const sill = box(w + 0.4, 0.06, 0.25, P.white, { r: 0.02 }); put(sill, 0, -0.14, 0.12); g.add(sill);
  // rèm cuốn
  const blind = box(w + 0.1, 0.45, 0.06, '#f7f3ea', { r: 0.02 }); put(blind, 0, h - 0.4, 0.12); g.add(blind);
  g.position.set(x, y - h / 2, z);
  g.rotation.y = ry;
  world.add(g);
}

// ======================================================================
// MÀN HÌNH LỚN — bảng công việc
function buildBigScreen(world) {
  const W = 5.6, H = 2.8;
  const pos = new THREE.Vector3(1.55, 2.55, Z0 + 0.12);
  const bezel = box(W + 0.18, H + 0.18, 0.12, '#1b1c20', { r: 0.05, m: { roughness: 0.4 } });
  put(bezel, pos.x, pos.y - H / 2 - 0.09, Z0 + 0.06);
  world.add(bezel);
  const cv = canvasTex(1600, 800, () => {});
  const screen = texPlane(W, H, cv.tex, { basic: true });
  screen.position.set(pos.x, pos.y, Z0 + 0.125);
  world.add(screen);
  // bệ dưới
  const shelf = box(W * 0.6, 0.08, 0.35, P.wood, { r: 0.02 }); put(shelf, pos.x, pos.y - H / 2 - 0.55, Z0 + 0.17);
  world.add(shelf);

  let data = null;
  let last = 0;
  const { ctx } = cv;
  function draw(t) {
    const w = 1600, h = 800;
    ctx.fillStyle = '#16171c'; ctx.fillRect(0, 0, w, h);
    // header
    ctx.fillStyle = '#f2c230'; ctx.fillRect(48, 50, 14, 52);
    ctx.fillStyle = '#ffffff'; ctx.font = `800 46px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText(`${(data?.studio?.name || 'NEKOMA STUDIO').toUpperCase()} — VIỆC ĐANG LÀM`, 84, 78);
    const now = new Date();
    ctx.textAlign = 'right'; ctx.font = `700 40px ${MONO}`; ctx.fillStyle = '#f2c230';
    ctx.fillText(now.toLocaleTimeString('vi-VN', { hour12: false }), w - 50, 78);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `600 22px ${MONO}`;
    const cols = [60, 330, 1010, 1260];
    ['NGƯỜI LÀM', 'VIỆC', 'TRẠNG THÁI', 'TIẾN ĐỘ'].forEach((c, i) => ctx.fillText(c, cols[i], 150));
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(48, 172, w - 96, 2);

    const order = { working: 0, blocked: 1, waiting_review: 2, idle: 3, done: 4 };
    const tasks = (data?.tasks || []).slice().sort((a, b) => (order[a.state] - order[b.state]) || String(b.updated || '').localeCompare(String(a.updated || ''))).slice(0, 6);
    if (!tasks.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `700 40px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('Chưa có việc nào', w / 2, 370);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `500 28px ${FONT}`;
      ctx.fillText(`Cả team đang rảnh — chờ anh ${data?.studio?.director || 'Nekoma'} giao việc`, w / 2, 425);
      ctx.textAlign = 'left';
    }
    tasks.forEach((tk, i) => {
      const y = 228 + i * 78;
      const who = PEOPLE[tk.assignee] || { name: tk.assignee || '—', color: '#888' };
      const st = STATES[tk.state] || STATES.idle;
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(48, y - 36, w - 96, 74); }
      ctx.fillStyle = who.color; roundRect(ctx, 60, y - 22, 44, 44, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 24px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(who.name[0] || '?', 82, y + 1); ctx.textAlign = 'left';
      ctx.font = `700 30px ${FONT}`; ctx.fillText(who.name, 120, y);
      ctx.font = `500 28px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(fit(ctx, `${tk.project ? tk.project + ' · ' : ''}${tk.title || tk.id}`, 640), cols[1], y);
      // pill trạng thái
      ctx.font = `700 22px ${MONO}`;
      const pw = ctx.measureText(st.label).width + 44;
      ctx.fillStyle = st.color; roundRect(ctx, cols[2], y - 21, pw, 42, 21); ctx.fill();
      ctx.fillStyle = tk.state === 'idle' ? '#fff' : '#16171c';
      ctx.fillText(st.label, cols[2] + 22, y + 1);
      // thanh tiến độ
      const bw = 220, p = (tk.progress || 0) / 100;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(ctx, cols[3], y - 8, bw, 16, 8); ctx.fill();
      if (p > 0) { ctx.fillStyle = st.color; roundRect(ctx, cols[3], y - 8, Math.max(16, bw * p), 16, 8); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.font = `700 24px ${MONO}`; ctx.fillText(`${Math.round(p * 100)}%`, cols[3] + bw + 18, y + 1);
    });

    // ticker
    ctx.fillStyle = '#f2c230'; ctx.fillRect(0, h - 70, w, 70);
    ctx.save(); ctx.beginPath(); ctx.rect(0, h - 70, w, 70); ctx.clip();
    const items = [];
    for (const a of AGENTS) {
      const s = data?.agents?.[a.id];
      if (s) items.push(`${a.name.toUpperCase()} · ${STATES[s.state].label}${s.state === 'working' ? ' ' + s.progress + '%' : ''}`);
    }
    const msg = items.join('   ◆   ') + '   ◆   ';
    ctx.fillStyle = '#16171c'; ctx.font = `700 28px ${MONO}`;
    const mw = ctx.measureText(msg).width || 1;
    let x = -((t * 90) % mw);
    while (x < w) { ctx.fillText(msg, x, h - 34); x += mw; }
    ctx.restore();
    cv.tex.needsUpdate = true;
  }
  function fit(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }
  return {
    pos,
    setData(d) { data = d; },
    tick(t) { if (t - last > 1 / 15) { last = t; draw(t); } },
  };
}

// ======================================================================
// ĐỒ TRANG TRÍ
function plant(scale = 1, potColor = P.pot) {
  const g = new THREE.Group();
  const pot = cyl(0.26, 0.2, 0.5, potColor, { m: { roughness: 0.6 } });
  g.add(pot);
  const soil = cyl(0.24, 0.24, 0.02, '#5a4334'); soil.position.y = 0.46; g.add(soil);
  const leafMat = [M(P.leaf, { roughness: 0.7 }), M(P.leafDark, { roughness: 0.7 })];
  for (let i = 0; i < 9; i++) {
    const l = shade(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), leafMat[i % 2]));
    l.scale.set(0.45, 1.6, 0.18);
    const a = (i / 9) * Math.PI * 2;
    l.position.set(Math.cos(a) * 0.18, 0.95 + (i % 3) * 0.15, Math.sin(a) * 0.18);
    l.rotation.set(Math.sin(a) * 0.6, -a, Math.cos(a) * 0.6);
    g.add(l);
  }
  g.scale.setScalar(scale);
  return g;
}

function posterTex(kind) {
  return canvasTex(400, 560, (ctx, w, h) => {
    if (kind === 'circles') {
      ctx.fillStyle = '#efe6d6'; ctx.fillRect(0, 0, w, h);
      const cols = ['#1f2a44', '#e8582c', '#f2c230', '#2f7a50', '#efe6d6'];
      for (let i = 0; i < 8; i++) { ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.arc(w / 2, h * 0.42, 170 - i * 21, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#1f2a44'; ctx.font = `800 40px ${FONT}`; ctx.fillText('RHYTHM', 30, h - 40);
    } else if (kind === 'swatch') {
      ctx.fillStyle = '#f8f5ef'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#26241f'; ctx.font = `800 34px ${FONT}`; ctx.fillText('SWATCH 26', 28, 56);
      const hues = [8, 22, 38, 50, 140, 175, 210, 260, 320, 350];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) {
        ctx.fillStyle = `hsl(${hues[(r + c) % hues.length]}, ${50 + c * 6}%, ${35 + r * 7}%)`;
        ctx.fillRect(28 + c * 58, 88 + r * 62, 50, 54);
      }
    } else if (kind === 'typo') {
      ctx.fillStyle = '#f3efe6'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d1d1f'; ctx.font = `800 110px ${FONT}`;
      ctx.fillText('TYPO', 26, 150); ctx.fillText('GRA', 26, 270); ctx.fillStyle = '#e8582c'; ctx.fillText('PHY', 26, 390);
      ctx.fillStyle = '#1d1d1f'; ctx.font = `500 22px ${MONO}`; ctx.fillText('Be Vietnam Pro — Aa Ăă Ơơ', 28, 470);
    } else if (kind === 'quote') {
      ctx.fillStyle = '#e8582c'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d1d1f'; ctx.font = `800 64px ${FONT}`;
      ['THIẾT KẾ', 'LÀ CÁCH', 'NHÌN', 'THẾ GIỚI'].forEach((l, i) => ctx.fillText(l, 28, 110 + i * 78));
      ctx.font = `600 22px ${MONO}`; ctx.fillText('NEKOMA DESIGN · 2026', 28, h - 34);
    } else if (kind === 'shapes') {
      ctx.fillStyle = '#f6f3ee'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(130, 170, 90, 0, Math.PI); ctx.fill();
      ctx.fillRect(220, 90, 120, 120);
      ctx.beginPath(); ctx.moveTo(60, 470); ctx.bezierCurveTo(140, 300, 260, 520, 340, 330); ctx.lineWidth = 26; ctx.strokeStyle = '#111'; ctx.stroke();
      ctx.beginPath(); ctx.arc(290, 420, 34, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = '#111'; ctx.strokeRect(20, 20, w - 40, h - 40);
    }
  });
}
function framedPoster(kind, w = 1.0, h = 1.4, frameColor = P.black) {
  const g = new THREE.Group();
  const fr = box(w + 0.08, h + 0.08, 0.04, frameColor, { r: 0.01 }); fr.position.y = -(h + 0.08) / 2; g.add(fr);
  const pic = texPlane(w, h, posterTex(kind).tex); pic.position.z = 0.025; g.add(pic);
  return g;
}

function buildDecor(world, tickers) {
  // Kệ đỏ + tranh + đèn neon (tường trái, phía trước)
  const shelf = new THREE.Group();
  const red = P.red;
  for (const yy of [0.1, 0.75, 1.4]) { const s = box(0.55, 0.05, 2.1, red, { r: 0.015, m: { roughness: 0.5 } }); s.position.y = yy; shelf.add(s); }
  for (const zz of [-1.02, 1.02]) for (const xx of [-0.24, 0.24]) { const leg = box(0.04, 1.5, 0.04, red, { r: 0.01 }); put(leg, xx, 0, zz); shelf.add(leg); }
  const books = ['#2f7a50', '#f2c230', '#3a5bd9', '#efe4cf', '#26241f'];
  books.forEach((c, i) => { const b = box(0.32, 0.36 + (i % 2) * 0.06, 0.08, c, { r: 0.01 }); put(b, 0, 0.8, -0.8 + i * 0.1); shelf.add(b); });
  const speaker = box(0.3, 0.38, 0.3, P.yellow, { r: 0.04 }); put(speaker, 0, 0.13, 0.6); shelf.add(speaker);
  const cone = cyl(0.09, 0.09, 0.02, P.black); cone.rotation.x = Math.PI / 2; cone.rotation.z = Math.PI / 2; put(cone, 0.16, 0.32, 0.6); cone.rotation.y = Math.PI / 2; shelf.add(cone);
  const vase = cyl(0.08, 0.1, 0.3, P.cream); put(vase, 0, 1.45, -0.5); shelf.add(vase);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 10, 24, Math.PI), M(P.blue, { roughness: 0.4 }));
  arch.castShadow = true; arch.rotation.y = Math.PI / 2; put(arch, 0, 1.45, 0.4); arch.rotation.y = Math.PI / 2; shelf.add(arch);
  put(shelf, X0 + 0.32, 0, 6.2);
  world.add(shelf);

  const art = framedPoster('shapes', 1.1, 1.5); art.rotation.y = Math.PI / 2; art.position.set(X0 + 0.03, 3.6, 6.7); world.add(art);
  // neon uốn lượn vàng
  const pts = [];
  for (let i = 0; i <= 60; i++) { const k = i / 60; pts.push(new THREE.Vector3(0, 2.0 + k * 1.6, 4.4 + Math.sin(k * Math.PI * 3) * 0.35)); }
  const neon = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.06, 10), new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#ffc21a', emissiveIntensity: 1.2, roughness: 0.4 }));
  neon.position.x = X0 + 0.14; world.add(neon);

  // Poster tường sau, khu Kuma
  const p1 = framedPoster('circles', 0.9, 1.25, P.wood); p1.position.set(-10.0, 3.85, Z0 + 0.03); world.add(p1);

  // Đồng hồ treo tường (chạy theo giờ thật)
  const clock = new THREE.Group();
  const face = cyl(0.42, 0.42, 0.06, P.white, { seg: 40 }); face.rotation.x = Math.PI / 2; clock.add(face);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 10, 40), M(P.black)); clock.add(ring);
  const hourH = box(0.04, 0.24, 0.02, P.black, { r: 0 }); const minH = box(0.03, 0.34, 0.02, P.black, { r: 0 }); const secH = box(0.012, 0.36, 0.02, P.orange, { r: 0 });
  const hp = grp(hourH), mp = grp(minH), sp = grp(secH);
  [hp, mp, sp].forEach((h, i) => { h.position.z = 0.04 + i * 0.012; clock.add(h); });
  clock.position.set(-6.2, 3.55, Z0 + 0.04);
  world.add(clock);
  tickers.push(() => {
    const d = new Date();
    const s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    sp.rotation.z = -(s / 60) * Math.PI * 2; mp.rotation.z = -(m / 60) * Math.PI * 2; hp.rotation.z = -(h / 12) * Math.PI * 2;
  });

  // Lịch treo tường của Kuma
  const cal = canvasTex(360, 420, (ctx, w, h) => {
    const d = new Date();
    ctx.fillStyle = '#fbf9f5'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = P.orange; ctx.fillRect(0, 0, w, 90);
    ctx.fillStyle = '#fff'; ctx.font = `800 40px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText(`THÁNG ${d.getMonth() + 1}`, 24, 46); ctx.font = `600 26px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(String(d.getFullYear()), w - 22, 48); ctx.textAlign = 'center';
    const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    ctx.font = `600 22px ${MONO}`; ctx.fillStyle = '#9a9184';
    ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].forEach((n, i) => ctx.fillText(n, 34 + i * 49, 118));
    for (let i = 1; i <= days; i++) {
      const idx = first + i - 1; const cx = 34 + (idx % 7) * 49; const cy = 160 + Math.floor(idx / 7) * 46;
      if (i === d.getDate()) { ctx.fillStyle = P.orange; ctx.beginPath(); ctx.arc(cx, cy, 19, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; }
      else ctx.fillStyle = '#26241f';
      ctx.font = `600 22px ${MONO}`; ctx.fillText(String(i), cx, cy + 1);
    }
  });
  const calMesh = texPlane(0.9, 1.05, cal.tex); calMesh.position.set(-8.6, 2.55, Z0 + 0.02); world.add(calMesh);

  // Bảng ghim của Brief
  const cork = box(2.0, 1.25, 0.05, '#c69a6b', { r: 0.02, m: { roughness: 0.95 } }); put(cork, -3.6, 1.95, Z0 + 0.02); world.add(cork);
  const noteCols = ['#fff3b0', '#ffd6c2', '#d8f0d2', '#ffffff', '#cfe0ff', '#fff3b0'];
  noteCols.forEach((c, i) => {
    const n = box(0.36, 0.42, 0.01, c, { r: 0 }); n.castShadow = false;
    n.position.set(-4.35 + (i % 3) * 0.72, 2.1 + (i < 3 ? 0.55 : 0) - 0.25, Z0 + 0.075);
    n.rotation.z = (Math.random() - 0.5) * 0.2; world.add(n);
    const pin = sph(0.025, P.red); pin.position.set(n.position.x, n.position.y + 0.36, Z0 + 0.09); world.add(pin);
  });
  // tủ hồ sơ
  const cab = box(0.6, 1.1, 0.6, '#d9d4cb', { r: 0.03, m: { roughness: 0.5 } }); put(cab, -1.6, 0, Z0 + 0.35); world.add(cab);
  for (let i = 0; i < 3; i++) { const h = box(0.24, 0.03, 0.03, P.metal, { r: 0.01, m: { metalness: 0.6, roughness: 0.3 } }); put(h, -1.6, 0.25 + i * 0.32, Z0 + 0.66); world.add(h); }
  const folders = ['#e8582c', '#3a5bd9', '#f2c230']; folders.forEach((c, i) => { const f = box(0.42, 0.05, 0.32, c, { r: 0.01 }); put(f, -1.6, 1.1 + i * 0.05, Z0 + 0.35, i * 0.15); world.add(f); });

  // Moodboard của Creative Director (tường sau, trên tầng lửng)
  const mb = canvasTex(900, 520, (ctx, w, h) => {
    ctx.fillStyle = '#f7f3ec'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26241f'; ctx.font = `800 34px ${FONT}`; ctx.fillText('MOODBOARD · DIRECTION', 30, 54);
    const sw = ['#e8582c', '#f2c230', '#2f7a50', '#efe4cf', '#26241f', '#3a5bd9'];
    sw.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(30 + i * 70, 82, 60, 60); });
    const imgs = [['#d7b48f', '#a0583a'], ['#2f4f44', '#9cc6a8'], ['#f0c46a', '#e8582c'], ['#3a5bd9', '#c9d6ff']];
    imgs.forEach(([a, b], i) => {
      const x = 30 + (i % 2) * 220, y = 170 + Math.floor(i / 2) * 170;
      const g = ctx.createLinearGradient(x, y, x + 200, y + 150); g.addColorStop(0, a); g.addColorStop(1, b);
      ctx.fillStyle = g; ctx.fillRect(x, y, 200, 150);
    });
    ctx.fillStyle = '#26241f'; ctx.font = `800 64px ${FONT}`; ctx.fillText('Aa', 500, 260);
    ctx.font = `500 22px ${MONO}`; ctx.fillText('Be Vietnam Pro / 800', 500, 300);
    ctx.fillStyle = '#e8582c'; ctx.beginPath(); ctx.arc(700, 420, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#26241f'; ctx.font = `600 22px ${MONO}`; ctx.fillText('v2 · đang chốt', 500, 470);
  });
  const mbMesh = texPlane(3.0, 1.73, mb.tex); mbMesh.position.set(8.3, 2.9, Z0 + 0.02); world.add(mbMesh);
  const mbFrame = box(3.1, 1.83, 0.03, P.white, { r: 0.01 }); put(mbFrame, 8.3, 2.9 - 0.915, Z0 + 0.005); world.add(mbFrame);
  // cây trên tầng lửng
  const pl1 = plant(1.15); pl1.position.set(10.4, PLATFORM.h, -7.4); world.add(pl1);
  const pl2 = plant(0.9, P.orange); pl2.position.set(-10.35, 0, -7.4); world.add(pl2);
  const pl3 = plant(1.25); pl3.position.set(-10.3, 0, 7.4); world.add(pl3);
  const pl4 = plant(1.0); pl4.position.set(-1.0, 0, -7.35); world.add(pl4);

  // Khối kính của Pixel (phòng 2D)
  buildGlassRoom(world);

  // Máy quay + softbox của Frame
  const tri = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.02, 0.02, 1.55, P.black); leg.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22); tri.add(leg);
  }
  const cam = box(0.42, 0.3, 0.26, P.black, { r: 0.04 }); cam.position.y = 1.5; tri.add(cam);
  const lens = cyl(0.1, 0.12, 0.25, '#3a3a3e'); lens.rotation.x = Math.PI / 2; lens.position.set(0, 1.65, -0.24); tri.add(lens);
  const rec = sph(0.03, '#ff3b30', { m: { emissive: '#ff3b30', emissiveIntensity: 1.5 } }); rec.position.set(0.15, 1.75, 0.0); tri.add(rec);
  tri.position.set(6.0, 0, 4.2); tri.rotation.y = 0.9;
  world.add(tri);
  tickers.push((t) => { rec.visible = Math.sin(t * 4) > 0; });

  const soft = new THREE.Group();
  const pole = cyl(0.025, 0.025, 2.0, P.black); soft.add(pole);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const f = box(0.5, 0.03, 0.04, P.black, { r: 0 }); f.position.set(Math.cos(a) * 0.22, 0.02, Math.sin(a) * 0.22); f.rotation.y = -a; soft.add(f); }
  const sbox = box(0.9, 0.9, 0.4, '#2a2a2e', { r: 0.03 }); sbox.position.set(0, 1.7, 0); soft.add(sbox);
  const diff = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6e6', emissiveIntensity: 0.9 }));
  diff.position.set(0, 2.15, 0.205); soft.add(diff);
  soft.position.set(2.2, 0, 3.6); soft.rotation.y = 0.5;
  world.add(soft);

  // Vài khối lơ lửng quanh phòng (như mô hình kiến trúc)
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 0.2 });
  const floaters = [[13, 3, -4], [-14, 2, 9], [12, -1, 11], [-6, 6.5, -10]].map(([x, y, z], i) => {
    const m = box(0.5, 0.5, 0.5, null, { mat: glass, r: 0.04 }); m.castShadow = false;
    m.position.set(x, y, z); m.rotation.set(0.4, i, 0.2); world.add(m); return m;
  });
  tickers.push((t) => floaters.forEach((m, i) => { m.position.y += Math.sin(t * 0.8 + i) * 0.002; m.rotation.y += 0.002; }));

  // Bóng nền dưới mô hình
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.12 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = -ROOM.slab - 0.04; catcher.receiveShadow = true;
  world.add(catcher);
}

function buildGlassRoom(world) {
  const cx = -6.2, cz = 2.5, s = 3.9, h = 3.0;
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: '#e8f6f7', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const edge = new THREE.LineBasicMaterial({ color: '#9fc9cf', transparent: true, opacity: 0.9 });
  const panels = [
    [s, h, 0, -s / 2, 0], // sau
    [s, h, -s / 2, 0, Math.PI / 2], // trái
  ];
  for (const [w, hh, x, z, ry] of panels) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), glass);
    p.position.set(x, hh / 2, z); p.rotation.y = ry; g.add(p);
  }
  // khung cạnh
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s, h, s)), edge);
  outline.position.y = h / 2; g.add(outline);
  // thảm đế
  const rug = box(s - 0.1, 0.03, s - 0.1, '#d9cdb7', { r: 0.01, m: { roughness: 1 } }); g.add(rug);
  const base = box(s + 0.06, 0.06, s + 0.06, '#cfe3e6', { r: 0.02, m: { roughness: 0.2 } }); base.position.y = -0.03; g.add(base);
  // poster dán trên kính sau & trái
  const posters = [['circles', -1.2, 2.1, -s / 2 + 0.03, 0], ['swatch', 0.05, 2.1, -s / 2 + 0.03, 0], ['quote', 1.3, 2.1, -s / 2 + 0.03, 0],
    ['typo', -s / 2 + 0.03, 2.1, -0.6, Math.PI / 2], ['shapes', -s / 2 + 0.03, 2.1, 0.75, Math.PI / 2]];
  for (const [k, x, y, z, ry] of posters) {
    const m = texPlane(0.9, 1.26, posterTex(k).tex);
    m.position.set(x, y, z); m.rotation.y = ry; g.add(m);
  }
  // quạt + sách
  const fan = new THREE.Group();
  fan.add(cyl(0.16, 0.18, 0.04, P.white));
  const st = cyl(0.025, 0.025, 0.45, P.white); fan.add(st);
  const head = cyl(0.22, 0.22, 0.08, P.white); head.rotation.x = Math.PI / 2; head.position.y = 0.6; fan.add(head);
  fan.position.set(1.4, 0.03, -0.5); g.add(fan);
  ['#3a5bd9', '#f2c230', '#efe4cf', '#e8582c'].forEach((c, i) => { const b = box(0.45, 0.07, 0.32, c, { r: 0.01 }); put(b, 1.45, 0.03 + i * 0.07, 1.4, i * 0.2); g.add(b); });
  ['#26241f', '#e8582c', '#2f7a50'].forEach((c, i) => { const b = box(0.45, 0.07, 0.32, c, { r: 0.01 }); put(b, -1.5, 0.03 + i * 0.07, 1.5, -i * 0.15); g.add(b); });
  g.position.set(cx, 0, cz);
  world.add(g);
}

function buildLounge(world) {
  const x = 7.4, z = 5.2;
  const g = new THREE.Group();
  // thảm caro cam–trắng
  const chk = canvasTex(512, 384, (ctx, w, h) => {
    const n = 8, cs = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) { ctx.fillStyle = (i + j) % 2 ? '#e8662f' : '#fbf6ef'; ctx.fillRect(i * cs, j * cs, cs, cs); }
  });
  const rug = texPlane(5.0, 3.75, chk.tex, { rough: 1 }); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.012; g.add(rug);
  const rugEdge = box(5.1, 0.01, 3.85, '#f3ece2', { r: 0 }); rugEdge.castShadow = false; g.add(rugEdge);

  // bàn kính
  const glass = new THREE.MeshPhysicalMaterial({ color: '#eaf6f7', roughness: 0.05, transparent: true, opacity: 0.35 });
  const top = box(1.3, 0.05, 0.8, null, { mat: glass, r: 0.01 }); top.position.y = 0.45; g.add(top);
  for (const [a, b] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) { const l = box(0.04, 0.45, 0.04, null, { mat: glass, r: 0.01 }); put(l, a, 0, b); g.add(l); }
  const mag = box(0.4, 0.04, 0.3, '#f7f3ec', { r: 0.01 }); put(mag, -0.2, 0.5, 0.05, 0.3); g.add(mag);
  const cup = cyl(0.06, 0.05, 0.12, P.white); put(cup, 0.35, 0.5, -0.1); g.add(cup);

  // ghế bành xanh lá
  g.add(armchair(P.green, -1.7, 0.6, 0.9));
  // ghế văn phòng đen
  g.add(armchair(P.black, 1.6, 0.9, -2.4));
  // ghế kem
  g.add(armchair('#efe6d4', -0.2, -1.35, 0.15));
  // đèn cây vòng cung
  const lamp = new THREE.Group();
  const base = cyl(0.25, 0.28, 0.05, P.black); lamp.add(base);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0.5, 2.5, 0), new THREE.Vector3(1.3, 2.3, 0)]);
  const arm = shade(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 8), M(P.metal, { metalness: 0.7, roughness: 0.3 }))); lamp.add(arm);
  const shadeM = shade(new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: P.white, emissive: '#fff4dc', emissiveIntensity: 0.5, side: THREE.DoubleSide })));
  shadeM.position.set(1.3, 2.25, 0); lamp.add(shadeM);
  lamp.position.set(-2.3, 0, -1.4); lamp.rotation.y = -0.5;
  g.add(lamp);
  // đèn tròn cam
  const pl = plant(1.2); pl.position.set(2.7, 0, 1.6); g.add(pl);
  g.position.set(x, 0, z);
  world.add(g);
  return { x, z };
}

function armchair(color, x, z, ry) {
  const g = new THREE.Group();
  const m = { roughness: 0.55 };
  const seat = box(0.85, 0.2, 0.8, color, { r: 0.09, m }); seat.position.y = 0.42; g.add(seat);
  const back = box(0.85, 0.65, 0.2, color, { r: 0.09, m }); back.position.set(0, 0.55, 0.32); back.rotation.x = -0.12; g.add(back);
  for (const s of [-1, 1]) { const arm = box(0.14, 0.32, 0.7, color, { r: 0.06, m }); arm.position.set(s * 0.43, 0.52, 0.02); g.add(arm); }
  const pole = cyl(0.04, 0.04, 0.4, P.black); g.add(pole);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = box(0.05, 0.04, 0.34, P.black, { r: 0.015 }); leg.position.set(Math.sin(a) * 0.17, 0.04, Math.cos(a) * 0.17); leg.rotation.y = a; g.add(leg); const wh = sph(0.04, P.black); wh.position.set(Math.sin(a) * 0.33, 0.04, Math.cos(a) * 0.33); g.add(wh); }
  g.position.set(x, 0, z); g.rotation.y = ry;
  return g;
}

// ======================================================================
// TRẠM LÀM VIỆC + NHÂN VẬT
function buildStation(person, cfg, world, onSelect) {
  const root = new THREE.Group();
  root.position.set(cfg.x, cfg.y, cfg.z);
  root.rotation.y = cfg.yaw;
  root.userData.personId = person.id;
  world.add(root);

  // Bàn
  const deskW = person.id === 'cd' ? 2.2 : 1.75;
  const desk = new THREE.Group();
  const top = box(deskW, 0.06, 0.85, person.id === 'cd' ? P.black : P.wood, { r: 0.025, m: { roughness: 0.55 } });
  top.position.y = 0.78; desk.add(top);
  for (const sx of [-1, 1]) {
    const leg = box(0.05, 0.78, 0.75, person.id === 'cd' ? P.wood : P.black, { r: 0.015 });
    put(leg, sx * (deskW / 2 - 0.08), 0, 0); desk.add(leg);
  }
  desk.position.z = -0.8;
  root.add(desk);

  // Màn hình (canvas riêng cho từng người, đổi theo trạng thái)
  const scr = canvasTex(320, 200, () => {});
  const monitor = new THREE.Group();
  const stand = cyl(0.03, 0.03, 0.22, P.black); stand.position.y = 0.84; monitor.add(stand);
  const foot = box(0.28, 0.02, 0.18, P.black, { r: 0.01 }); foot.position.y = 0.84; monitor.add(foot);
  const shell = box(0.98, 0.6, 0.05, '#1f1f22', { r: 0.02, m: { roughness: 0.4 } }); shell.position.y = 1.02; monitor.add(shell);
  const screen = texPlane(0.92, 0.54, scr.tex, { basic: true }); screen.position.set(0, 1.32, 0.027); monitor.add(screen);
  monitor.position.z = -1.05;
  root.add(monitor);
  if (person.id === 'cd' || person.id === 'frame') {
    const m2 = monitor.clone(); m2.position.set(-0.95, 0, -1.0); m2.rotation.y = 0.35; root.add(m2);
  }
  const kb = box(0.5, 0.025, 0.16, '#e9e5de', { r: 0.01 }); put(kb, 0, 0.84, -0.55); root.add(kb);
  const mouse = box(0.07, 0.025, 0.11, '#e9e5de', { r: 0.012 }); put(mouse, 0.38, 0.84, -0.55); root.add(mouse);

  addProps(person.id, root);

  // Ghế
  const chairCol = person.id === 'cd' ? P.orange : person.id === 'pixel' ? P.black : P.black;
  const chair = new THREE.Group();
  const seat = box(0.56, 0.09, 0.52, chairCol, { r: 0.04, m: { roughness: 0.6 } }); seat.position.set(0, 0.47, 0.05); chair.add(seat);
  const back = box(0.54, 0.62, 0.08, chairCol, { r: 0.04, m: { roughness: 0.6 } }); back.position.set(0, 0.6, 0.34); chair.add(back);
  const pole = cyl(0.035, 0.035, 0.45, P.metal, { m: { metalness: 0.6, roughness: 0.3 } }); pole.position.z = 0.05; chair.add(pole);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = box(0.04, 0.04, 0.3, P.black, { r: 0.015 }); leg.position.set(Math.sin(a) * 0.15, 0.04, 0.05 + Math.cos(a) * 0.15); leg.rotation.y = a; chair.add(leg); }
  root.add(chair);

  // Vòng trạng thái dưới ghế
  const ringMat = new THREE.MeshBasicMaterial({ color: '#999', transparent: true, opacity: 0.0, toneMapped: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.98, 6), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 6; ring.position.set(0, 0.055, -0.2);
  const discMat = new THREE.MeshBasicMaterial({ color: '#999', transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.82, 6), discMat);
  disc.rotation.copy(ring.rotation); disc.position.copy(ring.position); disc.position.y = 0.05;
  root.add(disc, ring);

  // Nhân vật
  const ch = makeCharacter(person);
  root.add(ch.group);

  // Nhãn (thẻ kính nổi)
  const tag = document.createElement('button');
  tag.className = 'tag' + (person.human ? ' tag-human' : '');
  tag.style.setProperty('--c', person.color);
  tag.innerHTML = `<span class="tag-dot"></span><span class="tag-main"><b>${person.name}</b><small>${person.role}</small></span><span class="tag-state">${person.human ? 'BẠN' : 'RẢNH'}</span>`;
  tag.addEventListener('click', (e) => { e.stopPropagation(); onSelect(person.id); });
  const tagObj = new CSS2DObject(tag);
  tagObj.position.set(0, 2.35, -0.2);
  root.add(tagObj);

  // Bong bóng thoại
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const bubbleObj = new CSS2DObject(bubble);
  bubbleObj.position.set(0, 3.45, -0.2);
  root.add(bubbleObj);
  let bubbleTimer = null;

  let status = { state: 'idle' };
  let flash = 0;
  let scrLast = -1;
  const seed = Math.random() * 10;

  function drawScreen(t) {
    const { ctx } = scr; const w = 320, h = 200;
    const st = status.state;
    const col = person.color;
    if (st === 'working') {
      ctx.fillStyle = '#1b1d24'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = col; ctx.fillRect(0, 0, w, 18);
      const off = Math.floor(t * 6);
      for (let i = 0; i < 10; i++) {
        const k = (i + off) * 7.13 + seed;
        const len = 40 + ((Math.sin(k) * 0.5 + 0.5) * 200);
        ctx.fillStyle = i % 3 === 0 ? col : 'rgba(255,255,255,0.55)';
        ctx.globalAlpha = 0.85;
        ctx.fillRect(16 + (i % 2) * 18, 30 + i * 16, len, 7);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(16, h - 18, w - 32, 6);
      ctx.fillStyle = '#f0a81c'; ctx.fillRect(16, h - 18, (w - 32) * (status.progress || 0) / 100, 6);
    } else {
      const map = { idle: ['#e9e3d8', '#9b958b', person.human ? '' : 'z z z'], waiting_review: ['#ec6a24', '#fff', 'CHỜ DUYỆT'], blocked: ['#d93a2b', '#fff', 'CẦN HỖ TRỢ'], done: ['#2f9a5c', '#fff', 'ĐÃ XONG ✓'] };
      const [bg, fg, txt] = map[st] || map.idle;
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 64px ${FONT}`; ctx.globalAlpha = st === 'idle' ? 0.35 : 1;
      ctx.fillText(person.name[0], w / 2, h / 2 - 22);
      ctx.globalAlpha = 1; ctx.font = `700 24px ${MONO}`; ctx.fillText(txt, w / 2, h / 2 + 46);
      ctx.textAlign = 'left';
    }
    scr.tex.needsUpdate = true;
  }

  function setStatus(s) {
    const prev = status.state;
    status = { ...s };
    const st = STATES[status.state] || STATES.idle;
    const label = person.human ? (status.state === 'waiting_review' ? `${status.waiting} CHỜ DUYỆT` : 'BẠN') : st.label;
    const stateEl = tag.querySelector('.tag-state');
    stateEl.textContent = label;
    tag.dataset.state = status.state;
    ringMat.color.set(st.color); discMat.color.set(st.color);
    if (prev !== status.state) { flash = 1; drawScreen(performance.now() / 1000); }
  }

  function tick(t, dt) {
    const st = status.state;
    // vòng sáng
    const base = st === 'idle' ? 0.0 : 0.85;
    const pulse = st === 'working' ? 0.15 * Math.sin(t * 4) : 0;
    ringMat.opacity = Math.min(1, base + pulse + flash * 0.4);
    discMat.opacity = st === 'idle' ? 0 : 0.16 + flash * 0.25;
    flash = Math.max(0, flash - dt * 1.2);
    // màn hình
    if (st === 'working' && t - scrLast > 0.15) { scrLast = t; drawScreen(t); }
    else if (scrLast < 0) { scrLast = 0; drawScreen(t); }
    ch.animate(st, t + seed, dt);
  }

  return {
    root,
    setStatus,
    tick,
    setSelected(on) { tag.classList.toggle('selected', on); },
    say(text) {
      bubble.textContent = text.length > 90 ? text.slice(0, 88) + '…' : text;
      bubble.classList.add('show');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 6500);
    },
  };
}

function addProps(id, root) {
  const add = (o, x, y, z, ry = 0) => { put(o, x, y, z, ry); root.add(o); return o; };
  const mug = (c) => { const g = grp(cyl(0.055, 0.05, 0.12, c)); const h = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 16), M(c)); h.position.set(0.065, 0.06, 0); g.add(h); return g; };
  if (id === 'kuma') {
    add(mug(P.yellow), -0.55, 0.81, -0.6);
    add(plant(0.45, P.yellow), 0.7, 0.81, -1.0);
    const hny = cyl(0.07, 0.07, 0.14, '#f2a92c', { m: { roughness: 0.3 } }); add(hny, -0.7, 0.81, -0.9);
  }
  if (id === 'brief') {
    ['#ffffff', '#f7f1e2', '#ffffff'].forEach((c, i) => add(box(0.32, 0.03, 0.42, c, { r: 0.005 }), -0.6, 0.81 + i * 0.03, -0.75, 0.1 * i));
    add(box(0.26, 0.02, 0.36, '#e8582c', { r: 0.005 }), 0.6, 0.81, -0.7, -0.2);
    add(mug(P.white), 0.7, 0.81, -1.0);
  }
  if (id === 'pixel') {
    add(box(0.42, 0.02, 0.3, '#1d1d20', { r: 0.01 }), -0.6, 0.81, -0.6, 0.1);
    const lamp = sph(0.12, '#f4a35f', { m: { emissive: '#ff8a3d', emissiveIntensity: 0.9, roughness: 0.4 } }); lamp.scale.set(1, 1.4, 1); add(lamp, 0.65, 0.95, -1.0);
    add(cyl(0.05, 0.05, 0.13, '#c88d43', { m: { transparent: true, opacity: 0.8, roughness: 0.2 } }), 0.55, 0.81, -0.62);
  }
  if (id === 'cube') {
    const holo = new THREE.Group();
    const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), new THREE.MeshBasicMaterial({ color: '#6f8cff', wireframe: true, toneMapped: false }));
    const core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.12, 0.04, 64, 8), new THREE.MeshStandardMaterial({ color: '#3a5bd9', emissive: '#3a5bd9', emissiveIntensity: 0.8, roughness: 0.3 }));
    holo.add(ico, core);
    const glowTex = canvasTex(128, 128, (ctx) => { const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(110,140,255,0.9)'); g.addColorStop(1, 'rgba(110,140,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: glowTex.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2;
    const pad = cyl(0.22, 0.25, 0.04, '#d6dcf5', { m: { roughness: 0.3, metalness: 0.3 } });
    add(pad, 0.6, 0.81, -0.9); add(glow, 0.6, 0.86, -0.9); add(holo, 0.6, 1.35, -0.9);
    holo.onBeforeRender = () => {};
    root.userData.holo = holo;
    const spin = () => { holo.rotation.y += 0.01; holo.rotation.x += 0.004; requestAnimationFrame(spin); };
    spin();
  }
  if (id === 'frame') {
    const hp = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 20, Math.PI), M(P.black)); hp.rotation.x = -Math.PI / 2; add(hp, 0.6, 0.84, -0.6);
    add(mug('#7a4fd0'), 0.7, 0.81, -1.0);
  }
  if (id === 'ink') {
    const tw = new THREE.Group();
    tw.add(box(0.5, 0.14, 0.36, '#2f7a50', { r: 0.04, m: { roughness: 0.4 } }));
    const roller = cyl(0.04, 0.04, 0.55, P.black); roller.rotation.z = Math.PI / 2; roller.position.set(0.275, 0.17, 0.1); tw.add(roller);
    const paper = box(0.3, 0.3, 0.01, P.white, { r: 0 }); paper.position.set(0, 0.17, 0.14); paper.rotation.x = -0.25; tw.add(paper);
    add(tw, -0.6, 0.81, -0.8, 0.15);
    ['#ffffff', '#ffffff', '#fbf3df'].forEach((c, i) => add(box(0.3, 0.025, 0.4, c, { r: 0.004 }), 0.62, 0.81 + i * 0.025, -0.75, i * 0.12));
    for (let i = 0; i < 4; i++) { const b = sph(0.07, P.white, { seg: 6 }); add(b, 0.9 + Math.random() * 0.4, 0.06, -0.2 - Math.random() * 0.7); }
  }
  if (id === 'cd') {
    const lampBase = cyl(0.08, 0.1, 0.03, P.black); add(lampBase, 0.8, 0.81, -1.0);
    const lp = cyl(0.015, 0.015, 0.45, P.black); add(lp, 0.8, 0.84, -1.0);
    const sh = cyl(0.06, 0.13, 0.14, P.orange, { m: { emissive: '#ffb070', emissiveIntensity: 0.4 } }); add(sh, 0.8, 1.25, -0.95);
    add(mug(P.black), 0.55, 0.81, -0.6);
  }
}

function makeCharacter(person) {
  const g = new THREE.Group();
  const skinTones = { brief: '#efc4a0', pixel: '#f3cfb1', cube: '#d9a27a', frame: '#e8b894', ink: '#c98e66', kuma: '#9c6a3c', cd: '#eabf98' };
  const hairCols = { brief: '#2a211c', pixel: '#5a3424', cube: '#1c1c1e', frame: '#2b2b33', ink: '#2a211c', kuma: '#8a5a30', cd: '#1c1c1e' };
  const skin = M(skinTones[person.id] || P.skin, { roughness: 0.7 });
  const shirt = M(person.shirt || person.color, { roughness: 0.85 });
  const pants = M(P.pants, { roughness: 0.85 });
  const hairM = M(hairCols[person.id] || '#2a211c', { roughness: 0.9 });

  for (const s of [-1, 1]) {
    const thigh = capsule(0.095, 0.36, pants); thigh.rotation.x = Math.PI / 2; thigh.position.set(s * 0.12, 0.64, -0.18); g.add(thigh);
    const shin = capsule(0.085, 0.36, pants); shin.position.set(s * 0.12, 0.33, -0.42); g.add(shin);
    const shoe = box(0.15, 0.1, 0.26, '#f4f1ea', { r: 0.04 }); put(shoe, s * 0.12, 0, -0.47); g.add(shoe);
  }
  const body = new THREE.Group(); body.position.set(0, 0.6, 0.04); g.add(body);
  const torso = capsule(0.21, 0.32, shirt); torso.position.y = 0.38; torso.scale.set(1, 1, 0.8); body.add(torso);
  const neck = cyl(0.07, 0.07, 0.12, null, { mat: skin }); neck.position.y = 0.72; body.add(neck);
  const head = new THREE.Group(); head.position.y = 0.98; body.add(head);

  if (person.hair === 'bear') {
    const fur = M('#9c6a3c', { roughness: 0.95 });
    const skull = shade(new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 16), fur)); head.add(skull);
    for (const s of [-1, 1]) { const ear = shade(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), fur)); ear.position.set(s * 0.16, 0.17, 0); head.add(ear); const inner = sph(0.045, '#e9b98c'); inner.position.set(s * 0.16, 0.17, -0.04); head.add(inner); }
    const muzzle = sph(0.1, '#e9c9a2'); muzzle.scale.set(1, 0.8, 0.8); muzzle.position.set(0, -0.05, -0.18); head.add(muzzle);
    const nose = sph(0.035, P.black); nose.position.set(0, -0.02, -0.26); head.add(nose);
  } else {
    const skull = shade(new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skin)); head.add(skull);
    const capG = new THREE.SphereGeometry(0.215, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hair = shade(new THREE.Mesh(capG, person.hair === 'beanie' ? M(person.color, { roughness: 0.95 }) : hairM));
    hair.rotation.x = 0.35; hair.position.set(0, 0.02, 0.02); head.add(hair);
    if (person.hair === 'bun') { const bun = shade(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), hairM)); bun.position.set(0, 0.2, 0.1); head.add(bun); }
    if (person.hair === 'long') { const back = shade(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.25, 6, 12), hairM)); back.position.set(0, -0.12, 0.08); back.scale.set(1.1, 1, 0.7); head.add(back); }
    if (person.hair === 'beanie') { const pom = sph(0.05, P.white); pom.position.set(0, 0.24, 0.06); head.add(pom); }
    if (person.id === 'cd') {
      const gl = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20), M(P.black));
      for (const s of [-1, 1]) { const l = gl.clone(); l.position.set(s * 0.075, 0.0, -0.19); head.add(l); }
    }
  }

  const arms = {};
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.27, 0.6, 0); body.add(sh);
    const upper = capsule(0.07, 0.22, shirt); upper.position.y = -0.16; sh.add(upper);
    const el = new THREE.Group(); el.position.y = -0.32; sh.add(el);
    const fore = capsule(0.062, 0.2, person.hair === 'bear' ? M('#9c6a3c') : skin); fore.position.y = -0.14; el.add(fore);
    const hand = shade(new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), person.hair === 'bear' ? M('#9c6a3c') : skin)); hand.position.y = -0.29; el.add(hand);
    arms[s] = { sh, el };
  }

  // Tư thế mục tiêu theo trạng thái
  const cur = { shX: [0.3, 0.3], shZ: [0, 0], elX: [1.0, 1.0], headX: 0, headY: 0, lean: 0 };
  const lerp = (a, b, k) => a + (b - a) * k;

  return {
    group: g,
    animate(state, t, dt) {
      const tgt = { shX: [0.3, 0.3], shZ: [0, 0], elX: [1.0, 1.0], headX: 0.05, headY: 0, lean: 0 };
      if (state === 'working') {
        tgt.shX = [0.32, 0.32];
        tgt.elX = [1.05 + Math.sin(t * 17) * 0.09, 1.05 + Math.sin(t * 17 + 1.7) * 0.09];
        tgt.headX = 0.12 + Math.sin(t * 2.3) * 0.03;
        tgt.headY = Math.sin(t * 0.7) * 0.08;
        tgt.lean = -0.06;
      } else if (state === 'idle') {
        tgt.shX = [0.12, 0.12]; tgt.elX = [1.25, 1.25];
        tgt.headY = Math.sin(t * 0.35) * 0.55;
        tgt.headX = -0.05;
        tgt.lean = 0.12;
      } else if (state === 'waiting_review') {
        // giơ tay phải vẫy
        tgt.shX = [0.12, -0.25]; tgt.shZ = [0, 2.5 + Math.sin(t * 6) * 0.25]; tgt.elX = [1.25, 0.4];
        tgt.headY = 0.4 * Math.sin(t * 0.8); tgt.headX = -0.1; tgt.lean = 0.05;
      } else if (state === 'blocked') {
        tgt.shX = [0.55, 0.55]; tgt.elX = [1.55, 1.55]; tgt.headX = 0.42; tgt.lean = -0.18;
      } else if (state === 'done') {
        tgt.shX = [-0.2, -0.2]; tgt.shZ = [-2.3, 2.3]; tgt.elX = [1.6 + Math.sin(t * 3) * 0.1, 1.6 + Math.sin(t * 3) * 0.1];
        tgt.headX = -0.2; tgt.lean = 0.2;
      }
      const k = 1 - Math.pow(0.002, dt);
      [-1, 1].forEach((s, i) => {
        // i=0: tay trái (s=-1), i=1: tay phải (s=1)
        cur.shX[i] = lerp(cur.shX[i], tgt.shX[i], k);
        cur.shZ[i] = lerp(cur.shZ[i], tgt.shZ[i], k);
        cur.elX[i] = lerp(cur.elX[i], tgt.elX[i], k);
        arms[s].sh.rotation.x = cur.shX[i];
        arms[s].sh.rotation.z = cur.shZ[i];
        arms[s].el.rotation.x = cur.elX[i];
      });
      cur.headX = lerp(cur.headX, tgt.headX, k);
      cur.headY = lerp(cur.headY, tgt.headY, k);
      cur.lean = lerp(cur.lean, tgt.lean, k);
      head.rotation.x = cur.headX; head.rotation.y = cur.headY;
      body.rotation.x = cur.lean;
      body.position.y = 0.6 + Math.sin(t * 1.6) * 0.006;
    },
  };
}
