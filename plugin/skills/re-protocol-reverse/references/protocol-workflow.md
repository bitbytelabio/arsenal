# Protocol Reverse Engineering Quick Reference

> Applicable to: `protocol-reverse` skill · 2026-07-18

## Common Layout Patterns

| Pattern | Characteristics | Tips |
|------|------|------|
| Fixed-length header + body | First 2/4 bytes represent length | Check whether it includes the header length |
| Magic number | Fixed values such as `0xDEAD` | Facilitates stream resynchronization |
| TLV | Repeated type-length-value | The type enumeration serves as the message dictionary |
| Protobuf | Field numbers encoded as varints | `protoc --decode_raw` |
| Encrypted frame | High entropy, no plaintext URLs | First look for nonce/IV proximity |

## Minimal Python Skeleton

```python
import struct
def parse_frame(buf: bytes):
    magic, length, msg_type = struct.unpack_from(">IHI", buf, 0)
    body = buf[10:10+length]
    return {"magic": magic, "type": msg_type, "body": body}
```

## Extracting TCP Payload from PCAP

```bash
tshark -r cap.pcap -Y "tcp.port==4433" -T fields -e tcp.payload | head
```