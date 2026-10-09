# OWASP LLM & Agentic AI Top 10 (2025-2026)

## OWASP Top 10 for LLM Applications v2.0 (2025)

| # | Risk | Core Issue | Testing Focus |
|---|------|------------|---------------|
| LLM01 | Prompt Injection | Manipulating model behavior via crafted inputs | Direct injection, indirect injection, encoding bypass |
| LLM02 | Sensitive Information Disclosure | Leakage of PII, API keys, or training data | Prompt extraction, output analysis |
| LLM03 | Supply Chain | Poisoned models, libraries, or datasets | Model provenance verification, dependency scanning |
| LLM04 | Data & Model Poisoning | Backdoors in training/fine-tuning data | Data lineage tracing, behavioral anomaly detection |
| LLM05 | Improper Output Handling | Outputs leading to XSS, SQLi, or RCE | Downstream system injection testing |
| LLM06 | Excessive Agency | Excessive tool access or autonomy causing real-world harm | Privilege auditing, human-in-the-loop testing |
| LLM07 | System Prompt Leakage | Extraction of hidden instructions, secrets, or business logic | Cascading extraction, canary tokens |
| LLM08 | Vector & Embedding Weaknesses | RAG pipeline attacks, embedding inversion | Retrieval poisoning, semantic similarity attacks |
| LLM09 | Misinformation | Hallucinations posing security risks in high-stakes scenarios | Factuality verification, confidence calibration |
| LLM10 | Unbounded Consumption | DoS / Denial-of-Wallet | Token consumption testing, rate limiting |

## OWASP Top 10 for Agentic Applications (ASI 2026)

| # | Risk | Core Impact | Testing Focus |
|---|------|-------------|---------------|
| ASI01 | Agent Goal Hijack | Malicious inputs or tool outputs hijacking the agent's goal | Instruction overriding, goal tampering |
| ASI02 | Tool Misuse & Exploitation | Unintended use of legitimate tools | Tool chain composition, parameter injection |
| ASI03 | Identity & Privilege Abuse | Unauthorized privilege escalation by agents | Credential theft, delegation chain testing |
| ASI04 | Agentic Supply Chain | Real-time risks from MCP descriptors or third-party tools | Dynamic supply chain scanning |
| ASI05 | Unexpected Code Execution | Prompt-to-tool-to-script RCE chains | Multi-layer code execution testing |
| ASI06 | Memory & Context Poisoning | Poisoning of long-term memory or embeddings | Memory persistence attacks |
| ASI07 | Insecure Inter-Agent Communication | Tampering with communications between agents | Man-in-the-middle, replay attacks |
| ASI08 | Cascading Failures | Single point of failure triggering system-wide collapse | Failure propagation testing |
| ASI09 | Human-Agent Trust Exploitation | Manipulating human operators into approving dangerous actions | Authority bias and urgency testing |
| ASI10 | Rogue Agents | Agent self-replication or persistent malicious behavior | Persistent backdoor detection |

## Empirical Data Distribution

Proportion of issues identified in real-world assessments:
- LLM01 Prompt Injection: ~45%
- LLM06 Sensitive Info Disclosure: ~20%
- LLM08 Excessive Agency: ~15%
- Remaining 7 items: ~20%

## Key Defensive Principles

1. Separation of Planning and Execution — The model interpreting intent must not be the model executing actions.
2. Bind Identity, Purpose, Scope, and TTL — Avoid granting broad, ambient permissions.
3. Log Everything — Treat tool calls, memory state, and communications as first-class security telemetry.
4. Blast Radius Control — Prioritize circuit breakers, rollbacks, and emergency stops over convenience.
5. Treat All Natural Language Inputs as Untrusted — This includes retrieved RAG context.
6. Outputs Are Equally Untrusted — Sanitize thoroughly before rendering, executing, or querying.