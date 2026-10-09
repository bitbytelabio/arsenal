---
name: webapp-analyzing-cloud-storage-access-patterns
description: Detect abnormal access patterns in AWS S3, GCS, and Azure Blob Storage by analyzing CloudTrail Data Events, GCS audit logs, and Azure Storage Analytics.
domain: webapp
category: threat-intelligence
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/webapp-analyzing-cloud-storage-access-patterns/SKILL.md
---
## Helper prerequisites

This bundled skill supplies operational methodology; execution should use evidence_exec or the documented underlying security binaries directly in accordance with engagement scope.



# Analyzing Cloud Storage Access Patterns


## When to Use

- When investigating security incidents that require analyzing cloud storage access patterns
- When building detection rules or threat hunting queries for this domain
- When SOC analysts need structured procedures for this analysis type
- When validating security monitoring coverage for related attack techniques

## Detection Gaps & Validation

- **The events may not exist at all:** S3 `GetObject`/`PutObject` are *data events*, off by default. Confirm with `aws cloudtrail get-event-selectors --trail-name X` showing a `DataResources` entry for `AWS::S3::Object`. GCS object reads need Data Access audit logs (`DATA_READ`) explicitly enabled per-service; Azure needs Storage Analytics / diagnostic settings on the storage account.
- **Exfil paths that dodge per-IP baselines:** presigned URLs log the *signer's* identity/IP, not the downloader; `CopyObject` / S3 replication to an attacker-owned bucket never hits `GetObject` from their IP; access via VPC gateway endpoint shows an internal `vpce-` source; CloudFront/OAC fronting masks the real client IP.
- **Volume framed as "normal":** slow-drip exfil under your `>100 GetObject/hr` threshold, or `ListBucket` recon spread across days, evades count-based rules. Watch bytes-out and distinct-key fan-out, not just call counts.
- **Baseline poisoning:** an attacker active during the 30-day learning window becomes part of "normal." Seed baselines from a known-clean period.
- **Validate the rule fires:** replay a known-bad pattern (e.g., 150 `GetObject` from a new IP in <1h against a canary key) and confirm a finding is generated; tune FPs by excluding backup/replication service principals and known batch jobs by `userIdentity.arn`.

## Prerequisites

- Familiarity with cloud security concepts and tools
- Access to a test or lab environment for safe execution
- Python 3.8+ with required dependencies installed
- Appropriate authorization for any testing activities

## Instructions

1. Install dependencies: `pip install boto3 requests`
2. Query CloudTrail for S3 Data Events using AWS CLI or boto3.
3. Build access baselines: hourly request volume, per-user object counts, source IP history.
4. Detect anomalies:
   - After-hours access (outside 8am-6pm local time)
   - Bulk downloads: >100 GetObject calls from single principal in 1 hour
   - New source IPs not seen in the prior 30 days
   - ListBucket enumeration spikes (reconnaissance indicator)
5. Generate prioritized findings report.

```bash
evidence_exec --bucket my-sensitive-data --hours-back 24 --output s3_access_report.json
```

## Examples

### CloudTrail S3 Data Event
```json
{"eventName": "GetObject", "requestParameters": {"bucketName": "sensitive-data", "key": "financials/q4.xlsx"},
 "sourceIPAddress": "203.0.113.50", "userIdentity": {"arn": "arn:aws:iam::123456789012:user/analyst"}}
```