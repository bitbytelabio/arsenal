---
name: webapp-browser-extension-reverse
description: Reverse engineering and security review of Chrome and Firefox browser extensions.
domain: webapp
category: client-side
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-browser-extension-reverse/SKILL.md
---
# Browser Extension Reverse Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://webapp-browser-extension-reverse/support/field-journal/precedent-reverse.md`
2. `NOW`: Confirm target is a **browser extension** (crx/xpi/unpacked directory), not standard web page JS (standard → `js-reverse/`)
3. `NEXT`: Unpack the extension; read manifest
4. `ACT`: Permission surface → Background scripts → Network/storage hooks

## Applicable Scenarios

- Chrome/Edge MV2/MV3 extension analysis
- Firefox extensions
- Malicious extension IOCs, supply chain extension poisoning investigations
- Reconstruction of signature/encryption/proxy logic implemented within extensions

## Workflow

### 1. Package Body

```text
□ Unpack crx / Extract extension directory from profile
□ manifest.json: permissions, host_permissions, background, content_scripts
□ Assess excessive permissions (<all_urls>, webRequest, debugger)
```

### 2. Logic

```text
□ service_worker / background entry points
□ content_script injection points and execution world (isolated)
□ chrome.storage / IndexedDB keys
□ Same as `js-reverse`: Observe network and message passing (runtime.sendMessage)
```

### 3. Dynamic

```text
□ Load unpacked directory in Developer Mode
□ chrome://extensions check for errors
□ DevTools attach to service worker
□ When necessary: Frida / Browser CDP (jshookmcp)
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Unpack tools / jq | manifest |
| Chrome DevTools | Worker debugging |
| js-reverse Toolchain | In-depth JS analysis |
| YARA | Malicious extension rules |

## References

- `skill://webapp-browser-extension-reverse/references/extension-analysis.md`
- Field-journal extension recovery entries
- ``skill://webapp-js-reverse`` ``skill://re-malware-analysis``

## Routing Context

**Upstream**: MASTER R30  
**Downstream**: Complex obfuscated JS → `js-reverse`; Poisoning investigations → supply-chain / malware

## Task Completion Checklist

- [ ] Are the permission surface and entry scripts enumerated?
- [ ] Are critical data flows reconstructed?
- [ ] Checklist verified?
