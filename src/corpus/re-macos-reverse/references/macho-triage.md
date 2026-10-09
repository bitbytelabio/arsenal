# Mach-O Triage

```bash
file ./app
otool -hv ./app
otool -l ./app | head
codesign -d --entitlements :- ./app
```

Focus areas: `com.apple.security.*` entitlements, Library Validation, and flags related to disabling library injection.