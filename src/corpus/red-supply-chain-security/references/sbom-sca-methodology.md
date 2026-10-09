# SBOM + SCA Methodology

## SBOM Standards Comparison

| Standard | Format | Ecosystem | Recommended Use Case |
|----------|--------|-----------|----------------------|
| SPDX | JSON/YAML/tag-value | Linux Foundation, Yocto | License compliance priority |
| CycloneDX | JSON/XML | OWASP, Kubernetes | Security analysis priority |
| SWID | XML | ISO Standard | Enterprise asset management |

## SBOM Generation Toolchain

```bash
# cdxgen: Generate CycloneDX SBOM from source code
cdxgen -o bom.json -t cyclonedx

# Syft: Generate from container/filesystem
syft nginx:latest -o spdx-json > sbom.spdx.json

# SBOM-Tool: Microsoft toolchain
sbom-tool generate -b ./build -bc ./src -pn MyApp -pv 1.0
```

## SCA Tools Comparison

| Tool | Free | Speed | Database | Reachability |
|------|:--:|------|----------|:--:|
| OSV-Scanner | ✅ | Extremely Fast | OSV.dev | ❌ |
| Trivy | ✅ | Fast | Multi-source | ❌ |
| Dependency-Track | ✅ | Medium | NVD+OSV+GitHub | ❌ (Plugin required) |
| Snyk | ❌ | Medium | Proprietary | ✅ |
| CodeQL | ✅ | Slow | Code-level | ✅ |

## Vulnerability Prioritization Strategy

```
CVSS ≥ 9.0 + Public PoC available + Reachable → P0 Fix immediately
CVSS ≥ 7.0 + PoC available + Reachable → P1 Fix this week
CVSS ≥ 7.0 + No PoC or Unreachable → P2 Fix next sprint
Others → Standard workflow
```

## Three-Step Manual Verification

```bash
# 1. Confirm version (Do not blindly trust SBOM fields)
# Inside container: dpkg -l | grep <package>
# Node: cat node_modules/<pkg>/package.json | jq .version
# Python: pip show <package>

# 2. Confirm vulnerability
# Search CVE: https://osv.dev / https://nvd.nist.gov
# Check affected version ranges
# Locate GitHub Advisory / oss-security mailing list

# 3. Verify impact
# Search public PoCs: GitHub/Exploit-DB
# Analyze exploit conditions: Authentication required / Local access / Specific configurations
# Verify in an isolated environment: docker run --rm -it vulnerable-image bash
```

## Continuous Monitoring

```yaml
# Daily SBOM update + scan
schedule:
  - cron: "0 6 * * *"  # Every day at 6:00 AM
    steps:
      - cdxgen -o bom.json
      - osv-scanner scan --sbom bom.json
      - trivy fs --exit-code 1 --severity CRITICAL .
```

Source: OWASP CycloneDX, SPDX, Google OSV, CISA SBOM Guidance