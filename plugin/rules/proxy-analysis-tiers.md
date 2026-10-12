---
name: proxy-analysis-tiers
description: Route web/API testing to Burp and application reverse engineering to mitmproxy plus focused runtime hooks, with tiered capture, correlation, and verification.
---

# Proxy & Runtime Hook Analysis Tiers

Apply when inspecting application traffic, reconstructing a protocol, correlating network behavior with code, or testing HTTP/API security. Choose the workflow by the investigation objective, not the file extension or tool availability alone.

## Active Harness Execution

- Tiers describe analysis depth and evidence quality, not tool permissions or mandatory sequential phases. Start at the tier that fits the task; replay, scanning, fuzzing, request/response modification, and runtime hooks are available at every tier when relevant to the authorized objective.
- Act within the existing engagement authorization and host approval mode. Do not require tier promotion or repeated confirmation for already-authorized actions.
- Do not invent per-tier capture windows, request-count quotas, or rate/concurrency caps. Capture and exercise the workflows needed to answer the task; honor actual operator-configured limits, host resource constraints, and target stability requirements.

## Tool Selection

- **Web/API security testing — Burp first.** Use Proxy history for discovery and Repeater for authorized, focused request experiments. Use mitmproxy instead when scripted capture, transformation, or reproducible batch processing is the actual requirement.
- **Application reverse engineering — mitmproxy + runtime hooks by default.** Use mitmproxy for the network view and narrowly scoped hooks for the code/data view. Prefer `mitmdump` for agent-driven capture and addons, `mitmweb` for visual inspection, or `mitmproxy` for interactive terminal inspection. This applies to native, mobile, Electron, and JavaScript applications when the objective is understanding implementation behavior.
- **Select the hook by runtime.** Prefer Frida or an existing debugger/instrumentation bridge for native/mobile targets, and an available JavaScript hook/CDP bridge for JavaScript/Electron targets. Inspect actual tool capabilities before choosing commands; a configured bridge is not proof that its runtime is attached or usable.
- **Mixed investigations.** Start with mitmproxy + hooks for reconstruction, then move selected requests to Burp when manual web/API vulnerability validation needs it. A mobile app's API authorization test can start in Burp without an unrelated reverse-engineering phase.
- Keep one primary interception proxy per capture. Do not chain Burp and mitmproxy by default. If chaining is necessary, record the direction, distinct listener addresses, TLS termination points, and loop avoidance before use.
- If the preferred tool is unavailable, record the missing prerequisite and the fallback's limits. Reuse existing captures or another available tool when it answers the question; do not install software or enable MCP servers automatically.
- Apply these objective-based defaults before selecting a leaf playbook; a Burp-specific recipe does not make Burp the default for all mobile reverse engineering. Select a matching playbook rather than blindly translating tool-specific commands.
- The master MUST pass the selected proxy workflow, tier, applicable rule constraints, and capture/attachment scope to delegated specialists, including independent verifiers. The workflow choice does not expand the handoff's authorization.

## Tier 1 — Active Traffic Discovery

**Goal:** Establish a reproducible baseline and actively explore the traffic and behavior relevant to the investigation.

- Reuse existing HAR, Burp history, or mitmproxy flows when useful, and generate fresh traffic when needed. Saved captures do not prove current server behavior.
- Identify the target process/device, endpoints, test account, actions, and output location. Capture the required sessions and workflows rather than restricting discovery to one action or an arbitrary time window. A display filter is not a network authorization boundary.
- Use Burp interception, available scanners/fuzzers, replay, and request/response modification during discovery when they advance the authorized objective. Retain original traffic and label generated or modified requests so the baseline remains distinguishable from active probes.
- For reverse engineering, combine mitmproxy with runtime hooks as soon as traffic/code correlation is useful. Explore request/response shapes, redirects, authentication boundaries, and encoded or encrypted data without waiting for another tier.
- Missing traffic is not evidence that the app made no request. Check routing, proxy bypass, caching, unsupported transports, certificate trust, and pinning. Record unobserved paths explicitly.

## Tier 2 — Focused Correlation (Default for Reverse Engineering)

**Goal:** Explain one behavior by linking a code-level observation to a captured flow.

- Pair the mitmproxy capture with the smallest useful hook set: request construction, serialization, application-layer encryption/decryption boundaries, signing inputs, response parsing, or the relevant application callback. Observe values before changing them; avoid global hooks or indiscriminate secret/key dumping.
- Record the binary/app version, PID/device, hook script and version/hash, function/module or address, and timestamps. Correlate with flow/request identifiers and stable non-secret fields. Timing alone suggests a relationship; it does not prove causality.
- Distinguish serialized input, ciphertext on the wire, decrypted response data, and application interpretation. A TLS proxy does not automatically decode application-layer encryption; a hook observation does not prove the corresponding bytes were sent.
- In Burp-led testing, change one relevant request factor at a time in Repeater, retain the original request/response, and compare the result. Re-sending a captured request is an active action, not passive analysis.
- TLS trust changes and pinning bypass are separate interventions, not automatic setup steps. Use them only within authorized target scope when needed; prefer a test build or isolated device. Do not weaken host-wide trust or disable validation globally. Retain an unmodified baseline and record how instrumentation may change behavior.
- Advance only the claim supported by the correlated evidence. Separate direct observations (`E-*`), hypotheses (`P-*`), and unresolved visibility (`unk-*`).

## Tier 3 — Reproducible Verification

**Goal:** Validate protocol or security claims with reproducible evidence within the authorized target and action scope.

- Preserve the exact mitmproxy addon/hook script, configuration, tool versions, sanitized inputs, capture selectors, and execution parameters needed to reproduce the observation. Apply operator-configured execution limits and adapt to observed resource or target-stability constraints; do not introduce tier-specific quotas.
- Compare a baseline with one controlled variation. For replay, first account for session state, nonces, timestamps, signatures, and server-side mutations; do not infer equivalence from status codes alone.
- Use Burp for focused manual web/API confirmation, or mitmproxy addons plus hooks for repeatable application/protocol experiments. Escalation does not require using both tools.
- Corroborate a reported behavior with both network and runtime evidence when the claim depends on their relationship. State coverage gaps and instrumentation effects; do not label the whole protocol or application understood from one successful path.
- Route candidate security findings through the existing independent verification workflow. A successful capture or replay is not itself a vulnerability.

## Evidence & Cleanup

- Store immutable raw captures and hook logs as access-restricted evidence with hashes. Use redacted derivatives for reports; do not copy credentials, session tokens, personal data, or key material into chat or general logs.
- Stop only the listeners/hooks started for the investigation. Restore any proxy, routing, or target trust changes made by the session, detach hooks, and leave user-owned processes/configuration intact.
- Authorization comes from the engagement and host configuration, not the tier label. Execute relevant in-scope actions without additional rule-imposed approval gates; do not expand target scope or bypass host approval controls.

## Tool References

- [mitmproxy interfaces](https://docs.mitmproxy.org/stable/overview/getting-started/), [addons](https://docs.mitmproxy.org/stable/addons/overview/), and [certificate pinning limits](https://docs.mitmproxy.org/stable/concepts/certificates/).
- [Burp Proxy](https://portswigger.net/burp/documentation/desktop/tools/proxy) and [Repeater](https://portswigger.net/burp/documentation/desktop/tools/repeater).
