// Văn phòng 3D: 5 "đảo" lơ lửng nối nhau bằng cầu. Grid ngồi ở đảo điều phối giữa,
// đường sáng chạy từ đảo điều phối ra khu nào đang có người làm việc.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AGENTS, CD, PEOPLE, STATES, ZONES, COMPANY } from './agents.js';

// ---------- Bảng màu (kem ấm, cam, xanh lá, đỏ, vàng + xanh ngọc của khu điều phối) ----------
const P = {
  floor: '#e9e2d6', slab: '#d9cfc0', slabDark: '#c9bead', wall: '#f6f2ec', trim: '#e4dbcf',
  wood: '#c09066', woodDark: '#8d6442', black: '#26241f', white: '#fbf9f5', cream: '#efe4cf',
  orange: '#e8582c', green: '#2f7a50', red: '#d73c2c', yellow: '#f2c230', blue: '#3a5bd9', teal: '#14a3a0',
  grey: '#bdb5a9', metal: '#a7abb0', leaf: '#3f8a4f', leafDark: '#2d6b3c', pot: '#e9e3d8',
  skin: '#efc4a0', pants: '#3b3e48',
};

// Các đảo: A tầng chỉ huy (nâng cao), B điều phối (tròn, ở giữa), C phòng chữ, D xưởng hình, E quảng trường chat
const ISLANDS = {
  A: { x: 8, z: -6, w: 8.4, d: 5.4, y: 1.2, top: 'hq' },
  B: { x: 0, z: 0, r: 2.9, y: 0.35, top: 'hub' },
  C: { x: -8, z: -6, w: 8.4, d: 5.4, y: 0, top: 'words' },
  D: { x: -8.2, z: 6, w: 9.4, d: 5.4, y: 0, top: 'studio' },
  E: { x: 8, z: 6, w: 8.4, d: 5.4, y: -0.25, top: 'lounge' },
};
const BACK = (k) => ISLANDS[k].z - ISLANDS[k].d / 2 + 0.26; // mặt trước của tường sau

// Vị trí ghế của từng người + hướng nhìn (yaw: 0 = nhìn về phía sau, π/2 = nhìn sang trái, π = nhìn ra ngoài)
const STATIONS = {
  cd:      { x: 9.4, y: ISLANDS.A.y, z: -7.0, yaw: Math.PI },
  lue:     { x: 5.0, y: ISLANDS.A.y, z: -5.6, yaw: -Math.PI / 2 },
  manager: { x: 0, y: ISLANDS.B.y, z: 0.75, yaw: 0 },
  brief:   { x: -9.7, y: 0, z: -5.3, yaw: 0 },
  ink:     { x: -6.5, y: 0, z: -5.3, yaw: 0 },
  pixel:   { x: -11.0, y: 0, z: 6.7, yaw: 0 },
  cube:    { x: -8.2, y: 0, z: 6.7, yaw: 0 },
  frame:   { x: -5.4, y: 0, z: 6.7, yaw: 0 },
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
export function createWorld(container, { onSelect, onOpenChat, onZone }) {
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
  const FRUSTUM = 25;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  const HOME = { target: new THREE.Vector3(-0.3, 0.2, 0.3), offset: new THREE.Vector3(34, 30, 34), zoom: 1 };
  camera.position.copy(HOME.target).add(HOME.offset);
  camera.zoom = HOME.zoom;

  const controls = new OrbitControls(camera, labels.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minZoom = 0.6; controls.maxZoom = 4;
  controls.minPolarAngle = 0.55; controls.maxPolarAngle = 1.25;
  controls.minAzimuthAngle = Math.PI / 4 - 0.75; controls.maxAzimuthAngle = Math.PI / 4 + 0.75;
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
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 75 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#ffe2c4', 0.5);
  fill.position.set(20, 10, 4);
  scene.add(fill);

  const world = new THREE.Group();
  scene.add(world);
  const tickers = []; // hàm cập nhật mỗi frame
  const clickables = []; // vật bấm được để mở chat

  const bridges = buildIslands(world, tickers);
  const board = buildBigScreen(world, { x: 0, y: ISLANDS.B.y, z: -2.05 });
  const chatWall = buildChatScreen(world, { x: 8.2, y: ISLANDS.E.y, z: 4.0 });
  clickables.push(chatWall.mesh);
  const orbit = buildHubOrbit(world, tickers);
  buildDecor(world, tickers);
  clickables.push(...buildLounge(world, tickers));

  // Nhãn khu (thẻ nổi trên mỗi đảo)
  const ZONE_LABEL = {
    A: [ISLANDS.A.x - 2.6, ISLANDS.A.y + 4.1, ISLANDS.A.z - 2.2],
    B: [0, ISLANDS.B.y + 4.4, -2.0],
    C: [ISLANDS.C.x + 1.6, 4.1, ISLANDS.C.z - 2.2],
    D: [ISLANDS.D.x, 3.9, ISLANDS.D.z - 2.3],
    E: [ISLANDS.E.x - 3.3, ISLANDS.E.y + 2.6, ISLANDS.E.z - 1.6],
  };
  const zoneTags = {};
  for (const z of Object.values(ZONES)) {
    const el = document.createElement('button');
    el.className = 'zone-tag';
    el.style.setProperty('--c', z.color);
    el.innerHTML = `<span class="zt-eyebrow">KHU ${z.id}</span><b>${z.name}</b><span class="zt-count">—</span>`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (z.id === 'E') { onOpenChat && onOpenChat(); return; }
      api.focusZone(z.id);
      onZone && onZone(z.id);
    });
    const obj = new CSS2DObject(el);
    obj.position.set(...ZONE_LABEL[z.id]);
    world.add(obj);
    zoneTags[z.id] = el;
  }

  // Trạm làm việc
  const stations = {};
  for (const person of [...AGENTS, CD]) {
    stations[person.id] = buildStation(person, STATIONS[person.id], world, onSelect);
  }

  // ---------- đi lại trao đổi công việc ----------
  // Có tin nhắn A → B: A đứng dậy, đi (qua cầu nếu khác đảo) tới cạnh bàn B, nói, rồi về chỗ.
  // Tin gửi cả team: ra Quảng trường chat nói.
  const LIFT = 0.42; // ngồi → đứng thì nhấc người lên cho chân chạm sàn
  const SPEED = 2.6;
  const walkers = {};
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const onStation = (id, x, z) => stations[id].root.localToWorld(V(x, 0, z));
  const standPoint = (id) => onStation(id, 0, 0.85); // sau ghế
  const visitPoint = (id) => onStation(id, 1.15, 0.3); // cạnh bàn người nhận
  const D = ISLANDS.D, AISLE_Z = D.z + D.d / 2 - 0.85, RIGHT_X = D.x + D.w / 2 - 0.35;
  // lối ra khỏi đảo, tránh đi xuyên tường kính / bàn
  function exitVia(zone, p) {
    if (zone === 'D') return [V(p.x, 0, AISLE_Z), V(RIGHT_X, 0, AISLE_Z), V(RIGHT_X, 0, D.z - D.d / 2 + 0.45)];
    if (zone === 'A' && p.x > 7) return [V(7.6, ISLANDS.A.y, -7.6), V(7.6, ISLANDS.A.y, ISLANDS.A.z + 1.8)];
    return [];
  }
  function route(fromZone, p, toZone, q) {
    if (fromZone === toZone) {
      return fromZone === 'D' ? [p, V(p.x, 0, AISLE_Z), V(q.x, 0, AISLE_Z), q] : [p, q];
    }
    const pts = [p, ...exitVia(fromZone, p)];
    if (fromZone !== 'B') pts.push(bridges[fromZone].islandEnd.clone(), bridges[fromZone].hubEnd.clone());
    if (toZone !== 'B') pts.push(bridges[toZone].hubEnd.clone(), bridges[toZone].islandEnd.clone());
    pts.push(...exitVia(toZone, q).reverse(), q);
    return pts;
  }
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

  function visit(from, to, text) {
    const s = stations[from];
    const w = (walkers[from] ||= { phase: 'seated', queue: [] });
    if (w.phase !== 'seated') {
      if (w.queue.length < 3) w.queue.push([to, text]); else s.say(text);
      return;
    }
    let q, toZone, face;
    if (to === 'team') {
      const E = ISLANDS.E, k = Object.keys(STATIONS).indexOf(from);
      toZone = 'E'; q = V(E.x - 1.2 + (k % 4) * 0.7, E.y, E.z + 0.6 + Math.floor(k / 4) * 0.7);
      face = V(E.x + 0.2, E.y, E.z - 1.5); // nhìn về màn hình chat
    } else {
      toZone = PEOPLE[to].zone; q = visitPoint(to);
      face = stations[to].root.getWorldPosition(V(0, 0, 0));
    }
    const p = standPoint(from);
    const path = route(PEOPLE[from].zone, p, toZone, q);
    const seat = s.root.getWorldPosition(V(0, 0, 0));
    world.attach(s.ch.group);
    Object.assign(w, {
      phase: 'go', pts: path, i: 0, text, face, lift: 0, target: to,
      back: [...path].reverse().concat([seat]),
      pos: s.ch.group.position.clone(), yaw: s.ch.group.rotation.y,
    });
    s.setPose('walk');
  }

  function tickWalkers(dt) {
    for (const [id, w] of Object.entries(walkers)) {
      if (w.phase === 'seated') continue;
      const s = stations[id], g = s.ch.group;
      let wantYaw = w.yaw;
      if (w.phase === 'talk') {
        w.wait -= dt;
        wantYaw = yawTo(w.face.x - w.pos.x, w.face.z - w.pos.z);
        if (w.wait <= 0) { w.phase = 'back'; w.pts = w.back; w.i = 0; s.setPose('walk'); }
      } else {
        const target = w.pts[w.i];
        const d = target.clone().sub(w.pos);
        const dist = d.length(), step = SPEED * dt;
        if (Math.hypot(d.x, d.z) > 0.01) wantYaw = yawTo(d.x, d.z);
        if (dist <= step) {
          w.pos.copy(target); w.i++;
          if (w.i >= w.pts.length) {
            if (w.phase === 'go') {
              w.phase = 'talk'; w.wait = 4.5; s.setPose('stand'); s.say(w.text);
            } else {
              // về tới ghế: ngồi lại vào bàn
              s.root.attach(g); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
              s.setPose('sit'); w.phase = 'seated';
              const next = w.queue.shift();
              if (next) visit(id, ...next);
              continue;
            }
          }
        } else w.pos.addScaledVector(d, step / dist);
      }
      // ngồi xuống ở đoạn cuối đường về, còn lại thì đứng
      const sitting = w.phase === 'back' && w.i === w.pts.length - 1;
      w.lift += ((sitting ? 0 : LIFT) - w.lift) * Math.min(1, dt * 8);
      let dy = wantYaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      w.yaw += dy * Math.min(1, dt * 10);
      g.position.set(w.pos.x, w.pos.y + w.lift, w.pos.z);
      g.rotation.set(0, w.yaw, 0);
    }
  }

  // ---------- chọn bằng click trên mô hình ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...Object.values(stations).map((s) => s.root), ...clickables], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.personId && !o.userData.openChat) o = o.parent;
      if (o) return o.userData;
    }
    return null;
  }
  let downAt = null;
  labels.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  labels.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const hit = pick(e);
    if (hit?.personId) onSelect(hit.personId);
    else if (hit?.openChat) onOpenChat && onOpenChat();
  });
  let hoverAt = 0;
  labels.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons || performance.now() - hoverAt < 80) return;
    hoverAt = performance.now();
    labels.domElement.style.cursor = pick(e) ? 'pointer' : '';
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
    focusZone(id) {
      const z = ISLANDS[id]; if (!z) return;
      flyTo(new THREE.Vector3(z.x, z.y + 0.8, z.z), id === 'B' ? 2.4 : 1.9);
    },
    focusBoard() { flyTo(board.pos.clone().add(new THREE.Vector3(0, -0.3, 1.5)), 2.6); },
    resetView() {
      anim = { t: 0, fromT: controls.target.clone(), toT: HOME.target.clone(), fromZ: camera.zoom, toZ: HOME.zoom, fromP: camera.position.clone(), toP: HOME.target.clone().add(HOME.offset) };
    },
    select(id) { for (const [k, s] of Object.entries(stations)) s.setSelected(k === id); },
    update(data) {
      const A = data.agents;
      for (const a of AGENTS) stations[a.id].setStatus(A[a.id]);
      const anyWorking = AGENTS.some((a) => A[a.id].state === 'working');
      const waiting = AGENTS.filter((a) => A[a.id].state === 'waiting_review').length;
      stations.cd.setStatus({ state: waiting ? 'waiting_review' : (anyWorking || data.runner?.busy) ? 'working' : 'idle', cd: true, waiting });
      board.setData(data);
      const company = data.chats[COMPANY] || [];
      chatWall.setData(company);
      orbit.setData(A);

      // nhãn khu + đường sáng trên cầu
      const lastCompany = company.at(-1)?.time;
      const freshChat = lastCompany && Date.now() - new Date(lastCompany).getTime() < 90000;
      for (const z of Object.values(ZONES)) {
        const team = AGENTS.filter((a) => a.zone === z.id);
        const busy = team.filter((a) => A[a.id].state === 'working').length;
        const help = team.filter((a) => A[a.id].state === 'blocked').length;
        const el = zoneTags[z.id].querySelector('.zt-count');
        if (z.id === 'E') {
          const total = Object.values(data.chats).reduce((n, c) => n + c.length, 0);
          el.textContent = `${company.length} tin chung · ${total} tổng`;
        } else {
          el.textContent = help ? `${help} cần hỗ trợ` : busy ? `${busy}/${team.length} đang làm` : 'rảnh';
        }
        zoneTags[z.id].dataset.busy = help ? 'help' : busy ? 'busy' : '';
        if (!bridges[z.id]) continue;
        const active = z.id === 'E' ? !!freshChat
          : z.id === 'A' ? ['working', 'waiting_review'].includes(A.manager.state) || A.lue.state === 'working'
          : busy > 0;
        bridges[z.id].setActive(active);
      }
    },
    // nói với ai đó: đi tới chỗ người nhận nếu được, không thì chỉ hiện bong bóng tại chỗ
    say(id, text, to) {
      if (!stations[id]) return;
      const here = (a, b) => walkers[a]?.phase === 'talk' && walkers[a].target === b; // a đang đứng nói chuyện ở chỗ b
      if (here(to, id)) { stations[id].say(text); walkers[to].wait = Math.max(walkers[to].wait, 3); return; } // người kia đang đứng cạnh mình → trả lời tại chỗ
      if (here(id, to)) { stations[id].say(text); walkers[id].wait += 2.5; return; } // mình đang ở chỗ người đó rồi
      if (to && to !== id && (stations[to] || to === 'team')) visit(id, to, text);
      else stations[id].say(text);
    },
    setPaused(p) { paused = p; labels.domElement.style.visibility = p ? 'hidden' : 'visible'; },
  };

  // ---------- resize + loop ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    const aspect = w / Math.max(h, 1);
    const f = aspect < 1 ? FRUSTUM * 1.45 : FRUSTUM;
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
    tickWalkers(dt);
    for (const s of Object.values(stations)) s.tick(t, dt);
    for (const b of Object.values(bridges)) b.tick(t);
    board.tick(t);
    chatWall.tick(t);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return api;
}

