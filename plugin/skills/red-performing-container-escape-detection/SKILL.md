---
name: red-performing-container-escape-detection
description: Audits container and pod configuration for escape-enabling misconfiguration using the Kubernetes Python client - privileged flags, dangerous capability grants, host path mounts, shared namespaces, and CVE-2022-0492 style cgroup abuse.
domain: red
category: cloud-security
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/red-performing-container-escape-detection/SKILL.md
---
# Performing Container Escape Detection


## When to Use

- When conducting security assessments that involve performing container escape detection
- When following incident response procedures for related security events
- When performing scheduled security testing or auditing activities
- When validating security controls through hands-on testing

## Prerequisites

- Familiarity with container security concepts and tools
- Access to a test or lab environment for safe execution
- Python 3.8+ with required dependencies installed
- Appropriate authorization for any testing activities

## Instructions

Audit Kubernetes pods for container escape vectors including privileged mode,
dangerous capabilities, host namespace sharing, and writable hostPath mounts.

```python
from kubernetes import client, config
config.load_kube_config()
v1 = client.CoreV1Api()

pods = v1.list_pod_for_all_namespaces()
for pod in pods.items:
    for container in pod.spec.containers:
        sc = container.security_context
        if sc and sc.privileged:
            print(f"PRIVILEGED: {pod.metadata.namespace}/{pod.metadata.name}")
```

Key escape vectors:
1. Privileged containers (full host access)
2. CAP_SYS_ADMIN capability
3. Host PID/Network/IPC namespace sharing
4. Writable hostPath mounts to / or /etc
5. Docker socket mount (/var/run/docker.sock)

## Examples

```python
# Check for docker socket mounts
for vol in pod.spec.volumes or []:
    if vol.host_path and "docker.sock" in (vol.host_path.path or ""):
        print(f"Docker socket exposed: {pod.metadata.name}")
```

## Shipped Playbook Resources

- `skill://red-performing-container-escape-detection/references/api-reference.md` — API and execution command reference
