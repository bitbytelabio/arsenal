[ English ](README.md) | [ Tiếng Việt ]

# Arsenal

> **Plugin-First Offensive Security & Reverse Engineering Harness cho Oh My Pi (OMP)**

Arsenal là một bộ công cụ kiểm thử bảo mật chuyên nghiệp (security engagement harness) và kho lưu trữ năng lực (skill corpus) phục vụ tấn công thâm nhập (penetration testing), dịch ngược nhị phân (binary reverse engineering), và đánh giá lỗ hổng động (dynamic vulnerability assessment).

---

## Tổng quan kiến trúc

Arsenal được thiết kế theo mô hình **Single Source of Truth (SSOT)** với sự phân lập chặt chẽ giữa các thành phần:

- **Single Source of Truth (`src/corpus/`, `presets/`, `src/core/`)**:
  Các kịch bản bảo mật chuẩn (security playbooks), bảng định tuyến (routing tables), bản đồ phủ năng lực baseline (coverage mappings), và công cụ xác thực CLI.
- **Gói phân phối được tạo tự động (`plugin/`)**:
  Plugin OMP độc lập chứa các runtime extensions đã biên dịch, chỉ mục danh mục (catalog indexes), và định nghĩa định tuyến.
- **Trạng thái Runtime (`evidence/`)**:
  Nhật ký sự kiện JSONL chỉ-ghi-nối (append-only) có thể kiểm chứng mật mã học với chuỗi băm SHA-256 và nhật ký SQLite chế độ WAL.

---

## Tài liệu & Cài đặt

- [Hướng dẫn cài đặt OMP Plugin](docs/install-omp-plugin.vi.md) ([Bản tiếng Anh](docs/install-omp-plugin.md)): Hướng dẫn cài đặt qua cơ chế Marketplace theo tài liệu OMP (`OMP_PROFILE=arsenal omp plugin marketplace add bitbytelabio/arsenal`, `OMP_PROFILE=arsenal omp plugin install arsenal@arsenal`), liên kết phát triển cục bộ (`OMP_PROFILE=arsenal omp plugin link ./plugin`), và quản lý cấu hình MCP bridges theo profile / project.

---

## Tính năng nổi bật của Arsenal Harness

### 1. Công cụ phân tích bảo mật bằng TypeScript thuần (`apk_inspect`)
- Các tác vụ phân tích trọng yếu (bao gồm kiểm tra Android APK và phân tích manifest nhị phân) thực thi trực tiếp bên trong runtime plugin thông qua các công cụ native Bun/TS, không phụ thuộc vào Python của máy host hay thư viện chưa quản lý.
- Loại bỏ toàn bộ các script đơn lẻ tự do trong corpus, thay thế bằng tài sản mẫu có quản lý và các lệnh gọi công cụ `evidence_exec` được giám sát chặt chẽ.

### 2. Định danh URI chuẩn `skill://` & Tải tài sản động
- Toàn bộ 3.288 tài liệu tham khảo và trích dẫn hỗ trợ trên 1.647 playbooks đều sử dụng URI chuẩn của nền tảng (`skill://<skill-id>/references/...` hoặc `skill://<skill-id>/support/...`).
- Cơ chế tải tài sản động (`skill_asset_load`, `skills read-asset`) giúp phân giải tài liệu tham khảo phụ trợ, checklist, và mẫu payload bất kể thư mục làm việc hiện tại của agent, với giới hạn đầu ra an toàn ký tự ($\le 4096$ bytes).

### 3. Quản trị Subagent & Khởi tạo Profile
- Toàn bộ 5 prompt của agent chuyên gia (`sec-re`, `sec-webapp`, `sec-mobile`, `sec-red`, `sec-verifier`) được tích hợp sẵn các cổng an toàn OpSec và ràng buộc đánh giá nhận thức luận (`E-*` quan sát thực nghiệm vs `P-*` suy luận phân tích vs `unk-*` biến số chưa rõ).
- Thực thi chuyển giao tác vụ theo JSON schema có định kiểu với logic tự phục hồi sau một lần thử lại.
- Cài đặt plugin sẽ tự động cung cấp `master`, toàn bộ 5 chuyên gia, rules, commands, và định nghĩa MCP. Lệnh `arsenal profile install` là tùy chọn cho template của người vận hành; lệnh này ghi đè các cấu hình chuyên gia vào `<profileDir>/agents/`.

