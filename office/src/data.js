// Nguồn dữ liệu: LIVE (đọc .studio/ qua server.mjs) hoặc DEMO (giả lập khi mở trên GitHub Pages).
import { AGENTS, stateOf } from './agents.js';

const DEFAULT_STUDIO = { name: 'NEKOMA STUDIO', tagline: 'Creative AI Production Lab', established: '2026', director: 'Nekoma' };

export function normalize(raw = {}) {
  const agents = {};
  for (const a of AGENTS) {
    const s = (raw.agents && raw.agents[a.id]) || {};
    agents[a.id] = {
      agent: a.id,
      state: stateOf(s.state),
      task: s.task || '',
      taskId: s.taskId || '',
      progress: clamp(Number(s.progress) || 0, 0, 100),
      note: s.note || '',
      updated: s.updated || '',
    };
  }
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({ ...t, state: stateOf(t.state), progress: clamp(Number(t.progress) || 0, 0, 100) }));
  const chats = {};
  for (const [k, v] of Object.entries(raw.chats || {})) {
    chats[k] = (Array.isArray(v) ? v : []).filter((m) => m && m.text);
  }
  return {
    studio: { ...DEFAULT_STUDIO, ...(raw.studio || {}) },
    agents,
    tasks,
    chats,
    reports: Array.isArray(raw.reports) ? raw.reports : [],
    runner: raw.runner || null,
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- LIVE / DEMO ----------
export function startSource(onData, onMode) {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  let mode = forceDemo ? 'demo' : 'connecting';
  let demo = null;

  const setMode = (m) => { if (m !== mode) { mode = m; onMode(m); } };
  onMode(mode);

  async function pollLive() {
    try {
      const r = await fetch('./api/state', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const json = await r.json();
      setMode('live');
      onData(normalize(json));
      return true;
    } catch {
      return false;
    }
  }

  function startDemo() {
    setMode('demo');
    demo = createDemo();
    const tick = () => onData(normalize(demo.snapshot()));
    tick();
    setInterval(tick, 1000);
  }

  if (forceDemo) { startDemo(); return; }

  pollLive().then((ok) => {
    if (!ok) { startDemo(); return; }
    setInterval(async () => {
      const ok2 = await pollLive();
      if (!ok2) setMode('offline');
    }, 3000);
  });
}

// ---------- DEMO: kịch bản 1 ngày làm việc, lặp lại mỗi ~2.5 phút ----------
function createDemo() {
  const LOOP = 150; // giây
  const P = 'autumn-cafe';
  const E = [
    // [giây, loại, ...]
    [0, 'chat', `${P}-brief`, 'cd', 'brief', 'Brief ơi, phân tích brief "Autumn Café – ra mắt menu thu" và lên plan giúp anh nha.'],
    [0, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'working', 5],
    [3, 'chat', `${P}-brief`, 'brief', 'cd', 'Dạ em nhận rồi anh! Em đọc brief ngay 📋'],
    [9, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'working', 45, 'Đang tách deliverable'],
    [16, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'working', 80, 'Đang chia task'],
    [22, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'waiting_review', 100, 'Chờ anh duyệt plan'],
    [22, 'chat', `${P}-brief`, 'brief', 'cd', 'Xong rồi anh ơi ✨ Em đề xuất: Ink viết headline, Pixel làm visual direction, Frame storyboard 15s, Cube dựng ly cà phê 3D. Plan ở outputs/autumn-cafe-brief/ ạ.'],
    [30, 'chat', `${P}-brief`, 'cd', 'brief', 'Ok duyệt plan nhé.'],
    [30, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'done', 100, 'Anh đã duyệt'],
    [31, 'chat', `${P}-headline`, 'cd', 'ink', 'Ink, viết 5 headline cho Autumn Café nhé.'],
    [31, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'working', 10],
    [33, 'chat', `${P}-visual`, 'cd', 'pixel', 'Pixel, lên visual direction tông thu cho anh.'],
    [33, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'working', 10],
    [35, 'chat', `${P}-headline`, 'ink', 'cd', 'Dạ em vào việc liền nha anh ✍️'],
    [37, 'chat', `${P}-visual`, 'pixel', 'cd', 'Em lên moodboard cam – nâu – kem mùa thu nha anh 🍂'],
    [42, 'idle', 'brief'],
    [48, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'working', 55, 'Bản nháp 3/5'],
    [52, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'working', 40, 'Chọn palette'],
    [62, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'waiting_review', 100, 'Chờ anh chọn'],
    [62, 'chat', `${P}-headline`, 'ink', 'cd', 'Anh ơi 5 headline đây ạ. Em thích nhất: "Thu về, cà phê ấm tay" ☕'],
    [70, 'chat', `${P}-story`, 'cd', 'frame', 'Frame, làm storyboard 15s dựa trên headline của Ink nhé.'],
    [70, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'working', 10],
    [72, 'chat', `${P}-cup3d`, 'cd', 'cube', 'Cube, viết script Blender dựng ly cà phê xoay 360 giúp anh.'],
    [72, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'working', 10],
    [74, 'chat', `${P}-story`, 'frame', 'cd', 'Dạ, em chia 5 cảnh khớp nhạc 100 BPM nha anh 🎬'],
    [80, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'waiting_review', 100, 'Chờ anh duyệt'],
    [80, 'chat', `${P}-visual`, 'pixel', 'cd', 'Visual direction v1 xong rồi ạ: palette 5 màu + 2 cặp font có dấu tiếng Việt 🎨'],
    [88, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'working', 50, 'Cảnh 3/5'],
    [90, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'working', 60, 'Setup đèn 3 điểm'],
    [92, 'chat', 'daily-report', 'cd', 'kuma', 'Kuma tổng hợp cuối ngày giúp anh nhé.'],
    [92, 'task', 'daily-report', 'kuma', 'Báo cáo cuối ngày', 'working', 30],
    [100, 'task', 'daily-report', 'kuma', 'Báo cáo cuối ngày', 'waiting_review', 100],
    [100, 'chat', 'daily-report', 'kuma', 'cd', 'Báo cáo xong rồi anh 🐻 Có 2 việc chờ anh duyệt, 2 việc đang chạy. Xem ở Phòng Kuma nha.'],
    [110, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'blocked', 70, 'Thiếu logo vector'],
    [110, 'chat', `${P}-cup3d`, 'cube', 'cd', 'Anh ơi em cần file logo vector (SVG) của quán để gắn lên ly ạ 🙏'],
    [120, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'waiting_review', 100],
    [120, 'chat', `${P}-story`, 'frame', 'cd', 'Storyboard 15s xong rồi anh, có kèm file .jsx dựng sẵn comp ạ.'],
    [126, 'chat', `${P}-headline`, 'cd', 'ink', 'Chốt headline số 1 nhé, tốt lắm.'],
    [126, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'done', 100, 'Anh đã chốt'],
  ];

  const start = Date.now();
  const iso = (sec) => toLocalIso(new Date(start + sec * 1000));

  const report = {
    name: 'kuma-demo.md',
    date: new Date().toISOString().slice(0, 10),
    content: `# Báo cáo cuối ngày 🐻\n\n**Dự án:** Autumn Café – ra mắt menu thu\n\n## Chờ anh duyệt\n- **Pixel** – Visual direction v1 (palette & type)\n- **Frame** – Storyboard video 15s\n\n## Đang chạy\n- **Cube** – Scene 3D ly cà phê 360° · *cần logo vector*\n\n## Đã xong\n- **Brief** – Phân tích brief & lên plan\n- **Ink** – 5 headline (anh đã chốt bản 1)\n\n## Đề xuất ngày mai\n1. Gửi Cube file logo SVG để mở khoá task 3D\n2. Duyệt visual direction trước 10h để Frame ráp animatic\n`,
  };

  return {
    snapshot() {
      const elapsed = ((Date.now() - start) / 1000);
      const loop = Math.floor(elapsed / LOOP);
      const T = elapsed % LOOP;
      const base = loop * LOOP;
      const agents = {};
      const tasks = new Map();
      const chats = {};
      for (const a of AGENTS) agents[a.id] = { agent: a.id, state: 'idle', note: 'Chờ anh giao việc', updated: iso(base) };
      for (const ev of E) {
        const [t, kind] = ev;
        if (t > T) break;
        const time = iso(base + t);
        if (kind === 'chat') {
          const [, , id, from, to, text] = ev;
          (chats[id] ||= []).push({ from, to, text, time });
        } else if (kind === 'task') {
          const [, , id, who, title, state, progress, note] = ev;
          tasks.set(id, { id, project: 'AUTUMN CAFÉ', title, assignee: who, state, progress, deadline: '2026-11-05', updated: time });
          agents[who] = { agent: who, state, task: `AUTUMN CAFÉ · ${title}`, taskId: id, progress, note: note || '', updated: time };
        } else if (kind === 'idle') {
          agents[ev[2]] = { agent: ev[2], state: 'idle', note: 'Chờ anh giao việc', updated: time };
        }
      }
      return {
        studio: { name: 'NEKOMA STUDIO', tagline: 'Creative AI Production Lab' },
        agents,
        tasks: [...tasks.values()],
        chats,
        reports: T >= 100 ? [report] : [],
      };
    },
  };
}

export function toLocalIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
