// Nguồn dữ liệu: LIVE (đọc .studio/ qua server.mjs) hoặc DEMO (giả lập khi mở trên GitHub Pages).
import { AGENTS, COMPANY, stateOf } from './agents.js';

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
  if (!chats[COMPANY]) chats[COMPANY] = [];
  return {
    studio: { ...DEFAULT_STUDIO, ...(raw.studio || {}) },
    agents,
    tasks,
    chats,
    reports: Array.isArray(raw.reports) ? raw.reports : [],
    runner: raw.runner || null,
    usage: raw.usage || null,
    chatter: raw.runner ? raw.runner.chatter !== false : raw.chatter !== false,
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- LIVE / DEMO ----------
// Trả về { send, order, newSession, openFolder } để anh Nekoma nhắn / giao việc / mở thư mục từ văn phòng.
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

  async function send(channel, text) {
    if (mode === 'demo' && demo) {
      demo.post(channel, text);
      onData(normalize(demo.snapshot()));
      return { ok: true };
    }
    return post('./api/chat', { channel, text });
  }

  // Giao việc thật: server gọi Claude Code chạy nền (chỉ có ở chế độ LIVE)
  async function order(text) {
    if (mode !== 'live') throw new Error('chỉ giao việc được khi chạy start-studio.bat trên máy');
    return post('./api/order', { text });
  }
  const newSession = () => post('./api/session/new', {});
  // mở thư mục chứa file trong Explorer trên máy anh
  const openFolder = (p) => {
    if (mode !== 'live') return Promise.reject(new Error('chỉ mở được khi chạy start-studio.bat trên máy'));
    return post('./api/open-folder', { path: p });
  };

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio': '1' }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    if (r.status === 404 || r.status === 405) throw new Error('server cũ — tắt và mở lại start-studio.bat');
    if (!r.ok || res.ok === false) throw new Error(res.error || `lỗi ${r.status}`);
    await pollLive();
    return res;
  }

  if (forceDemo) startDemo();
  else {
    pollLive().then((ok) => {
      if (!ok) { startDemo(); return; }
      setInterval(async () => {
        const ok2 = await pollLive();
        if (!ok2) setMode('offline');
      }, 3000);
    });
  }
  // bật/tắt kênh ☕ Tám chuyện (nhân viên tự nhắn nhau theo office/chatter.json)
  async function setChatter(on) {
    if (mode === 'demo' && demo) { demo.setChatter(on); onData(normalize(demo.snapshot())); return { ok: true }; }
    return post('./api/chatter', { enabled: on });
  }

  return { send, order, newSession, openFolder, setChatter };
}

