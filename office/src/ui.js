// Giao diện 2D: sidebar, hồ sơ nhân viên, mini chat, bảng công việc, chat công ty, phòng Lue, toast.
import { AGENTS, CD, PEOPLE, STATES, ZONES, COMPANY, ORDERS } from './agents.js';
import { FILE_RE, filesOf, attachHtml, hydrate, openViewer, openModal, md } from './files.js';

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

const face = (id) => { const p = PEOPLE[id]; return p ? (p.hair === 'duck' || p.bot ? p.emoji : esc(p.name[0])) : esc((id || '?')[0]); };
function avatar(id, size = '') {
  const p = PEOPLE[id] || { name: id || '?', color: '#888' };
  return `<span class="avatar ${size} ${p.human ? 'human' : ''} ${p.bot ? 'bot' : ''}" style="--c:${p.color}">${face(id)}</span>`;
}
const nameOf = (id) => (id === 'cd' ? `Anh ${CD.name}` : id === 'team' ? 'Cả team' : (PEOPLE[id]?.name || id || '?'));
const pill = (s) => { const st = STATES[s] || STATES.idle; return `<span class="pill" data-s="${s}" style="--c:${st.color}">${st.label}</span>`; };
// tô sáng @tên trong tin nhắn
const richText = (t) => esc(t).replace(/@([a-zà-ỹ]+)/gi, (m, n) => {
  const id = n.toLowerCase() === 'grid' ? 'manager' : n.toLowerCase();
  if (id === 'all' || id === 'team') return '<span class="mention" style="--c:#1d1c19">@all</span>';
  const p = PEOPLE[id];
  return p ? `<span class="mention" style="--c:${p.color}">@${esc(p.name)}</span>` : m;
}).replace(FILE_RE, (p) => `<button type="button" class="fpath" data-file="${p}">${p}</button>`);

