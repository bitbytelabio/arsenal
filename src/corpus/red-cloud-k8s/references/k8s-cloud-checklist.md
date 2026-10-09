# Cloud / K8s Checklist (Concise)

## IMDS
- [ ] Whether SSRF can reach 169.254.169.254
- [ ] Whether IMDSv2 is enforced
- [ ] Permission surface of the returned IAM role

## K8s High-Risk
- [ ] Excessive cluster-admin bindings
- [ ] Secrets stored in plaintext environment variables
- [ ] Privileged + hostPID/hostPath combination
- [ ] Anonymous auth / insecure apiserver port

## Containers
- [ ] Running as root
- [ ] Capable of loading kernel modules / docker.sock mounted