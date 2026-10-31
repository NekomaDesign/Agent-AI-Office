# NEKOMA STUDIO · Agent Office 3D

Studio sáng tạo chạy bằng các AI agent trong **Claude Code**, kèm một **văn phòng 3D** hiển thị trực tiếp ai đang làm gì.
Creative Director là **Nekoma** (người thật). Agent nào được anh giao việc thì người đó mới làm.

| Khu | Agent | Vai trò |
|---|---|---|
| A | **Brief** | Nhận brief & lên plan (chỉ đề xuất phân công) |
| B | **Nekoma** | Creative Director — tầng lửng |
| C | **Pixel** | Designer 2D — phòng kính |
| D | **Cube** | Designer 3D — script Blender |
| E | **Frame** | Motion Designer — storyboard, script After Effects |
| F | **Ink** | Content / Copywriter |
| G | **Kuma** 🐻 | Trợ lý cá nhân — báo cáo, deadline |
| H | — | Phòng hội thoại |

---

## Chạy văn phòng 3D

Chỉ cần **Node.js**, không phải cài thêm gì. Máy cần có Internet lần đầu để tải Three.js và font.

**Cách 1:** bấm đúp `start-studio.bat`.

**Cách 2:** trong PowerShell:

```powershell
cd Z:\DAI_WORKSPACE\Agent-AI-Office
node office\server.mjs
```

Trình duyệt tự mở `http://localhost:5173`. Giữ cửa sổ server mở trong lúc làm việc.

## Giao việc cho agent

Mở một cửa sổ PowerShell **khác**:

```powershell
cd Z:\DAI_WORKSPACE\Agent-AI-Office
claude
```

Rồi gọi tên người cần giao:

```
Brief ơi, phân tích brief này và lên plan giúp anh: <dán brief>
Ink ơi, viết 5 headline cho task autumn-cafe
Pixel ơi, làm visual direction cho task autumn-cafe
Kuma ơi, làm báo cáo đầu ngày cho anh
```

Agent sẽ ghi trạng thái vào `.studio/`. Văn phòng đọc lại mỗi 3 giây, nhân vật chuyển sang **ĐANG LÀM**, tin nhắn hiện ở **Phòng hội thoại**.
Sản phẩm nằm trong `outputs/<tên-task>/`. Khi anh nói "duyệt" hoặc "ok", agent chuyển sang **ĐÃ XONG**.

## Cấu trúc

```
CLAUDE.md            luật làm việc + giao thức ghi trạng thái (agent đọc file này)
.claude/agents/      định nghĩa 6 agent
.studio/             trạng thái sống: status/, tasks.json, chat/, reports/
outputs/             sản phẩm của agent
office/              văn phòng 3D (Three.js) + server.mjs
start-studio.bat     chạy văn phòng 1 click
```

## Tuỳ chỉnh

- **Tên studio:** sửa `.studio/studio.json`.
- **Tên, màu, mô tả agent trong văn phòng:** sửa `office/src/agents.js`.
- **Tính cách và cách làm việc của agent:** sửa file tương ứng trong `.claude/agents/`.
- **Xem bản demo dữ liệu giả:** mở `http://localhost:5173/?demo`.

## Riêng tư

`.studio/` (chat, task) và `outputs/` **không được đẩy lên GitHub** (xem `.gitignore`), vì có thể chứa brief của khách.
Bản demo trên GitHub Pages chỉ dùng dữ liệu giả: tab Actions → *Deploy demo office* → Run workflow. Lần đầu cần bật Settings → Pages → Source: *GitHub Actions*.
