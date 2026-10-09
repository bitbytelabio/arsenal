# AI Agent Compliance Engineering — Making AI Actually Execute After Reading Workflows

> Source: 2026 Multi-Source Synthesis (Anthropic Skill Engineering, Microsoft Code Words, Strands Steering Hooks, Gradient Flow Harness Engineering)
> Target Scenarios: AI Coding Agents (Claude Code / Codex / Cursor / Cline / Windsurf / Kiro, etc.) reading README/RULES.md only to acknowledge without executing, skipping steps, or arbitrarily omitting critical operations.

---

## Core Problem Diagnosis

The root cause of AI Agents "reading the workflow but not working" is not insufficient model capability, but rather **semantic escape hatches present in natural language instructions**:

| Root Cause | Explanation |
|---|---|
| **Contextual Attention Decay** | Content in the middle of long documents is down-weighted by the LLM attention mechanism; the Agent effectively only "sees" the beginning and the end. |
| **Semantic Overwriting** | When optimizing for "helpfulness," models creatively reinterpret explicit instructions (e.g., treating MUST DO X as "recommended to do X"). |
| **Passive Language Treated as Optional** | "Ready for next step → invoke X" is interpreted as a suggestion rather than a directive. |
| **Absence of State Enforcement** | Without an external state machine validating workflow sequence, the Agent can skip steps undetected. |
| **Silent State Corruption** | The Agent produces structurally valid but semantically erroneous outputs, allowing errors to accumulate silently. |

---

## Technique 1: Critical-First Pattern

**Place "what to do next" at the very beginning, and context at the end.**

```
WRONG (Agent ignores):
  [70 lines of project background and tool lists]
  → "Next step: run bootstrap to install missing tools"

CORRECT (Agent executes):
  "## EXECUTE IMMEDIATELY: Run `bootstrap-reverse.ps1` to inspect and install missing tools
   → Upon completion, read routing.md to determine which skill to enter"
  [followed by project background and tool lists]
```

**Principle**: LLMs assign the highest attention weights to content at the beginning and end of prompts. Middle content may be entirely ignored.

**Application to this project**:
- Place the "Routing Entry" section of RULES.md immediately after trigger keywords and before execution principles.
- The first section of every SKILL.md MUST be "Execute Immediately" rather than "Applicable Scenarios".

---

## Technique 2: Directive Over Suggestive Language

Replace all "suggestive" language with RFC 2119-compliant directive language:

| Weak Language (Agent may skip) | Strong Language (Agent forcefully executes) |
|---|---|
| "You can try..." | **MUST**: You must execute... |
| "Ready for next step → invoke X" | **NOW**: Invoke X immediately; do not wait for confirmation. |
| "It is recommended to read routing.md first" | **REQUIRED**: You must completely read routing.md before entering any submodule. |
| "If tools are missing, you can bootstrap" | **NO EXCUSE**: The ONLY correct action when tools are missing is invoking bootstrap; manual installation guessing is forbidden. |
| "Remember to update field-journal" | **CHECKLIST ENFORCED**: Tick off the checklist item by item upon task completion; do not claim task completion until finished. |
| "Should..." | **MUST** / **MUST NOT** |

**Key Pattern**:
```
MUST — Violation = Task Failure
MUST NOT — Violation = Security Breach
SHOULD — Omission requires explicit justification
MAY — Truly optional
```

---

## Technique 3: Excuse Rebuttal Table

**This is the most critical patch for this project.** When encountering resistance, AI Agents automatically generate "plausible excuses" to skip steps. Pre-emptively list common excuses and refute them one by one:

