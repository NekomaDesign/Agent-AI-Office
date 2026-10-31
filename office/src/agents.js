// Đội ngũ studio + khu làm việc + bảng trạng thái. Sửa tên/màu ở đây là văn phòng tự đổi theo.

// Khu (đảo) trong văn phòng 3D
export const ZONES = {
  A: { id: 'A', name: 'Tầng chỉ huy',      desc: 'Creative Director & trợ lý',      color: '#f2c230' },
  B: { id: 'B', name: 'Đảo điều phối',     desc: 'Manager nhận việc & chia cho team', color: '#14a3a0' },
  C: { id: 'C', name: 'Phòng chữ',         desc: 'Brief & Content',                  color: '#2f8a5b' },
  D: { id: 'D', name: 'Xưởng hình',        desc: 'Designer 2D · 3D · Motion',        color: '#5b6cf0' },
  E: { id: 'E', name: 'Quảng trường chat', desc: 'Chat chung toàn công ty',          color: '#e8582c' },
};

export const AGENTS = [
  {
    id: 'manager', name: 'Grid', role: 'Manager · Điều phối', zone: 'B', reportsTo: 'cd',
    color: '#14a3a0', shirt: '#1f3b4d', hair: 'swept', emoji: '🧭',
    desc: 'Chỉ dưới quyền anh Nekoma. Nhận việc lớn từ anh, chia nhỏ rồi giao lại cho đúng người trong team, theo dõi tiến độ và gom kết quả về cho anh duyệt.',
    order: 'Grid ơi, lo trọn gói việc này giúp anh, tự chia cho team nhé:\n',
  },
  {
    id: 'lue', name: 'Lue', role: 'Trợ lý cá nhân', zone: 'A', reportsTo: 'cd',
    color: '#e09a00', shirt: '#f28fab', hair: 'duck', emoji: '🦆',
    desc: 'Ngồi cạnh anh ở tầng chỉ huy. Báo cáo đầu/cuối ngày, nhắc deadline, lên lịch, ghi chú họp, dọn bảng công việc.',
    order: 'Lue ơi, làm báo cáo đầu ngày cho anh nhé.',
  },
  {
    id: 'brief', name: 'Brief', role: 'Nhận brief & Plan', zone: 'C', reportsTo: 'manager',
    color: '#e8582c', shirt: '#e8582c', hair: 'short', emoji: '📋',
    desc: 'Đọc brief, phân tích mục tiêu – đối tượng – deliverable, chia task và đề xuất phân công.',
    order: 'Brief ơi, phân tích brief này và lên plan giúp anh:\n',
  },
  {
    id: 'ink', name: 'Ink', role: 'Content / Copywriter', zone: 'C', reportsTo: 'manager',
    color: '#2f8a5b', shirt: '#2f8a5b', hair: 'long', emoji: '✍️',
    desc: 'Headline, tagline, caption, hook, kịch bản và VO script — luôn đưa nhiều phương án kèm đề xuất.',
    order: 'Ink ơi, viết 5 headline cho task này giúp anh:\n',
  },
  {
    id: 'pixel', name: 'Pixel', role: 'Designer 2D', zone: 'D', reportsTo: 'manager',
    color: '#d9488b', shirt: '#f4f1ea', hair: 'bun', emoji: '🎨',
    desc: 'Visual direction, moodboard, palette, typography, layout phác (SVG/HTML) và prompt cho công cụ tạo ảnh AI.',
    order: 'Pixel ơi, làm visual direction cho task này giúp anh:\n',
  },
  {
    id: 'cube', name: 'Cube', role: 'Designer 3D', zone: 'D', reportsTo: 'manager',
    color: '#3a5bd9', shirt: '#3a5bd9', hair: 'short', emoji: '🧊',
    desc: 'Shot list 3D, ánh sáng, vật liệu PBR và script Python dựng sẵn scene trong Blender.',
    order: 'Cube ơi, viết script Blender dựng scene cho task này giúp anh:\n',
  },
  {
    id: 'frame', name: 'Frame', role: 'Motion Designer', zone: 'D', reportsTo: 'manager',
    color: '#7a4fd0', shirt: '#2b2a33', hair: 'beanie', emoji: '🎬',
    desc: 'Storyboard, timing theo beat/VO, expression và script ExtendScript dựng sẵn comp trong After Effects.',
    order: 'Frame ơi, làm storyboard cho task này giúp anh:\n',
  },
];

export const CD = {
  id: 'cd', name: 'Nekoma', role: 'Creative Director', zone: 'A', reportsTo: null,
  color: '#1f1d1a', shirt: '#1f1d1a', hair: 'short', human: true, emoji: '★',
  desc: 'Người ra quyết định. Giao việc thẳng cho từng người, hoặc giao Grid (Manager) để Grid tự chia cho team.',
};

for (const p of [...AGENTS, CD]) p.zoneName = ZONES[p.zone].name;

// Claude Code chạy nền — nhận lệnh anh gõ ở kênh ⚡ Giao việc rồi chuyển cho đúng agent
export const STUDIO_BOT = { id: 'studio', name: 'Claude', role: 'Chạy lệnh nền', color: '#3b3a36', bot: true, emoji: '✦' };

export const PEOPLE = Object.fromEntries([...AGENTS, CD, STUDIO_BOT].map((a) => [a.id, a]));

export const STATES = {
  idle:           { label: 'RẢNH',       short: 'Rảnh',       color: '#9b958b', icon: '○' },
  working:        { label: 'ĐANG LÀM',   short: 'Đang làm',   color: '#f0a81c', icon: '●' },
  manager_review: { label: 'GRID DUYỆT', short: 'Chờ Grid duyệt', color: '#14a3a0', icon: '◑' },
  waiting_review: { label: 'CHỜ ANH DUYỆT', short: 'Chờ anh duyệt', color: '#ec6a24', icon: '◐' },
  blocked:        { label: 'CẦN HỖ TRỢ', short: 'Cần hỗ trợ', color: '#d93a2b', icon: '!' },
  done:           { label: 'ĐÃ XONG',    short: 'Đã xong',    color: '#2f9a5c', icon: '✓' },
};

export const stateOf = (s) => (STATES[s] ? s : 'idle');

// Kênh chat chung toàn công ty (file .studio/chat/company.jsonl)
export const COMPANY = 'company';
// Kênh ra lệnh: tin gửi ở đây được Claude Code chạy thật (file .studio/chat/dieu-phoi.jsonl)
export const ORDERS = 'dieu-phoi';
