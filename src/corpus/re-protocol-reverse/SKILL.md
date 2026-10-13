---
name: re-protocol-reverse
description: Reverse engineering and parsing methodologies for custom binary and network protocols.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-protocol-reverse/SKILL.md
---
# Protocol Reverse Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-protocol-reverse/support/field-journal/precedent-reverse.md` — Verify authorization and standard operational boundaries
2. `NOW`: Confirm if the task is **protocol/traffic/serialization format** reverse engineering (if purely Web parameter signatures → redirect to `js-reverse/`)
3. `NOW`: If target network interaction is involved → complete scope via `arsenal scripts case-init`; do NOT ACT against targets if `auth` is not granted
4. `NEXT`: Read `tool-index` (workstation tool inventory); bootstrap missing tools (tshark/wireshark, etc. may require manual installation)
5. `ACT`: Enter Workflow Phase 1, produce draft frame layout or message dictionary

## Applicable Scenarios

- Custom TCP/UDP binary protocols
- Protobuf / gRPC / FlatBuffers / MessagePack
- WebSocket / MQTT / proprietary RPC
- Reconstructing fields and state machines from PCAP / PCAPNG
- Client-server verification, sequence numbers, encrypted frame headers

## Out of Scope for this Skill

| Scenario | Where to go |
|----------|-------------|
| HTTP parameter signatures / JS encryption only | `js-reverse/` |
| TLS certificate issues only | `pentest-tools/` or browser proxy |
| In-depth firmware protocol stack analysis + emulation | `firmware-pentest/` then return to this skill |

## Workflow

### Phase 1 — Capture and Triage

```text
□ Obtain sample: PCAP / proxy export / client logs / binary
□ Mark direction: C→S / S→C; check for handshakes, heartbeats, reconnections
□ Fixed header? Magic bytes? Length field? TLV? Fixed length?
□ Compressed (zlib/gzip/lz4) or encrypted (in-frame AES/ChaCha)?
□ tshark -r cap.pcap -T fields -e frame.number -e ip.src -e tcp.payload
```

### Phase 2 — Frame Layout Reconstruction

```text
□ Align multiple messages of the same type to find invariant bytes / incrementing sequence numbers
□ Length field: Big-endian/Little-endian, header-inclusive/header-exclusive
□ Verification: Location of CRC16/32, checksum, HMAC
□ Map out state machine: Connect → Auth → Ready → Request/Response → Close
□ Tools: Wireshark custom dissector draft / ImHex / 010 Editor template / Kaitai Struct
```

### Phase 3 — Serialization and Encryption

```text
□ Protobuf: .proto recovery (blackboxprotobuf / pbtk / protoc --decode_raw)
□ gRPC: HTTP/2 headers + protobuf body
□ Encryption: Locate key derivation (client so/dll/JS) → collaborate with ida-reverse / js-reverse / apk-reverse
□ Replay: Only within authorized scope; test benign fields before sensitive operations
```

### Phase 4 — Deliverables

```text
MUST produce:
- Message type table (name / opcode / fields)
- At least 1 reproducible decoding command or script
- Evidence: Raw hex excerpt + decoded output (sanitized/redacted)
```

## Toolchain

| Tool | Required | Purpose | Bootstrap |
|------|----------|---------|-----------|
| tshark / Wireshark | Strongly recommended | PCAP analysis | Manual / winget |
| Python3 | Yes | Decoding scripts | System |
| blackboxprotobuf | Optional | Unknown protobuf | pip |
| ImHex / 010 | Optional | Structure templates | Manual |
| IDA / r2 / Ghidra | As needed | Client serialization functions | See corresponding skill |

## References

- `skill://re-protocol-reverse/references/protocol-workflow.md` — Frame layout and Protobuf quick reference
- Related: `../re-ida-reverse/` `../webapp-js-reverse/` `../re-firmware-pentest/` `../webapp-pentest-tools/`

## Routing Context

**Upstream**: `MASTER-ROUTING` R21 · `skill://re-protocol-reverse/support/routing.md`  
**Downstream**: Client-side algorithm required → `re-ida-reverse`/`webapp-js-reverse`; replay verification required → `webapp-pentest-tools`/`webapp-api-security`  
**Peer**: `re-malware-analysis` (C2 protocols), `re-digital-forensics` (traffic forensics)

## Completion Self-Check

- [ ] Has the message layout or state machine been reconstructed (rather than merely pasting raw hex)?
- [ ] Is there a reproducible decoding command?
- [ ] Are scope boundaries respected and data sanitized?
- [ ] Has feedback been written back to field-journal / report checklist?
