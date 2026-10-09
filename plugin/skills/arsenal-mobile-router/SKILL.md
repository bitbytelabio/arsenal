---
name: arsenal-mobile-router
description: "Mobile security domain routing table covering Android and APK analysis, iOS analysis, instrumentation, and repackaging."
domain: mobile
hide: false
license: MIT
---
# Arsenal Mobile Application Security Router

## Role & Guidance
Use for Android and iOS mobile application reverse engineering, APK unpacking, smali modification, IPA analysis, Frida hooks, and certificate pinning bypasses.

## On-Demand Playbook Retrieval
Leaf playbooks are hidden from the base prompt. Use runtime tools:
- `skill_search(query: "frida hook android", domain: "mobile")`
- `skill_route(hint: "frida hook android", domain: "mobile")`
- `skill_load(name: "re-apk-reverse")`

## Declared Categories
- `apk-analysis` → `M1` (re-apk-reverse)
- `ios-analysis` → `M2` (mobile-reverse)
- `instrumentation` → `M3` (mobile-reverse-engineering-ios-app-with-frida)
- `repackaging` → `M5` (re-apk-reverse)
