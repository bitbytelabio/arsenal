# CI/CD Pipeline Security Audit

## Pipeline Attack Surface

```text
Threat Model (STRIDE):
□ Spoofing: Forging builds/signatures/provenance
□ Tampering: Modifying source code/build artifacts/dependencies
□ Repudiation: Malicious actions lacking audit logs
□ Information Disclosure: Pipeline logs/build artifacts leaking secrets
□ Denial of Service: Exhausting CI resources/sabotaging builds
□ Elevation of Privilege: Runner escape/secret theft
```

## Audit Checklist

### 1. Pipeline as Code Configuration

```yaml
# GitHub Actions Audit Key Points
# ❌ Dangerous Pattern
on:
  pull_request_target:  # PR trigger with access to secrets
    types: [opened]

# ❌ Script Injection
- run: echo "${{ github.event.issue.title }}"  # User input → shell

# ❌ Unrestricted Token Permissions
permissions: write-all

# ✅ Secure Pattern
on:
  pull_request:  # No access to secrets
    types: [opened]

# ✅ Pinned to SHA
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683

# ✅ Principle of Least Privilege
permissions:
  contents: read
```

### 2. Secret Management

```bash
# Scan commit history for secrets
gitleaks detect --source . --verbose
trufflehog git file://. --only-verified

# Check Actions Secrets usage
gh secret list
# Verify: No hardcoded secrets, regular rotation, least privilege

# Runtime Secret Injection
# ✅ Use OIDC instead of long-lived credentials
# ✅ Expose secrets only to specific steps when needed
```

### 3. Build Integrity

```bash
# Build Provenance
# Generate tamper-evident build records (SLSA L2+)
slsa-provenance generate --source . --output provenance.json

# Artifact Signing
cosign sign-blob --key cosign.key artifact.tar.gz

# Verification
cosign verify-blob --key cosign.pub --signature artifact.tar.gz.sig artifact.tar.gz
```

### 4. Runner Security

```text
□ Are GitHub-hosted runners used? (Recommended, fresh environment each run)
□ Self-hosted runners: Do they run inside isolated VMs/containers?
□ Have workflows run on fork PRs? (Extremely high risk for self-hosted runners)
□ Does the runner enforce outbound network restrictions?
□ Can build caches leak data across builds?
```

### 5. Dependency Fetching Security

```text
□ npm: Is package-lock.json committed? Disallow --force / --legacy-peer-deps
□ pip: Are versions pinned in requirements.txt? Disallow pip install <unverified-sources>
□ Docker: Is FROM pinned to an image digest? Disallow the latest tag
□ Go: Is go.sum committed?
□ Private packages: Does registry authentication use short-lived tokens?
```

## Automated Check Pipeline

```yaml
# .github/workflows/supply-chain.yml
name: Supply Chain Security
on: [push, pull_request]

jobs:
  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: SBOM Generate
        run: |
          npm install -g @cyclonedx/cdxgen
          cdxgen -o sbom.json
      
      - name: OSV Scan
        run: |
          go install github.com/google/osv-scanner/cmd/osv-scanner@latest
          osv-scanner scan --sbom sbom.json --format sarif > osv-results.sarif
      
      - name: Trivy Scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          severity: CRITICAL,HIGH
          exit-code: 1
      
      - name: Secret Scan
        run: |
          docker run --rm -v $PWD:/src ghcr.io/gitleaks/gitleaks:latest \
            detect --source /src --verbose
      
      - name: Dependency-Track Upload
        run: |
          curl -X POST https://dtrack.example.com/api/v1/bom \
            -H "X-Api-Key: ${{ secrets.DTRACK_API_KEY }}" \
            -F "autoCreate=true" -F "project=myapp" -F "bom=@sbom.json"
```

Source: SLSA Framework, OWASP CI/CD Top 10, GitHub Security Lab