| Agent Common Excuse | Rebuttal (Forced Execution) |
|---|---|
| "This step can be omitted, I will directly..." | **SKIPPING FORBIDDEN.** Every step in the behavioral chain is required. If you believe a step can be skipped, output the specific rationale first and let the user decide. |
| "Based on my judgment, this is not required" | **YOUR JUDGMENT DOES NOT APPLY HERE.** State the specific criteria used for your judgment and explain why these criteria permit skipping explicitly defined steps. |
| "The user probably does not need this" | **NEVER DECIDE FOR THE USER.** Present all options to the user; mark recommendations, but do not conceal alternatives. |
| "I already know how to do this, no need to read X" | **READ X BEFORE ACTING.** Even if you are certain you know how to proceed, X may contain task-specific constraints. Reading it takes only 2 seconds. |
| "To save time, I can skip... in parallel" | **THE PROPER WAY TO SAVE TIME IS EXECUTING INDEPENDENT STEPS IN PARALLEL, NOT SKIPPING STEPS.** If two steps are mutually independent, execute them in parallel; if dependent, execute sequentially. |
| "I have used this tool before and know its path" | **GUESSING PATHS IS FORBIDDEN.** You must retrieve actual paths from tool-index; installation locations differ across machines. |
| "The task is basically complete, no checklist needed" | **THE SOLE DEFINITION OF TASK COMPLETION IS ALL CHECKLIST ITEMS MARKED.** A task without a completed checklist is not complete. |
| "I could not find tool-index, so I will guess the path" | **A MISSING FILE IS 100 TIMES SAFER THAN A GUESSED PATH.** When tool-index is missing, run refresh-tool-index.ps1 first to generate it. |
| "The user did not explicitly request a report, so I will omit it" | **REPORTS ARE DEFAULT BEHAVIOR, NOT OPTIONAL.** A report must be generated upon security task completion unless the user explicitly specifies "no report". |
| "This is too simple to warrant recording in the journal" | **SIMPLE TASKS PROVIDE PITFALL VALUE AS WELL.** Record at least: target type + tools used + unexpected issues (a single line suffices). |
| "The user told me to redo the import table/a specific step, but I did another more useful step instead" | **REDO = REDO THE EXACT NAMED STEP** (or an authorized prerequisite path confirmed by the user). MUST update corresponding Evidence; masquerading with unrelated steps or silent skipping is forbidden. Unpacking is a **prerequisite** for a readable IAT, not a **replacement** for import table Evidence. |
| "The user said not to unpack packed samples yet, just view the import table; I submitted the obfuscated table and called it done" | **FEASIBILITY GATE:** When X is blocked, you MUST explain the blockage, provide the recommended order, and **request user confirmation**. If forced by the user, execute and flag `quality=unreadable/packed`; negating conclusions using capabilities under an obfuscated table is forbidden. |
| "Crashes occur after unpacking, so I will keep modifying files on disk endlessly" | **PATCH 6:** Record E-self-check-crash / E-iat-repair-fail, switch to dynamic analysis (bp CreateFile/GetFileSize). Infinite static file patching is forbidden. |
| "IAT cannot be fixed, so I will statically try more packing tools to stall" | **IAT REPAIR IRON RULE:** Prioritize automated/semi-automated repair; tool errors or inability to run post-repair → stop static IAT immediately, record E-iat-repair-fail, switch to dynamic API breakpoint capture. Infinite static struggle is forbidden. |
| ".NET / No import table, hard gates do not apply, so I skip" | **EQUIVALENT ANCHORS STILL MUST BE PROVIDED:** For .NET, write dnSpy/IL/metadata summaries into the E-imports semantic slot; for DLL/SYS, align with E-exports. Skipping empty is forbidden. |

**Usage**: Place this table near the end of RULES.md or other instruction files (high attention zone). The Agent encounters the refutations before generating excuses.

---

## Technique 4: The Five Skill Engineering Patterns (Anthropic 2026 Official)

| Pattern | Applicable Scenarios | Key Techniques |
|---|---|---|
| **Linear Flow** | Processes with clear steps (deployment, installation) | Provide safe defaults; use negative directives ("MUST NOT use --force"). |
| **Decision Tree** | Platform navigation, troubleshooting | Tree navigation + progressive loading via `references/`. |
| **Iterative Loop** | TDD, review-fix loops | Hard rules front-loaded + **Excuse Rebuttal Table** blocking shortcuts. |
| **Baton Loop** | Multi-session, multi-agent collaboration | State externalized to `next-prompt.md` (MUST write before exit). |
| **Multi-Phase + Checkpoints** | Multi-day complex workflows | Orchestrator "parent" skill + manual Go/No-Go checkpoints, time costs labeled. |

**Mapping to this project**:
- Complete Behavioral Chain = Linear Flow (15-step sequential execution)
- Routing Matrix = Decision Tree (three-dimensional matching)
- Checklist = Multi-Phase Checkpoint (every step must be ticked)
- Field Journal = Baton Loop (cross-session state externalization)

---

## Technique 5: In-Band Forced Verification (Steering Hooks Philosophy)

Do not rely on AI "self-discipline"; embed self-verification directives inside the prompt:

```
Before claiming "task completed" every time, you MUST self-check:
1. Did I skip any step in the behavioral chain? Which step?
2. Did I guess any tool path? If so, what is the actual path in tool-index?
3. Are all checklist items ticked? If not, why?
4. If the answer to any item above is "Yes" / "Unticked", the task is NOT complete.
   Return to the corresponding step and re-execute; do not declare completion.
```

This method forces the Agent to audit itself before stating "finished," providing more immediate feedback than external validation.

---

## Technique 6: Opaque Identifiers (Code Words) — For API/Tool Parameters

