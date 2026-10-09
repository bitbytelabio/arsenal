# Attack Chain Playbook Quick Reference

> Select the corresponding playbook based on the target type. Each playbook defines the standard path from initial access to objective attainment.

---

## Playbook 1: External Web Application → Domain Controller

```
1. Subdomain enumeration + port scanning
2. Web fingerprinting → identify components with known vulnerabilities
3. Exploit vulnerability to obtain Webshell / RCE
4. Internal network reconnaissance (ipconfig/ifconfig, arp, net user)
5. Establish tunnel (frp/chisel/ssh)
6. Internal network scanning (live hosts, open ports)
7. Credential harvesting (mimikatz/hashdump/configuration files)
8. Lateral movement (PTH/WMI/PsExec)
9. Domain reconnaissance (BloodHound)
10. Domain privilege escalation (Kerberoasting/DCSync/constrained delegation)
11. Obtain Domain Controller privileges
```

**Key Toolchain**: subfinder → httpx → nuclei → sqlmap/sstimap → frp → nmap → mimikatz → crackmapexec → bloodhound → certipy

---

## Playbook 2: Phishing → Internal Network Penetration

```
1. Target employee reconnaissance (LinkedIn/Maimai)
2. Craft phishing emails (spoofed sender / legitimate subject)
3. Construct payload (macro document/LNK/ISO/HTML smuggling)
4. Send phishing emails
5. Await callback (C2 beacon)
6. Local reconnaissance + privilege escalation
7. Credential extraction
8. Lateral movement
9. Persistence
10. Objective attainment
```

**Key Toolchain**: theHarvester → gophish → msfvenom/cobalt-strike → mimikatz → bloodhound

---

## Playbook 3: Proximity / Physical Penetration → Internal Network

```
1. Physical reconnaissance (Wi-Fi signals, access control types, USB ports)
2. Wi-Fi attack (Fluxion rogue AP / WPA cracking)
   or BadUSB implant (Rubber Ducky keystroke injection)
   or Network implant (Raspberry Pi / LAN Turtle)
3. Obtain internal network access point
4. Internal network scanning
5. Subsequent steps identical to Playbook 1, steps 5-11
```

**Key Toolchain**: fluxion/aircrack-ng → rubber-ducky → frp → nmap → crackmapexec

---

## Playbook 4: Cloud Environment Penetration

```
1. Cloud asset discovery (subdomain → CNAME → cloud provider)
2. Storage bucket enumeration (S3/OSS/Blob public access)
3. SSRF → Cloud metadata (169.254.169.254)
4. Obtain temporary credentials (AK/SK/Token)
5. Cloud API enumeration (IAM/EC2/Lambda/RDS)
6. Privilege escalation (PassRole/AssumeRole)
7. Lateral movement (cross-account / cross-region)
8. Data acquisition
```

**Key Toolchain**: subfinder → nuclei(ssrf) → aws-cli → pacu → ScoutSuite

---

## Playbook 5: Bug Bounty / SRC Rapid Initial Access

```
1. Asset discovery (subdomains + ports + JS files)
2. Fingerprinting → rapid verification of known vulnerabilities (nuclei)
3. Parameter discovery (arjun/paramspider)
4. Category-by-category testing:
   - IDOR / Broken Access Control (modify ID / modify role)
   - SSRF (internal network scanning / cloud metadata)
   - SQL Injection (sqlmap)
   - XSS (xsstrike)
   - File Upload (bypass detection)
   - Business Logic Vulnerabilities (payment / OTP / password reset)
5. Write PoC + submit report
```

**Key Toolchain**: subfinder → httpx → nuclei → arjun → sqlmap → xsstrike → burpsuite

---

## Playbook 6: AD CS Certificate Attacks

```
1. Discover AD CS services (certipy find)
2. Identify vulnerable templates (ESC1-ESC8)
3. Request malicious certificate
4. Authenticate as target user using certificate
5. Obtain NTLM Hash or TGT
6. DCSync dump all credentials
```

**Key Toolchain**: certipy → rubeus → mimikatz → secretsdump

---

## General Decision Matrix

| Current State | Next Step Priority |
|---|---|
| Target domain only | Subdomain enumeration → Port scanning → Web fingerprinting |
| Web vulnerability identified | Obtain shell → Internal network reconnaissance |
| Low-privilege shell obtained | Privilege escalation → Credential extraction |
| One internal machine compromised | Establish tunnel → Internal network scanning → Lateral movement |
| Domain user credentials obtained | BloodHound → Identify attack paths |
| Domain Admin Hash obtained | DCSync → Golden Ticket |
| Cloud AK/SK obtained | Enumerate permissions → Privilege escalation → Data acquisition |
| Phishing callback received | Local privilege escalation → Credentials → Lateral movement |
| Proximity access established | Internal network scanning → Same as above |