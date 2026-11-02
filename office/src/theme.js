// Giao diện sáng / tối. "Tự động" đổi theo giờ thật trên máy: sáng 6:00–18:00, tối từ 18:00.
// Anh bấm nút trên thanh trên để chọn Tự động → Sáng → Tối; lựa chọn được nhớ trong trình duyệt.
const KEY = 'nekoma-theme';
const MODES = ['auto', 'light', 'dark'];
export const DAY_START = 6;
export const DAY_END = 18;

const isDay = (d = new Date()) => d.getHours() >= DAY_START && d.getHours() < DAY_END;

function readMode() {
  try { const m = localStorage.getItem(KEY); return MODES.includes(m) ? m : 'auto'; } catch { return 'auto'; }
}

export function startTheme(onChange) {
  let mode = readMode();
  let theme = null;
  const root = document.documentElement;

  function apply() {
    const next = mode === 'auto' ? (isDay() ? 'light' : 'dark') : mode;
    if (next === theme) return;
    // lần đầu đặt ngay, các lần sau mờ dần cho dịu mắt
    if (theme) { root.classList.add('theme-fade'); setTimeout(() => root.classList.remove('theme-fade'), 700); }
    theme = next;
    root.dataset.theme = theme;
    onChange?.(theme, mode);
  }
  apply();
  setInterval(apply, 30000);

  return {
    get mode() { return mode; },
    get theme() { return theme; },
    cycle() {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch { /* chế độ riêng tư: chỉ đổi tạm */ }
      const before = theme;
      apply();
      if (before === theme) onChange?.(theme, mode); // đổi chế độ nhưng màu giữ nguyên → vẫn cập nhật nhãn nút
    },
  };
}
