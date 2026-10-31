import { createWorld } from './world.js';
import { createUI } from './ui.js';
import { startSource } from './data.js';

async function boot() {
  // Chờ font tải xong để chữ vẽ trên tường/màn hình 3D hiển thị đúng tiếng Việt
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load("800 40px 'Be Vietnam Pro'"),
        document.fonts.load("600 40px 'Be Vietnam Pro'"),
        document.fonts.load("700 20px 'JetBrains Mono'"),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* dùng font dự phòng */ }

  let ui, source;
  const world = createWorld(document.getElementById('canvas-wrap'), {
    onSelect: (id) => ui.select(id),
    onOpenChat: () => ui.setView('chat'),
  });
  ui = createUI({ world, send: (channel, text) => source.send(channel, text) });
  ui.select('cd', false);

  source = startSource((data) => ui.update(data), (mode) => ui.setMode(mode));

  const loading = document.getElementById('loading');
  setTimeout(() => loading.classList.add('hide'), 300);
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  el.classList.add('error');
  el.innerHTML = `<p>Không dựng được văn phòng 3D.<br>Kiểm tra kết nối Internet (cần tải Three.js) rồi tải lại trang.<br><small>${String(err.message || err)}</small></p>`;
});
