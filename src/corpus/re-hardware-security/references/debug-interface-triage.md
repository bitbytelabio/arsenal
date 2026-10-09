# Debug Interface Triage

1. Locate silkscreen markings: TX RX GND VCC TDI TDO TCK TMS  
2. Match voltage levels before connecting  
3. Read serial logs first (read-only)  
4. Record U-Boot interrupt keys and environment variables (do not execute saveenv arbitrarily)  
5. Compute SHA256 checksum after image extraction