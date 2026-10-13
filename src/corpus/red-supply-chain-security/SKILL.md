---
name: red-supply-chain-security
description: Software supply-chain security analysis covering dependency confusion and SBOM verification.
domain: red
category: network
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-supply-chain-security/SKILL.md
---
# Supply Chain Security Testing

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://red-supply-chain-security/support/field-journal/precedent-pentest.md` — confirm that operations in this skill are authorized standard procedures.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Read engagement tool index to verify tool availability and actual paths.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

> SBOM / SCA / CI/CD Pipelines / Dependency Provenance
> Regulatory-driven: US Executive Order on SBOM, Chinese National Standards (GB), EU CRA

## Applicable Scenarios

- Software supply chain security assessments
- Open-source dependency vulnerability scanning and verification
- CI/CD pipeline security audits
- Container image security analysis
- Third-party component compliance reviews
- Build artifact provenance and integrity verification

## Six-Layer Supply Chain Governance Framework

```text
Layer 1: Source Code Trust Assessment → Upstream repo / maintainer / release history audit
Layer 2: Build Pipeline Integration → CI/CD security quality gates, signature verification
Layer 3: Artifact Distribution Integrity → Signatures, checksums, SBOM attestation
Layer 4: Runtime Protection → Container scanning, admission control
Layer 5: Continuous Monitoring → Real-time CVE tracking, vulnerability reachability analysis
Layer 6: Incident Response → Supply chain attack emergency response, rollback strategies
```

## Workflow

### 1. SBOM Generation and Auditing

```text
Generate SBOM:
□ CycloneDX format: cdxgen → bom.json
□ SPDX format: sbom-tool generate
□ Syft: syft <image|dir> -o spdx-json

Audit Focus Areas:
□ Presence of unknown/unauthorized dependencies
□ Presence of deprecated/unmaintained packages
□ License conflict detection
□ Direct dependencies vs. transitive dependencies manifest
□ Release timeline and maintainer status for each component
```

### 2. Software Composition Analysis (SCA)

```bash
# OSV-Scanner (Free, maintained by Google)
osv-scanner scan -r . --format json

# OWASP Dependency-Track (Enterprise-grade continuous monitoring)
docker run -p 8080:8080 dependencytrack/apiserver
# → Upload SBOM → Automatically match against NVD/OSV/GitHub Advisory

# Snyk (Commercial)
snyk test --all-projects
snyk monitor  # Continuous monitoring

# Trivy (Containers + Dependencies + IaC)
trivy fs .          # Filesystem scan
trivy image nginx   # Container image
trivy config .      # IaC configuration
```

### 3. Vulnerability Reachability Verification

```text
SCA Alerts ≠ Actual Risk! Most SCA tools show that only ~15% of alerts are practically reachable.

Verification Steps:
1. Retrieve CVE list using Dependency-Track or Trivy
2. Filter for vulnerabilities with CVSS ≥ 7.0
3. Conduct reachability analysis on CVEs with existing PoCs
   - Code Property Graph slicing: Trace path from user input to the vulnerable function
   - DEPTEX methodology: EPD (Execution Path Dominance) + LLM semantic verification
4. Verify PoC in an isolated environment
5. Prioritize remediation based on the actual impact of reachable vulnerabilities
```

Tool References:
- CodeQL: GitHub code querying → Data flow analysis
- Snyk Code: Reachability tagging
- DEPTEX: LLM-assisted context-aware risk assessment

### 4. CI/CD Pipeline Security

```text
Security Checkpoints:
□ Code Commit → pre-commit hook: gitleaks (secret scanning)
□ PR Stage → SCA scan (Trivy/OSV-Scanner)
□ Build Stage → Artifact signing (cosign)
□ Push Stage → SBOM attestation (syft + attest)
□ Deployment Stage → Admission control (OPA/Kyverno + image scanning)
□ Runtime → Continuous vulnerability monitoring (Dependency-Track)

Pipeline Self-Security:
□ Pipeline as Code audit (GitHub Actions / GitLab CI configuration injection)
□ Runner isolation (prevent malicious builds from escaping containers)
□ Secret management (Actions Secrets / Vault, strictly forbid hardcoding)
□ Third-party Action review (pin to commit SHA, not tag)
```

### 5. Container Image Security

```bash
# Dockerfile audit
hadolint Dockerfile

# Image scan (multi-layer: OS + application dependencies + configuration)
trivy image --severity HIGH,CRITICAL nginx:latest

# Minimal base images
# Preferred: distroless → alpine → slim → avoid latest
docker scout quickview nginx:latest

# Image signing
cosign sign --key cosign.key myimage:tag
cosign verify --key cosign.pub myimage:tag
```

### 6. Third-Party Dependency Review

```text
New Dependency Checklist:
□ Maintenance status: Any commits in the last 6 months? Maintainer activity?
□ Security history: Has it been compromised or injected with malicious code in the past?
□ Dependency tree: How many transitive dependencies are introduced?
□ License: Compatible with the project's license?
□ Alternatives: Are there more secure alternatives available (Snyk Advisor / Socket.dev scores)?

Risk Assessment Matrix:
  High Maintenance × Low Dependency Count × Compatible License → Low Risk
  Low Maintenance × High Dependency Count × License Conflict → High Risk
```

## Toolchain

| Tool | Purpose | Acquisition |
|------|---------|-------------|
| OWASP Dependency-Track | Enterprise-grade continuous SCA | `docker pull dependencytrack/apiserver` |
| OSV-Scanner | Free SCA (OSV.dev ecosystem) | `go install github.com/google/osv-scanner` |
| Trivy | Image + dependency + IaC scanning | `apt install trivy` |
| Syft | SBOM generation | `curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh` |
| cdxgen | CycloneDX SBOM generation | `npm install -g @cyclonedx/cdxgen` |
| Cosign | Container signing | `go install github.com/sigstore/cosign/v2/cmd/cosign` |
| Gitleaks | Secret/credential scanning | `go install github.com/gitleaks/gitleaks/v8` |
| Snyk | Commercial SCA + reachability | `npm install -g snyk` |
| CodeQL | Code querying + data flow | Built into GitHub Actions |

## References

- `skill://red-supply-chain-security/references/sbom-sca-methodology.md` — SBOM + SCA Methodology
- `skill://red-supply-chain-security/references/cicd-pipeline-security.md` — CI/CD Pipeline Security Audit


## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
