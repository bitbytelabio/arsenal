# Arsenal Engagement Operating Model

## 1. Role Architecture
Arsenal structures security assessments across exactly six explicit roles:
1. \`master\`: Orchestrator and coordinator. Spawns domain specialists; synthesizes findings.
2. \`sec-re\`: Reverse engineering and binary exploitation specialist.
3. \`sec-webapp\`: Web application, API, and cloud security specialist.
4. \`sec-mobile\`: Android and iOS mobile security specialist.
5. \`sec-red\`: Red team, Active Directory, and network evasion specialist.
6. \`sec-verifier\`: Independent verification and oracle replay specialist.

## 2. Delegation Contract
- Only \`master\` may spawn child subagents.
- Domain specialists declare \`spawns: []\` and perform focused technical work.
- \`sec-verifier\` is independent and strictly verifies findings reported by specialists.

## 3. Tool Execution & Guidance
- Tier 1 domain routers are available in the base prompt.
- Tier 3 leaf playbooks are retrieved on demand using \`skill_search\` and \`skill_load\`.