// ======================================================================
// ĐẢO + CẦU
function rrShape(w, d, r) {
  const s = new THREE.Shape(), x0 = -w / 2, y0 = -d / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + d - r); s.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d);
  s.lineTo(x0 + r, y0 + d); s.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
function circShape(r) { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); return s; }
function slab(shape, depth, color, o = {}) {
  const b = o.bevel ?? 0.04;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 32 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0); // đáy (kể cả bevel) nằm ở y = 0
  return shade(new THREE.Mesh(g, o.mat || M(color, o.m)));
}

// Hoạ tiết mặt sàn riêng cho từng khu
function islandTex(kind, W, D) {
  const ppu = 120, w = Math.min(1400, Math.round(W * ppu)), h = Math.min(1400, Math.round(D * ppu));
  return canvasTex(w, h, (ctx) => {
    const u = w / W; // pixel / mét
    if (kind === 'words') {
      // giấy kẻ dòng như trang vở
      ctx.fillStyle = '#f7f1e3'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(70,110,190,0.28)'; ctx.lineWidth = 2;
      for (let y = 0.45 * u; y < h; y += 0.45 * u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(215,60,44,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0.9 * u, 0); ctx.lineTo(0.9 * u, h); ctx.stroke();
      ctx.fillStyle = 'rgba(38,36,31,0.13)'; ctx.font = `800 ${1.3 * u}px ${FONT}`; ctx.textBaseline = 'alphabetic';
      ctx.fillText('Aa', w - 2.6 * u, h - 0.5 * u);
    } else if (kind === 'studio') {
      // thảm cắt xanh lá có lưới đo
      ctx.fillStyle = '#2f6b55'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 0.25 * u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 0.25 * u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2;
      for (let x = 0; x < w; x += u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(242,194,48,0.45)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(h, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(w - 1.2 * u, h - 1.0 * u, 0.8 * u, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `600 ${0.16 * u}px ${MONO}`;
      for (let i = 1; i < W; i++) ctx.fillText(String(i * 10), i * u + 4, 0.2 * u);
    } else if (kind === 'hq') {
      // sàn gỗ xương cá
      ctx.fillStyle = '#c79c70'; ctx.fillRect(0, 0, w, h);
      const pw = 0.9 * u, ph = 0.22 * u;
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI / 4);
      for (let y = -w; y < w; y += ph) for (let x = -w; x < w; x += pw) {
        const k = Math.sin(x * 12.9 + y * 78.2) * 0.5 + 0.5;
        ctx.fillStyle = `hsl(28, ${36 + k * 12}%, ${52 + k * 9}%)`;
        ctx.fillRect(x + ((y / ph) % 2 ? pw / 2 : 0), y, pw - 2, ph - 2);
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(242,194,48,0.85)'; ctx.fillRect(0, h - 0.12 * u, w, 0.12 * u);
    } else if (kind === 'hub') {
      // la bàn / radar điều phối
      ctx.fillStyle = '#eef4f2'; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      ctx.strokeStyle = 'rgba(20,163,160,0.35)';
      for (let r = 0.5; r < W / 2; r += 0.5) { ctx.lineWidth = r % 1 === 0 ? 3 : 1.5; ctx.beginPath(); ctx.arc(cx, cy, r * u, 0, Math.PI * 2); ctx.stroke(); }
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 0.5 * u, cy + Math.sin(a) * 0.5 * u); ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w); ctx.stroke(); }
      ctx.fillStyle = 'rgba(20,163,160,0.8)'; ctx.font = `700 ${0.2 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [['C', -0.8, -0.6], ['A', 0.8, -0.6], ['D', -0.8, 0.6], ['E', 0.8, 0.6]].forEach(([l, dx, dy]) => ctx.fillText(l, cx + dx * 2.45 * u, cy + dy * 2.45 * u));
    } else {
      // caro cam–kem của quảng trường chat
      const cs = 0.62 * u;
      for (let i = 0; i * cs < w; i++) for (let j = 0; j * cs < h; j++) { ctx.fillStyle = (i + j) % 2 ? '#e8662f' : '#fbf6ef'; ctx.fillRect(i * cs, j * cs, cs, cs); }
    }
  });
}

function buildIsland(world, key, cfg) {
  const round = !!cfg.r;
  const W = round ? cfg.r * 2 : cfg.w, D = round ? cfg.r * 2 : cfg.d;
  const shape = (inset = 0) => (round ? circShape(cfg.r - inset) : rrShape(W - inset * 2, D - inset * 2, Math.max(0.2, 0.5 - inset * 0.3)));
  const g = new THREE.Group();
  g.position.set(cfg.x, cfg.y, cfg.z);
  const T = 0.38;
  const body = slab(shape(0), T, '#f3eee6', { m: { roughness: 0.75 } }); body.position.y = -T - 0.08; g.add(body);
  const band = slab(shape(-0.03), 0.06, ZONES[key].color, { bevel: 0.015, m: { roughness: 0.5 } }); band.position.y = -0.28; g.add(band);
  const u1 = slab(shape(0.45), 0.5, '#ddd3c4', { m: { roughness: 0.9 } }); u1.position.y = -T - 0.08 - 0.55; g.add(u1);
  const u2 = slab(shape(1.1), 0.5, '#c9bba7', { m: { roughness: 0.9 } }); u2.position.y = -T - 0.08 - 1.05; g.add(u2);
  if (!round) {
    const u3 = slab(shape(1.8), 0.35, '#b3a38d', { m: { roughness: 0.9 } }); u3.position.y = -T - 0.08 - 1.4; g.add(u3);
  }

  // mặt sàn có hoạ tiết
  const topShape = shape(0.04);
  const tg = new THREE.ShapeGeometry(topShape, 32);
  const uv = tg.attributes.uv, pos = tg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + D / 2) / D);
  tg.rotateX(-Math.PI / 2);
  const tex = islandTex(cfg.top, W, D);
  const top = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tex.tex, roughness: cfg.top === 'hq' ? 0.55 : 0.85 }));
  top.position.y = 0.004; top.receiveShadow = true;
  g.add(top);
  world.add(g);
  return g;
}

// Điểm trên mép đảo theo hướng dir (từ tâm đảo)
function edgePoint(cfg, dir) {
  if (cfg.r) return new THREE.Vector3(cfg.x + dir.x * cfg.r, cfg.y, cfg.z + dir.z * cfg.r);
  const t = Math.min(Math.abs((cfg.w / 2) / (dir.x || 1e-6)), Math.abs((cfg.d / 2) / (dir.z || 1e-6)));
  return new THREE.Vector3(cfg.x + dir.x * t, cfg.y, cfg.z + dir.z * t);
}

function buildBridge(world, from, to, color) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const g = new THREE.Group();
  const plank = shade(new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.14, len, 2, 0.04), M('#ece4d7', { roughness: 0.8 })));
  plank.position.y = -0.07; g.add(plank);
  const n = Math.max(2, Math.floor(len / 0.32));
  for (let i = 0; i < n; i++) {
    const s = box(1.0, 0.02, 0.1, '#d6c9b5', { r: 0 }); s.castShadow = false;
    s.position.set(0, 0.0, -len / 2 + (i + 0.5) * (len / n)); g.add(s);
  }
  const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15, roughness: 0.5 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, len - 0.2), glowMat); strip.position.y = 0.02; g.add(strip);
  for (const sx of [-0.56, 0.56]) {
    const rail = box(0.035, 0.035, len, P.black, { r: 0.01 }); rail.position.set(sx, 0.5, 0); g.add(rail);
    for (const zz of [-len / 2 + 0.1, 0, len / 2 - 0.1]) { const post = cyl(0.018, 0.018, 0.5, P.black); post.position.set(sx, 0, zz); g.add(post); }
  }
  g.position.copy(from).add(to).multiplyScalar(0.5);
  g.lookAt(to);
  world.add(g);

  // hạt sáng chạy từ đảo điều phối ra khu đang làm việc
  const pulses = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.95 }));
    m.visible = false; world.add(m); return m;
  });
  let active = false, glow = 0.15;
  return {
    setActive(on) { active = on; },
    tick(t) {
      glow += ((active ? 1.1 : 0.15) - glow) * 0.08;
      glowMat.emissiveIntensity = glow;
      pulses.forEach((p, i) => {
        p.visible = active;
        if (!active) return;
        const f = ((t * 0.45) + i / 3) % 1;
        p.position.copy(from).lerp(to, f); p.position.y += 0.16 + Math.sin(f * Math.PI) * 0.15;
      });
    },
  };
}

function buildIslands(world, tickers) {
  for (const [k, cfg] of Object.entries(ISLANDS)) buildIsland(world, k, cfg);
  const hub = ISLANDS.B;
  const bridges = {};
  for (const k of ['A', 'C', 'D', 'E']) {
    const c = ISLANDS[k];
    const dir = new THREE.Vector3(c.x - hub.x, 0, c.z - hub.z).normalize();
    const a = edgePoint(hub, dir).add(dir.clone().multiplyScalar(-0.3));
    const b = edgePoint(c, dir.clone().negate()).add(dir.clone().multiplyScalar(0.3));
    a.y = hub.y; b.y = c.y;
    bridges[k] = Object.assign(buildBridge(world, a, b, ZONES[k].color), { hubEnd: a, islandEnd: b });
  }

  // Bóng nền phía dưới (cho cảm giác các đảo đang lơ lửng)
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShadowMaterial({ opacity: 0.1 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = -3.2; catcher.receiveShadow = true;
  world.add(catcher);
  return bridges;
}

// Vòng quỹ đạo quanh đảo điều phối: mỗi chấm là một người trong team của Grid, sáng lên khi đang làm
function buildHubOrbit(world, tickers) {
  const hub = ISLANDS.B;
  const g = new THREE.Group(); g.position.set(hub.x, hub.y, hub.z); world.add(g);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: P.teal, toneMapped: false, transparent: true, opacity: 0.7 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  const team = AGENTS.filter((a) => a.reportsTo === 'manager');
  const dots = team.map((a) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.2, roughness: 0.4 }));
    m.castShadow = true; g.add(m); return { a, m, on: 0 };
  });
  let states = {};
  tickers.push((t) => {
    dots.forEach((d, i) => {
      const ang = t * 0.25 + (i / dots.length) * Math.PI * 2;
      d.m.position.set(Math.cos(ang) * 2.55, 0.16 + Math.sin(t * 2 + i) * 0.03, Math.sin(ang) * 2.55);
      const target = states[d.a.id] === 'working' ? 1 : states[d.a.id] === 'blocked' ? 0.7 : 0;
      d.on += (target - d.on) * 0.06;
      d.m.material.emissiveIntensity = 0.15 + d.on * 1.3;
      d.m.scale.setScalar(1 + d.on * 0.45);
    });
  });
  return { setData(agents) { states = Object.fromEntries(Object.entries(agents).map(([k, v]) => [k, v.state])); } };
}

// ======================================================================
// MÀN HÌNH LỚN Ở ĐẢO ĐIỀU PHỐI — bảng công việc
function buildBigScreen(world, at) {
  const W = 4.8, H = 2.4, LIFT = 1.15;
  const g = new THREE.Group(); g.position.set(at.x, at.y, at.z); world.add(g);
  for (const sx of [-W / 2 + 0.3, W / 2 - 0.3]) { const leg = box(0.08, LIFT + 0.2, 0.08, P.black, { r: 0.02 }); leg.position.set(sx, 0, -0.08); g.add(leg); }
  const bezel = box(W + 0.18, H + 0.18, 0.12, '#1b1c20', { r: 0.05, m: { roughness: 0.4 } });
  bezel.position.set(0, LIFT, -0.06); g.add(bezel);
  const cv = canvasTex(1600, 800, () => {});
  const screen = texPlane(W, H, cv.tex, { basic: true });
  screen.position.set(0, LIFT + 0.09 + H / 2, 0.005); g.add(screen);
  const pos = new THREE.Vector3(at.x, at.y + LIFT + H / 2, at.z);

  let data = null;
  let last = 0;
  const { ctx } = cv;
  function draw(t) {
    const w = 1600, h = 800;
    ctx.fillStyle = '#14181c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = P.teal; ctx.fillRect(48, 50, 14, 52);
    ctx.fillStyle = '#ffffff'; ctx.font = `800 46px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText('BẢNG ĐIỀU PHỐI — VIỆC ĐANG CHẠY', 84, 78);
    const now = new Date();
    ctx.textAlign = 'right'; ctx.font = `700 40px ${MONO}`; ctx.fillStyle = '#5fe0d6';
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
      ctx.fillText(`Giao Grid trọn gói, hoặc gọi thẳng tên từng bạn trong team`, w / 2, 425);
      ctx.textAlign = 'left';
    }
    tasks.forEach((tk, i) => {
      const y = 228 + i * 78;
      const who = PEOPLE[tk.assignee] || { name: tk.assignee || '—', color: '#888' };
      const st = STATES[tk.state] || STATES.idle;
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(48, y - 36, w - 96, 74); }
      ctx.fillStyle = who.color; roundRect(ctx, 60, y - 22, 44, 44, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 24px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(who.name[0] || '?', 82, y + 1); ctx.textAlign = 'left';
      ctx.font = `700 30px ${FONT}`; ctx.fillText(who.name, 120, y - (tk.assignedBy === 'manager' ? 9 : 0));
      if (tk.assignedBy === 'manager') { ctx.font = `600 18px ${MONO}`; ctx.fillStyle = '#5fe0d6'; ctx.fillText('← GRID GIAO', 120, y + 20); }
      ctx.font = `500 28px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(fit(ctx, `${tk.project ? tk.project + ' · ' : ''}${tk.title || tk.id}`, 640), cols[1], y);
      ctx.font = `700 22px ${MONO}`;
      const pw = ctx.measureText(st.label).width + 44;
      ctx.fillStyle = st.color; roundRect(ctx, cols[2], y - 21, pw, 42, 21); ctx.fill();
      ctx.fillStyle = tk.state === 'idle' ? '#fff' : '#16171c';
      ctx.fillText(st.label, cols[2] + 22, y + 1);
      const bw = 220, p = (tk.progress || 0) / 100;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(ctx, cols[3], y - 8, bw, 16, 8); ctx.fill();
      if (p > 0) { ctx.fillStyle = st.color; roundRect(ctx, cols[3], y - 8, Math.max(16, bw * p), 16, 8); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.font = `700 24px ${MONO}`; ctx.fillText(`${Math.round(p * 100)}%`, cols[3] + bw + 18, y + 1);
    });

    // ticker
    ctx.fillStyle = P.teal; ctx.fillRect(0, h - 70, w, 70);
    ctx.save(); ctx.beginPath(); ctx.rect(0, h - 70, w, 70); ctx.clip();
    const items = [];
    for (const a of AGENTS) {
      const s = data?.agents?.[a.id];
      if (s) items.push(`${a.name.toUpperCase()} · ${STATES[s.state].label}${s.state === 'working' ? ' ' + s.progress + '%' : ''}`);
    }
    const msg = items.join('   ◆   ') + '   ◆   ';
    ctx.fillStyle = '#0b1f1f'; ctx.font = `700 28px ${MONO}`;
    const mw = ctx.measureText(msg).width || 1;
    let x = -((t * 90) % mw);
    while (x < w) { ctx.fillText(msg, x, h - 34); x += mw; }
    ctx.restore();
    cv.tex.needsUpdate = true;
  }
  return {
    pos,
    setData(d) { data = d; },
    tick(t) { if (t - last > 1 / 15) { last = t; draw(t); } },
  };
}

function fit(ctx, s, max) {
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
function wrap(ctx, text, max, lines) {
  const words = String(text).split(/\s+/); const out = []; let cur = '';
  for (const wd of words) {
    const next = cur ? cur + ' ' + wd : wd;
    if (ctx.measureText(next).width > max && cur) { out.push(cur); cur = wd; if (out.length === lines) break; } else cur = next;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = fit(ctx, out[lines - 1] + '…', max);
  return out;
}

// MÀN HÌNH CHAT CHUNG ở quảng trường — hiện các tin mới nhất của kênh công ty
function buildChatScreen(world, at) {
  const W = 3.6, H = 2.0, LIFT = 0.95;
  const g = new THREE.Group(); g.position.set(at.x, at.y, at.z); world.add(g);
  for (const sx of [-W / 2 + 0.25, W / 2 - 0.25]) { const leg = box(0.07, LIFT + 0.2, 0.07, P.black, { r: 0.02 }); leg.position.set(sx, 0, -0.07); g.add(leg); }
  const frame = box(W + 0.14, H + 0.14, 0.1, P.orange, { r: 0.05, m: { roughness: 0.5 } }); frame.position.set(0, LIFT, -0.05); g.add(frame);
  const cv = canvasTex(1080, 600, () => {});
  const screen = texPlane(W, H, cv.tex, { basic: true }); screen.position.set(0, LIFT + 0.07 + H / 2, 0.005); g.add(screen);
  screen.userData.openChat = true;
  let msgs = [], key = '', dirty = true, last = 0;
  const { ctx } = cv;
  function draw(t) {
    const w = 1080, h = 600;
    ctx.fillStyle = '#fbf7f0'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = P.orange; ctx.fillRect(0, 0, w, 78);
    ctx.fillStyle = '#fff'; ctx.font = `800 36px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText('# chung · cả công ty', 30, 40);
    ctx.textAlign = 'right'; ctx.font = `700 24px ${MONO}`; ctx.fillText(`${msgs.length} TIN`, w - 30, 41); ctx.textAlign = 'left';
    const show = msgs.slice(-3);
    if (!show.length) { ctx.fillStyle = '#958d81'; ctx.font = `600 30px ${FONT}`; ctx.fillText('Chưa có tin nào — bấm để mở chat', 30, 300); }
    show.forEach((m, i) => {
      const y = 112 + i * 160;
      const p = PEOPLE[m.from] || { name: m.from, color: '#888' };
      ctx.fillStyle = m.from === 'cd' ? P.black : p.color; ctx.beginPath(); ctx.arc(64, y + 34, 32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = m.from === 'cd' ? P.yellow : '#fff'; ctx.font = `800 30px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText((p.name || '?')[0], 64, y + 36); ctx.textAlign = 'left';
      ctx.fillStyle = '#1d1c19'; ctx.font = `800 28px ${FONT}`; ctx.fillText(m.from === 'cd' ? 'Anh Nekoma' : p.name, 118, y + 14);
      ctx.fillStyle = '#3d3a34'; ctx.font = `500 26px ${FONT}`;
      wrap(ctx, m.text, w - 160, 2).forEach((ln, j) => ctx.fillText(ln, 118, y + 54 + j * 36));
    });
    // con trỏ "đang gõ"
    ctx.fillStyle = '#c9bfb0';
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - i)); ctx.beginPath(); ctx.arc(w - 90 + i * 24, h - 30, 7, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    cv.tex.needsUpdate = true;
  }
  return {
    mesh: screen,
    setData(list) { const k = list.length + '|' + (list.at(-1)?.time || ''); if (k !== key) { key = k; msgs = list; dirty = true; } },
    tick(t) { if (dirty || t - last > 0.2) { dirty = false; last = t; draw(t); } },
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
    } else if (kind === 'wire' || kind === 'wire2') {
      // khối 3D dạng wireframe
      ctx.fillStyle = kind === 'wire' ? '#1f2440' : '#eef0fa'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = kind === 'wire' ? '#7f9cff' : '#3a5bd9'; ctx.lineWidth = 3;
      const cx = w / 2, cy = h * 0.42, r = 120;
      for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, r, r * Math.abs(Math.cos(i / 7 * Math.PI)), 0, 0, Math.PI * 2); ctx.stroke(); }
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, r * Math.abs(Math.cos(i / 6 * Math.PI)), r, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = kind === 'wire' ? '#fff' : '#1f2440'; ctx.font = `800 42px ${FONT}`; ctx.fillText(kind === 'wire' ? 'MESH' : 'TOPO', 30, h - 40);
    } else if (kind === 'render') {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f2e6d8'); g.addColorStop(1, '#d6c3ad'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const s = ctx.createRadialGradient(w * 0.42, h * 0.36, 10, w / 2, h * 0.42, 140); s.addColorStop(0, '#ffffff'); s.addColorStop(0.35, '#e8582c'); s.addColorStop(1, '#5a1d0c');
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.68, 130, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s; ctx.beginPath(); ctx.arc(w / 2, h * 0.42, 140, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#26241f'; ctx.font = `600 22px ${MONO}`; ctx.fillText('CYCLES · 512 spp', 30, h - 36);
    } else if (kind === 'film') {
      ctx.fillStyle = '#26241f'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const y = 40 + i * 125; ctx.fillStyle = ['#7a4fd0', '#e8582c', '#f2c230', '#2f7a50'][i]; ctx.fillRect(70, y, w - 140, 100);
        ctx.fillStyle = '#fbf9f5'; for (let k = 0; k < 6; k++) { ctx.fillRect(22, y + k * 18, 26, 10); ctx.fillRect(w - 48, y + k * 18, 26, 10); }
      }
    } else if (kind === 'wave') {
      ctx.fillStyle = '#efe9fb'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#7a4fd0'; ctx.lineWidth = 6;
      for (let r = 0; r < 3; r++) { ctx.beginPath(); for (let x = 20; x < w - 20; x += 4) { const y = 150 + r * 130 + Math.sin(x / 26 + r) * 40 * Math.sin(x / 120); x === 20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
      ctx.fillStyle = '#26241f'; ctx.font = `800 40px ${FONT}`; ctx.fillText('100 BPM', 30, 70);
    } else if (kind === 'keys') {
      ctx.fillStyle = '#1b1d24'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      for (let x = 30; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, h - 40); ctx.stroke(); }
      ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(30, h - 100); ctx.bezierCurveTo(160, h - 100, 160, 120, w - 40, 120); ctx.stroke();
      ctx.fillStyle = '#f2c230'; for (const [x, y] of [[30, h - 100], [w - 40, 120]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-10, -10, 20, 20); ctx.restore(); }
      ctx.fillStyle = '#fff'; ctx.font = `700 30px ${MONO}`; ctx.fillText('EASE IN-OUT', 30, h - 30);
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


function wallPiece(len, h, ry = 0) {
  const g = new THREE.Group();
  const w = box(len, h, 0.22, P.wall, { r: 0.04 }); g.add(w);
  const cap = box(len + 0.04, 0.06, 0.26, '#e7ded2', { r: 0.02 }); cap.position.y = h; g.add(cap);
  const sb = box(len - 0.02, 0.12, 0.04, P.trim, { r: 0.01 }); sb.position.z = 0.12; g.add(sb);
  g.rotation.y = ry;
  return g;
}

function bookshelf(w = 2.2, h = 2.3) {
  const g = new THREE.Group();
  const col = P.wood;
  for (const sx of [-w / 2, w / 2]) { const s = box(0.06, h, 0.42, col, { r: 0.015 }); s.position.x = sx; g.add(s); }
  const books = ['#2f7a50', '#f2c230', '#3a5bd9', '#efe4cf', '#26241f', '#e8582c', '#d9488b', '#f4f1ea'];
  for (let i = 0; i < 4; i++) {
    const y = 0.08 + i * (h - 0.1) / 4;
    const s = box(w, 0.04, 0.42, col, { r: 0.01 }); s.position.y = y; g.add(s);
    if (i === 3) continue;
    let x = -w / 2 + 0.12;
    let k = i * 3;
    while (x < w / 2 - 0.2) {
      const bw = 0.07 + ((k * 37) % 5) * 0.012, bh = 0.32 + ((k * 13) % 4) * 0.05;
      if ((k * 7) % 11 === 0) { x += 0.18; k++; continue; }
      const b = box(bw, bh, 0.3, books[k % books.length], { r: 0.008 }); b.position.set(x + bw / 2, y + 0.04, 0); g.add(b);
      x += bw + 0.01; k++;
    }
  }
  return g;
}

function buildDecor(world, tickers) {
  // ---------------- C · PHÒNG CHỮ (Brief + Ink) ----------------
  const C = ISLANDS.C, cBack = BACK('C'), cLeft = C.x - C.w / 2 + 0.26;
  const wb = wallPiece(C.w - 0.5, 3.3); wb.position.set(C.x, 0, cBack - 0.11); world.add(wb);
  const wl = wallPiece(C.d - 0.7, 3.3, Math.PI / 2); wl.position.set(cLeft - 0.11, 0, C.z - 0.1); world.add(wl);

  // biển tên studio trên tường trái
  const sign = canvasTex(1400, 360, (ctx) => {
    ctx.fillStyle = P.black; ctx.font = `800 150px ${FONT}`; ctx.fillText('NEKOMA', 8, 160);
    ctx.fillStyle = P.orange; ctx.fillText('STUDIO', 8, 300);
    ctx.fillStyle = '#6b6357'; ctx.font = `600 34px ${MONO}`;
    ctx.fillText('CREATIVE AI PRODUCTION LAB', 640, 290);
  });
  const signMesh = texPlane(4.0, 1.03, sign.tex, { transparent: true });
  signMesh.rotation.y = Math.PI / 2; signMesh.position.set(cLeft + 0.01, 2.55, C.z - 0.2); world.add(signMesh);

  // bảng ghim của Brief
  const bx = STATIONS.brief.x;
  const cork = box(2.0, 1.25, 0.05, '#c69a6b', { r: 0.02, m: { roughness: 0.95 } }); put(cork, bx, 1.55, cBack + 0.02); world.add(cork);
  ['#fff3b0', '#ffd6c2', '#d8f0d2', '#ffffff', '#cfe0ff', '#fff3b0'].forEach((c, i) => {
    const n = box(0.36, 0.42, 0.01, c, { r: 0 }); n.castShadow = false;
    n.position.set(bx - 0.72 + (i % 3) * 0.72, 1.7 + (i < 3 ? 0.55 : 0) - 0.25, cBack + 0.075);
    n.rotation.z = Math.sin(i * 4.1) * 0.12; world.add(n);
    const pin = sph(0.025, P.red); pin.position.set(n.position.x, n.position.y + 0.36, cBack + 0.09); world.add(pin);
  });
  // tủ sách chung + chữ lớn của Ink
  const shelf = bookshelf(2.4, 2.4); shelf.position.set(STATIONS.ink.x - 0.1, 0, cBack + 0.24); world.add(shelf);
  const typo = framedPoster('typo', 0.9, 1.26, P.black); typo.position.set(C.x + C.w / 2 - 0.9, 2.6, cBack + 0.02); world.add(typo);
  // đèn thả dài nối 2 bàn — một bàn làm việc chung
  const rugC = box(5.4, 0.015, 2.2, '#e8dcc6', { r: 0.005, m: { roughness: 1 } }); rugC.castShadow = false; rugC.position.set(C.x - 0.1, 0.004, STATIONS.brief.z - 0.6); world.add(rugC);
  const pend = box(4.6, 0.06, 0.12, P.black, { r: 0.02 }); pend.position.set(C.x - 0.1, 2.75, STATIONS.brief.z - 0.9); world.add(pend);
  const pendLight = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.02, 0.08), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff1d6', emissiveIntensity: 1.2 }));
  pendLight.position.set(C.x - 0.1, 2.74, STATIONS.brief.z - 0.9); world.add(pendLight);
  for (const dx of [-2.1, 2.1]) { const wire = cyl(0.006, 0.006, 0.55, P.black); wire.position.set(C.x - 0.1 + dx, 2.8, STATIONS.brief.z - 0.9); world.add(wire); }
  // tủ hồ sơ + cây
  const cab = box(0.6, 1.1, 0.6, '#d9d4cb', { r: 0.03, m: { roughness: 0.5 } }); put(cab, cLeft + 0.45, 0, C.z + 1.9); world.add(cab);
  ['#e8582c', '#3a5bd9', '#f2c230'].forEach((c, i) => { const f = box(0.42, 0.05, 0.32, c, { r: 0.01 }); put(f, cLeft + 0.45, 1.1 + i * 0.05, C.z + 1.9, i * 0.15); world.add(f); });
  const pc1 = plant(1.15); pc1.position.set(cLeft + 0.45, 0, cBack + 0.45); world.add(pc1);
  const pc2 = plant(0.85, P.orange); pc2.position.set(C.x + C.w / 2 - 0.5, 0, cBack + 0.5); world.add(pc2);

  // ---------------- A · TẦNG CHỈ HUY (Nekoma + Lue) ----------------
  const A = ISLANDS.A, aBack = BACK('A'), ay = A.y;
  const wa = wallPiece(A.w - 0.5, 3.0); wa.position.set(A.x, ay, aBack - 0.11); world.add(wa);
  // moodboard sau lưng CD
  const mb = canvasTex(900, 520, (ctx, w, h) => {
    ctx.fillStyle = '#f7f3ec'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26241f'; ctx.font = `800 34px ${FONT}`; ctx.fillText('MOODBOARD · DIRECTION', 30, 54);
    ['#e8582c', '#f2c230', '#2f7a50', '#efe4cf', '#26241f', '#14a3a0'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(30 + i * 70, 82, 60, 60); });
    [['#d7b48f', '#a0583a'], ['#2f4f44', '#9cc6a8'], ['#f0c46a', '#e8582c'], ['#3a5bd9', '#c9d6ff']].forEach(([a, b], i) => {
      const x = 30 + (i % 2) * 220, y = 170 + Math.floor(i / 2) * 170;
      const g = ctx.createLinearGradient(x, y, x + 200, y + 150); g.addColorStop(0, a); g.addColorStop(1, b);
      ctx.fillStyle = g; ctx.fillRect(x, y, 200, 150);
    });
    ctx.fillStyle = '#26241f'; ctx.font = `800 64px ${FONT}`; ctx.fillText('Aa', 500, 260);
    ctx.font = `500 22px ${MONO}`; ctx.fillText('Be Vietnam Pro / 800', 500, 300);
    ctx.fillStyle = '#e8582c'; ctx.beginPath(); ctx.arc(700, 420, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#26241f'; ctx.font = `600 22px ${MONO}`; ctx.fillText('v2 · đang chốt', 500, 470);
  });
  const mbMesh = texPlane(2.9, 1.68, mb.tex); mbMesh.position.set(STATIONS.cd.x, ay + 1.95, aBack + 0.02); world.add(mbMesh);
  const mbFrame = box(3.0, 1.78, 0.03, P.white, { r: 0.01 }); put(mbFrame, STATIONS.cd.x, ay + 1.95 - 0.89, aBack + 0.005); world.add(mbFrame);
  // neon tên CD
  const neonTex = canvasTex(512, 128, (ctx, w, h) => {
    ctx.shadowColor = '#ffcf3a'; ctx.shadowBlur = 18; ctx.fillStyle = '#ffe27a';
    ctx.font = `800 70px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★ NEKOMA', w / 2, h / 2 + 4);
  });
  const neon = texPlane(2.0, 0.5, neonTex.tex, { basic: true, transparent: true }); neon.position.set(STATIONS.cd.x, ay + 3.2, aBack + 0.03); world.add(neon);
  // lịch của Lue + đồng hồ
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
  const calMesh = texPlane(0.9, 1.05, cal.tex); calMesh.position.set(A.x - A.w / 2 + 1.1, ay + 1.9, aBack + 0.02); world.add(calMesh);
  const clock = new THREE.Group();
  const face = cyl(0.38, 0.38, 0.06, P.white, { seg: 40 }); face.rotation.x = Math.PI / 2; clock.add(face);
  clock.add(new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 10, 40), M(P.black)));
  const hp = grp(box(0.04, 0.22, 0.02, P.black, { r: 0 })), mp = grp(box(0.03, 0.31, 0.02, P.black, { r: 0 })), sp = grp(box(0.012, 0.33, 0.02, P.orange, { r: 0 }));
  [hp, mp, sp].forEach((h, i) => { h.position.z = 0.04 + i * 0.012; clock.add(h); });
  clock.position.set(A.x - A.w / 2 + 2.5, ay + 2.4, aBack + 0.04); world.add(clock);
  tickers.push(() => {
    const d = new Date();
    const s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    sp.rotation.z = -(s / 60) * Math.PI * 2; mp.rotation.z = -(m / 60) * Math.PI * 2; hp.rotation.z = -(h / 12) * Math.PI * 2;
  });
  // lan can kính mép trước tầng chỉ huy
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#dff1f5', roughness: 0.05, transparent: true, opacity: 0.25 });
  const railLen = A.w - 2.2, railX = A.x + 0.9, railZ = A.z + A.d / 2 - 0.2;
  const rail = box(railLen, 0.7, 0.04, null, { mat: glassMat, r: 0.01 }); rail.castShadow = false; put(rail, railX, ay, railZ); world.add(rail);
  const bar = box(railLen, 0.05, 0.07, P.black, { r: 0.02 }); put(bar, railX, ay + 0.7, railZ); world.add(bar);
  const pa1 = plant(1.1); pa1.position.set(A.x + A.w / 2 - 0.55, ay, aBack + 0.5); world.add(pa1);
  const pa2 = plant(0.8, P.yellow); pa2.position.set(A.x + A.w / 2 - 0.55, ay, A.z + 1.6); world.add(pa2);
  const rugA = box(3.4, 0.015, 2.6, '#26241f', { r: 0.005, m: { roughness: 1 } }); rugA.castShadow = false; rugA.position.set(STATIONS.cd.x, ay + 0.004, STATIONS.cd.z + 0.4); world.add(rugA);

  // ---------------- D · XƯỞNG HÌNH (Pixel, Cube, Frame) — 3 phòng kính ----------------
  buildPod(world, STATIONS.pixel.x, STATIONS.pixel.z - 0.45, { rug: '#d9cdb7', posters: ['circles', 'swatch', 'quote'], side: ['typo', 'shapes'], fan: true });
  buildPod(world, STATIONS.cube.x, STATIONS.cube.z - 0.45, { rug: '#cfd6ef', posters: ['wire', 'render', 'wire2'] });
  buildPod(world, STATIONS.frame.x, STATIONS.frame.z - 0.45, { rug: '#ddd0ef', posters: ['film', 'wave', 'keys'] });
  // máy quay của Frame
  const tri = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.02, 0.02, 1.55, P.black); leg.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22); tri.add(leg);
  }
  const cam = box(0.42, 0.3, 0.26, P.black, { r: 0.04 }); cam.position.y = 1.5; tri.add(cam);
  const lens = cyl(0.1, 0.12, 0.25, '#3a3a3e'); lens.rotation.x = Math.PI / 2; lens.position.set(0, 1.65, -0.24); tri.add(lens);
  const rec = sph(0.03, '#ff3b30', { m: { emissive: '#ff3b30', emissiveIntensity: 1.5 } }); rec.position.set(0.15, 1.75, 0.0); tri.add(rec);
  tri.position.set(ISLANDS.D.x + ISLANDS.D.w / 2 - 0.55, 0, ISLANDS.D.z + ISLANDS.D.d / 2 - 0.6); tri.rotation.y = -2.2;
  world.add(tri);
  tickers.push((t) => { rec.visible = Math.sin(t * 4) > 0; });
  // kệ đỏ ở góc xưởng
  const shelfD = new THREE.Group();
  for (const yy of [0.1, 0.75, 1.4]) { const s = box(1.9, 0.05, 0.5, P.red, { r: 0.015, m: { roughness: 0.5 } }); s.position.y = yy; shelfD.add(s); }
  for (const xx of [-0.92, 0.92]) for (const zz of [-0.22, 0.22]) { const leg = box(0.04, 1.5, 0.04, P.red, { r: 0.01 }); put(leg, xx, 0, zz); shelfD.add(leg); }
  ['#2f7a50', '#f2c230', '#3a5bd9', '#efe4cf', '#26241f'].forEach((c, i) => { const b = box(0.08, 0.36 + (i % 2) * 0.06, 0.3, c, { r: 0.01 }); put(b, -0.7 + i * 0.1, 0.8, 0); shelfD.add(b); });
  const speaker = box(0.3, 0.38, 0.3, P.yellow, { r: 0.04 }); put(speaker, 0.5, 0.13, 0); shelfD.add(speaker);
  const vase = cyl(0.08, 0.1, 0.3, P.cream); put(vase, 0.6, 1.45, 0); shelfD.add(vase);
  shelfD.position.set(ISLANDS.D.x - 2.2, 0, ISLANDS.D.z + ISLANDS.D.d / 2 - 0.45);
  world.add(shelfD);
  const pd = plant(1.2); pd.position.set(ISLANDS.D.x - ISLANDS.D.w / 2 + 0.5, 0, ISLANDS.D.z + ISLANDS.D.d / 2 - 0.5); world.add(pd);

  // ---------------- Khối kính lơ lửng quanh mô hình ----------------
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 0.2 });
  const floaters = [[15, 2.5, -2], [-15, 1.5, 0], [3, 4.5, 11], [-3, 5.5, -11], [14, 0.5, 10]].map(([x, y, z], i) => {
    const m = box(0.5, 0.5, 0.5, null, { mat: glass, r: 0.04 }); m.castShadow = false;
    m.position.set(x, y, z); m.rotation.set(0.4, i, 0.2); world.add(m); return m;
  });
  tickers.push((t) => floaters.forEach((m, i) => { m.position.y += Math.sin(t * 0.8 + i) * 0.002; m.rotation.y += 0.002; }));
}

