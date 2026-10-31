// Giao diện 2D: sidebar, hồ sơ nhân viên, mini chat, bảng công việc, chat công ty, phòng Lue, toast.
import { AGENTS, CD, PEOPLE, STATES, ZONES, COMPANY } from './agents.js';

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
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }); };

const face = (id) => { const p = PEOPLE[id]; return p ? (p.hair === 'duck' ? p.emoji : esc(p.name[0])) : esc((id || '?')[0]); };
function avatar(id, size = '') {
  const p = PEOPLE[id] || { name: id || '?', color: '#888' };
  return `<span class="avatar ${size} ${p.human ? 'human' : ''}" style="--c:${p.color}">${face(id)}</span>`;
}
const nameOf = (id) => (id === 'cd' ? `Anh ${CD.name}` : id === 'team' ? 'Cả team' : (PEOPLE[id]?.name || id || '?'));
const pill = (s) => { const st = STATES[s] || STATES.idle; return `<span class="pill" data-s="${s}" style="--c:${st.color}">${st.label}</span>`; };
// tô sáng @tên trong tin nhắn
const richText = (t) => esc(t).replace(/@([a-zà-ỹ]+)/gi, (m, n) => {
  const id = n.toLowerCase() === 'grid' ? 'manager' : n.toLowerCase();
  const p = PEOPLE[id];
  return p ? `<span class="mention" style="--c:${p.color}">@${esc(p.name)}</span>` : m;
});

