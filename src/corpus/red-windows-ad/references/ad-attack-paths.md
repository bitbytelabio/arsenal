# AD Attack Path Quick Reference

| Path | Prerequisite | Tool / Indicator |
|------|--------------|------------------|
| Kerberoast | SPN account | GetUserSPNs / Rubeus |
| AS-REP Roast | Pre-authentication not required | GetNPUsers |
| ESC1 | Enforceable template + forgeable SAN | Certipy |
| ESC8 | HTTP enrollment + Relay | ntlmrelayx |
| ACL → DA | GenericAll on user/group | BloodHound |
| NTLM Relay | Signing not enforced | Responder + relay |

Always: Authorization → Enumeration → Path Scoring → Minimal Verification → Cleanup.