// Phòng kính kiểu "hộp trưng bày" cho từng designer
function buildPod(world, cx, cz, o) {
  const sw = 2.72, sd = 2.9, h = 2.75;
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: '#e8f6f7', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const edge = new THREE.LineBasicMaterial({ color: '#9fc9cf', transparent: true, opacity: 0.9 });
  for (const [w, x, z, ry] of [[sw, 0, -sd / 2, 0], [sd, -sw / 2, 0, Math.PI / 2]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
    p.position.set(x, h / 2, z); p.rotation.y = ry; g.add(p);
  }
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sw, h, sd)), edge);
  outline.position.y = h / 2; g.add(outline);
  const base = box(sw + 0.06, 0.05, sd + 0.06, '#cfe3e6', { r: 0.02, m: { roughness: 0.2 } }); base.position.y = -0.02; g.add(base);
  const rug = box(sw - 0.3, 0.02, sd - 0.4, o.rug, { r: 0.01, m: { roughness: 1 } }); rug.position.set(0, 0.03, 0.1); g.add(rug);
  o.posters.forEach((k, i) => {
    const m = texPlane(0.66, 0.92, posterTex(k).tex); m.position.set(-0.85 + i * 0.85, 2.0, -sd / 2 + 0.03); g.add(m);
  });
  (o.side || []).forEach((k, i) => {
    const m = texPlane(0.66, 0.92, posterTex(k).tex); m.position.set(-sw / 2 + 0.03, 2.0, -0.55 + i * 0.95); m.rotation.y = Math.PI / 2; g.add(m);
  });
  ['#3a5bd9', '#f2c230', '#efe4cf', '#e8582c'].forEach((c, i) => { const b = box(0.4, 0.07, 0.3, c, { r: 0.01 }); put(b, -sw / 2 + 0.35, 0.05 + i * 0.07, sd / 2 - 0.4, i * 0.2); g.add(b); });
  if (o.fan) {
    const fan = new THREE.Group();
    fan.add(cyl(0.14, 0.16, 0.04, P.white));
    fan.add(cyl(0.022, 0.022, 0.42, P.white));
    const head = cyl(0.2, 0.2, 0.07, P.white); head.rotation.x = Math.PI / 2; head.position.y = 0.55; fan.add(head);
    fan.position.set(sw / 2 - 0.3, 0.04, sd / 2 - 0.35); g.add(fan);
  }
  g.position.set(cx, 0, cz);
  world.add(g);
}