function allMessages(chats) {
  const out = [];
  for (const [taskId, list] of Object.entries(chats)) for (const m of list) out.push({ ...m, taskId });
  return out.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

// ======================================================================
export function createUI({ world, send }) {
  let data = null;
  let mode = 'connecting';
  let selected = 'cd';
  let profileId = null;
  let view = 'office';
  let channel = COMPANY;
  let activeReport = 0;
  let prevAgents = null;
  let prevMsgKeys = null;
  let lastUpdate = null;

  // ---- tabs ----
  const tabs = $('#tabs');
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
  $('#btn-board').addEventListener('click', () => { setView('office'); world.focusBoard(); });
  $('#btn-reset').addEventListener('click', () => { setView('office'); world.resetView(); closeProfile(); select('cd', false); });
  $('#mini-more').addEventListener('click', (e) => { e.stopPropagation(); setView('chat'); });
  $('#mini-toggle').addEventListener('click', () => $('#mini-chat').classList.toggle('collapsed'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && profileId) closeProfile(); });

  function setView(v) {
    view = v;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    for (const k of ['board', 'chat', 'lue']) $(`#view-${k}`).hidden = v !== k;
    $('#mini-chat').style.display = v === 'office' ? '' : 'none';
    $('#profile').hidden = v !== 'office' || !profileId;
    world.setPaused(v !== 'office');
    render();
    if (v === 'chat') { scrollMsgs(true); $('#composer-input')?.focus(); }
  }

  function select(id, fly = true) {
    selected = id;
    world.select(id);
    if (fly) { setView('office'); world.focusPerson(id); openProfile(id); }
    renderSide();
  }

  function openProfile(id) {
    profileId = id;
    const el = $('#profile');
    el.hidden = view !== 'office';
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    renderProfile();
  }
  function closeProfile() { profileId = null; $('#profile').hidden = true; }

  // ---- mode ----
  function setMode(m) {
    mode = m;
    const chip = $('#mode-chip');
    chip.dataset.mode = m;
    chip.textContent = { connecting: 'ĐANG KẾT NỐI…', live: '● LIVE · ĐỌC .studio/', demo: 'DEMO · DỮ LIỆU GIẢ LẬP', offline: 'MẤT KẾT NỐI SERVER' }[m];
    $('#mode-box').innerHTML = {
      connecting: 'Đang tìm server của studio…',
      live: '<b>LIVE</b> — đang đọc trạng thái thật trong <code>.studio/</code>. Giao việc trong Claude Code hoặc nhắn trong Chat công ty.',
      demo: '<b>DEMO</b> — dữ liệu giả lập: anh giao Grid trọn gói, Grid chia lại cho team. Chạy <code>start-studio.bat</code> để xem studio thật.',
      offline: '<b>Mất kết nối</b> — cửa sổ server đã tắt? Chạy lại <code>start-studio.bat</code>.',
    }[m];
    if (view === 'chat') renderChat();
  }

  // ---- data ----
  function update(d) {
    data = d;
    lastUpdate = new Date();
    $('#studio-name').textContent = d.studio.name;
    $('#studio-tagline').textContent = d.studio.tagline;
    document.title = `${d.studio.name} · Agent Office`;

    if (prevAgents) {
      for (const a of AGENTS) {
        const before = prevAgents[a.id]?.state, now = d.agents[a.id].state;
        if (before && before !== now) toast(a, now, d.agents[a.id].task);
      }
    }
    prevAgents = structuredClone(d.agents);

    // bong bóng thoại khi có tin mới
    const msgs = allMessages(d.chats);
    const keyOf = (m) => `${m.taskId}|${m.time}|${m.from}|${m.text.slice(0, 20)}`;
    if (prevMsgKeys) for (const m of msgs) if (!prevMsgKeys.has(keyOf(m))) world.say(m.from, m.text);
    prevMsgKeys = new Set(msgs.map(keyOf));

    world.update(d);
    render();
  }

  function toast(a, state, task) {
    const st = STATES[state];
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--c', st.color);
    el.innerHTML = `${avatar(a.id)}<div><b>${esc(a.name)}</b> → ${st.label}${task && state === 'working' ? `<br><small>${esc(task)}</small>` : ''}</div>`;
    el.addEventListener('click', () => select(a.id));
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4200);
  }

  // ---- render ----
  function render() {
    if (!data) return;
    renderSide();
    renderMini();
    if (profileId && view === 'office') renderProfile();
    if (view === 'board') renderBoard();
    if (view === 'chat') renderChat();
    if (view === 'lue') renderLue();
  }

  const tasksOf = (id) => data.tasks.filter((t) => t.assignee === id).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  const byState = (s) => AGENTS.filter((a) => data.agents[a.id].state === s);

  function renderSide() {
    if (!data) return;
    const counts = {};
    for (const a of AGENTS) counts[data.agents[a.id].state] = (counts[data.agents[a.id].state] || 0) + 1;
    $('#team-summary').textContent = `${counts.working || 0} ĐANG LÀM · ${counts.idle || 0} RẢNH`;

    const item = (p) => {
      const s = p.human ? null : data.agents[p.id];
      const right = p.human ? `<span class="pill" style="--c:#1d1c19;color:#f2c230">BẠN</span>` : pill(s.state);
      const sub = p.human ? p.role : s.state === 'working' && s.task ? `${s.progress}% · ${s.task}` : p.role;
      return `<li><button class="agent-item ${p.human ? 'human' : ''} ${selected === p.id ? 'selected' : ''} ${p.id === 'manager' ? 'mgr' : ''}" data-id="${p.id}" style="--c:${p.color}">
        <span class="sq">${face(p.id)}</span>
        <span class="ai-main"><b>${esc(p.name)}</b><small>${esc(sub)}</small></span>${right}</button></li>`;
    };
    const ul = $('#agent-list');
    ul.innerHTML = Object.values(ZONES).filter((z) => z.id !== 'E').map((z) => {
      const people = [CD, ...AGENTS].filter((p) => p.zone === z.id);
      return `<li class="zone-group" style="--c:${z.color}"><div class="zg-head"><i></i>KHU ${z.id} · ${esc(z.name.toUpperCase())}</div><ul>${people.map(item).join('')}</ul></li>`;
    }).join('') + `<li class="zone-group" style="--c:${ZONES.E.color}"><button class="zg-chat" id="side-chat"><i></i>KHU E · ${esc(ZONES.E.name.toUpperCase())}<span>${(data.chats[COMPANY] || []).length} tin →</span></button></li>`;
    ul.querySelectorAll('.agent-item').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
    $('#side-chat').addEventListener('click', () => setView('chat'));

    // Hôm nay của anh
    const waiting = byState('waiting_review'), working = byState('working'), blocked = byState('blocked');
    const line = (list, f) => list.length ? list.map(f).join('') : '<span class="hint">Không có</span>';
    $('#detail').innerHTML = `<div class="section-title" style="margin-top:0">HÔM NAY CỦA ANH</div>
      <dl class="kv">
        <dt>CHỜ DUYỆT</dt><dd>${line(waiting, (a) => `<button class="link" data-id="${a.id}"><b>${esc(a.name)}</b> — ${esc(data.agents[a.id].task || '')}</button>`)}</dd>
        <dt>ĐANG LÀM</dt><dd>${line(working, (a) => `<button class="link" data-id="${a.id}">${esc(a.name)}</button> `)}</dd>
        <dt>CẦN HỖ TRỢ</dt><dd>${line(blocked, (a) => `<button class="link" data-id="${a.id}"><b>${esc(a.name)}</b> — ${esc(data.agents[a.id].note)}</button>`)}</dd>
      </dl>
      <p class="hint">Bấm vào một nhân viên (trong văn phòng hoặc danh sách) để xem hồ sơ. Việc lớn cứ giao <b>Grid</b>, Grid tự chia cho team.</p>`;
    $('#detail').querySelectorAll('.link').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
  }

  function renderProfile() {
    const box = $('#profile');
    const p = PEOPLE[profileId];
    if (!p || !data) return;
    const z = ZONES[p.zone];
    const head = `<button class="pf-close" id="pf-close" aria-label="Đóng">×</button>
      <div class="pf-head" style="--c:${p.human ? '#1d1c19' : p.color}">
        <span class="pf-ava ${p.human ? 'human' : ''}">${face(p.id)}</span>
        <div><div class="pf-zone" style="--z:${z.color}">KHU ${z.id} · ${esc(z.name)}</div><h3>${esc(p.name)}</h3><small>${esc(p.role)}</small></div>
      </div>`;
    const people = (ids) => ids.map((id) => `<button class="chip-person" data-id="${id}" style="--c:${PEOPLE[id].color}">${face(id)} ${esc(PEOPLE[id].name)}</button>`).join('');

    if (p.human) {
      const waiting = byState('waiting_review');
      box.innerHTML = head + `<p class="pf-desc">${esc(p.desc)}</p>
        <div class="pf-block"><h4>SƠ ĐỒ ĐỘI NGŨ</h4>
          <div class="org">
            <div class="org-row"><span class="org-node human">★ Nekoma</span></div>
            <div class="org-row two"><button class="org-node" data-id="manager" style="--c:${PEOPLE.manager.color}">🧭 Grid · Manager</button><button class="org-node" data-id="lue" style="--c:${PEOPLE.lue.color}">🦆 Lue · Trợ lý</button></div>
            <div class="org-row">${people(AGENTS.filter((a) => a.reportsTo === 'manager').map((a) => a.id))}</div>
          </div></div>
        <div class="pf-block"><h4>CHỜ ANH DUYỆT · ${waiting.length}</h4>${waiting.length ? waiting.map((a) => `<button class="pf-task" data-id="${a.id}">${avatar(a.id, 'sm')}<span><b>${esc(a.name)}</b><small>${esc(data.agents[a.id].task)}</small></span></button>`).join('') : '<p class="hint">Không có việc nào chờ anh.</p>'}</div>`;
    } else {
      const s = data.agents[p.id];
      const st = STATES[s.state];
      const mine = tasksOf(p.id);
      const cnt = (k) => mine.filter((t) => t.state === k).length;
      const msgs = allMessages(data.chats).filter((m) => m.from === p.id || m.to === p.id).slice(-4).reverse();
      const boss = p.reportsTo === 'manager' ? 'Grid (Manager) · Anh Nekoma' : 'Anh Nekoma';
      const team = p.id === 'manager' ? `<div class="pf-block"><h4>ĐANG QUẢN LÝ</h4><div class="chips-wrap">${people(AGENTS.filter((a) => a.reportsTo === 'manager').map((a) => a.id))}</div></div>` : '';
      box.innerHTML = head + `<p class="pf-desc">${esc(p.desc)}</p>
        <div class="pf-now" style="--c:${st.color}">
          <div class="pf-now-top">${pill(s.state)}<span class="hint">${timeAgo(s.updated)}</span></div>
          <b>${esc(s.task) || '<span class="hint">Chưa được giao việc</span>'}</b>
          <div class="bar" style="--c:${st.color}"><span><b style="width:${s.progress}%"></b></span>${s.progress}%</div>
          ${s.note ? `<small>${esc(s.note)}</small>` : ''}
        </div>
        <div class="pf-stats"><div><b>${mine.length}</b><small>VIỆC</small></div><div><b>${cnt('working')}</b><small>ĐANG LÀM</small></div><div><b>${cnt('waiting_review')}</b><small>CHỜ DUYỆT</small></div><div><b>${cnt('done')}</b><small>XONG</small></div></div>
        <dl class="kv"><dt>BÁO CÁO CHO</dt><dd>${boss}</dd><dt>NHẬN VIỆC TỪ</dt><dd>${p.reportsTo === 'manager' ? 'Anh Nekoma hoặc Grid' : 'Chỉ anh Nekoma'}</dd></dl>
        ${team}
        <div class="pf-block"><h4>VIỆC GẦN ĐÂY</h4>${mine.length ? mine.slice(0, 5).map((t) => `<div class="pf-row"><span>${esc(t.title || t.id)}<small>${t.assignedBy === 'manager' ? '← Grid giao' : '← Anh giao'} · ${timeAgo(t.updated)}</small></span>${pill(t.state)}</div>`).join('') : '<p class="hint">Chưa có việc nào.</p>'}</div>
        <div class="pf-block"><h4>TIN NHẮN GẦN ĐÂY</h4>${msgs.length ? msgs.map((m) => `<div class="pf-msg"><small><b>${esc(nameOf(m.from))}</b> → ${esc(nameOf(m.to))} · ${hhmm(m.time)}</small><p>${richText(m.text)}</p></div>`).join('') : '<p class="hint">Chưa có tin nhắn.</p>'}</div>
        <div class="order-box"><header>LỆNH MẪU · DÁN VÀO CLAUDE CODE <button id="copy-order">COPY</button></header><pre>${esc(p.order)}</pre></div>
        <div class="pf-actions"><button class="btn btn-dark" id="pf-dm">Nhắn @${esc(p.name)} trong chat chung</button></div>`;
      $('#copy-order').addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(p.order); e.target.textContent = 'ĐÃ COPY'; } catch { e.target.textContent = 'LỖI'; }
        setTimeout(() => (e.target.textContent = 'COPY'), 1500);
      });
      $('#pf-dm').addEventListener('click', () => { channel = COMPANY; setView('chat'); const ta = $('#composer-input'); if (ta) { ta.value = `@${p.name} `; ta.focus(); } });
    }
    $('#pf-close').addEventListener('click', closeProfile);
    box.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
  }

  function renderMini() {
    const msgs = allMessages(data.chats);
    $('#mini-count').textContent = msgs.length;
    const last = msgs.slice(-3).reverse();
    $('#mini-list').innerHTML = last.length ? last.map((m) => {
      const p = PEOPLE[m.from] || { color: '#888' };
      return `<li>${avatar(m.from)}<div><div class="who" style="--c:${p.color}"><b>${esc(nameOf(m.from))}</b> → ${esc(nameOf(m.to))}${m.taskId === COMPANY ? ' · <i># chung</i>' : ''} · <time>${timeAgo(m.time)}</time></div><p>${richText(m.text)}</p></div></li>`;
    }).join('') : '<li class="mini-empty">Chưa có tin nhắn nào.</li>';
  }

  function renderBoard() {
    const all = data.tasks.slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    // việc con của Grid xếp ngay dưới việc cha
    const ids = new Set(all.map((t) => t.id));
    const tasks = [];
    for (const t of all) {
      if (t.parent && ids.has(t.parent)) continue;
      tasks.push(t);
      for (const c of all.filter((x) => x.parent === t.id)) tasks.push({ ...c, _child: true });
    }
    const counts = {};
    for (const t of all) counts[t.state] = (counts[t.state] || 0) + 1;
    const head = `<div class="ov-head"><div><div class="ov-eyebrow">${esc(data.studio.name)} · BẢNG CÔNG VIỆC</div><h2>Việc trong studio</h2></div>
      <div class="count-row">${Object.entries(STATES).map(([k, s]) => `<span class="count" style="--c:${s.color}"><i></i>${s.label} · ${counts[k] || 0}</span>`).join('')}</div></div>`;
    const body = tasks.length ? `<div class="table-wrap"><table><thead><tr><th>VIỆC</th><th>NGƯỜI LÀM</th><th>GIAO BỞI</th><th>TRẠNG THÁI</th><th>TIẾN ĐỘ</th><th>DEADLINE</th><th>CẬP NHẬT</th></tr></thead><tbody>
      ${tasks.map((t) => { const p = PEOPLE[t.assignee] || { name: t.assignee || '—', color: '#999' }; const st = STATES[t.state];
        const by = t.assignedBy === 'manager' ? `<span class="person" style="--c:${PEOPLE.manager.color}"><i></i>Grid</span>` : '<span class="hint">Anh Nekoma</span>';
        return `<tr class="${t._child ? 'child' : ''}"><td><span class="proj">${esc(t.project || '')}</span>${esc(t.title || t.id)}</td>
        <td><button class="person" data-id="${esc(t.assignee)}" style="--c:${p.color}"><i></i>${esc(p.name)}</button></td><td>${by}</td><td>${pill(t.state)}</td>
        <td><div class="bar" style="--c:${st.color}"><span><b style="width:${t.progress}%"></b></span>${t.progress}%</div></td>
        <td>${esc(t.deadline || '—')}</td><td>${timeAgo(t.updated)}</td></tr>`; }).join('')}
      </tbody></table></div>`
      : `<div class="empty"><b>Chưa có việc nào</b>Mở Claude Code và giao việc, ví dụ: <code>Grid ơi, lo trọn gói chiến dịch này giúp anh</code></div>`;
    $('#view-board').innerHTML = head + body;
    $('#view-board').querySelectorAll('button.person[data-id]').forEach((b) => b.addEventListener('click', () => PEOPLE[b.dataset.id] && select(b.dataset.id)));
  }

  // ---------- CHAT CÔNG TY ----------
  function threadTitle(id) {
    if (id === COMPANY) return { project: 'CẢ CÔNG TY', title: 'chung' };
    const t = data.tasks.find((x) => x.id === id);
    if (t) return { project: t.project || '', title: t.title || id };
    if (id === 'studio-welcome') return { project: 'STUDIO', title: 'Chào mừng' };
    return { project: '', title: id.replace(/[-_]/g, ' ') };
  }

  function buildChatShell() {
    const box = $('#view-chat');
    box.innerHTML = `<div class="ov-head"><div><div class="ov-eyebrow" id="chat-eyebrow"></div><h2>Chat công ty</h2></div></div>
      <div class="slack">
        <nav class="channels" id="ch-list" aria-label="Kênh"></nav>
        <section class="room">
          <header class="room-head" id="room-head"></header>
          <div class="msgs" id="msgs"></div>
          <form class="composer" id="composer">
            <div class="mention-row" id="mention-row"></div>
            <div class="composer-box"><textarea id="composer-input" rows="2" placeholder="Nhắn cho cả công ty… gõ @Grid, @Ink để gọi tên"></textarea><button type="submit" id="composer-send">Gửi ↵</button></div>
            <small class="composer-hint" id="composer-hint"></small>
          </form>
        </section>
        <aside class="members" id="members"></aside>
      </div>`;
    $('#mention-row').innerHTML = AGENTS.map((a) => `<button type="button" data-n="${esc(a.name)}" style="--c:${a.color}">@${esc(a.name)}</button>`).join('');
    $('#mention-row').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]'); if (!b) return;
      const ta = $('#composer-input'); ta.value = `@${b.dataset.n} ` + ta.value.replace(/^@\S+\s*/, ''); ta.focus();
    });
    const ta = $('#composer-input');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
    $('#composer').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      const hint = $('#composer-hint');
      const btn = $('#composer-send');
      btn.disabled = true;
      try {
        await send(channel === 'all' ? COMPANY : channel, text);
        ta.value = '';
        hint.className = 'composer-hint';
        hint.textContent = mode === 'demo' ? 'Đã gửi (bản demo — chỉ hiện trên máy này).' : 'Đã gửi · lưu ở .studio/chat/. Gọi tên trong Claude Code để agent đọc & trả lời.';
        scrollMsgs(true);
      } catch (err) {
        hint.className = 'composer-hint err';
        hint.textContent = `Chưa gửi được: ${err.message}`;
      } finally { btn.disabled = false; }
    });
    $('#ch-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      channel = b.dataset.t; renderChat(); scrollMsgs(true);
    });
    $('#members').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]'); if (!b) return;
      if (b.dataset.id === 'cd') return;
      const ta2 = $('#composer-input'); ta2.value = `@${PEOPLE[b.dataset.id].name} `; ta2.focus();
    });
  }

  function scrollMsgs(force) {
    const m = $('#msgs'); if (!m) return;
    if (force || m.dataset.stick !== '0') m.scrollTop = m.scrollHeight;
  }

  function renderChat() {
    if (!data) return;
    if (!$('#composer')) buildChatShell();
    const threads = Object.entries(data.chats).filter(([id, l]) => l.length && id !== COMPANY)
      .sort((a, b) => String(b[1].at(-1).time).localeCompare(String(a[1].at(-1).time)));
    const company = data.chats[COMPANY] || [];
    const total = Object.values(data.chats).reduce((n, l) => n + l.length, 0);
    if (channel !== 'all' && channel !== COMPANY && !data.chats[channel]) channel = COMPANY;
    $('#chat-eyebrow').textContent = `${data.studio.name} · KHU E · ${ZONES.E.name.toUpperCase()}`;

    const chBtn = (id, label, sub, n) => `<button class="channel ${channel === id ? 'active' : ''}" data-t="${esc(id)}"><b>${label}</b><small>${esc(sub)}</small>${n ? `<span class="n">${n}</span>` : ''}</button>`;
    $('#ch-list').innerHTML = `<div class="ch-title">KÊNH</div>` +
      chBtn(COMPANY, '# chung', 'Cả công ty', company.length) +
      chBtn('all', '◎ Tất cả hoạt động', 'Mọi kênh gộp lại', total) +
      `<div class="ch-title">VIỆC (${threads.length})</div>` +
      threads.map(([id, l]) => { const tt = threadTitle(id); return chBtn(id, `# ${esc(tt.title)}`, tt.project, l.length); }).join('');

    let shown;
    if (channel === 'all') shown = Object.entries(data.chats).filter(([, l]) => l.length);
    else shown = [[channel, data.chats[channel] || []]];
    const list = channel === 'all' ? allMessages(Object.fromEntries(shown)) : shown[0][1].map((m) => ({ ...m, taskId: channel }));
    const tt = threadTitle(channel === 'all' ? COMPANY : channel);
    $('#room-head').innerHTML = channel === 'all'
      ? `<b>◎ Tất cả hoạt động</b><small>${total} tin từ mọi kênh · gửi tin ở đây sẽ vào # chung</small>`
      : `<b># ${esc(tt.title)}</b><small>${channel === COMPANY ? 'Kênh chung của cả công ty · anh Nekoma, Grid, Lue và cả team' : esc(tt.project)}</small>`;

    let lastDay = '', lastFrom = '';
    const html = list.length ? list.map((m) => {
      const d = new Date(m.time); const day = isNaN(d) ? '' : d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
      const sep = day && day !== lastDay ? `<div class="day-sep"><span>${esc(day)}</span></div>` : '';
      if (sep) lastFrom = '';
      lastDay = day || lastDay;
      const p = PEOPLE[m.from] || { color: '#888', role: '' };
      const cont = m.from === lastFrom; lastFrom = m.from;
      const where = channel === 'all' ? `<span class="in-ch"># ${esc(threadTitle(m.taskId).title)}</span>` : '';
      const toMe = m.to === 'cd' ? ' to-me' : '';
      return sep + `<div class="smsg ${cont ? 'cont' : ''}${toMe}">${cont ? '<span class="avatar-gap"></span>' : avatar(m.from)}<div class="smsg-body">
        ${cont ? '' : `<div class="smeta"><b style="--c:${p.color}">${esc(nameOf(m.from))}</b><span class="role">${esc(p.role || '')}</span><time>${hhmm(m.time)}</time>${m.to && m.to !== 'team' ? `<span class="to">→ ${esc(nameOf(m.to))}</span>` : ''}${where}</div>`}
        <div class="stext">${richText(m.text)}</div></div></div>`;
    }).join('') : `<div class="empty"><b>Kênh còn trống</b>Gõ tin đầu tiên bên dưới. Tin có <code>@Grid</code> là giao việc cho Grid.</div>`;
    const box = $('#msgs');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.dataset.stick = atBottom ? '1' : '0';
    const prevTop = box.scrollTop;
    box.innerHTML = html;
    if (atBottom) box.scrollTop = box.scrollHeight; else box.scrollTop = prevTop;

    const canSend = mode === 'live' || mode === 'demo';
    $('#composer-input').disabled = !canSend;
    $('#composer-send').disabled = !canSend;
    $('#composer-input').placeholder = canSend
      ? (channel === COMPANY || channel === 'all' ? 'Nhắn cho cả công ty… gõ @Grid, @Ink để gọi tên' : `Nhắn trong # ${tt.title}…`)
      : 'Chưa kết nối server — chạy start-studio.bat để nhắn';

    const mem = (p) => {
      const s = p.human ? null : data.agents[p.id];
      const st = s ? STATES[s.state] : null;
      return `<button class="member" data-id="${p.id}" title="${p.human ? '' : 'Bấm để @' + esc(p.name)}"><span class="mdot" style="--c:${st ? st.color : '#2f9a5c'}"></span>${avatar(p.id, 'sm')}<span><b>${esc(p.name)}</b><small>${p.human ? 'Đang online' : esc(st.short)}</small></span></button>`;
    };
    $('#members').innerHTML = `<div class="ch-title">THÀNH VIÊN · ${AGENTS.length + 1}</div>${[CD, ...AGENTS].map(mem).join('')}`;
  }

  function renderLue() {
    const reps = data.reports;
    const box = $('#view-lue');
    const head = `<div class="ov-head"><div><div class="ov-eyebrow">KHU A · TRỢ LÝ CÁ NHÂN</div><h2>Phòng Lue 🦆</h2></div></div>`;
    if (!reps.length) {
      box.innerHTML = head + `<div class="empty"><b>Chưa có báo cáo nào</b>Gõ trong Claude Code: <code>Lue ơi, làm báo cáo đầu ngày cho anh</code><br>Báo cáo sẽ lưu ở <code>.studio/reports/</code> và hiện ở đây.</div>`;
      return;
    }
    activeReport = Math.min(activeReport, reps.length - 1);
    box.innerHTML = head + `<div class="lue-layout"><div class="thread-list">${reps.map((r, i) => `<button class="thread ${i === activeReport ? 'active' : ''}" data-i="${i}"><small>BÁO CÁO</small><b>${esc(r.date || r.name)}</b></button>`).join('')}</div>
      <article class="report">${md(reps[activeReport].content)}</article></div>`;
    box.querySelectorAll('.thread').forEach((b) => b.addEventListener('click', () => { activeReport = +b.dataset.i; renderLue(); }));
  }

  // clock chip
  setInterval(() => {
    const t = lastUpdate ? lastUpdate.toLocaleTimeString('vi-VN', { hour12: false }) : '--:--:--';
    $('#clock-chip').textContent = `CẬP NHẬT LÚC ${t}`;
  }, 500);
  // làm mới "x phút trước"
  setInterval(() => { if (data) renderMini(); }, 15000);

  return { update, setMode, select, setView, openProfile };
}

// Markdown tối giản cho báo cáo của Lue
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