// ---------- DEMO: anh Nekoma giao Grid trọn gói, Grid chia cho team. Lặp lại mỗi ~2.5 phút ----------
function createDemo() {
  const LOOP = 150; // giây
  const P = 'autumn-cafe';
  const PROJECT = 'AUTUMN CAFÉ';
  const E = [
    // [giây, 'chat', kênh, từ, đến, nội dung]
    // [giây, 'task', id, người làm, tiêu đề, trạng thái, tiến độ, ghi chú, người giao]
    [0, 'chat', P, 'cd', 'manager', 'Grid ơi, lo trọn gói chiến dịch "Autumn Café – ra mắt menu thu" giúp anh, tự chia cho team nhé.'],
    [0, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'working', 5, 'Đang đọc yêu cầu', 'cd'],
    [3, 'chat', P, 'manager', 'cd', 'Dạ em nhận rồi anh 🧭 Em chia việc cho team ngay, xong em gom lại cho anh duyệt.'],
    [7, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'working', 15, 'Đang chia việc', 'cd'],
    [9, 'chat', COMPANY, 'manager', 'team', 'Cả nhà ơi, dự án Autumn Café: Brief lên plan trước → sau đó Ink viết headline, Pixel lo visual, Frame storyboard 15s, Cube dựng ly cà phê 3D. Chi tiết ở outputs/autumn-cafe/assignments.md nha!'],
    [9, 'chat', `${P}-brief`, 'manager', 'brief', 'Brief ơi, phân tích brief Autumn Café và lên plan giúp anh Nekoma nhé.'],
    [9, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'working', 5, '', 'manager'],
    [11, 'chat', `${P}-brief`, 'brief', 'manager', 'Dạ em nhận ạ 📋'],
    [12, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'working', 25, 'Theo dõi team', 'cd'],
    [17, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'working', 55, 'Đang tách deliverable', 'manager'],
    [24, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'manager_review', 100, 'Gửi Grid duyệt', 'manager'],
    [24, 'chat', `${P}-brief`, 'brief', 'manager', 'Plan xong rồi Grid ơi ✨ 4 deliverable, deadline 05/11.'],
    [28, 'chat', `${P}-headline`, 'manager', 'ink', 'Ink, viết 5 headline theo plan của Brief nhé.'],
    [28, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'working', 10, '', 'manager'],
    [29, 'chat', `${P}-visual`, 'manager', 'pixel', 'Pixel, lên visual direction tông thu giúp mình.'],
    [29, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'working', 10, '', 'manager'],
    [30, 'chat', `${P}-story`, 'manager', 'frame', 'Frame, storyboard 15s khớp nhạc 100 BPM nhé.'],
    [30, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'working', 10, '', 'manager'],
    [31, 'chat', `${P}-cup3d`, 'manager', 'cube', 'Cube, viết script Blender dựng ly cà phê xoay 360°.'],
    [31, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'working', 10, '', 'manager'],
    [33, 'chat', `${P}-headline`, 'ink', 'manager', 'Dạ em vào việc liền ✍️'],
    [34, 'chat', `${P}-visual`, 'pixel', 'manager', 'Em lên moodboard cam – nâu – kem mùa thu nha 🍂'],
    [35, 'chat', `${P}-story`, 'frame', 'manager', 'Dạ, em chia 5 cảnh nha 🎬'],
    [36, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'working', 40, '4 việc đang chạy', 'cd'],
    [40, 'chat', 'daily-report', 'cd', 'lue', 'Lue tổng hợp đầu ngày giúp anh nhé.'],
    [40, 'task', 'daily-report', 'lue', 'Báo cáo đầu ngày', 'working', 30, '', 'cd'],
    [46, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'working', 55, 'Bản nháp 3/5', 'manager'],
    [50, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'working', 45, 'Chọn palette', 'manager'],
    [52, 'task', 'daily-report', 'lue', 'Báo cáo đầu ngày', 'waiting_review', 100, '', 'cd'],
    [52, 'chat', 'daily-report', 'lue', 'cd', 'Báo cáo xong rồi anh 🦆 Grid đang điều 4 bạn làm Autumn Café. Xem ở Phòng Lue nha.'],
    [58, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'working', 50, 'Cảnh 3/5', 'manager'],
    [60, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'working', 60, 'Setup đèn 3 điểm', 'manager'],
    [66, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'manager_review', 100, 'Gửi Grid duyệt', 'manager'],
    [66, 'chat', COMPANY, 'ink', 'team', 'Xong 5 headline rồi nha cả nhà ☕ Em thích nhất: "Thu về, cà phê ấm tay".'],
    [74, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'blocked', 70, 'Thiếu logo vector', 'manager'],
    [74, 'chat', COMPANY, 'cube', 'cd', 'Anh Nekoma ơi, em cần file logo vector (SVG) của quán để gắn lên ly ạ 🙏'],
    [80, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'manager_review', 100, 'Gửi Grid duyệt', 'manager'],
    [80, 'chat', `${P}-visual`, 'pixel', 'manager', 'Visual direction v1 xong: palette 5 màu + 2 cặp font có dấu 🎨'],
    [86, 'chat', COMPANY, 'cd', 'cube', '@cube anh gửi logo vào outputs/autumn-cafe/logo.svg rồi nhé.'],
    [88, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'working', 85, 'Gắn logo', 'manager'],
    [96, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'manager_review', 100, 'Gửi Grid duyệt', 'manager'],
    [102, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'manager_review', 100, 'Gửi Grid duyệt', 'manager'],
    [104, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'working', 85, 'Kiểm tra & tổng hợp', 'cd'],
    [106, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'done', 100, 'Grid đã duyệt', 'manager'],
    [107, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'done', 100, 'Grid đã duyệt', 'manager'],
    [108, 'chat', `${P}-visual`, 'manager', 'pixel', 'Visual ổn rồi Pixel, mình gửi anh Nekoma bản cuối nha 👍'],
    [108, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'done', 100, 'Grid đã duyệt', 'manager'],
    [110, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'done', 100, 'Grid đã duyệt', 'manager'],
    [111, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'done', 100, 'Grid đã duyệt', 'manager'],
    [114, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'waiting_review', 100, 'Chờ anh duyệt', 'cd'],
    [114, 'chat', P, 'manager', 'cd', 'Anh ơi, em đã duyệt đủ 4 phần của team, đây là bản cuối ạ: outputs/autumn-cafe/summary.md — có 2 điểm cần anh chốt.'],
    [124, 'chat', P, 'cd', 'manager', 'Duyệt hết nhé, team làm tốt lắm!'],
    [124, 'task', P, 'manager', 'Chiến dịch ra mắt menu thu', 'done', 100, 'Anh đã duyệt', 'cd'],
    [124, 'task', `${P}-brief`, 'brief', 'Phân tích brief & lên plan', 'done', 100, 'Anh đã duyệt', 'manager'],
    [124, 'task', `${P}-headline`, 'ink', '5 headline ra mắt menu thu', 'done', 100, 'Anh đã duyệt', 'manager'],
    [124, 'task', `${P}-visual`, 'pixel', 'Visual direction v1 – palette & type', 'done', 100, 'Anh đã duyệt', 'manager'],
    [124, 'task', `${P}-story`, 'frame', 'Storyboard video 15s', 'done', 100, 'Anh đã duyệt', 'manager'],
    [124, 'task', `${P}-cup3d`, 'cube', 'Scene 3D ly cà phê 360°', 'done', 100, 'Anh đã duyệt', 'manager'],
    [126, 'chat', COMPANY, 'manager', 'team', 'Anh Nekoma duyệt hết rồi 🎉 Cảm ơn cả nhà!'],
  ];

  const start = Date.now();
  const iso = (sec) => toLocalIso(new Date(start + sec * 1000));
  const extra = []; // tin anh gõ trong bản demo + tám chuyện
  // bản demo cũng tám chuyện theo office/chatter.json
  let chatterOn = true;
  fetch('./chatter.json').then((r) => r.json()).then((script) => {
    const threads = (script.threads || []).filter((t) => !t.when || t.when === 'any' || t.when === 'busy');
    const play = () => {
      if (chatterOn && threads.length) {
        const t = threads[Math.floor(Math.random() * threads.length)];
        t.lines.forEach(([from, to, text], i) => setTimeout(() => extra.push({ channel: 'tam-chuyen', msg: { from, to, text: text.replace(/\{(task:\w+|busyTask)\}/g, 'Autumn Café'), time: toLocalIso(new Date()), sim: true } }), i * 5000));
      }
      setTimeout(play, 25000 + Math.random() * 20000);
    };
    setTimeout(play, 6000);
  }).catch(() => { /* không có kịch bản */ });

  const report = {
    name: 'lue-demo.md',
    date: new Date().toISOString().slice(0, 10),
    content: `# Báo cáo đầu ngày 🦆\n\n**Dự án:** Autumn Café – ra mắt menu thu (Grid đang điều phối)\n\n## Đang chạy\n- **Ink** – 5 headline\n- **Pixel** – Visual direction v1\n- **Frame** – Storyboard 15s\n- **Cube** – Scene 3D ly cà phê 360°\n\n## Đã xong\n- **Brief** – Phân tích brief & lên plan\n\n## Đề xuất hôm nay\n1. Chuẩn bị sẵn logo SVG cho Cube\n2. Dành 30 phút cuối ngày duyệt bản tổng hợp của Grid\n`,
  };

  return {
    setChatter(on) { chatterOn = on; },
    post(channel, text) {
      const m = text.match(/@([a-z]+)/i);
      const tag = m ? m[1].toLowerCase() : '';
      const to = tag === 'grid' ? 'manager' : AGENTS.some((a) => a.id === tag) ? tag : 'team';
      extra.push({ channel, msg: { from: 'cd', to, text, time: toLocalIso(new Date()), via: 'office' } });
      // bản demo: người được tag (hoặc Grid nếu @all) đáp lại 1 câu mẫu
      const who = /@(all|team)/i.test(text) ? 'manager' : to !== 'team' ? to : null;
      if (channel === COMPANY && who) setTimeout(() => extra.push({ channel, msg: { from: who, to: 'cd', text: 'Dạ anh, em đây ạ! (bản demo — chạy start-studio.bat thì em trả lời thật bằng Claude) 👋', time: toLocalIso(new Date()) } }), 1800);
    },
    snapshot() {
      const elapsed = ((Date.now() - start) / 1000);
      const loop = Math.floor(elapsed / LOOP);
      const T = elapsed % LOOP;
      const base = loop * LOOP;
      const agents = {};
      const tasks = new Map();
      const chats = { [COMPANY]: [{ from: 'manager', to: 'team', text: 'Chào cả nhà, em là Grid — Manager của studio 🧭 Đây là kênh chat chung của cả công ty nha.', time: iso(base) }] };
      for (const a of AGENTS) agents[a.id] = { agent: a.id, state: 'idle', note: 'Chờ anh giao việc', updated: iso(base) };
      for (const ev of E) {
        const [t, kind] = ev;
        if (t > T) break;
        const time = iso(base + t);
        if (kind === 'chat') {
          const [, , id, from, to, text] = ev;
          (chats[id] ||= []).push({ from, to, text, time });
        } else if (kind === 'task') {
          const [, , id, who, title, state, progress, note, by] = ev;
          tasks.set(id, { id, project: PROJECT, title, assignee: who, state, progress, deadline: '2026-11-05', updated: time,
            assignedBy: by, ...(by === 'manager' ? { parent: P } : {}) });
          agents[who] = { agent: who, state, task: `${PROJECT} · ${title}`, taskId: id, progress, note: note || '', updated: time };
        }
      }
      for (const { channel, msg } of extra) (chats[channel] ||= []).push(msg);
      return {
        studio: { name: 'NEKOMA STUDIO', tagline: 'Creative AI Production Lab' },
        agents,
        tasks: [...tasks.values()],
        chats,
        reports: T >= 52 ? [report] : [],
        chatter: chatterOn,
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
