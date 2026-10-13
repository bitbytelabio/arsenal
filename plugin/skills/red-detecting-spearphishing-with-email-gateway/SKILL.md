---
name: red-detecting-spearphishing-with-email-gateway
description: Detect and block spearphishing emails that use personalized, researched content to evade generic spam filters, by configuring email security gateway (SEG) impersonation protection, URL rewriting, attachment sandboxing, and custom detection rules in Microsoft Defender for Office 365, Proofpoint…
domain: red
category: social-engineering
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/red-detecting-spearphishing-with-email-gateway/SKILL.md
---
# Detecting Spearphishing with Email Gateway

## Overview
Spearphishing targets specific individuals using personalized, researched content that bypasses generic spam filters. Email security gateways (SEGs) like Microsoft Defender for Office 365, Proofpoint, Mimecast, and Barracuda provide advanced detection capabilities including behavioral analysis, URL detonation, attachment sandboxing, and impersonation detection. This skill covers configuring these gateways to detect and block targeted phishing attacks.


## When to Use

- When investigating security incidents that require detecting spearphishing with email gateway
- When building detection rules or threat hunting queries for this domain
- When SOC analysts need structured procedures for this analysis type
- When validating security monitoring coverage for related attack techniques

## Prerequisites
- Access to email security gateway admin console
- Understanding of email flow architecture (MX records, transport rules)
- Familiarity with SPF/DKIM/DMARC authentication
- Knowledge of common spearphishing techniques and pretexts

## Key Concepts

### Spearphishing Characteristics
- **Targeted recipients**: Specific individuals, often executives or finance staff
- **Researched pretexts**: References to real projects, colleagues, or events
- **Impersonation**: Spoofs trusted senders (CEO, vendor, partner)
- **Low volume**: Few emails to avoid pattern-based detection
- **Urgent tone**: Creates pressure to act quickly

### Gateway Detection Layers
1. **Reputation filtering**: IP/domain/URL reputation scoring
2. **Authentication checks**: SPF, DKIM, DMARC validation
3. **Content analysis**: NLP-based analysis of email body
4. **Impersonation detection**: Display name and domain similarity matching
5. **URL analysis**: Real-time URL detonation and redirect following
6. **Attachment sandboxing**: Behavioral analysis of attachments in isolated environments
7. **Behavioral analytics**: Anomaly detection in communication patterns

## Workflow

### Step 1: Configure Impersonation Protection
```
Microsoft Defender for Office 365:
  Security > Anti-phishing policies > Impersonation settings
  - Enable user impersonation protection for VIPs
  - Enable domain impersonation protection
  - Add protected users (CEO, CFO, HR Director)
  - Set action: Quarantine message

Proofpoint:
  Email Protection > Impostor Classifier
  - Enable display name spoofing detection
  - Configure lookalike domain detection
  - Set Impostor threshold sensitivity
```

### Step 2: Configure URL Protection
- Enable Safe Links / URL rewriting
- Enable time-of-click URL detonation
- Block newly registered domains (< 30 days)
- Enable URL redirect chain following

### Step 3: Configure Attachment Sandboxing
- Enable Safe Attachments / attachment sandboxing
- Configure dynamic delivery (deliver body, hold attachments)
- Set sandbox detonation timeout to 60+ seconds
- Block macro-enabled Office documents from external senders

### Step 4: Create Custom Detection Rules
Use the `arsenal scripts red-detecting-spearphishing-with-email-gateway` to analyze email gateway logs, identify spearphishing patterns, and generate custom detection rules.

### Step 5: Configure Alert and Response Actions
- Real-time alerts for impersonation attempts
- Automatic quarantine for high-confidence detections
- User notification with safety tips
- Integration with SIEM for correlation

## Tools & Resources
- **Microsoft Defender for Office 365**: https://security.microsoft.com
- **Proofpoint Email Protection**: https://www.proofpoint.com/us/products/email-security
- **Mimecast Email Security**: https://www.mimecast.com/products/email-security/
- **Barracuda Email Protection**: https://www.barracuda.com/products/email-protection

## Validation
- Impersonation protection correctly identifies spoofed VIP display names
- URL detonation catches malicious links in test phishing emails
- Attachment sandboxing detects weaponized documents
- Custom rules trigger on known spearphishing patterns
- SIEM integration receives gateway alerts

## Shipped Playbook Resources

- `skill://red-detecting-spearphishing-with-email-gateway/references/api-reference.md` — API and execution command reference
- `skill://red-detecting-spearphishing-with-email-gateway/references/standards.md` — Relevant standards and compliance baselines
- `skill://red-detecting-spearphishing-with-email-gateway/references/workflows.md` — Operational procedures and detailed workflows
- `skill://red-detecting-spearphishing-with-email-gateway/assets/template.md` — Assessment deliverable and reporting template
