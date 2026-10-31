// Giao diện 2D: sidebar, mini chat, bảng công việc, phòng hội thoại, phòng Kuma, toast.
import { AGENTS, CD, PEOPLE, STATES } from './agents.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 0) return 'vừa xong';
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return d.toLocaleDateString('vi-VN');
}
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };

function avatar(id) {
  const p = PEOPLE[id] || { name: id || '?', color: '#888' };
  const face = id === 'kuma' ? '🐻' : esc((p.name || '?')[0]);
  return `<span class="avatar ${p.human ? 'human' : ''}" style="--c:${p.color}">${face}</span>`;
}
const nameOf = (id) => (id === 'cd' ? `Anh ${CD.name}` : (PEOPLE[id]?.name || id || '?'));
const pill = (s) => { const st = STATES[s] || STATES.idle; return `<span class="pill" data-s="${s}" style="--c:${st.color}">${st.label}</span>`; };

function allMessages(chats) {
  const out = [];
  for (const [taskId, list] of Object.entries(chats)) for (const m of list) out.push({ ...m, taskId });
  return out.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

// ======================================================================
export function createUI({ world }) {
  let data = null;
  let selected = 'cd';
  let view = 'office';
  let activeThread = 'all';
  let activeReport = 0;
  let prevAgents = null;
  let prevMsgKeys = null;
  let lastUpdate = null;

  // ---- tabs ----
  const tabs = $('#tabs');
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
  $('#btn-board').addEventListener('click', () => { setView('office'); world.focusBoard(); });
  $('#btn-reset').addEventListener('click', () => { setView('office'); world.resetView(); select('cd', false); });
  $('#mini-more').addEventListener('click', (e) => { e.stopPropagation(); setView('chat'); });
  $('#mini-toggle').addEventListener('click', () => $('#mini-chat').classList.toggle('collapsed'));

  function setView(v) {
    view = v;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    for (const k of ['board', 'chat', 'kuma']) $(`#view-${k}`).hidden = v !== k;
    $('#mini-chat').style.display = v === 'office' ? '' : 'none';
    world.setPaused(v !== 'office');
    render();
    if (v === 'chat') { const m = $('.msgs'); if (m) m.scrollTop = m.scrollHeight; }
  }

  function select(id, fly = true) {
    selected = id;
    world.select(id);
    if (fly) { setView('office'); world.focusPerson(id); }
    renderSide();
  }

  // ---- mode ----
  function setMode(mode) {
    const chip = $('#mode-chip');
    chip.dataset.mode = mode;
    chip.textContent = { connecting: 'ĐANG KẾT NỐI…', live: '● LIVE · ĐỌC .studio/', demo: 'DEMO · DỮ LIỆU GIẢ LẬP', offline: 'MẤT KẾT NỐI SERVER' }[mode];
    $('#mode-box').innerHTML = {
      connecting: 'Đang tìm server của studio…',
      live: '<b>LIVE</b> — đang đọc trạng thái thật trong thư mục <code>.studio/</code>. Giao việc trong Claude Code là văn phòng tự cập nhật.',
      demo: '<b>DEMO</b> — dữ liệu giả lập, không nối với agent thật. Chạy <code>start-studio.bat</code> trên máy để xem studio thật.',
      offline: '<b>Mất kết nối</b> — cửa sổ server đã tắt? Chạy lại <code>start-studio.bat</code>.',
    }[mode];
  }

  // ---- data ----
  function update(d) {
    data = d;
    lastUpdate = new Date();
    $('#studio-name').textContent = d.studio.name;
    $('#studio-tagline').textContent = d.studio.tagline;
    document.title = `${d.studio.name} · Agent Office`;

    // toast khi trạng thái đổi
    if (prevAgents) {
      for (const a of AGENTS) {
        const before = prevAgents[a.id]?.state, now = d.agents[a.id].state;
        if (before && before !== now) toast(a, now, d.agents[a.id].task);
      }
    }
    prevAgents = structuredClone(d.agents);

    // bong bóng thoại khi có tin mới
    const msgs = allMessages(d.chats);
    const keys = new Set(msgs.map((m) => `${m.taskId}|${m.time}|${m.from}|${m.text.slice(0, 20)}`));
    if (prevMsgKeys) {
      for (const m of msgs) {
        const k = `${m.taskId}|${m.time}|${m.from}|${m.text.slice(0, 20)}`;
        if (!prevMsgKeys.has(k)) world.say(m.from, m.text);
      }
    }
    prevMsgKeys = keys;

    world.update(d);
    render();
  }

  function toast(a, state, task) {
    const st = STATES[state];
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--c', st.color);
    el.innerHTML = `${avatar(a.id)}<div><b>${esc(a.name)}</b> → ${st.label}${task && state === 'working' ? `<br><small>${esc(task)}</small>` : ''}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4200);
  }

  // ---- render ----
  function render() {
    if (!data) return;
    renderSide();
    renderMini();
    if (view === 'board') renderBoard();
    if (view === 'chat') renderChat();
    if (view === 'kuma') renderKuma();
  }

  function renderSide() {
    if (!data) return;
    const counts = {};
    for (const a of AGENTS) counts[data.agents[a.id].state] = (counts[data.agents[a.id].state] || 0) + 1;
    $('#team-summary').textContent = `${counts.working || 0} ĐANG LÀM · ${counts.idle || 0} RẢNH`;

    const waiting = AGENTS.filter((a) => data.agents[a.id].state === 'waiting_review');
    const list = [CD, ...AGENTS].map((p) => {
      const s = p.human ? null : data.agents[p.id];
      const right = p.human ? `<span class="pill" style="--c:#1d1c19;color:#f2c230">BẠN</span>` : pill(s.state);
      return `<li><button class="agent-item ${p.human ? 'human' : ''} ${selected === p.id ? 'selected' : ''}" data-id="${p.id}" style="--c:${p.color}">
        <span class="sq">${p.id === 'kuma' ? '🐻' : esc(p.name[0])}</span>
        <span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></span>${right}</button></li>`;
    }).join('');
    const ul = $('#agent-list');
    ul.innerHTML = list;
    ul.querySelectorAll('.agent-item').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));

    const p = PEOPLE[selected];
    const det = $('#detail');
    if (p.human) {
      det.innerHTML = `<div class="detail-head" style="--c:#1d1c19"><span class="sq" style="color:#f2c230">${esc(p.name[0])}</span><div><h3>${esc(p.name)}</h3><small>${esc(p.role)} · Khu ${p.zone} · ${esc(p.zoneName)}</small></div></div>
        <p>${esc(p.desc)}</p>
        <dl class="kv"><dt>CHỜ ANH DUYỆT</dt><dd>${waiting.length ? waiting.map((a) => `<b>${esc(a.name)}</b> — ${esc(data.agents[a.id].task || '')}`).join('<br>') : 'Không có'}</dd>
        <dt>ĐANG LÀM</dt><dd>${AGENTS.filter((a) => data.agents[a.id].state === 'working').map((a) => esc(a.name)).join(', ') || 'Không ai'}</dd>
        <dt>CẦN HỖ TRỢ</dt><dd>${AGENTS.filter((a) => data.agents[a.id].state === 'blocked').map((a) => `<b>${esc(a.name)}</b> — ${esc(data.agents[a.id].note)}`).join('<br>') || 'Không có'}</dd></dl>
        <p class="hint">Mở Claude Code trong thư mục dự án rồi gọi tên người cần giao, ví dụ <code>Ink ơi, viết 5 headline…</code>. Bấm vào một agent để xem lệnh mẫu.</p>`;
      return;
    }
    const s = data.agents[p.id];
    const st = STATES[s.state];
    det.innerHTML = `<div class="detail-head" style="--c:${p.color}"><span class="sq">${p.id === 'kuma' ? '🐻' : esc(p.name[0])}</span><div><h3>${esc(p.name)}</h3><small>${esc(p.role)} · Khu ${p.zone} · ${esc(p.zoneName)}</small></div></div>
      <p>${esc(p.desc)}</p>
      <dl class="kv">
        <dt>TRẠNG THÁI</dt><dd>${pill(s.state)}</dd>
        <dt>VIỆC</dt><dd>${esc(s.task) || '<span class="hint">Chưa được giao việc</span>'}</dd>
        <dt>TIẾN ĐỘ</dt><dd><div class="bar" style="--c:${st.color}"><span><b style="width:${s.progress}%"></b></span>${s.progress}%</div></dd>
        <dt>GHI CHÚ</dt><dd>${esc(s.note) || '—'}</dd>
        <dt>CẬP NHẬT</dt><dd>${timeAgo(s.updated)}</dd>
      </dl>
      <div class="order-box"><header>LỆNH MẪU · DÁN VÀO CLAUDE CODE <button id="copy-order">COPY</button></header><pre>${esc(p.order)}</pre></div>`;
    $('#copy-order').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(p.order); e.target.textContent = 'ĐÃ COPY'; } catch { e.target.textContent = 'LỖI'; }
      setTimeout(() => (e.target.textContent = 'COPY'), 1500);
    });
  }

  function renderMini() {
    const msgs = allMessages(data.chats);
    $('#mini-count').textContent = msgs.length;
    const last = msgs.slice(-3).reverse();
    $('#mini-list').innerHTML = last.length ? last.map((m) => {
      const p = PEOPLE[m.from] || { color: '#888' };
      return `<li>${avatar(m.from)}<div><div class="who" style="--c:${p.color}"><b>${esc(nameOf(m.from))}</b> → ${esc(nameOf(m.to))} · <time>${timeAgo(m.time)}</time></div><p>${esc(m.text)}</p></div></li>`;
    }).join('') : '<li class="mini-empty">Chưa có tin nhắn nào.</li>';
  }

  function renderBoard() {
    const tasks = data.tasks.slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    const counts = {};
    for (const t of tasks) counts[t.state] = (counts[t.state] || 0) + 1;
    const head = `<div class="ov-head"><div><div class="ov-eyebrow">${esc(data.studio.name)} · BẢNG CÔNG VIỆC</div><h2>Việc trong studio</h2></div>
      <div class="count-row">${Object.entries(STATES).map(([k, s]) => `<span class="count" style="--c:${s.color}"><i></i>${s.label} · ${counts[k] || 0}</span>`).join('')}</div></div>`;
    const body = tasks.length ? `<div class="table-wrap"><table><thead><tr><th>VIỆC</th><th>NGƯỜI LÀM</th><th>TRẠNG THÁI</th><th>TIẾN ĐỘ</th><th>DEADLINE</th><th>CẬP NHẬT</th></tr></thead><tbody>
      ${tasks.map((t) => { const p = PEOPLE[t.assignee] || { name: t.assignee || '—', color: '#999' }; const st = STATES[t.state];
        return `<tr><td><span class="proj">${esc(t.project || '')}</span>${esc(t.title || t.id)}</td>
        <td><span class="person" style="--c:${p.color}"><i></i>${esc(p.name)}</span></td><td>${pill(t.state)}</td>
        <td><div class="bar" style="--c:${st.color}"><span><b style="width:${t.progress}%"></b></span>${t.progress}%</div></td>
        <td>${esc(t.deadline || '—')}</td><td>${timeAgo(t.updated)}</td></tr>`; }).join('')}
      </tbody></table></div>`
      : `<div class="empty"><b>Chưa có việc nào</b>Mở Claude Code và giao việc, ví dụ: <code>Brief ơi, phân tích brief này và lên plan giúp anh</code></div>`;
    $('#view-board').innerHTML = head + body;
  }

  function threadTitle(id) {
    const t = data.tasks.find((x) => x.id === id);
    if (t) return { project: t.project || '', title: t.title || id };
    if (id === 'studio-welcome') return { project: 'STUDIO', title: 'Chào mừng' };
    return { project: '', title: id.replace(/[-_]/g, ' ') };
  }

  function renderChat() {
    const threads = Object.entries(data.chats).filter(([, l]) => l.length)
      .sort((a, b) => String(b[1].at(-1).time).localeCompare(String(a[1].at(-1).time)));
    const total = threads.reduce((n, [, l]) => n + l.length, 0);
    if (activeThread !== 'all' && !data.chats[activeThread]) activeThread = 'all';
    const list = `<button class="thread ${activeThread === 'all' ? 'active' : ''}" data-t="all"><small>TẤT CẢ</small><b>${total} tin nhắn</b></button>` +
      threads.map(([id, l]) => { const tt = threadTitle(id); return `<button class="thread ${activeThread === id ? 'active' : ''}" data-t="${esc(id)}"><small>${esc(tt.project)} · ${l.length} TIN</small><b>${esc(tt.title)}</b></button>`; }).join('');

    const shown = activeThread === 'all' ? threads.slice().reverse() : threads.filter(([id]) => id === activeThread);
    const msgs = shown.length ? shown.map(([id, l]) => { const tt = threadTitle(id);
      return `<div class="msg-group-title">${esc(tt.project ? tt.project + ' · ' : '')}${esc(tt.title).toUpperCase()}</div>` + l.map((m) => {
        const me = m.from === 'cd'; const p = PEOPLE[m.from] || { color: '#888' };
        return `<div class="msg ${me ? 'me' : ''}">${avatar(m.from)}<div><div class="meta" style="--c:${p.color}"><b>${esc(nameOf(m.from))}</b> → ${esc(nameOf(m.to))} · ${hhmm(m.time)}</div><div class="text">${esc(m.text)}</div></div></div>`;
      }).join(''); }).join('')
      : '<div class="empty"><b>Phòng hội thoại còn trống</b>Mỗi lần anh giao việc, agent sẽ ghi lời trao đổi vào <code>.studio/chat/</code>.</div>';

    const box = $('#view-chat');
    const prevScroll = box.querySelector('.msgs');
    const atBottom = !prevScroll || prevScroll.scrollTop + prevScroll.clientHeight >= prevScroll.scrollHeight - 30;
    box.innerHTML = `<div class="ov-head"><div><div class="ov-eyebrow">${esc(data.studio.name)} · PHÒNG HỘI THOẠI</div><h2>Team đang trao đổi</h2></div></div>
      <div class="chat-layout"><div class="thread-list">${list}</div><div class="msgs">${msgs}</div></div>`;
    box.querySelectorAll('.thread').forEach((b) => b.addEventListener('click', () => { activeThread = b.dataset.t; renderChat(); const m = $('.msgs'); m.scrollTop = m.scrollHeight; }));
    const m = box.querySelector('.msgs');
    if (atBottom) m.scrollTop = m.scrollHeight; else m.scrollTop = prevScroll.scrollTop;
  }

  function renderKuma() {
    const reps = data.reports;
    const box = $('#view-kuma');
    const head = `<div class="ov-head"><div><div class="ov-eyebrow">KHU G · TRỢ LÝ CÁ NHÂN</div><h2>Phòng Kuma 🐻</h2></div></div>`;
    if (!reps.length) {
      box.innerHTML = head + `<div class="empty"><b>Chưa có báo cáo nào</b>Gõ trong Claude Code: <code>Kuma ơi, làm báo cáo đầu ngày cho anh</code><br>Báo cáo sẽ lưu ở <code>.studio/reports/</code> và hiện ở đây.</div>`;
      return;
    }
    activeReport = Math.min(activeReport, reps.length - 1);
    box.innerHTML = head + `<div class="kuma-layout"><div class="thread-list">${reps.map((r, i) => `<button class="thread ${i === activeReport ? 'active' : ''}" data-i="${i}"><small>BÁO CÁO</small><b>${esc(r.date || r.name)}</b></button>`).join('')}</div>
      <article class="report">${md(reps[activeReport].content)}</article></div>`;
    box.querySelectorAll('.thread').forEach((b) => b.addEventListener('click', () => { activeReport = +b.dataset.i; renderKuma(); }));
  }

  // clock chip
  setInterval(() => {
    const t = lastUpdate ? lastUpdate.toLocaleTimeString('vi-VN', { hour12: false }) : '--:--:--';
    $('#clock-chip').textContent = `CẬP NHẬT LÚC ${t}`;
  }, 500);
  // làm mới "x phút trước"
  setInterval(() => { if (data) { renderMini(); } }, 15000);

  return { update, setMode, select, setView };
}

// Markdown tối giản cho báo cáo của Kuma
function md(src = '') {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let html = '', list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { close(); const n = m[1].length; html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) close();
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  return html;
}
