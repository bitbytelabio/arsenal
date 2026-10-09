---
name: red-cloud-k8s
description: Cloud infrastructure and Kubernetes security review covering container escapes and IAM policies.
domain: red
category: cloud-security
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-cloud-k8s/SKILL.md
---
# Cloud / Container / Kubernetes Security

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://red-cloud-k8s/support/field-journal/precedent-pentest.md` — **Cloud/K8s testing strictly requires written authorization**
2. `NOW`: case-init + scope; clearly define account boundaries and prohibit destructive operations
3. `NOW`: Confirm focus is cloud metadata/containers/K8s/IAM, rather than generic web scanning (the latter belongs to `pentest-tools/`)
4. `NEXT`: tool-index; tools such as kubectl/aws/gcloud mostly require manual installation
5. `ACT`: Start from "identity and attack surface exposure"; full-network scanning by default is prohibited

## Applicable Scenarios

- Cloud metadata SSRF (169.254.169.254 / IMDS)
- IAM excessive permissions, public storage buckets, misconfigured security groups
- Docker/containerd escape vector assessment
- Kubernetes RBAC, Secrets, Admission, supply chain images
- Container image vulnerabilities (can integrate with `supply-chain-security/`)

## Workflow

### Phase 1 — Identity and Boundaries

```text
□ Current identity: Cloud AK/SK, K8s SA, node SSH?
□ Scope: Single account / single cluster / single namespace
□ Network profile: authorized_target_only
```

### Phase 2 — Cloud Control Plane

```bash
# Example (substitute by vendor; MUST be executed within authorized accounts)
aws sts get-caller-identity
aws s3 ls
# Azure / GCP corresponding identity commands
```

```text
□ Public buckets / misconfigured ACLs
□ Metadata: IMDSv1 vs v2; SSRF chains
□ Role assumability (PassRole) and lateral movement
```

### Phase 3 — Containers

```text
□ Privileged / hostPath / hostNetwork enabled
□ capabilities (SYS_ADMIN, etc.)
□ Writable host paths → escape candidates
□ Image history and known CVEs → Trivy
```

### Phase 4 — Kubernetes

```bash
kubectl auth can-i --list
kubectl get pods,secrets,svc -A
kubectl get clusterrolebindings
```

```text
□ SA token mount status and permissions
□ Missing dangerous admission webhooks
□ etcd / dashboard exposure
□ Network policies: open by default or restricted
```

## Toolchain

| Tool | Purpose | Bootstrap |
|------|---------|-----------|
| kubectl | Cluster interaction | Manual |
| trivy | Images / IaC | bootstrap `trivy` if available |
| kube-bench / kubeaudit | CIS / Configuration | Manual |
| pacu / scoutsuite | Cloud auditing (authorized) | Manual |
| nuclei | Known cloud vulnerability templates | bootstrap nmap/nuclei ecosystem |

## References

- `skill://red-cloud-k8s/references/k8s-cloud-checklist.md`
- CTF Cross-reference: `../../CTF-Sandbox-Orchestrator/competition-agent-cloud/`
- `../supply-chain-security/` `../pentest-tools/`

## Routing Context

**Upstream**: MASTER R23  
**Downstream**: Node shell obtained → `attack-chain` / `windows-ad`; Image vulnerabilities → supply-chain  
**MUST NOT**: Scan unauthorized multi-tenant public cloud infrastructure

## Task Completion Checklist

- [ ] Strictly confined to authorized account/cluster?
- [ ] Do findings include reproduction steps and impact analysis?
- [ ] Were destructive operations avoided?
- [ ] Report / journal updated?