### 4. Quản lý vòng đời MCP động & Bộ chạy `uv` cô lập
- Các lệnh phụ CLI `arsenal mcp enable <name>` và `arsenal mcp disable <name>` bật/tắt động các tool bridges dưới cơ chế chọn tham gia (opt-in) nghiêm ngặt với sự phân lập theo profile (`--scope profile`, mặc định) hoặc project (`--scope project`).
- Danh mục chính thức hỗ trợ 6 bridges chuẩn: `ida-pro`, `ghidra`, `jshook`, `burp-ultra`, `playwright`, và `rea` (tất cả khởi tạo ở trạng thái `enabled: false`).
- Các bridge viết bằng Python thực thi qua môi trường `uv` cô lập, kèm chẩn đoán báo lỗi nhanh nếu `uv` chưa được cài trên host.
- REA chạy thông qua `bunx rea-agents@6.4.0 mcp`. Skill `re-reverse-engineer-anything` đi kèm, 6 tài liệu tham khảo và giấy phép MIT được đóng gói sẵn trong plugin; xem chi tiết tại [hướng dẫn cài đặt REA](docs/install-omp-plugin.vi.md#6-rea-reverse-engineer-anything).

### 5. Bộ Slash Commands tác chiến toàn diện
- 8 slash commands hướng dẫn các giai đoạn đánh giá an ninh:
  - `/sec-scope`: Quản lý phạm vi, thực thi danh sách mục tiêu hợp lệ và danh sách loại trừ.
  - `/sec-recon`: Điều phối trinh sát bề mặt tấn công với lời nhắc ủy quyền tương tác đối với mục tiêu ngoài phạm vi.
  - `/sec-engage`: Điều phối quy trình đánh giá an ninh 5 giai đoạn từ đầu đến cuối.
  - `/sec-verify`: Điều phối trực tiếp đến `sec-verifier` chạy các oracle tiền định (`verify_oracle`).
  - `/sec-finding`: Ghi nhận phát hiện có cấu trúc, liên kết trực tiếp tới biên lai sổ cái bằng chứng SHA-256.
  - `/sec-review`: Kiểm toán xem xét case, khẳng định tính liên tục của bằng chứng qua toàn bộ 37 mã xác thực.
  - `/sec-report`: Trình biên dịch báo cáo bàn giao hỗ trợ xuất Markdown, JSON, và SARIF (mặc định tại `.omp/arsenal/reports/report-<timestamp>.md` kèm tóm tắt terminal).
  - `/sec-doctor`: Trình kiểm tra chẩn đoán nền tảng, xác thực độ lành mạnh của plugin, bridges, và manifests.

### 6. Độ phủ kỹ thuật dựa trên bằng chứng & Tính toàn vẹn của Manifest
- 496 ánh xạ kỹ thuật được kiểm chứng thực nghiệm đưa vào `presets/baselines/coverage-map.json` sử dụng bộ định vị tiêu đề markdown trong các playbook `SKILL.md`.
- Giảm hơn 50% các mục giả lập `accepted-gaps.json` nhằm tuân thủ nghiêm ngặt Nguyên tắc III (Evidence Rigor) và quy tắc CM-4.
- Đạt 100% độ toàn vẹn manifest của corpus, xác thực qua `arsenal skills check --domains` (0 lỗi).

---

## Sử dụng CLI

```bash
# Biên dịch gói phân phối plugin và xác thực tính tiền định byte-for-byte
bun run bin/arsenal.ts build --write --force
bun run bin/arsenal.ts build --check-determinism --json

# Đóng gói plugin phân phối marketplace
bun run bin/arsenal.ts plugin pack --write

# Kiểm tra tuân thủ ngôn ngữ và trích dẫn script
bun run bin/arsenal.ts skills check --language --json
bun run bin/arsenal.ts skills scripts-audit --json

# Kiểm tra độ phủ năng lực theo chuẩn giữa các domain
bun run bin/arsenal.ts skills coverage --domain re --check --json
bun run bin/arsenal.ts skills coverage --domain webapp --check --json
bun run bin/arsenal.ts skills coverage --domain mobile --check --json
bun run bin/arsenal.ts skills coverage --domain red --check --json

# Xác thực tính toàn vẹn của sổ cái bằng chứng mật mã học
bun run bin/arsenal.ts evidence verify --ledger evidence/ledger.jsonl --json

# Chạy toàn bộ test suite
bun test
```

---

## Giấy phép

MIT
