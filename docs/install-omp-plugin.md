# Hướng dẫn cài đặt Arsenal Plugin vào Oh My Pi (OMP)

Tài liệu này hướng dẫn cách kết nối và nạp plugin `arsenal` vào môi trường Oh My Pi (OMP) từ mã nguồn repository cục bộ.

## Cài local và test bằng Just

Yêu cầu `just`, Bun và OMP có trong `PATH`. Chạy từ repository:

```bash
just                       # Liệt kê các recipe, không tự cài đặt
just preview               # Preview profile và plugin link, không ghi cấu hình
just install-local         # Cài dependencies → build → cài/verify profile → link OMP
just test-local            # Test profile, MCP, specialist parity và slash commands
just test                  # Toàn bộ test suite
just test tests/mcp-lifecycle.test.ts
just typecheck
just determinism
```

`install-local` dùng `bun install --frozen-lockfile`, không truyền `--force`
cho cài profile. Plugin được link ở scope `user`; profile mặc định là
`~/.omp/profiles/arsenal/agent`.

```bash
# Cài/verify profile thử nghiệm, không link plugin hay sửa profile đang dùng
ARSENAL_PROFILE=/tmp/arsenal-test/agent just profile-install
ARSENAL_PROFILE=/tmp/arsenal-test/agent just verify

# Chọn scope project cho bước link (độc lập với đường dẫn profile)
ARSENAL_SCOPE=project just install-local
```

`just build`, `just profile-install` và `just link` cũng chạy độc lập được.
Recipe giữ nguyên hành vi merge/conflict của CLI; không tự ép ghi đè file.

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

Rule OpSec và các specialist không bắt buộc agent đặt POSIX mode `0600`
cho spilled raw outputs. Permission mặc định của tool và file hiện có không
bị thay đổi bởi chính sách này.

### Proxy analysis tiers: Burp và mitmproxy + hook

Rule nguồn nằm tại `plugin/rules/proxy-analysis-tiers.md`. `profile install`
chép rule vào `<profile>/rules/` và thêm
`@path ./rules/proxy-analysis-tiers.md` trong phần managed của `AGENTS.md`.
Không cần bật MCP hay cấu hình proxy hệ thống để cài rule.

- **Web/API security:** ưu tiên Burp Proxy history và Repeater.
- **Reverse engineering native/mobile/Electron/JavaScript:** ưu tiên mitmproxy
  để quan sát network, kết hợp hook runtime có phạm vi hẹp để đối chiếu code/data.
  Dùng `mitmdump` cho capture/addon tự động; `mitmweb` khi cần xem trực quan.
- **Tier 1:** discovery chủ động; được capture, replay, scan/fuzz và sửa
  request/response ngay khi cần cho mục tiêu đã được phép, đồng thời giữ baseline
  để phân biệt traffic gốc với probe hoặc dữ liệu đã sửa.
- **Tier 2 — mặc định cho RE:** liên kết flow với hook tại điểm dựng request,
  serialization, mã hóa/giải mã hoặc xử lý response; phân biệt quan sát và suy luận.
- **Tier 3:** kiểm chứng có thể tái lập bằng baseline và một biến đổi có kiểm soát.

Tier phân biệt độ sâu phân tích và chất lượng bằng chứng, không phải cổng phân
quyền công cụ hay các bước bắt buộc tuần tự. Không tự đặt quota capture,
số request, thời gian hoặc rate theo tier; chỉ tuân theo cấu hình thực tế của
operator/host và yêu cầu ổn định của target. Không hỏi lại cho từng thao tác
đã nằm trong phạm vi được phép.

Master truyền workflow, tier và phạm vi cho specialist. Các prompt `sec-re`,
`sec-mobile` và `sec-webapp` áp dụng cùng lựa chọn theo mục tiêu; mobile API
security có thể dùng Burp trực tiếp, không bắt buộc qua RE. Không mặc định nối
hai proxy, bypass pinning, cài CA hay bật hook toàn cục. Khởi động phiên OMP mới
để nạp rule và prompt đã cập nhật.

### REA (Reverse Engineer Anything)

Arsenal tích hợp [morluto/rea](https://github.com/morluto/rea) qua MCP stdio,
ghim package `rea-agents@6.4.0` và dùng `bunx`. Cần Bun và Node.js
22.19+ trong nhánh 22, 24.11+ trong nhánh 24, hoặc 26+ theo
[yêu cầu upstream](https://github.com/morluto/rea/blob/main/docs/installation.md).

Skill phát hành cùng phiên bản được nhập vào
`src/corpus/re-reverse-engineer-anything/`; build đóng gói `SKILL.md`,
cả sáu file `references/` và MIT `LICENSE` vào
`plugin/skills/re-reverse-engineer-anything/`. Frontmatter được chuẩn hóa theo
schema Arsenal; provenance được ghi trong `src/corpus/MANIFEST.json`.
Các liên kết nội bộ trong `SKILL.md` dùng URI `skill://re-reverse-engineer-anything/`;
nội dung hướng dẫn khác và sáu file references upstream được giữ nguyên.
Khi tài liệu dùng `npx -y rea-agents@6.4.0`, dùng
`bunx rea-agents@6.4.0` tương đương trong Arsenal.

Catalog plugin và profile mới giữ `enabled: false`. Để bật có chủ đích:

```bash
bun run bin/arsenal.ts mcp enable rea --profile ~/.omp/profiles/arsenal/agent --json
bun run bin/arsenal.ts mcp list --profile ~/.omp/profiles/arsenal/agent --json
```

Lệnh `enable` cập nhật entry `rea` trong `.omp/mcp.json` của repository và
`mcp.json` của profile đã tồn tại, giữ nguyên các entry khác. Cấu hình kết quả:

```json
"rea": {
  "type": "stdio",
  "command": "bunx",
  "args": ["rea-agents@6.4.0", "mcp"],
  "enabled": true
}
```

Khởi động lại phiên OMP dùng profile `arsenal` để nạp MCP và skill mới.
Không chạy `rea setup` toàn cục để tránh tạo skill trùng hoặc sửa client khác.
Khi nâng cấp REA, cập nhật cả pin MCP và bộ skill/references cùng bản phát hành.

Phân tích JavaScript tĩnh không cần engine native:

```bash
bunx rea-agents@6.4.0 analyze-javascript-application /absolute/path/to/extracted-app --json
```

Tích hợp này không cài Hopper/Ghidra/IDA và không cấu hình provider native.
REA cần provider tương ứng cho decompile native; cấu hình IDA native của OMP
không tự biến thành provider IDA của REA.

---

## 4. Gỡ bỏ hoặc hủy liên kết Plugin

Khi cần cập nhật lớn hoặc gỡ bỏ plugin khỏi OMP:

```bash
omp plugin uninstall arsenal --scope user
```
Sau đó kiểm tra lại với `omp plugin list` để bảo đảm môi trường sạch.
