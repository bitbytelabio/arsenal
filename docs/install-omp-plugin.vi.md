[ English ](install-omp-plugin.md) | [ Tiếng Việt ]

# Hướng dẫn cài đặt Arsenal Plugin vào Oh My Pi (OMP)

Tài liệu này hướng dẫn cách kết nối và nạp plugin `arsenal` vào môi trường Oh My Pi (OMP) thông qua cơ chế Marketplace theo tài liệu OMP từ GitHub repository `bitbytelabio/arsenal` hoặc liên kết trực tiếp mã nguồn phát triển cục bộ (`omp plugin link`).

## Tài liệu tham chiếu chính thức từ Oh My Pi

Các quy trình trong tài liệu này bám sát quy chuẩn của OMP:
- [OMP Marketplace Plugin System](https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md)
- [OMP Configuration Discovery & Profiles](https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md#profiles)
- [MCP Configuration in OMP](https://github.com/can1357/oh-my-pi/blob/main/docs/mcp-config.md)
- [Plugin Manager and Installer Plumbing](https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md)
- [Public Arsenal Marketplace Catalog](https://raw.githubusercontent.com/bitbytelabio/arsenal/main/.omp-plugin/marketplace.json)
- [OMP Magic Keywords](https://github.com/can1357/oh-my-pi/blob/main/docs/magic-keywords.md)

> **Lưu ý về định danh và bảo chứng**: Arsenal là một bộ harness / plugin độc lập dành cho Oh My Pi, không phải là một plugin được OMP bảo chứng chính thức (not an OMP-endorsed plugin). Các gói cài đặt từ xa luôn cần được người vận hành tự thẩm định trước khi tích hợp vào môi trường bảo mật nhạy cảm.

---

## Cài đặt nhanh bằng Justfile

Phát triển từ repo cần `uv`, Python 3.11+, `just`, Bun và OMP trong `PATH`. Python CLI đã cài không cần Bun; việc biên dịch extension native OMP cần Bun.

```bash
just                       # Liệt kê các recipe, không tự cài đặt
just preview               # Preview plugin link, không ghi cấu hình
just install-local         # Cài dependencies → build bundle → link OMP
just test-local            # Test profile, MCP, specialist parity và slash commands
just test                  # Toàn bộ test suite
uv run --locked pytest tests/python/test_install_mcp.py
just typecheck
just determinism
```

`install-local` đồng bộ môi trường Python theo lockfile và dependencies Bun, build rồi link `plugin/` vào OMP. Plugin giữ skills native, agents, commands, rules và MCP definitions mặc định disabled. Cài CLI nghiệp vụ riêng:

```bash
uv tool install git+https://github.com/bitbytelabio/arsenal.git
arsenal --help
```

Bước cài đặt profile template (`just profile-install`) là **tùy chọn (optional)** dành riêng cho người vận hành muốn tùy biến sâu prompt orchestrator `AGENTS.md` hoặc cấu hình riêng trong profile agent directory:

```bash
# Tùy chọn: cài đặt profile prompt templates riêng biệt
ARSENAL_OMP_PROFILE=security-lab just profile-install
ARSENAL_OMP_PROFILE=security-lab just verify

# Hoặc trỏ trực tiếp đến một đường dẫn agent profile bất kỳ (hai biến này là hai cấu hình độc lập)
ARSENAL_PROFILE=/tmp/arsenal-test/agent just profile-install
ARSENAL_PROFILE=/tmp/arsenal-test/agent just verify
```

`just build`, `just profile-install` và `just link` cũng chạy độc lập được. Recipe giữ nguyên hành vi merge/conflict của CLI; không tự ép ghi đè file.

## Magic Keywords OMP cho Prompt của Người vận hành

OMP nhận diện chính xác các từ độc lập viết thường `ultrathink`, `orchestrate`, `workflowz` và `jevify` trong prompt gốc của người vận hành cũng như sau khi slash command được mở rộng. Dùng `orchestrate` cho `/arsenal-engage`, `jevify` cho `/arsenal-review`, `workflowz` cho `/arsenal-skill-update`; thêm `ultrathink` khi cần suy luận đặc biệt sâu.

Magic keywords là control theo lượt của OMP, không phải nội dung prompt của Arsenal. Chúng không kích hoạt khi nằm trong skill, rules hoặc handoff tổng hợp của subagent. Giữ chúng là prose độc lập, bên ngoài fenced code block và inline code span.

Xem [tài liệu magic keywords chính thức của OMP](https://github.com/can1357/oh-my-pi/blob/main/docs/magic-keywords.md).
---
## Runtime Playbook Tác Vụ (Operational Playbook Runtime)

Arsenal cung cấp danh mục chuẩn hóa đóng gói sẵn (in-package catalog) cho các playbook tác vụ và tiện ích script cốt lõi:

```bash
# Liệt kê đầy đủ metadata dạng máy đọc (loại, domain, chế độ thực thi, trạng thái tiếp nhận)
arsenal scripts --json list

# Liệt kê dạng văn bản gom theo domain
arsenal scripts list
arsenal scripts list --domain webapp
arsenal scripts list --all

# Kiểm chứng tính toàn vẹn (parity) giữa file trên đĩa, catalog descriptor, tài nguyên đóng gói và receipt
arsenal scripts catalog/verify --json

# Chạy playbook qua giao diện chuẩn hóa
arsenal scripts <canonical-id> -- <tham-số>
```

### Ranh giới Thực thi và Cổng Tiền kiểm (Preflight Gates)

- **Nội tiến trình (`shared`)**: Thực thi trong tiến trình chính dành cho các handler thuần túy đã qua phê duyệt (`admission_status: approved_shared`).
- **Tiến trình con cô lập (`managed_subprocess`)**: Ranh giới mặc định cho playbook chưa phân loại hoặc legacy, cô lập `SystemExit`, tín hiệu và phụ thuộc với giới hạn thời gian nhóm tiến trình và đầu ra UTF-8 có giới hạn.
- **Môi trường khóa (`locked_environment`)**: Dành cho playbook xung đột phụ thuộc (ví dụ: LLM Guard). Chạy `uv run --locked --offline --project ...` duy nhất một lần; không thử lại trực tuyến hay sửa lockfile khi chạy.
- **Công cụ bên ngoài (`external_tool`)**: Dành cho binary hệ thống allowlist kèm kiểm tra năng lực.
- **Kiểm soát Fail-Closed**: Playbook có tác dụng phụ kiểm tra scope máy đọc (`.omp/arsenal/scope.json` hoặc `ARSENAL_SCOPE_FILE`), ủy quyền host tin cậy, adapter proxy bắt buộc (Burp cho web/API, mitmproxy+hook cho dịch ngược) và sink bằng chứng trước khi khởi chạy. Nếu thiếu hoặc không hợp lệ, lệnh bị từ chối ngay lập tức.

---

## Phân biệt `--profile <path>` của Arsenal CLI và `OMP_PROFILE=<name>` của OMP

- **`--profile <path>` trong Arsenal CLI**: Trỏ trực tiếp tới **đường dẫn thư mục agent** trên đĩa (mặc định: `~/.omp/profiles/arsenal/agent`). Cờ này không tự động phân giải tên ngắn thành đường dẫn OMP và không phụ thuộc vào biến môi trường OMP.
- **`OMP_PROFILE=<name>` (hoặc cờ `omp --profile <name>`) trong OMP**: Chỉ định **tên định danh profile** của OMP (ví dụ: `OMP_PROFILE=arsenal`). Khi profile có hiệu lực, OMP tự động ánh xạ cấu hình user từ `~/.omp/agent/` sang `~/.omp/profiles/<name>/agent/`.

---

## 1. Bản chất kiến trúc phân phối và nạp Capability

Theo kiểm chứng thực nghiệm trên OMP 18.10.2:
- **Hai cơ chế nạp (Two Loaders)**:
  - Cài đặt qua **Marketplace** nạp qua provider `claude-plugins` (priority 70): các MCP servers được đặt tiền tố namespace theo tên marketplace/plugin (ví dụ: `arsenal:burp-ultra`, `arsenal:rea`).
  - Cài đặt qua **Local Link** (`omp plugin link`) nạp qua provider legacy `omp-plugins` (priority 90): các MCP servers giữ nguyên định danh bare ID ban đầu (`burp-ultra`, `rea`).
- **Năng lực tự động sẵn sàng**: `master` cùng 5 specialist agents (`arsenal-reverse`, `arsenal-web`, `arsenal-mobile`, `arsenal-redteam`, `arsenal-verifier`), 9 slash commands (`/arsenal-*`) và rules được nạp từ plugin mà không cần chạy `profile install`. Đã kiểm chứng qua RPC trên OMP 18.10.2.
- **Quyền ưu tiên**: Cấu hình native của profile/project (priority 100) có quyền ưu tiên cao hơn khi dùng đúng cùng định danh server, bao gồm namespace nếu cài qua marketplace. Plugin không ghi lại file cấu hình native của user.

Phương thức phân phối:
1. **Marketplace**: Catalog nội bộ trỏ source `./plugin` và skills `./skills` (bản GitHub raw từ xa hiện giữ `./` cho đến khi người dùng đẩy commit mới).
2. **Local Link**: Bắt buộc chạy build trước (`just build`) vì OMP không có build hook tự động.
---

## 2. Quy trình cài đặt qua cơ chế Marketplace theo tài liệu OMP

Theo tài liệu của OMP, marketplace registry và plugin user state được phân lập theo từng named profile (mặc định tại `~/.omp/profiles/<name>/marketplaces.json` và `~/.omp/profiles/<name>/plugins/` trong môi trường non-XDG; nếu cấu hình biến `XDG_DATA_HOME` và đã khởi tạo qua `omp config init-xdg`, đường dẫn sẽ giải quyết dưới `$XDG_DATA_HOME/omp/profiles/<name>/`).

Do đó, **toàn bộ các lệnh tương tác marketplace** (kể cả thao tác ở phạm vi project hoặc tra cứu danh sách) cần được tiền tố nhất quán với `OMP_PROFILE=arsenal` để đảm bảo catalog và plugin registry được ghi nhận đúng vào profile mục tiêu thay vì profile mặc định.

### Bước 1: Thêm Marketplace Source

Thêm nguồn marketplace từ repository GitHub vào profile:

```bash
# Thêm marketplace catalog từ GitHub vào profile arsenal
OMP_PROFILE=arsenal omp plugin marketplace add bitbytelabio/arsenal

# Kiểm tra danh sách marketplace đã cấu hình trong profile
OMP_PROFILE=arsenal omp plugin marketplace list

# Khám phá các plugin có sẵn trong marketplace arsenal
OMP_PROFILE=arsenal omp plugin discover arsenal
```

### Bước 2: Kiểm tra cài đặt thử nghiệm (Dry Run)

Cờ `--dry-run` của OMP kiểm tra tính hợp lệ của catalog đã được cache, phạm vi cài đặt và các ràng buộc mà không tải gói hay thay đổi cấu hình đĩa:

```bash
# Chạy dry-run kiểm tra trước khi cài đặt thực tế
OMP_PROFILE=arsenal omp plugin install --dry-run arsenal@arsenal
```

> **Điều kiện tiên quyết của `--dry-run`**: OMP yêu cầu catalog đã được nạp/cache trong hệ thống (`~/.omp/profiles/arsenal/marketplaces.json` và cache cục bộ của profile). Do đó bước `OMP_PROFILE=arsenal omp plugin marketplace add bitbytelabio/arsenal` phải được chạy trước.

### Bước 3: Cài đặt Plugin vào OMP

Bạn có thể cài đặt theo một trong hai phạm vi (Scope):

#### Cách A: Cài đặt phạm vi User (cho Profile arsenal)

Phạm vi `user` là mặc định trong OMP. Để đảm bảo phân lập profile môi trường:

```bash
# Cài đặt plugin cho user profile arsenal
OMP_PROFILE=arsenal omp plugin install arsenal@arsenal

# Kiểm tra danh sách plugin đã cài đặt
OMP_PROFILE=arsenal omp plugin list
```

#### Cách B: Cài đặt phạm vi Project (Dự án cục bộ)

Nếu bạn muốn áp dụng Arsenal trong một dự án đánh giá an ninh cụ thể, vẫn giữ tiền tố profile để OMP nhận diện catalog nguồn từ profile đang làm việc:

```bash
# Cài đặt plugin trong phạm vi project hiện tại (.omp/plugins/)
OMP_PROFILE=arsenal omp plugin install --scope project arsenal@arsenal

# Kiểm tra plugin trong phạm vi project
OMP_PROFILE=arsenal omp plugin list
```

### Bước 4: Cập nhật và nâng cấp Plugin (Update & Upgrade)

OMP phân tách giữa việc đồng bộ bản sao repository của marketplace và việc nâng cấp phiên bản cài đặt của plugin. Mặc định `marketplace.autoUpdate` chỉ tự động làm mới catalog theo cơ chế best-effort khi cache đã quá 24 giờ; lệnh `omp plugin upgrade` đơn lẻ sẽ không tự động làm mới cache marketplace trên mỗi lần chạy.

Khi có bản cập nhật mới trên GitHub, hãy chạy theo quy trình 2 bước:

```bash
# 1. Đồng bộ mã nguồn và catalog mới nhất từ remote về cache
OMP_PROFILE=arsenal omp plugin marketplace update arsenal

# 2. Nâng cấp plugin từ cache mới
OMP_PROFILE=arsenal omp plugin upgrade arsenal@arsenal
```

---

## 3. Quy trình chuẩn bị và liên kết Plugin cục bộ (Local Link)

Dành cho nhà phát triển muốn biên dịch và kiểm thử trực tiếp từ repository này:

### Bước 1: Biên dịch và kiểm tra tính toàn vẹn của Plugin

```bash
# 1. Biên dịch distribution bundle sang plugin/
arsenal build --write --force

# 2. Xác thực tính tiền định byte-for-byte
arsenal build --check-determinism --json
```

### Bước 2: Kiểm tra cấu hình liên kết (Dry Run)

> **Lưu ý về phạm vi của `link`**: Theo tài liệu OMP (`docs/plugin-manager-installer-plumbing.md`), các thao tác `omp plugin link` luôn thuộc phạm vi **user-level** (tạo symlink trong thư mục plugins của profile đang hoạt động: `~/.omp/profiles/<name>/plugins/node_modules/` trong chế độ non-XDG hoặc `~/.omp/plugins/node_modules/` ở default profile). OMP link CLI cảnh báo và bỏ qua `--scope`. Không sử dụng `--scope project` cho lệnh `omp plugin link`. Nếu cần phạm vi project, hãy sử dụng cơ chế marketplace nêu ở mục trên.

```bash
# Dry-run kiểm tra liên kết
OMP_PROFILE=arsenal omp plugin link ./plugin --dry-run --json
```

### Bước 3: Thực hiện liên kết thực tế

```bash
# Liên kết thư mục plugin/ cục bộ vào OMP dưới profile ngữ cảnh
OMP_PROFILE=arsenal omp plugin link ./plugin
```

---

## 4. Khuyến cáo thực nghiệm và xử lý sự cố (Operational Caveats)

1. **Kiểm tra trạng thái sau khi cài đặt**:
   ```bash
   OMP_PROFILE=arsenal omp plugin list --json
   ```
   Nếu lệnh phản hồi chậm, hãy kiểm tra file cấu hình plugin của OMP tại:
   - Profile user scope: `~/.omp/profiles/arsenal/plugins/` hoặc `~/.omp/profiles/arsenal/agent/config.json`
   - Project scope: `.omp/plugins/` hoặc `.omp/config.json`

2. **Chẩn đoán môi trường OMP**:
   ```bash
   OMP_PROFILE=arsenal omp plugin doctor
   ```

3. **Nạp lại Plugin và giới hạn phiên (Restart vs /reload-plugins)**:
   - Lệnh `/reload-plugins` trong phiên tương tác chỉ làm mới task agents, skills, slash commands và MCP servers.
   - Đối với các công cụ không thuộc MCP (non-MCP tools), hooks, hoặc runtime extension modules (như các bundle JavaScript trong `plugin/dist/extensions/`), bạn **bắt buộc phải khởi động lại (restart) phiên OMP** để nạp mã thực thi mới.

4. **Cài đặt Profile Arsenal (Tùy chọn) & Cấu hình OMP**:
   Do plugin đã tự động cung cấp subagents và skills qua provider `omp-plugins`, bước cài đặt profile template vào `<profileDir>/agent/` là tùy chọn, chỉ cần thiết khi bạn muốn nạp các prompt mẫu `AGENTS.md` và `RULES.md` tùy chỉnh vào thư mục profile:
   ```bash
   arsenal profile install --profile ~/.omp/profiles/arsenal/agent --write
   arsenal profile verify --profile ~/.omp/profiles/arsenal/agent --json
   ```
   - **Quy ước tên lệnh và specialist**: Tất cả slash commands sử dụng tiền tố `/arsenal-*` (ví dụ: `/arsenal-engage`, `/arsenal-doctor`), và các specialist subagents mang tên `arsenal-*` (`arsenal-reverse`, `arsenal-web`, `arsenal-mobile`, `arsenal-redteam`, `arsenal-verifier`).
   - **Phân giải Model & Cấu hình OMP**: OMP **không** tự động nạp các file `config.yml` tùy ý của plugin. Arsenal sử dụng cơ chế phân giải model mặc định của OMP. Lệnh `arsenal profile install` không ghi file `config.yml` hoặc `models.yml`, cũng như không yêu cầu thiết lập `modelRoles` hay `task.agentModelOverrides`. Để chỉ định file cấu hình trong OMP, hãy dùng biến môi trường `PI_CONFIG_FILES`, cờ `--config`, hoặc cấu hình native profile/project.
   - **Cấu hình IDA Guest Remote Debugging**: Các định nghĩa remote guest (`remoteDebug.guests`) được lưu trong `config.yml` / `config.yaml` do người dùng quản lý vì cấu hình đa host qua biến môi trường rất bất tiện; các biến `IDA_DIR`, `IDA_INSTALL_DIR`, và `IDA_PYTHON` trong `.env` chỉ là các tùy chọn ghi đè đường dẫn cục bộ.
---

## 5. Cấu hình và Quản lý MCP Bridges

Khi cài đặt plugin Arsenal, các canonical MCP bridges (`ida-pro`, `ghidra`, `jshook`, `burp-ultra`, `playwright`, `rea`) đã được định nghĩa sẵn trong `.mcp.json` của plugin và tự động tích hợp vào OMP mà không cần chạy lệnh cài đặt MCP riêng.

> **Mặc định vô hiệu hóa (Default Disabled)**: Toàn bộ canonical bridges đều giữ `enabled: false`. Lệnh `/mcp list` của OMP 18.10.2 chỉ đọc các file cấu hình native (`mcp.json`), không duyệt danh mục plugin; đồng thời lệnh `/mcp enable` trong OMP không kích hoạt được các bridge chỉ tồn tại ở lớp bundle nếu chưa có trong cấu hình native.

### Kích hoạt Bridges có chủ đích (Opt-in Activation)

Để kích hoạt bridge mong muốn trong profile, thêm định danh tương ứng vào `enabledServers` trong `~/.omp/profiles/arsenal/agent/mcp.json` (thực hiện merge, giữ nguyên các servers khác):

- **Khi cài qua Marketplace**: Thêm định danh đầy đủ có namespace `arsenal:<name>` (ví dụ: `"arsenal:burp-ultra"`). Cấu hình bare `burp-ultra` sẽ không kích hoạt được server marketplace.
- **Khi cài qua Local Link**: Thêm định danh bare ID (ví dụ: `"burp-ultra"`).

Ví dụ phần cấu hình cần merge khi cài qua **Marketplace**; với local link, thay `arsenal:burp-ultra` bằng `burp-ultra`. Không bật cả hai nếu chỉ cần một kết nối:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "enabledServers": ["arsenal:burp-ultra"]
}
```

CLI `arsenal mcp` quản lý và kiểm tra file cấu hình native của profile/project (chẳng hạn khi bạn muốn export định nghĩa đầy đủ ra file native để OMP nhận diện độc lập), không can thiệp toàn bộ discovery runtime nội tại của OMP.

---

### Kiểm tra và Liệt kê MCP Bridges

Lệnh `mcp list` hiển thị trạng thái của bridge theo phạm vi được chọn:

```bash
# Liệt kê trạng thái bridges trong profile
arsenal mcp list --scope profile --profile ~/.omp/profiles/arsenal/agent --json

# Liệt kê trạng thái bridges trong project
arsenal mcp list --scope project --repo . --json
```

### Kích hoạt và Vô hiệu hóa MCP Bridges có chủ đích (Opt-in)

Các thao tác `enable` và `disable` chỉ tác động vào đúng file cấu hình được chỉ định bởi `--scope` (hoặc profile được chọn), **không bao giờ đồng thời ghi đè cả hai file**:

```bash
# Kích hoạt bridge 'rea' trong profile
arsenal mcp enable rea --scope profile --profile ~/.omp/profiles/arsenal/agent --write

# Vô hiệu hóa bridge 'rea' trong profile
arsenal mcp disable rea --scope profile --profile ~/.omp/profiles/arsenal/agent --write

# Kích hoạt bridge 'rea' ở cấp độ project
arsenal mcp enable rea --scope project --repo . --write
```

### Xác thực cấu hình MCP

Lệnh `mcp verify` kiểm tra tính toàn vẹn của file cấu hình, điều kiện tiên quyết của binary trong `PATH`, và đảm bảo an toàn bảo mật (không bị git theo dõi trái phép):

```bash
# Kiểm tra cấu hình MCP của profile
arsenal mcp verify --scope profile --profile ~/.omp/profiles/arsenal/agent --json

# Kiểm tra cấu hình MCP của project
arsenal mcp verify --scope project --repo . --json
```

> **Lưu ý về cờ `--check`**: Cờ `--check` là chế độ báo cáo thuần túy (report-only) và cam kết không làm thay đổi hay ghi đè bất kỳ byte nào trên đĩa.

---

## 6. REA (Reverse Engineer Anything)

Arsenal tích hợp [morluto/rea](https://github.com/morluto/rea) qua MCP stdio, ghim package `rea-agents@6.4.0` và dùng `bunx`. Cần Bun và Node.js 22.19+ trong nhánh 22, 24.11+ trong nhánh 24, hoặc 26+ theo [yêu cầu upstream](https://github.com/morluto/rea/blob/main/docs/installation.md).

Skill phát hành cùng phiên bản được nhập vào `src/corpus/re-reverse-engineer-anything/`; build đóng gói `SKILL.md`, cả sáu file `references/` và MIT `LICENSE` vào `plugin/skills/re-reverse-engineer-anything/`. Frontmatter được chuẩn hóa theo schema Arsenal; provenance được ghi trong `src/corpus/MANIFEST.json`.
Các liên kết nội bộ trong `SKILL.md` dùng URI `skill://re-reverse-engineer-anything/`; nội dung hướng dẫn khác và sáu file references upstream được giữ nguyên. Khi tài liệu dùng `npx -y rea-agents@6.4.0`, dùng `bunx rea-agents@6.4.0` tương đương trong Arsenal.

Để kích hoạt REA trong profile của bạn:

```bash
# Bật bridge REA trong profile
arsenal mcp enable rea --scope profile --profile ~/.omp/profiles/arsenal/agent --write

# Kiểm tra lại trạng thái
arsenal mcp list --scope profile --profile ~/.omp/profiles/arsenal/agent --json
```

Cấu hình entry kết quả trong `mcp.json`:

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

## 7. Burp Suite & BurpMCP-Ultra Bridge

Arsenal tích hợp [Cy-S3c/BurpMCP-Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra) qua MCP SSE, dùng Bearer token trong header. Tham chiếu cấu hình upstream: [mcp-claude-code-direct.json](https://github.com/Cy-S3c/BurpMCP-Ultra/blob/main/configs/mcp-claude-code-direct.json).

### 1. Chuẩn bị tiện ích BurpMCP-Ultra trên Burp Suite Pro

1. Tải bản phát hành JAR từ [BurpMCP-Ultra Releases](https://github.com/Cy-S3c/BurpMCP-Ultra/releases) (hoặc biên dịch từ nguồn với JDK 17–21 qua `./gradlew shadowJar`).
2. Mở **Burp Suite Professional** → vào tab **Extensions** → chọn **Add** → chọn file JAR `burpmcp-ultra-*.jar`.
3. Tab **BurpMCP-Ultra** sẽ xuất hiện trên giao diện Burp Suite với trạng thái màu xanh "Running" tại cổng mặc định `http://127.0.0.1:9876/` cùng mã kết nối (connection token).

### 2. Định dạng cấu hình MCP và Endpoint chính xác

Theo cấu hình tham chiếu thượng nguồn (`configs/mcp-claude-code-direct.json`), BurpMCP-Ultra hoạt động qua:
- **Transport**: `sse`.
- **URL Endpoint**: Lắng nghe tại root path `/` (mặc định cổng 9876). Không dùng `/sse` hay `/mcp`.
- **Xác thực**: Header `Authorization: Bearer <TOKEN>`.

Để hỗ trợ đổi cổng cục bộ hoặc kết nối máy chủ Burp từ xa mà không ghi đè cấu hình của người dùng khi cập nhật plugin, URL được định nghĩa qua biến môi trường kèm giá trị mặc định:

Mẫu cấu hình trong `mcp.json`:

```json
"burp-ultra": {
  "type": "sse",
  "url": "${BURP_MCP_URL:-http://127.0.0.1:9876/}",
  "headers": {
    "Authorization": "Bearer ${BURP_MCP_TOKEN}"
  },
  "enabled": false
}
```

> **Cơ chế mở rộng biến môi trường native `${VAR}` của OMP**: Theo tài liệu OMP (`docs/mcp-config.md`), OMP tự động mở rộng cú pháp `${BURP_MCP_TOKEN}` trong `headers` và `${BURP_MCP_URL:-http://127.0.0.1:9876/}` trong `url` tại thời điểm discovery. Do đó:
> - **Tuyệt đối không ghi token thô trực tiếp vào `mcp.json`** để bảo vệ bí mật xác thực khỏi bị vô tình theo dõi hoặc lộ lọt.
> - Plugin chỉ thiết lập giá trị mặc định ban đầu; cấu hình `url` và `headers` do người dùng hoặc profile/project tự tùy chỉnh sẽ được giữ nguyên toàn vẹn, không bị plugin cập nhật đè lên.

### 3. Lưu trữ Biến Môi trường an toàn trong Profile `.env`

Theo cơ chế discovery môi trường của OMP (`docs/providers.md`), file `.env` của profile nằm tại thư mục agent đang hoạt động:

```
~/.omp/profiles/arsenal/agent/.env
```

Thêm cấu hình token và URL tùy chọn vào file này:

```bash
# Thêm BURP_MCP_TOKEN lấy từ tab Server của BurpMCP-Ultra
echo 'BURP_MCP_TOKEN=your_token_from_burpmcp_server_tab' >> ~/.omp/profiles/arsenal/agent/.env

# Tùy chọn: ghi đè URL nếu đổi cổng hoặc kết nối Burp từ xa (mặc định nếu không đặt: http://127.0.0.1:9876/)
# LƯU Ý BẢO MẬT: Khi kết nối tới remote endpoint qua mạng, bắt buộc/ưu tiên sử dụng HTTPS vì Bearer token truyền trong header!
echo 'BURP_MCP_URL=http://127.0.0.1:9876/' >> ~/.omp/profiles/arsenal/agent/.env
```

> **Quy tắc ghi đè biến môi trường (Environment Precedence)**:
> - Biến môi trường hiện hữu trong tiến trình (process environment) và file `.env` tại thư mục dự án (`<project>/.env`) có độ ưu tiên cao hơn và sẽ ghi đè giá trị trong profile `.env`.
> - Nếu xác thực vào BurpMCP-Ultra gặp lỗi `401 Unauthorized`, hãy kiểm tra xem trong terminal hoặc dự án có đang tồn tại biến `BURP_MCP_TOKEN` rỗng hoặc không khớp hay không.

### 4. Kích hoạt và nạp cấu hình

1. **Kích hoạt trong profile `mcp.json`**:
   - Khi cài đặt qua Marketplace: thêm `"arsenal:burp-ultra"` vào mảng `enabledServers`.
   - Khi cài đặt qua Local Link: thêm `"burp-ultra"` vào mảng `enabledServers`.
2. **Khởi động lại (Restart) phiên OMP**:
   - Khi thay đổi file `.env`, bạn được **khuyến nghị khởi động lại toàn bộ phiên OMP** để đảm bảo biến môi trường mới được nạp vào tiến trình đầy đủ.
   - Lệnh `/mcp reload` trong OMP chỉ nạp lại cấu hình file `mcp.json` đã có sẵn, không tự động quét lại thay đổi trong file `.env`.

---

## 8. Gỡ bỏ hoặc hủy cài đặt Plugin

### Gỡ bỏ Plugin cài qua Marketplace

```bash
# Gỡ bỏ ở scope user trong profile arsenal
OMP_PROFILE=arsenal omp plugin uninstall arsenal@arsenal --scope user

# Hoặc gỡ bỏ ở scope project
OMP_PROFILE=arsenal omp plugin uninstall arsenal@arsenal --scope project
```

### Hủy liên kết Plugin cài qua Local Link

```bash
OMP_PROFILE=arsenal omp plugin uninstall arsenal
```

Sau đó kiểm tra lại với `OMP_PROFILE=arsenal omp plugin list` để bảo đảm môi trường sạch.

---

## 9. Proxy analysis tiers: Burp và mitmproxy + hook

Rule nguồn nằm tại `plugin/rules/proxy-analysis-tiers.md`. `profile install` chép rule vào `<profile>/rules/` và thêm `@path ./rules/proxy-analysis-tiers.md` trong phần managed của `AGENTS.md`. Không cần bật MCP hay cấu hình proxy hệ thống để cài rule.

- **Web/API security:** ưu tiên Burp Proxy history và Repeater.
- **Reverse engineering native/mobile/Electron/JavaScript:** ưu tiên mitmproxy để quan sát network, kết hợp hook runtime có phạm vi hẹp để đối chiếu code/data. Dùng `mitmdump` cho capture/addon tự động; `mitmweb` khi cần xem trực quan.
- **Tier 1:** discovery chủ động; được capture, replay, scan/fuzz và sửa request/response ngay khi cần cho mục tiêu đã được phép, đồng thời giữ baseline để phân biệt traffic gốc với probe hoặc dữ liệu đã sửa.
- **Tier 2 — mặc định cho RE:** liên kết flow với hook tại điểm dựng request, serialization, mã hóa/giải mã hoặc xử lý response; phân biệt quan sát và suy luận.
- **Tier 3:** kiểm chứng có thể tái lập bằng baseline và một biến đổi có kiểm soát.

Tier phân biệt độ sâu phân tích và chất lượng bằng chứng, không phải cổng phân quyền công cụ hay các bước bắt buộc tuần tự. Không tự đặt quota capture, số request, thời gian hoặc rate theo tier; chỉ tuân theo cấu hình thực tế của operator/host và yêu cầu ổn định của target. Không hỏi lại cho từng thao tác đã nằm trong phạm vi được phép.

Master truyền workflow, tier và phạm vi cho specialist. Các prompt `arsenal-reverse`, `arsenal-mobile` và `arsenal-web` áp dụng cùng lựa chọn theo mục tiêu; mobile API security có thể dùng Burp trực tiếp, không bắt buộc qua RE.

**Capture HTTPS trên Android và iOS:** khi SSL/TLS pinning cản interception, được dùng bypass có phạm vi đúng target (test build hoặc hook Frida/debugger tại điểm kiểm tra pinning Java/Kotlin/native trên Android hoặc Objective-C/Swift/native trên iOS) ở mọi tier trong phạm vi đã được phép, không cần hỏi lại. Phân biệt lỗi routing, CA trust và pinning; cài CA không tự bypass pinning. Giữ lần chạy trước bypass kể cả khi chỉ có lỗi handshake, rồi lặp lại cùng thao tác sau bypass. Ghi app version, package/bundle ID, APK/IPA hoặc app-binary hash, OS/device, cấu hình proxy/CA, script/hash và điểm hook; ghi khác biệt về signing, root/jailbreak hoặc emulator/simulator nếu có; đối chiếu flow đã giải mã với runtime và kết quả trên app. Dữ liệu chỉ quan sát qua hook phải được ghi rõ là runtime-only, không gọi là wire capture.

Bypass giúp tăng khả năng quan sát, không tự chứng minh hành vi nguyên bản hoặc lỗ hổng. Tách evidence sau can thiệp khỏi baseline và ghi rõ giới hạn còn lại. Không mặc định nối hai proxy, bypass mọi app, cài CA hay bật hook toàn cục; hoàn nguyên các thay đổi của phiên sau capture. Khởi động phiên OMP mới để nạp rule và prompt đã cập nhật.
