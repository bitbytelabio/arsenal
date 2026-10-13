---
name: red-performing-red-team-phishing-with-gophish
description: Automates GoPhish phishing simulation campaigns using the Python gophish library, creating email templates with tracking pixels, configuring SMTP sending profiles, building target groups from CSV, launching campaigns, and analyzing results such as open rates, click rates, and credential submission…
domain: red
category: social-engineering
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/red-performing-red-team-phishing-with-gophish/SKILL.md
---
## When to Use

- When conducting security assessments that involve performing red team phishing with gophish
- When following incident response procedures for related security events
- When performing scheduled security testing or auditing activities
- When validating security controls through hands-on testing

## Prerequisites

- Familiarity with security operations concepts and tools
- Access to a test or lab environment for safe execution
- Python 3.8+ with required dependencies installed
- Appropriate authorization for any testing activities

## Instructions

1. Install dependencies: `pip install gophish requests`
2. Deploy GoPhish server and obtain an API key from Settings.
3. Use the Python gophish library to automate campaign setup:
   - Create email templates with HTML body and tracking
   - Configure SMTP sending profiles
   - Import target groups from CSV
   - Create landing pages for credential capture
   - Launch and monitor campaigns
4. Analyze campaign results: opens, clicks, submitted data, reported.

```bash
# For authorized penetration testing and lab environments only
evidence_exec --gophish-url https://localhost:3333 --api-key <key> --campaign-name "Q1 Awareness" --output phishing_report.json
```

## Examples

### Create Campaign via API
```python
from gophish import Gophish
from gophish.models import Campaign, Template, Group, SMTP, Page
api = Gophish("api_key", host="https://localhost:3333", verify=False)  # Self-signed cert on localhost lab
campaign = Campaign(name="Q1 Test", groups=[Group(name="Sales Team")],
    template=Template(name="IT Password Reset"), smtp=SMTP(name="Internal SMTP"),
    page=Page(name="Credential Page"))
api.campaigns.post(campaign)
```

## Shipped Playbook Resources

- `skill://red-performing-red-team-phishing-with-gophish/references/api-reference.md` — API and execution command reference