function allMessages(chats) {
  const out = [];
  for (const [taskId, list] of Object.entries(chats)) for (const m of list) out.push({ ...m, taskId });
  return out.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

// ======================================================================
const elapsed = (iso) => { const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const CHATTER = 'tam-chuyen'; // kênh giả lập: nhân viên tám chuyện theo office/chatter.json
const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n || 0));
const fmtUsd = (n) => '$' + (n || 0).toFixed(2);
const fmtMin = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} phút` : `${Math.round((ms || 0) / 1000)} giây`);

export function createUI({ world, send, order, newSession, openFolder, setChatter }) {
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

  // ---- file & duyệt việc: bấm ở đâu cũng được (chat, bảng việc, hồ sơ, cửa sổ xem) ----
  document.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-file]');
    if (v) { e.preventDefault(); openViewer(v.dataset.file); return; }
    const o = e.target.closest('[data-open]');
    if (o) {
      e.preventDefault();
      try { await openFolder(o.dataset.open); miniToast('📂 Đã mở thư mục trên máy anh'); }
      catch (err) { miniToast(`Chưa mở được thư mục: ${err.message}`, true); }
      return;
    }
    const r = e.target.closest('[data-review]');
    if (r) { e.preventDefault(); openTaskReview(r.dataset.review); }
  });
  function miniToast(text, err) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--c', err ? '#d93a2b' : '#2f9a5c');
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---- Xem & duyệt bản cuối: anh chỉ duyệt việc Grid gửi lên, góp ý cũng gửi qua Grid ----
  function openTaskReview(id) {
    const t = data?.tasks.find((x) => x.id === id);
    if (!t) return;
    const kids = data.tasks.filter((x) => x.parent === t.id);
    const p = PEOPLE[t.assignee] || { name: t.assignee, color: '#999' };
    const sent = (data.chats[t.id] || []).filter((m) => m.from !== 'cd').flatMap(filesOf);
    const dirs = [`outputs/${t.id}/`, ...kids.map((k) => `outputs/${k.id}/`)];
    const files = [...new Set([...sent.filter((f) => !dirs.some((d) => f.startsWith(d))), ...dirs])];
    const final = t.state === 'waiting_review';
    const can = runnerStatus().ok;
    // việc của Lue (trợ lý riêng) gửi thẳng Lue, còn lại đều qua Grid
    const boss = t.assignee === 'lue' ? 'Lue' : 'Grid';
    const note = final ? '' : t.state === 'manager_review'
      ? '<p class="review-note">Grid đang duyệt phần này — anh chưa cần làm gì, khi đạt Grid sẽ gửi anh bản cuối.</p>'
      : t.state === 'done' ? '<p class="review-note ok">Việc này đã được duyệt xong.</p>' : '<p class="review-note">Việc đang làm — anh xem tạm các file đã có.</p>';
    const body = openModal(`<div class="review">
      <div class="review-head"><div><span class="proj">${esc(t.project || '')}</span><h3>${esc(t.title || t.id)}</h3>
        <small><span class="person" style="--c:${p.color}"><i></i>${esc(p.name)}</span> · ${t.assignedBy === 'manager' ? 'Grid giao' : 'Anh giao'} · cập nhật ${timeAgo(t.updated)}</small></div>${pill(t.state)}</div>
      ${kids.length ? `<div class="review-kids">${kids.map((k) => `<span>${pill(k.state)} ${esc(PEOPLE[k.assignee]?.name || k.assignee)} — ${esc(k.title || k.id)}</span>`).join('')}</div>` : ''}
      ${note}
      ${attachHtml(files)}
      ${final ? `<div class="review-act">
        <button type="button" class="btn btn-dark" id="rv-ok" ${can ? '' : 'disabled'}>✓ Duyệt bản cuối</button>
        <textarea id="rv-text" rows="3" placeholder="Góp ý cho bản cuối… ${boss === 'Grid' ? 'Grid sẽ chuyển cho đúng bạn sửa rồi gửi lại anh' : 'Lue sẽ sửa rồi gửi lại anh'}"></textarea>
        <button type="button" class="btn" id="rv-fb" ${can ? '' : 'disabled'}>Gửi góp ý cho ${boss}</button>
        <small class="hint" id="rv-hint">${can ? (boss === 'Grid' ? 'Duyệt hay góp ý đều gửi cho Grid — Grid chốt với cả team.' : 'Việc của Lue — duyệt hay góp ý gửi thẳng Lue.') : esc(runnerStatus().text || 'Chưa gửi được lúc này')}</small>
      </div>` : ''}
    </div>`, true);
    if (!final) return;
    const done = (msg) => { body.querySelector('.review-act').innerHTML = `<p class="review-note ok">${esc(msg)}</p>`; };
    body.querySelector('#rv-ok').addEventListener('click', async () => {
      try {
        await order(boss === 'Grid'
          ? `Grid ơi, anh duyệt bản cuối "${t.title || t.id}" (task ${t.id}) rồi nhé. Em chốt done cho task và các việc con, cảm ơn team giúp anh.`
          : `Lue ơi, anh duyệt "${t.title || t.id}" (task ${t.id}) rồi nhé, em chuyển sang done giúp anh.`);
        done(`Đã gửi duyệt cho ${boss} ✓`);
      }
      catch (err) { body.querySelector('#rv-hint').textContent = `Chưa gửi được: ${err.message}`; }
    });
    body.querySelector('#rv-fb').addEventListener('click', async () => {
      const fb = body.querySelector('#rv-text').value.trim();
      if (!fb) { body.querySelector('#rv-text').focus(); return; }
      try {
        await order(boss === 'Grid'
          ? `Grid ơi, anh góp ý bản cuối "${t.title || t.id}" (task ${t.id}):\n${fb}\n\nEm chuyển cho đúng bạn sửa, duyệt lại rồi gửi anh bản mới nhé.`
          : `Lue ơi, anh góp ý "${t.title || t.id}" (task ${t.id}):\n${fb}\n\nEm sửa rồi gửi lại anh nhé.`);
        done(boss === 'Grid' ? 'Đã gửi góp ý cho Grid — Grid sẽ chuyển cho team sửa.' : 'Đã gửi góp ý cho Lue.');
      }
      catch (err) { body.querySelector('#rv-hint').textContent = `Chưa gửi được: ${err.message}`; }
    });
  }

  // ---- giao việc thật (Claude Code chạy nền) ----
  let flash = null; // { text, err, until }
  function runnerStatus() {
    const run = data?.runner;
    if (mode === 'demo') return { ok: false, text: 'Bản demo — không giao việc thật được. Chạy start-studio.bat để dùng thật.' };
    if (mode !== 'live') return { ok: false, text: 'Đang chờ server…' };
    if (!run) return { ok: false, warn: true, text: 'Server cũ — tắt và mở lại start-studio.bat để bật giao việc trên web.' };
    if (!run.available) return { ok: false, warn: true, html: 'Chưa tìm thấy Claude Code trên máy. Cài: <code>irm https://claude.ai/install.ps1 | iex</code> rồi mở lại start-studio.bat' };
    if (run.busy) return { ok: true, busy: true, html: `<i class="dot"></i> Claude đang xử lý <span class="cs-time" data-start="${esc(run.startedAt)}">${elapsed(run.startedAt)}</span>${run.queue ? ` · ${run.queue} lệnh đang chờ` : ''} — “${esc(run.currentText.slice(0, 60))}${run.currentText.length > 60 ? '…' : ''}”` };
    return { ok: true, session: run.session, text: run.session ? 'Sẵn sàng · Claude nhớ ngữ cảnh các lệnh trước' : 'Sẵn sàng nhận việc · Enter để gửi, Shift+Enter xuống dòng' };
  }
  function paintStatus(el) {
    if (!el) return;
    if (flash && Date.now() < flash.until) { el.className = el.dataset.base + (flash.err ? ' err' : ''); el.textContent = flash.text; return; }
    const r = runnerStatus();
    el.className = el.dataset.base + (r.busy ? ' busy' : r.warn ? ' err' : '');
    if (r.html) el.innerHTML = r.html; else el.textContent = r.text;
    if (r.ok && r.session && !r.busy && el.id === 'composer-hint') el.insertAdjacentHTML('beforeend', ' <button type="button" class="cs-new" id="cs-new">Phiên mới</button>');
  }
  async function giveOrder(text) {
    const res = await order(text);
    flash = { text: res.queue > 0 ? `Đã xếp hàng · còn ${res.queue} lệnh phía trước` : 'Đã gửi · Claude đang nhận việc…', until: Date.now() + 4000 };
  }
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#cs-new')) return;
    try { await newSession(); flash = { text: 'Đã mở phiên mới', until: Date.now() + 3000 }; } catch (err) { flash = { text: err.message, err: true, until: Date.now() + 4000 }; }
    paintStatus($('#composer-hint'));
  });
  $('#mini-order-status').dataset.base = 'mini-order-status';
  const miniTa = $('#mini-order-input');
  miniTa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#mini-order').requestSubmit(); } });
  $('#mini-order').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = miniTa.value.trim();
    if (!text) return;
    try { await giveOrder(text); miniTa.value = ''; } catch (err) { flash = { text: `Chưa gửi được: ${err.message}`, err: true, until: Date.now() + 5000 }; }
    renderOrderBox();
  });
  function renderOrderBox() {
    const r = runnerStatus();
    miniTa.disabled = !r.ok; $('#mini-order button').disabled = !r.ok;
    paintStatus($('#mini-order-status'));
  }

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
    renderOrderBox();
  }

  // ---- data ----
  // ---- usage Claude: ô trên thanh trên + bảng chi tiết ----
  $('#usage-chip').addEventListener('click', () => openUsage());
  function renderUsage() {
    const chip = $('#usage-chip');
    const u = data?.usage;
    chip.hidden = !u;
    if (!u) return;
    chip.dataset.state = u.limit ? 'limit' : data.runner?.busy ? 'busy' : '';
    chip.textContent = u.limit
      ? `⛔ CLAUDE HẾT LƯỢT${u.limit.reset ? ` · RESET ${u.limit.reset.toUpperCase()}` : ''}`
      : `✦ CLAUDE · ${u.today.runs} LƯỢT · ${fmtTok(u.today.tokens)} TOKEN`;
  }
  function openUsage() {
    const u = data?.usage; if (!u) return;
    const card = (title, s) => `<div class="us-card"><small>${title}</small><b>${s.runs} lượt</b><span>${s.ok}/${s.runs} thành công</span><span>${fmtTok(s.tokens)} token · ${fmtTok(s.output)} viết ra</span><span>${fmtUsd(s.cost)} quy đổi API · ${fmtMin(s.ms)}</span></div>`;
    const kind = { order: '⚡ Giao việc', chat: '# all', review: 'Duyệt' };
    openModal(`<div class="usage">
      <h3>Claude của anh · lượt dùng từ văn phòng</h3>
      ${u.limit ? `<p class="review-note err">⛔ Gói Claude đang hết lượt${u.limit.reset ? ` — reset lúc <b>${esc(u.limit.reset)}</b>` : ''}. Lệnh gửi lúc này sẽ báo lỗi, tới giờ reset anh gửi lại nhé.<br><small>${esc(u.limit.text || '')}</small></p>` : ''}
      <div class="us-grid">${card('HÔM NAY', u.today)}${card('5 GIỜ QUA', u.last5h)}${card('7 NGÀY', u.last7d)}${card('TỪ TRƯỚC TỚI NAY', u.total)}</div>
      <h4>LẦN CHẠY GẦN ĐÂY</h4>
      ${u.recent.length ? `<div class="table-wrap"><table><thead><tr><th>LÚC</th><th>LOẠI</th><th>LỆNH</th><th>TOKEN</th><th>QUY ĐỔI</th><th>THỜI GIAN</th><th>KẾT QUẢ</th></tr></thead><tbody>${u.recent.map((r) => `<tr><td>${hhmm(r.time)} <small class="hint">${esc(r.time.slice(5, 10))}</small></td><td>${kind[r.kind] || esc(r.kind)}</td><td>${esc(r.text)}</td><td>${fmtTok(r.input + r.output + r.cacheRead + r.cacheWrite)}</td><td>${fmtUsd(r.cost)}</td><td>${fmtMin(r.durationMs)}</td><td>${r.ok ? '<span class="pill" data-s="done" style="--c:#2f9a5c">XONG</span>' : `<span class="pill" style="--c:#d93a2b">${r.limited ? 'HẾT LƯỢT' : 'LỖI'}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Chưa có lần chạy nào được ghi lại.</p>'}
      <p class="hint">Chỉ tính các lần văn phòng gọi Claude chạy nền (kênh ⚡ Giao việc, tag ở # all, nút duyệt/góp ý). "Quy đổi API" là giá nếu trả theo API — gói Pro không bị tính số tiền này. Anthropic chưa cho đọc % hạn mức 5 giờ của gói Pro tự động; muốn xem chính xác, mở Claude Code và gõ <code>/usage</code>.</p>
    </div>`, true);
  }

  function update(d) {
    data = d;
    lastUpdate = new Date();
    renderUsage();
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
    if (prevMsgKeys) for (const m of msgs) if (!prevMsgKeys.has(keyOf(m))) world.say(m.from, m.text, m.to);
    prevMsgKeys = new Set(msgs.map(keyOf));

    world.update(d);
    render();
    renderOrderBox();
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
    const working = byState('working'), blocked = byState('blocked');
    const finals = data.tasks.filter((t) => t.state === 'waiting_review' && !t.parent);
    const gridReview = data.tasks.filter((t) => t.state === 'manager_review');
    const line = (list, f) => list.length ? list.map(f).join('') : '<span class="hint">Không có</span>';
    const taskLink = (t) => `<button class="link" data-review="${esc(t.id)}"><b>${esc(PEOPLE[t.assignee]?.name || t.assignee)}</b> — ${esc(t.title || t.id)}</button>`;
    $('#detail').innerHTML = `<div class="section-title" style="margin-top:0">HÔM NAY CỦA ANH</div>
      <dl class="kv">
        <dt>BẢN CUỐI CHỜ ANH</dt><dd>${line(finals, taskLink)}</dd>
        <dt>GRID ĐANG DUYỆT</dt><dd>${line(gridReview, taskLink)}</dd>
        <dt>ĐANG LÀM</dt><dd>${line(working, (a) => `<button class="link" data-id="${a.id}">${esc(a.name)}</button> `)}</dd>
        <dt>CẦN HỖ TRỢ</dt><dd>${line(blocked, (a) => `<button class="link" data-id="${a.id}"><b>${esc(a.name)}</b> — ${esc(data.agents[a.id].note)}</button>`)}</dd>
      </dl>
      <p class="hint">Bấm vào một nhân viên (trong văn phòng hoặc danh sách) để xem hồ sơ. Việc lớn cứ giao <b>Grid</b>, Grid tự chia cho team và duyệt trước, anh chỉ nhận bản cuối.</p>`;
    $('#detail').querySelectorAll('.link[data-id]').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
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
      const finals = data.tasks.filter((t) => t.state === 'waiting_review' && !t.parent);
      const gridReview = data.tasks.filter((t) => t.state === 'manager_review');
      box.innerHTML = head + `<p class="pf-desc">${esc(p.desc)}</p>
        <div class="pf-block"><h4>SƠ ĐỒ ĐỘI NGŨ</h4>
          <div class="org">
            <div class="org-row"><span class="org-node human">★ Nekoma</span></div>
            <div class="org-row two"><button class="org-node" data-id="manager" style="--c:${PEOPLE.manager.color}">🧭 Grid · Manager</button><button class="org-node" data-id="lue" style="--c:${PEOPLE.lue.color}">🦆 Lue · Trợ lý</button></div>
            <div class="org-row">${people(AGENTS.filter((a) => a.reportsTo === 'manager').map((a) => a.id))}</div>
          </div></div>
        <div class="pf-block"><h4>BẢN CUỐI CHỜ ANH DUYỆT · ${finals.length}</h4>${finals.length ? finals.map((t) => `<button class="pf-task" data-review="${esc(t.id)}">${avatar(t.assignee, 'sm')}<span><b>${esc(t.title || t.id)}</b><small>Grid đã duyệt · bấm để xem file & duyệt</small></span></button>`).join('') : '<p class="hint">Không có bản cuối nào chờ anh.</p>'}</div>
        <div class="pf-block"><h4>GRID ĐANG DUYỆT · ${gridReview.length}</h4>${gridReview.length ? gridReview.map((t) => `<button class="pf-task" data-review="${esc(t.id)}">${avatar(t.assignee, 'sm')}<span><b>${esc(t.title || t.id)}</b><small>${esc(PEOPLE[t.assignee]?.name || '')} đã nộp · anh chưa cần làm gì</small></span></button>`).join('') : '<p class="hint">Grid không có bài nào đang chờ duyệt.</p>'}</div>`;
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
        <div class="pf-stats"><div><b>${mine.length}</b><small>VIỆC</small></div><div><b>${cnt('working')}</b><small>ĐANG LÀM</small></div><div><b>${cnt('manager_review') + cnt('waiting_review')}</b><small>CHỜ DUYỆT</small></div><div><b>${cnt('done')}</b><small>XONG</small></div></div>
        <dl class="kv"><dt>BÁO CÁO CHO</dt><dd>${boss}</dd><dt>NHẬN VIỆC TỪ</dt><dd>${p.reportsTo === 'manager' ? 'Anh Nekoma hoặc Grid' : 'Chỉ anh Nekoma'}</dd></dl>
        ${team}
        <div class="pf-block"><h4>VIỆC GẦN ĐÂY</h4>${mine.length ? mine.slice(0, 5).map((t) => `<div class="pf-row"><span>${esc(t.title || t.id)}<small>${t.assignedBy === 'manager' ? '← Grid giao' : '← Anh giao'} · ${timeAgo(t.updated)}</small></span>${pill(t.state)}</div>`).join('') : '<p class="hint">Chưa có việc nào.</p>'}</div>
        <div class="pf-block"><h4>TIN NHẮN GẦN ĐÂY</h4>${msgs.length ? msgs.map((m) => `<div class="pf-msg"><small><b>${esc(nameOf(m.from))}</b> → ${esc(nameOf(m.to))} · ${hhmm(m.time)}</small><p>${richText(m.text)}</p></div>`).join('') : '<p class="hint">Chưa có tin nhắn.</p>'}</div>
        <div class="order-box"><header>LỆNH MẪU · DÁN VÀO CLAUDE CODE <button id="copy-order">COPY</button></header><pre>${esc(p.order)}</pre></div>
        <div class="pf-actions"><button class="btn btn-dark" id="pf-dm">Nhắn @${esc(p.name)} trong # all</button></div>`;
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
      return `<li>${avatar(m.from)}<div><div class="who" style="--c:${p.color}"><b>${esc(nameOf(m.from))}</b> → ${esc(nameOf(m.to))}${m.taskId === COMPANY ? ' · <i># all</i>' : m.taskId === CHATTER ? ' · <i>☕ tám</i>' : ''} · <time>${timeAgo(m.time)}</time></div><p>${richText(m.text)}</p>${filesOf(m).length ? `<small class="mini-files">📎 ${filesOf(m).length} tệp — mở Chat công ty để xem</small>` : ''}</div></li>`;
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
    const body = tasks.length ? `<div class="table-wrap"><table><thead><tr><th>VIỆC</th><th>NGƯỜI LÀM</th><th>GIAO BỞI</th><th>TRẠNG THÁI</th><th>TIẾN ĐỘ</th><th>DEADLINE</th><th>CẬP NHẬT</th><th>TỆP · DUYỆT</th></tr></thead><tbody>
      ${tasks.map((t) => { const p = PEOPLE[t.assignee] || { name: t.assignee || '—', color: '#999' }; const st = STATES[t.state];
        const by = t.assignedBy === 'manager' ? `<span class="person" style="--c:${PEOPLE.manager.color}"><i></i>Grid</span>` : '<span class="hint">Anh Nekoma</span>';
        return `<tr class="${t._child ? 'child' : ''}"><td><span class="proj">${esc(t.project || '')}</span>${esc(t.title || t.id)}</td>
        <td><button class="person" data-id="${esc(t.assignee)}" style="--c:${p.color}"><i></i>${esc(p.name)}</button></td><td>${by}</td><td>${pill(t.state)}</td>
        <td><div class="bar" style="--c:${st.color}"><span><b style="width:${t.progress}%"></b></span>${t.progress}%</div></td>
        <td>${esc(t.deadline || '—')}</td><td>${timeAgo(t.updated)}</td>
        <td>${t.state === 'waiting_review' && !t.parent ? `<button class="btn-mini hot" data-review="${esc(t.id)}">Xem & duyệt</button>` : `<button class="btn-mini" data-review="${esc(t.id)}">📎 Xem</button>`}</td></tr>`; }).join('')}
      </tbody></table></div>`
      : `<div class="empty"><b>Chưa có việc nào</b>Mở Claude Code và giao việc, ví dụ: <code>Grid ơi, lo trọn gói chiến dịch này giúp anh</code></div>`;
    $('#view-board').innerHTML = head + body;
    $('#view-board').querySelectorAll('button.person[data-id]').forEach((b) => b.addEventListener('click', () => PEOPLE[b.dataset.id] && select(b.dataset.id)));
  }

  // ---------- CHAT CÔNG TY ----------
  function threadTitle(id) {
    if (id === COMPANY) return { project: 'CẢ CÔNG TY', title: 'all' };
    if (id === ORDERS) return { project: 'CLAUDE CHẠY THẬT', title: '⚡ Giao việc' };
    if (id === CHATTER) return { project: 'GIẢ LẬP · KHÔNG PHẢI VIỆC THẬT', title: '☕ Tám chuyện' };
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
            <div class="composer-box"><textarea id="composer-input" rows="2" placeholder="Nhắn # all… tag @Grid, @Ink hoặc @all để được trả lời"></textarea><button type="submit" id="composer-send">Gửi ↵</button></div>
            <small class="composer-hint" id="composer-hint" data-base="composer-hint"></small>
          </form>
        </section>
        <aside class="members" id="members"></aside>
      </div>`;
    $('#mention-row').innerHTML = `<button type="button" data-n="all" class="tag-all" style="--c:#1d1c19">@all</button>` + AGENTS.map((a) => `<button type="button" data-n="${esc(a.name)}" style="--c:${a.color}">@${esc(a.name)}</button>`).join('');
    $('#mention-row').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]'); if (!b) return;
      insertName(b.dataset.n);
    });
    const ta = $('#composer-input');
    // kênh ⚡ Giao việc: chèn "Ink ơi, …"; kênh khác: chèn "@Ink"
    function insertName(n) {
      if (channel === ORDERS) ta.value = `${n} ơi, ` + ta.value.replace(/^\S+ ơi, /, '');
      else ta.value = `@${n} ` + ta.value.replace(/^@\S+\s*/, '');
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
    $('#composer').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      const hint = $('#composer-hint');
      const btn = $('#composer-send');
      btn.disabled = true;
      try {
        if (channel === ORDERS) await giveOrder(text);
        else {
          const res = await send(channel === 'all' ? COMPANY : channel, text);
          const toAll = channel === COMPANY || channel === 'all';
          flash = { text: res?.reply ? `Đã gửi · người được tag đang trả lời${res.queue ? ` (còn ${res.queue} việc phía trước)` : ''}…`
            : mode === 'demo' ? 'Đã gửi (bản demo — chỉ hiện trên máy này).'
            : toAll ? 'Đã gửi · tag @tên hoặc @all để được trả lời.' : 'Đã gửi · chỉ ghi lại. Muốn agent làm thật thì gửi ở kênh ⚡ Giao việc.', until: Date.now() + 6000 };
        }
        ta.value = '';
        paintStatus(hint);
        scrollMsgs(true);
      } catch (err) {
        flash = { text: `Chưa gửi được: ${err.message}`, err: true, until: Date.now() + 6000 };
        paintStatus(hint);
      } finally { btn.disabled = false; }
    });
    $('#room-head').addEventListener('click', async (e) => {
      if (!e.target.closest('#chatter-toggle')) return;
      try { await setChatter(!data.chatter); } catch (err) { miniToast(`Chưa đổi được: ${err.message}`, true); }
    });
    $('#ch-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      channel = b.dataset.t; renderChat(); scrollMsgs(true);
    });
    $('#members').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]'); if (!b) return;
      if (b.dataset.id === 'cd') return;
      insertName(PEOPLE[b.dataset.id].name);
    });
  }

  function scrollMsgs(force) {
    const m = $('#msgs'); if (!m) return;
    if (force || m.dataset.stick !== '0') m.scrollTop = m.scrollHeight;
  }

  function renderChat() {
    if (!data) return;
    if (!$('#composer')) buildChatShell();
    const threads = Object.entries(data.chats).filter(([id, l]) => l.length && id !== COMPANY && id !== ORDERS && id !== CHATTER)
      .sort((a, b) => String(b[1].at(-1).time).localeCompare(String(a[1].at(-1).time)));
    const company = data.chats[COMPANY] || [];
    // "Tất cả hoạt động" chỉ gồm việc thật, không tính tám chuyện giả lập
    const real = Object.fromEntries(Object.entries(data.chats).filter(([id]) => id !== CHATTER));
    const total = Object.values(real).reduce((n, l) => n + l.length, 0);
    if (channel !== 'all' && channel !== COMPANY && channel !== ORDERS && channel !== CHATTER && !data.chats[channel]) channel = COMPANY;
    $('#chat-eyebrow').textContent = `${data.studio.name} · KHU E · ${ZONES.E.name.toUpperCase()}`;

    const chBtn = (id, label, sub, n) => `<button class="channel ${channel === id ? 'active' : ''}" data-t="${esc(id)}"><b>${label}</b><small>${esc(sub)}</small>${n ? `<span class="n">${n}</span>` : ''}</button>`;
    $('#ch-list').innerHTML = `<div class="ch-title">KÊNH</div>` +
      chBtn(COMPANY, '# all', 'Cả công ty · tag để được trả lời', company.length) +
      chBtn(ORDERS, '⚡ Giao việc', 'Claude Code làm thật', (data.chats[ORDERS] || []).length) +
      chBtn(CHATTER, '☕ Tám chuyện', data.chatter ? 'Team tám Gen Z · giả lập' : 'Đang tắt', (data.chats[CHATTER] || []).length) +
      chBtn('all', '◎ Tất cả hoạt động', 'Mọi kênh gộp lại', total) +
      `<div class="ch-title">VIỆC (${threads.length})</div>` +
      threads.map(([id, l]) => { const tt = threadTitle(id); return chBtn(id, `# ${esc(tt.title)}`, tt.project, l.length); }).join('');

    let shown;
    if (channel === 'all') shown = Object.entries(real).filter(([, l]) => l.length);
    else shown = [[channel, data.chats[channel] || []]];
    const list = channel === 'all' ? allMessages(Object.fromEntries(shown)) : shown[0][1].map((m) => ({ ...m, taskId: channel }));
    const tt = threadTitle(channel === 'all' ? COMPANY : channel);
    $('#room-head').innerHTML = channel === 'all'
      ? `<b>◎ Tất cả hoạt động</b><small>${total} tin từ mọi kênh · gửi tin ở đây sẽ vào # all</small>`
      : channel === CHATTER
        ? `<div class="room-row"><div><b>☕ Tám chuyện</b><small>Giả lập: nhân viên tự nhắn nhau theo kịch bản <code>office/chatter.json</code> — không tốn lượt Claude, không phải việc thật</small></div><button type="button" class="btn-mini ${data.chatter ? '' : 'hot'}" id="chatter-toggle">${data.chatter ? '⏸ Tạm tắt' : '▶ Bật lại'}</button></div>`
      : channel === ORDERS
        ? `<b>⚡ Giao việc</b><small>Gõ ở đây là Claude Code trên máy chạy thật: gọi "Grid ơi…" để giao trọn gói, hoặc gọi thẳng tên từng bạn</small>`
        : `<b># ${esc(tt.title)}</b><small>${channel === COMPANY ? 'Cả công ty · tag @tên để người đó trả lời, @all để cả team (Grid thay mặt) trả lời · không tag thì chỉ ghi lại' : esc(tt.project)}</small>`;

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
        <div class="stext">${richText(m.text)}</div>${attachHtml(filesOf(m))}</div></div>`;
    }).join('') : channel === ORDERS
      ? `<div class="empty"><b>Chưa có lệnh nào</b>Gõ ví dụ <code>Grid ơi, lo trọn gói chiến dịch này giúp anh</code> — Claude sẽ chuyển việc cho đúng người.</div>`
      : `<div class="empty"><b>Kênh còn trống</b>Gõ tin đầu tiên bên dưới. Muốn agent làm việc thật thì dùng kênh <b>⚡ Giao việc</b>.</div>`;
    const typing = data.runner?.busy && data.runner.currentKind === 'chat' && (channel === COMPANY || channel === 'all')
      ? '<div class="typing"><i></i><i></i><i></i> Người được tag đang trả lời anh…</div>' : '';
    const box = $('#msgs');
    const sig = channel + '|' + html.length + '|' + (list.at(-1)?.time || '') + '|' + typing.length;
    if (box.dataset.sig !== sig) {
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      box.dataset.stick = atBottom ? '1' : '0';
      const prevTop = box.scrollTop;
      box.innerHTML = html + typing;
      box.dataset.sig = sig;
      hydrate(box);
      if (atBottom || box.dataset.sigChannel !== channel) box.scrollTop = box.scrollHeight; else box.scrollTop = prevTop;
      box.dataset.sigChannel = channel;
      // ảnh tải xong làm tin dài ra → giữ đáy nếu đang ở đáy
      box.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => { if (box.dataset.stick !== '0') box.scrollTop = box.scrollHeight; }, { once: true }));
    }

    const isOrder = channel === ORDERS;
    const canSend = isOrder ? runnerStatus().ok : mode === 'live' || mode === 'demo';
    $('#composer-input').disabled = !canSend;
    $('#composer-send').disabled = !canSend;
    $('#composer-send').textContent = isOrder ? 'Giao việc ↵' : 'Gửi ↵';
    $('#composer').classList.toggle('order', isOrder);
    $('#mention-row').querySelectorAll('button').forEach((b) => { b.textContent = isOrder ? `${b.dataset.n} ơi` : `@${b.dataset.n}`; b.hidden = isOrder && b.dataset.n === 'all'; });
    $('#composer-input').placeholder = !canSend
      ? (isOrder ? runnerStatus().text || 'Chưa giao việc được' : 'Chưa kết nối server — chạy start-studio.bat để nhắn')
      : isOrder ? 'Giao việc… vd: Grid ơi, lo trọn gói brief Autumn Café giúp anh'
      : channel === COMPANY || channel === 'all' ? 'Nhắn # all… tag @Grid, @Ink hoặc @all để được trả lời' : `Nhắn trong # ${tt.title}…`;
    if (isOrder || (flash && Date.now() < flash.until)) paintStatus($('#composer-hint'));
    else { const h = $('#composer-hint'); h.className = 'composer-hint'; h.textContent = ''; }

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
    document.querySelectorAll('.cs-time').forEach((el) => (el.textContent = elapsed(el.dataset.start)));
  }, 500);
  // làm mới "x phút trước"
  setInterval(() => { if (data) renderMini(); }, 15000);

  return { update, setMode, select, setView, openProfile };
}
