# NEKOMA STUDIO · Agent Office 3D

Studio sáng tạo chạy bằng các AI agent trong **Claude Code**, kèm một **văn phòng 3D** hiển thị trực tiếp ai đang làm gì.
Creative Director là **Nekoma** (người thật). Anh giao thẳng cho từng người, hoặc giao **Grid** (Manager) để Grid tự chia việc cho team.

Văn phòng gồm 5 "đảo" lơ lửng nối bằng cầu. Khi một khu có người đang làm, các hạt sáng chạy trên cầu từ đảo điều phối sang khu đó.

| Khu | Ai ngồi | Vai trò |
|---|---|---|
| A · Tầng chỉ huy | **Nekoma** · **Lue** 🦆 | Creative Director + trợ lý cá nhân |
| B · Đảo điều phối | **Grid** 🧭 | Manager — chỉ dưới quyền anh, nhận việc lớn rồi chia lại cho team |
| C · Phòng chữ | **Brief** · **Ink** | Nhận brief & plan · Content / Copywriter |
| D · Xưởng hình | **Pixel** · **Cube** · **Frame** | Designer 2D · 3D · Motion (mỗi người một phòng kính) |
| E · Quảng trường chat | — | Chat chung của cả công ty |

Sơ đồ: **Nekoma → Grid → Brief, Ink, Pixel, Cube, Frame**. Lue chỉ nhận việc từ anh.

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

### Cách 1 — gõ ngay trên web (khuyên dùng)

Gõ vào ô **Giao việc…** ở góc dưới trái văn phòng, hoặc kênh **⚡ Giao việc** trong tab **Chat công ty**, rồi bấm Enter.
Server trên máy sẽ gọi Claude Code chạy nền để chuyển việc cho đúng người. Gõ `Grid ơi, lo trọn gói…` để Grid tự chia việc, hoặc bấm tên agent phía trên ô chat để chèn nhanh "Ink ơi, …".

- Lệnh xếp hàng lần lượt. Claude nhớ ngữ cảnh các lệnh trước, bấm **Phiên mới** để bắt đầu lại.
- Ở chế độ này agent được tự ghi file trong dự án, được đọc web và chạy lệnh `date`/`mkdir`/`ls`. Các lệnh hệ thống khác bị chặn.
- Cần đăng nhập Claude Code ít nhất một lần (gõ `claude` trong PowerShell).

### Cách 2 — trong Claude Code

Mở một cửa sổ PowerShell **khác**:

```powershell
cd Z:\DAI_WORKSPACE\Agent-AI-Office
claude
```

Giao trọn gói cho Manager — Grid chia việc, gọi từng bạn làm, rồi gom kết quả về cho anh duyệt:

```
Grid ơi, lo trọn gói chiến dịch này giúp anh, tự chia cho team nhé: <dán brief>
```

Hoặc gọi thẳng tên từng người:

```
Brief ơi, phân tích brief này và lên plan giúp anh: <dán brief>
Ink ơi, viết 5 headline cho task autumn-cafe
Lue ơi, làm báo cáo đầu ngày cho anh
```

Agent sẽ ghi trạng thái vào `.studio/`. Văn phòng đọc lại mỗi 3 giây, nhân vật chuyển sang **ĐANG LÀM**, tin nhắn hiện ở **Chat công ty**.

**Bấm vào bất kỳ nhân viên nào** (trong văn phòng 3D hoặc danh sách bên phải) để mở hồ sơ: việc đang làm, tiến độ, việc gần đây, tin nhắn, lệnh mẫu.

### Chat công ty

Tab **Chat công ty** giống Slack: kênh `# all` cho cả công ty, kênh **⚡ Giao việc** (Claude chạy thật), mỗi việc một kênh riêng, danh sách thành viên kèm trạng thái.

- **`# all`**: tag `@Ink`, `@Grid`… là người đó trả lời ngay trong kênh. Tag `@all` thì Grid trả lời thay mặt cả team. Không tag thì tin chỉ được ghi lại.
- **Xem file ngay trong chat**: ảnh, video, SVG, HTML, Markdown nhân viên gửi hiện thẳng trong tin nhắn. Bấm vào để phóng to.
- **Tải file gốc** về máy, **tải cả bộ .zip** của một việc, hoặc **📂 Mở thư mục** chứa file trong Explorer.

### Duyệt việc qua Grid

Nhân viên làm xong → **Grid duyệt trước** (trạng thái *GRID DUYỆT*). Đạt rồi Grid mới gửi anh **bản cuối** (*CHỜ ANH DUYỆT*).
Ở **Bảng công việc** bấm **Xem & duyệt**: xem toàn bộ file, rồi **Duyệt bản cuối** hoặc **Gửi góp ý cho Grid**. Grid chuyển góp ý cho đúng người sửa.
Việc của Lue (trợ lý riêng) thì gửi thẳng anh.
Sản phẩm nằm trong `outputs/<tên-task>/`. Khi anh nói "duyệt" hoặc "ok", agent chuyển sang **ĐÃ XONG**.

## Cấu trúc

```
CLAUDE.md            luật làm việc + giao thức ghi trạng thái (agent đọc file này)
.claude/agents/      định nghĩa 7 agent (manager = Grid)
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
