// Đội ngũ studio + bảng trạng thái. Sửa tên/màu ở đây là văn phòng tự đổi theo.

export const AGENTS = [
  {
    id: 'brief', name: 'Brief', role: 'Nhận brief & Plan', zone: 'A', zoneName: 'Nhận brief',
    color: '#e8582c', shirt: '#e8582c', hair: 'short',
    desc: 'Đọc brief, phân tích mục tiêu – đối tượng – deliverable, chia task và đề xuất phân công. Chỉ đề xuất, anh duyệt mới giao.',
    order: 'Brief ơi, phân tích brief này và lên plan giúp anh:\n',
  },
  {
    id: 'pixel', name: 'Pixel', role: 'Designer 2D', zone: 'C', zoneName: 'Phòng kính 2D',
    color: '#d9488b', shirt: '#f4f1ea', hair: 'bun',
    desc: 'Visual direction, moodboard, palette, typography, layout phác (SVG/HTML) và prompt cho công cụ tạo ảnh AI.',
    order: 'Pixel ơi, làm visual direction cho task này giúp anh:\n',
  },
  {
    id: 'cube', name: 'Cube', role: 'Designer 3D', zone: 'D', zoneName: 'Xưởng 3D',
    color: '#3a5bd9', shirt: '#3a5bd9', hair: 'short',
    desc: 'Shot list 3D, ánh sáng, vật liệu PBR và script Python dựng sẵn scene trong Blender.',
    order: 'Cube ơi, viết script Blender dựng scene cho task này giúp anh:\n',
  },
  {
    id: 'frame', name: 'Frame', role: 'Motion Designer', zone: 'E', zoneName: 'Góc motion',
    color: '#7a4fd0', shirt: '#2b2a33', hair: 'beanie',
    desc: 'Storyboard, timing theo beat/VO, expression và script ExtendScript dựng sẵn comp trong After Effects.',
    order: 'Frame ơi, làm storyboard cho task này giúp anh:\n',
  },
  {
    id: 'ink', name: 'Ink', role: 'Content / Copywriter', zone: 'F', zoneName: 'Bàn chữ',
    color: '#2f8a5b', shirt: '#2f8a5b', hair: 'long',
    desc: 'Headline, tagline, caption, hook, kịch bản và VO script — luôn đưa nhiều phương án kèm đề xuất.',
    order: 'Ink ơi, viết 5 headline cho task này giúp anh:\n',
  },
  {
    id: 'kuma', name: 'Kuma', role: 'Trợ lý cá nhân', zone: 'G', zoneName: 'Bàn trợ lý',
    color: '#a8692f', shirt: '#f2c230', hair: 'bear',
    desc: 'Báo cáo đầu/cuối ngày, nhắc deadline, lên lịch, ghi chú họp, dọn bảng công việc.',
    order: 'Kuma ơi, làm báo cáo đầu ngày cho anh nhé.',
  },
];

export const CD = {
  id: 'cd', name: 'Nekoma', role: 'Creative Director', zone: 'B', zoneName: 'Tầng lửng CD',
  color: '#1f1d1a', shirt: '#1f1d1a', hair: 'short', human: true,
  desc: 'Người ra quyết định. Agent chỉ bắt tay vào việc khi anh Nekoma giao trực tiếp.',
};

// Claude Code chạy nền — nhận lệnh anh gõ trên web rồi chuyển cho đúng agent
export const STUDIO_BOT = { id: 'studio', name: 'Điều phối', role: 'Claude Code', color: '#3b3a36', bot: true };

export const PEOPLE = Object.fromEntries([...AGENTS, CD, STUDIO_BOT].map((a) => [a.id, a]));

export const STATES = {
  idle:           { label: 'RẢNH',       short: 'Rảnh',       color: '#9b958b', icon: '○' },
  working:        { label: 'ĐANG LÀM',   short: 'Đang làm',   color: '#f0a81c', icon: '●' },
  waiting_review: { label: 'CHỜ DUYỆT',  short: 'Chờ duyệt',  color: '#ec6a24', icon: '◐' },
  blocked:        { label: 'CẦN HỖ TRỢ', short: 'Cần hỗ trợ', color: '#d93a2b', icon: '!' },
  done:           { label: 'ĐÃ XONG',    short: 'Đã xong',    color: '#2f9a5c', icon: '✓' },
};

export const stateOf = (s) => (STATES[s] ? s : 'idle');