// ---------------- E · QUẢNG TRƯỜNG CHAT ----------------
function buildLounge(world, tickers) {
  const E = ISLANDS.E;
  const g = new THREE.Group();
  // bàn kính
  const glass = new THREE.MeshPhysicalMaterial({ color: '#eaf6f7', roughness: 0.05, transparent: true, opacity: 0.35 });
  const top = box(1.3, 0.05, 0.8, null, { mat: glass, r: 0.01 }); top.position.y = 0.45; g.add(top);
  for (const [a, b] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) { const l = box(0.04, 0.45, 0.04, null, { mat: glass, r: 0.01 }); put(l, a, 0, b); g.add(l); }
  const mag = box(0.4, 0.04, 0.3, '#f7f3ec', { r: 0.01 }); put(mag, -0.2, 0.5, 0.05, 0.3); g.add(mag);
  const cup = cyl(0.06, 0.05, 0.12, P.white); put(cup, 0.35, 0.5, -0.1); g.add(cup);
  g.add(armchair(P.green, -1.8, 0.5, 0.9));
  g.add(armchair('#efe6d4', -0.2, 1.45, Math.PI + 0.1));
  g.add(armchair(P.orange, 1.7, 0.6, -0.9));
  // đèn cây vòng cung
  const lamp = new THREE.Group();
  lamp.add(cyl(0.25, 0.28, 0.05, P.black));
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0.5, 2.5, 0), new THREE.Vector3(1.3, 2.3, 0)]);
  lamp.add(shade(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 8), M(P.metal, { metalness: 0.7, roughness: 0.3 }))));
  const shadeM = shade(new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: P.white, emissive: '#fff4dc', emissiveIntensity: 0.5, side: THREE.DoubleSide })));
  shadeM.position.set(1.3, 2.25, 0); lamp.add(shadeM);
  lamp.position.set(-2.8, 0, 1.6); lamp.rotation.y = 0.6;
  g.add(lamp);
  const pl = plant(1.2); pl.position.set(3.4, 0, 2.0); g.add(pl);
  const pl2 = plant(0.9, P.orange); pl2.position.set(-3.5, 0, -1.6); g.add(pl2);
  g.position.set(E.x, E.y, E.z + 0.5);
  world.add(g);

  // Bong bóng chat 3D bay lơ lửng — bấm vào để mở Chat công ty
  const clickables = [];
  const bubbleDefs = [
    { x: E.x + 2.9, y: E.y + 3.3, z: E.z - 0.4, c: P.orange, fg: '#fff', txt: '•••', s: 1 },
    { x: E.x - 2.6, y: E.y + 2.7, z: E.z + 1.4, c: P.white, fg: P.black, txt: 'Hi!', s: 0.85 },
    { x: E.x + 3.3, y: E.y + 2.1, z: E.z + 2.2, c: P.teal, fg: '#fff', txt: '@', s: 0.7 },
  ];
  const bubbles = bubbleDefs.map((b, i) => {
    const grpB = new THREE.Group();
    const body = box(1.3, 0.82, 0.32, b.c, { r: 0.16, m: { roughness: 0.45 } }); body.position.y = -0.41; grpB.add(body);
    const tail = shade(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), M(b.c, { roughness: 0.45 })));
    tail.rotation.z = Math.PI; tail.position.set(-0.35, -0.5, 0); grpB.add(tail);
    const tx = canvasTex(256, 160, (ctx, w, h) => { ctx.fillStyle = b.fg; ctx.font = `800 96px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.txt, w / 2, h / 2 + 4); });
    const face = texPlane(1.1, 0.68, tx.tex, { transparent: true, basic: true }); face.position.set(0, 0, 0.17); grpB.add(face);
    grpB.scale.setScalar(b.s); grpB.position.set(b.x, b.y, b.z); grpB.rotation.y = Math.PI / 4;
    grpB.userData.openChat = true;
    world.add(grpB); clickables.push(grpB);
    return { g: grpB, base: b.y, i };
  });
  tickers.push((t) => bubbles.forEach((b) => { b.g.position.y = b.base + Math.sin(t * 1.2 + b.i * 1.7) * 0.12; b.g.rotation.y = Math.PI / 4 + Math.sin(t * 0.5 + b.i) * 0.15; }));
  return clickables;
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
  const deskW = person.id === 'cd' || person.id === 'manager' ? 2.2 : 1.75;
  const desk = new THREE.Group();
  const top = box(deskW, 0.06, 0.85, person.id === 'cd' ? P.black : person.id === 'manager' ? '#f4f1ea' : P.wood, { r: 0.025, m: { roughness: 0.55 } });
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
  if (person.id === 'cd' || person.id === 'frame' || person.id === 'manager') {
    const m2 = monitor.clone(); m2.position.set(-0.95, 0, -1.0); m2.rotation.y = 0.35; root.add(m2);
  }
  const kb = box(0.5, 0.025, 0.16, '#e9e5de', { r: 0.01 }); put(kb, 0, 0.84, -0.55); root.add(kb);
  const mouse = box(0.07, 0.025, 0.11, '#e9e5de', { r: 0.012 }); put(mouse, 0.38, 0.84, -0.55); root.add(mouse);

  addProps(person.id, root);

  // Ghế
  const chairCol = person.id === 'cd' ? P.orange : person.id === 'manager' ? P.teal : P.black;
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
  ch.group.userData.personId = person.id; // vẫn bấm được khi đang đi ngoài bàn
  root.add(ch.group);
  let pose = 'sit';

  // Nhãn (thẻ kính nổi)
  const tag = document.createElement('button');
  tag.className = 'tag' + (person.human ? ' tag-human' : '');
  tag.style.setProperty('--c', person.color);
  tag.innerHTML = `<span class="tag-dot"></span><span class="tag-main"><b>${person.name}</b><small>${person.role}</small></span><span class="tag-state">${person.human ? 'BẠN' : 'RẢNH'}</span>`;
  // chặn OrbitControls bắt con trỏ, nếu không thì click vào thẻ không bao giờ tới được
  tag.addEventListener('pointerdown', (e) => e.stopPropagation());
  tag.addEventListener('click', (e) => { e.stopPropagation(); onSelect(person.id); });
  const tagObj = new CSS2DObject(tag);
  tagObj.position.set(0, 2.35, -0.2);
  ch.group.add(tagObj); // thẻ tên + bong bóng đi theo người

  // Bong bóng thoại
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const bubbleObj = new CSS2DObject(bubble);
  bubbleObj.position.set(0, 3.45, -0.2);
  ch.group.add(bubbleObj);
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
    ch.animate(st, t + seed, dt, pose);
  }

  return {
    root,
    ch,
    setPose(p) { pose = p; },
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
  if (id === 'lue') {
    add(mug(P.yellow), -0.55, 0.81, -0.6);
    add(plant(0.45, P.yellow), 0.7, 0.81, -1.0);
    // vịt cao su nhỏ trên bàn
    const rd = grp(sph(0.07, '#f7d24a'), sph(0.045, '#f7d24a'));
    rd.children[0].scale.set(1.2, 0.8, 1); rd.children[1].position.set(0, 0.07, -0.04);
    const rb = sph(0.02, '#f39a2b'); rb.scale.set(1.4, 0.5, 1.2); rb.position.set(0, 0.065, -0.09); rd.add(rb);
    add(rd, -0.7, 0.86, -0.9, 0.4);
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
  if (id === 'manager') {
    add(box(0.34, 0.02, 0.46, '#1d1d20', { r: 0.02 }), -0.62, 0.81, -0.62, 0.25); // máy tính bảng
    add(mug(P.teal), 0.75, 0.81, -0.6);
    // bảng kanban mini
    ['#f0a81c', '#ec6a24', '#2f9a5c'].forEach((c, i) => add(box(0.12, 0.012, 0.16, c, { r: 0.004 }), 0.35 + i * 0.15, 0.81, -1.05));
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
  const skinTones = { manager: '#e3b48c', brief: '#efc4a0', pixel: '#f3cfb1', cube: '#d9a27a', frame: '#e8b894', ink: '#c98e66', lue: '#f7d24a', cd: '#eabf98' };
  const hairCols = { manager: '#3b2a20', brief: '#2a211c', pixel: '#5a3424', cube: '#1c1c1e', frame: '#2b2b33', ink: '#2a211c', lue: '#8a5a30', cd: '#1c1c1e' };
  const skin = M(skinTones[person.id] || P.skin, { roughness: 0.7 });
  const shirt = M(person.shirt || person.color, { roughness: 0.85 });
  const pants = M(P.pants, { roughness: 0.85 });
  const hairM = M(hairCols[person.id] || '#2a211c', { roughness: 0.9 });

  // Chân có khớp hông + gối để vừa ngồi vừa đứng/đi được (ngồi: hông π/2, gối -π/2)
  const legs = {};
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.12, 0.64, 0); g.add(hip);
    const thigh = capsule(0.095, 0.36, pants); thigh.position.y = -0.2; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
    const shin = capsule(0.085, 0.36, pants); shin.position.y = -0.27; knee.add(shin);
    const shoe = box(0.15, 0.1, 0.26, person.hair === 'duck' ? '#f39a2b' : '#f4f1ea', { r: 0.04 }); shoe.position.set(0, -0.64, -0.05); knee.add(shoe);
    hip.rotation.x = Math.PI / 2; knee.rotation.x = -Math.PI / 2;
    legs[s] = { hip, knee };
  }
  const body = new THREE.Group(); body.position.set(0, 0.6, 0.04); g.add(body);
  const torso = capsule(0.21, 0.32, shirt); torso.position.y = 0.38; torso.scale.set(1, 1, 0.8); body.add(torso);
  const neck = cyl(0.07, 0.07, 0.12, null, { mat: skin }); neck.position.y = 0.72; body.add(neck);
  const head = new THREE.Group(); head.position.y = 0.98; body.add(head);

  if (person.hair === 'duck') {
    // cô vịt: đầu vàng, mỏ cam, má hồng, nơ hồng
    const feather = M('#f7d24a', { roughness: 0.8 });
    const skull = shade(new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 16), feather)); skull.scale.set(1, 1.02, 1.05); head.add(skull);
    const beakM = M('#f39a2b', { roughness: 0.5 });
    const beakTop = shade(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), beakM)); beakTop.scale.set(1.25, 0.42, 1.15); beakTop.position.set(0, -0.03, -0.23); head.add(beakTop);
    const beakLow = shade(new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 10), beakM)); beakLow.scale.set(1.1, 0.32, 0.95); beakLow.position.set(0, -0.075, -0.2); head.add(beakLow);
    for (const s of [-1, 1]) {
      const eye = sph(0.032, P.black, { seg: 12 }); eye.position.set(s * 0.085, 0.05, -0.19); head.add(eye);
      const glint = sph(0.01, P.white, { seg: 8 }); glint.position.set(s * 0.085 + 0.01, 0.065, -0.218); head.add(glint);
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), new THREE.MeshBasicMaterial({ color: '#ff9db5', transparent: true, opacity: 0.85 }));
      cheek.position.set(s * 0.15, -0.025, -0.165); cheek.rotation.y = s * 0.75 + Math.PI; head.add(cheek);
    }
    // chỏm lông trên đỉnh đầu
    [-0.04, 0.03].forEach((x, i) => { const tuft = shade(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), feather)); tuft.scale.set(0.6, 1.4, 0.6); tuft.position.set(x, 0.25, 0.01 + i * 0.03); tuft.rotation.z = -x * 6; head.add(tuft); });
    // nơ hồng
    const bowM = M('#e8487a', { roughness: 0.45 });
    const bow = new THREE.Group();
    for (const s of [-1, 1]) { const wing = shade(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 12), bowM)); wing.rotation.z = s * Math.PI / 2; wing.position.x = s * 0.06; bow.add(wing); }
    bow.add(sph(0.03, '#c9356a', { seg: 10 }));
    bow.position.set(0.13, 0.17, 0.0); bow.rotation.set(0, 0.3, -0.5); head.add(bow);
  } else {
    const skull = shade(new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skin)); head.add(skull);
    const capG = new THREE.SphereGeometry(0.215, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hair = shade(new THREE.Mesh(capG, person.hair === 'beanie' ? M(person.color, { roughness: 0.95 }) : hairM));
    hair.rotation.x = 0.35; hair.position.set(0, 0.02, 0.02); head.add(hair);
    if (person.hair === 'bun') { const bun = shade(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), hairM)); bun.position.set(0, 0.2, 0.1); head.add(bun); }
    if (person.hair === 'long') { const back = shade(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.25, 6, 12), hairM)); back.position.set(0, -0.12, 0.08); back.scale.set(1.1, 1, 0.7); head.add(back); }
    if (person.hair === 'swept') { const quiff = shade(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), hairM)); quiff.scale.set(1.3, 0.6, 1); quiff.position.set(0.02, 0.17, -0.1); head.add(quiff); }
    if (person.id === 'manager') {
      // tai nghe điều phối
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 8, 24, Math.PI), M(P.black)); band.position.y = 0.02; head.add(band);
      for (const s of [-1, 1]) { const cup = cyl(0.06, 0.06, 0.05, P.teal); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.215, -0.01, 0); head.add(cup); }
      const mic = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.01, 6, 16, Math.PI / 2), M(P.black)); mic.rotation.set(Math.PI / 2, 0, Math.PI); mic.position.set(0.215, -0.06, -0.02); head.add(mic);
    }
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
    const fore = capsule(0.062, 0.2, skin); fore.position.y = -0.14; el.add(fore);
    const hand = shade(new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), skin)); hand.position.y = -0.29; el.add(hand);
    arms[s] = { sh, el };
  }

  // Tư thế mục tiêu theo trạng thái
  const cur = { shX: [0.3, 0.3], shZ: [0, 0], elX: [1.0, 1.0], headX: 0, headY: 0, lean: 0, hip: [Math.PI / 2, Math.PI / 2], knee: [-Math.PI / 2, -Math.PI / 2] };
  const lerp = (a, b, k) => a + (b - a) * k;

  return {
    group: g,
    // pose: 'sit' (ngồi bàn) · 'walk' (đang đi) · 'stand' (đứng nói chuyện)
    animate(state, t, dt, pose = 'sit') {
      const tgt = { shX: [0.3, 0.3], shZ: [0, 0], elX: [1.0, 1.0], headX: 0.05, headY: 0, lean: 0, hip: [Math.PI / 2, Math.PI / 2], knee: [-Math.PI / 2, -Math.PI / 2] };
      if (pose === 'walk') {
        const w = Math.sin(t * 9);
        tgt.hip = [w * 0.55, -w * 0.55];
        tgt.knee = [-Math.max(0, -w) * 0.9, -Math.max(0, w) * 0.9];
        tgt.shX = [-w * 0.5, w * 0.5]; tgt.elX = [0.35, 0.35];
        tgt.headX = 0; tgt.lean = -0.05;
      } else if (pose === 'stand') {
        tgt.hip = [0, 0]; tgt.knee = [0, 0];
        tgt.shX = [0.05, -0.35 + Math.sin(t * 4) * 0.18]; tgt.elX = [0.2, 0.9 + Math.sin(t * 5) * 0.2];
        tgt.headX = -0.05 + Math.sin(t * 3) * 0.04; tgt.headY = Math.sin(t * 1.3) * 0.12;
      } else if (state === 'working') {
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
      const kLeg = pose === 'walk' ? 1 - Math.pow(0.00001, dt) : k; // bước chân theo nhịp, không trễ
      [-1, 1].forEach((s, i) => {
        // i=0: tay/chân trái (s=-1), i=1: tay/chân phải (s=1)
        cur.shX[i] = lerp(cur.shX[i], tgt.shX[i], kLeg);
        cur.shZ[i] = lerp(cur.shZ[i], tgt.shZ[i], k);
        cur.elX[i] = lerp(cur.elX[i], tgt.elX[i], k);
        arms[s].sh.rotation.x = cur.shX[i];
        arms[s].sh.rotation.z = cur.shZ[i];
        arms[s].el.rotation.x = cur.elX[i];
        cur.hip[i] = lerp(cur.hip[i], tgt.hip[i], kLeg);
        cur.knee[i] = lerp(cur.knee[i], tgt.knee[i], kLeg);
        legs[s].hip.rotation.x = cur.hip[i];
        legs[s].knee.rotation.x = cur.knee[i];
      });
      cur.headX = lerp(cur.headX, tgt.headX, k);
      cur.headY = lerp(cur.headY, tgt.headY, k);
      cur.lean = lerp(cur.lean, tgt.lean, k);
      head.rotation.x = cur.headX; head.rotation.y = cur.headY;
      body.rotation.x = cur.lean;
      body.position.y = 0.6 + (pose === 'walk' ? Math.abs(Math.sin(t * 9)) * 0.03 : Math.sin(t * 1.6) * 0.006);
    },
  };
}
