# Hướng dẫn cài đặt Arsenal Plugin vào Oh My Pi (OMP)

Tài liệu này hướng dẫn cách kết nối và nạp plugin `arsenal` vào môi trường Oh My Pi (OMP) từ mã nguồn repository cục bộ.

---

## 1. Bản chất kiến trúc phân phối

Plugin Arsenal được thiết kế theo chuẩn OMP package tại thư mục `plugin/`:
- `plugin/package.json`: Khai báo các runtime extension biên dịch tại `./dist/extensions/*.js` (`bounding.js`, `ledger.js`, `budget.js`, `routing.js`).
- `plugin/plugin.json`: Khai báo năng lực roles, router skills, tools (`evidence_exec`, `skill_*`, `verify_oracle`...), và extensions.
- `plugin/catalog/`: Chứa danh mục định tuyến và chỉ mục kỹ năng.

> **Lưu ý về Marketplace Manifest**: Repository hiện tại là mã nguồn phát triển cục bộ và chưa có manifest marketplace đã xuất bản (không có `.omp-plugin/marketplace.json` trên root). Do đó, **không sử dụng** cú pháp cài đặt từ xa như `omp plugin install arsenal@arsenal`. Đường dẫn cài đặt chuẩn và tin cậy nhất là liên kết trực tiếp thư mục `plugin/` cục bộ.

---

## 2. Quy trình chuẩn bị và liên kết Plugin (Recommended)

### Bước 1: Biên dịch và kiểm tra tính toàn vẹn của Plugin

Trước khi liên kết vào OMP, luôn đảm bảo các bản bundle JavaScript standalone trong `plugin/dist/extensions/` đã được sinh đầy đủ và khớp hash:

```bash
# 1. Biên dịch distribution bundle sang plugin/
bun run bin/arsenal.ts build --write --force

# 2. Xác thực tính tiền định byte-for-byte (tùy chọn nhưng khuyến nghị)
bun run bin/arsenal.ts build --check-determinism --json
```

### Bước 2: Kiểm tra cấu hình liên kết (Dry Run)

Chạy kiểm tra thử với cờ `--dry-run` để quan sát hành động của OMP CLI mà không làm thay đổi cấu hình:

```bash
# Scope user (áp dụng toàn bộ môi trường của user)
omp plugin link ./plugin --dry-run --scope user --json

# Hoặc scope project (chỉ áp dụng cho project hiện tại)
omp plugin link ./plugin --dry-run --scope project --json
```

Kết quả quan sát mẫu:
```json
{
  "dryRun": true,
  "action": "link",
  "path": "./plugin"
}
```

### Bước 3: Thực hiện liên kết Plugin thực tế

Liên kết thư mục `plugin/` vào OMP:

```bash
# Khuyến nghị: liên kết ở scope user để dùng trong profile arsenal
omp plugin link ./plugin --scope user
```

*(Hoặc liên kết trong phạm vi thư mục dự án mục tiêu)*:
```bash
omp plugin link ./plugin --scope project
```

---

## 3. Khuyến cáo thực nghiệm và xử lý khi gặp độ trễ (Operational Caveats)

Trong một số môi trường OMP hoặc terminal có cấu hình mạng/khóa file đặc thù, các lệnh tương tác plugin có thể gặp hiện tượng chờ đợi xử lý:

1. **Kiểm tra trạng thái sau khi liên kết**:
   ```bash
   omp plugin list --json
   ```
   Nếu lệnh `omp plugin list` phản hồi chậm, hãy kiểm tra file cấu hình plugin của OMP tại:
   - User scope: `~/.omp/plugins/` hoặc `~/.omp/config.json`
   - Project scope: `.omp/plugins/` hoặc `.omp/config.json`

2. **Chẩn đoán môi trường OMP**:
   ```bash
   omp plugin doctor
   ```

3. **Cài đặt / đồng bộ Profile Arsenal song song**:
   Bên cạnh plugin runtime, Arsenal sử dụng profile OMP riêng biệt để quản lý context, prompt `AGENTS.md` và `RULES.md`:
   ```bash
   bun run bin/arsenal.ts profile install --write
   bun run bin/arsenal.ts profile verify --json
   ```

---

## 4. Gỡ bỏ hoặc hủy liên kết Plugin

Khi cần cập nhật lớn hoặc gỡ bỏ plugin khỏi OMP:

```bash
omp plugin uninstall arsenal --scope user
```
Sau đó kiểm tra lại với `omp plugin list` để bảo đảm môi trường sạch.