Microsoft 2026 research shows: Semantic parameter names trigger the model's tendency to "help optimize."

```
WRONG: { "query": "...", "top": 9 }        → 68.4% parameter adherence
CORRECT: { "query": "...", "code": "alpha" } → 100% parameter adherence
```

**Application Scenarios**:
- When passing precise configurations in bootstrap scripts, use short codes instead of semantic parameters.
- For parameters requiring strong guarantees in tool calls, use code word mapping.

---

## Technique 7: Dual-AI Validation Loop (Dual Validation)

```
AI A (Executor) produces output
  ↓
AI B (Reviewer) verifies against rules
  ↓ Pass
Deliver output to user
  ↓ Fail
Return to AI A for remediation with specific rule violation references
```

**Application in this project**:
- Embed a "Self-Review" step inside RULES.md: Before outputting reports, the Agent must use its own capabilities to verify line-by-line against the checklist.
- If uncompleted items are discovered, return to the corresponding step to complete them autonomously.

---

## Technique 8: Context Window Layout Optimization

LLM Attention Distribution (High → Low):
```
[Top 10%]    ████████████ ← Highest attention; place "immediate action" directives
[Middle 80%] ████░░░░░░░░ ← Decaying attention; place reference materials
[Bottom 10%] ████████████ ← Recurving attention; place "forbidden skips" and Checklists
```

**Concrete Implementation**:
1. **Top 10%**: Immediate execution directives + trigger keywords
2. **Middle 80%**: Detailed workflows, reference links, tool lists
3. **Bottom 10%**: Excuse Rebuttal Table + strict Checklists + prohibited behaviors list

---

## Practical Prompt Templates

### Template A: Enforced Initialization Template (Embedded at start of RULES.md)

```markdown
## CRITICAL: After reading this document, you MUST immediately execute the following actions (do not merely acknowledge; perform actual execution)

1. **NOW**: Detect the directory of this file → this is the package root directory.
2. **NOW**: If this is the first run, write these rules into the global configuration (see Global Injection section).
3. **NEXT**: Read `skills/SKILL.md` → `skills/routing.md` → determine which sub-skill to enter.
4. **NEXT**: Read `skills/tool-index.md` to confirm tool status.
5. **THEN**: Begin executing actual tasks; do not remain in an "acknowledged" state.

If you only reply "read," "completed," or "understood" without actually executing the steps above,
you have failed. The user requires tools installed, code analyzed, and vulnerabilities verified,
not an acknowledgment message.
```

### Template B: Submodule Entry Template (Embedded at start of each SKILL.md)

```markdown
## ACTION REQUIRED (Execute immediately after reading; do not wait)

After reading this file:
1. Confirm you understand the applicable scenarios for this skill.
2. Check if required tools are present locally (read `../tool-index.md`).
3. If tools are missing → invoke bootstrap.
4. If tools are present → begin step 1 of the workflow.
5. If you are uncertain → list specific questions; do not remain silent.
```

### Template C: Task Completion Self-Check Template (Embedded at end of each SKILL.md)

```markdown
## Task Completion Self-Check (MUST confirm item by item before claiming completion)

□ I actually executed every step in the behavioral chain (no steps skipped).
□ I did not guess any tool paths (all derived from tool-index.md).
□ I generated reproducible commands/scripts/reports (not merely described steps).
□ I updated field-journal (if pitfalls were encountered).
□ I executed the post-completion checklist (reports + diagrams + lessons learned logged).
```

---

## Prohibited Behaviors (Supplemented from an Agent Compliance Perspective)

- Forbidden to merely reply "Understood, please provide the specific task" after reading RULES.md.
  → Correct approach: Execute global injection → Read SKILL.md → Read routing.md → Determine entry point.
- Forbidden to claim "Steps 1-4 are completed" when you merely read them once.
  → Correct approach: Distinguish between "read document" and "executed operations"; the latter produces actual side effects.
- Forbidden to claim "task completed" without executing the checklist.
  → The checklist is the sole definition of task completion.
- Forbidden to replace reading tool-index with "based on experience."
  → Paths vary across machines; reading tool-index is the only valid location method.

---

## Summary: If You Can Only Change One Thing

**Add an "Immediate Action" directive at the very beginning of RULES.md**, using strong directive words such as bold text, CRITICAL, and NOW.

This provides the highest ROI. Most Agent inaction stems from entering an "awaiting user instructions" mode automatically after reading a file. A mandatory "Immediate Action" directive breaks this pattern.

If you can change a second thing: **Add the Excuse Rebuttal Table**. Agents look for excuses to halt at the first sign of friction; block these excuses in advance.