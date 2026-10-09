# Code Audit Checklist (Condensed)

- [ ] List of all external input entry points
- [ ] Authentication/authorization middleware coverage
- [ ] Multi-tenant ID binding to session
- [ ] Deserialization / pickle / YAML load
- [ ] SSRF outbound traffic and protocol restrictions
- [ ] Secret key and token storage
- [ ] File upload path and type validation
- [ ] Dangerous exec/system/Runtime calls