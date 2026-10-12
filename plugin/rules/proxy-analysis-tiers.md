---
name: proxy-analysis-tiers
description: Route web/API testing to Burp and application reverse engineering to mitmproxy plus focused runtime hooks, with tiered capture, correlation, and verification.
---

# Proxy & Runtime Hook Analysis Tiers

Apply when inspecting application traffic, reconstructing a protocol, correlating network behavior with code, or testing HTTP/API security. Choose the workflow by the investigation objective, not the file extension or tool availability alone.

## Tool Selection

- **Web/API security testing — Burp first.** Use Proxy history for discovery and Repeater for authorized, focused request experiments. Use mitmproxy instead when scripted capture, transformation, or reproducible batch processing is the actual requirement.
- **Application reverse engineering — mitmproxy + runtime hooks by default.** Use mitmproxy for the network view and narrowly scoped hooks for the code/data view. Prefer `mitmdump` for agent-driven capture and addons, `mitmweb` for visual inspection, or `mitmproxy` for interactive terminal inspection. This applies to native, mobile, Electron, and JavaScript applications when the objective is understanding implementation behavior.
- **Select the hook by runtime.** Prefer Frida or an existing debugger/instrumentation bridge for native/mobile targets, and an available JavaScript hook/CDP bridge for JavaScript/Electron targets. Inspect actual tool capabilities before choosing commands; a configured bridge is not proof that its runtime is attached or usable.
- **Mixed investigations.** Start with mitmproxy + hooks for reconstruction, then move selected requests to Burp when manual web/API vulnerability validation needs it. A mobile app's API authorization test can start in Burp without an unrelated reverse-engineering phase.
- Keep one primary interception proxy per capture. Do not chain Burp and mitmproxy by default. If chaining is necessary, record the direction, distinct listener addresses, TLS termination points, and loop avoidance before use.
- If the preferred tool is unavailable, record the missing prerequisite and the fallback's limits. Reuse existing captures or another available tool when it answers the question; do not install software or enable MCP servers automatically.
- Apply these objective-based defaults before selecting a leaf playbook; a Burp-specific recipe does not make Burp the default for all mobile reverse engineering. Select a matching playbook rather than blindly translating tool-specific commands.
- The master MUST pass the selected proxy workflow, tier, applicable rule constraints, and capture/attachment scope to delegated specialists, including independent verifiers. The workflow choice does not expand the handoff's authorization.

## Tier 1 — Bounded Traffic Triage

**Goal:** Establish a reproducible baseline and identify the smallest unanswered question.

- Inspect existing HAR, Burp history, or mitmproxy flow files before generating new traffic. Saved captures do not prove current server behavior.
- For an authorized live capture, identify the exact target process/device, endpoints, test account, action, capture interval, and output location. Limit capture at the source where possible; a display filter is not a network authorization boundary.
- Keep Burp interception off during observation unless pausing a specific request is necessary. Do not turn on scanning, fuzzing, replay, or request modification as part of triage.
- For reverse engineering, capture one bounded app action with mitmproxy first. Identify request/response shapes, timing, redirects, authentication boundaries, and missing visibility; escalate to the focused hook stage rather than guessing from encrypted or encoded bytes.
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

**Goal:** Validate a bounded protocol or security claim without expanding the authorized target or action.

- Preserve the exact mitmproxy addon/hook script, configuration, tool versions, sanitized inputs, and capture selectors needed to reproduce the observation. Bound automation by target scope, duration, request count, concurrency, and rate.
- Compare a baseline with one controlled variation. For replay, first account for session state, nonces, timestamps, signatures, and server-side mutations; do not infer equivalence from status codes alone.
- Use Burp for focused manual web/API confirmation, or mitmproxy addons plus hooks for repeatable application/protocol experiments. Escalation does not require using both tools.
- Corroborate a reported behavior with both network and runtime evidence when the claim depends on their relationship. State coverage gaps and instrumentation effects; do not label the whole protocol or application understood from one successful path.
- Route candidate security findings through the existing independent verification workflow. A successful capture or replay is not itself a vulnerability.

## Evidence & Cleanup

- Store immutable raw captures and hook logs as access-restricted evidence with hashes. Use redacted derivatives for reports; do not copy credentials, session tokens, personal data, or key material into chat or general logs.
- Stop only the listeners/hooks started for the investigation. Restore any proxy, routing, or target trust changes made by the session, detach hooks, and leave user-owned processes/configuration intact.
- This rule selects workflows; it does not authorize traffic interception, replay, scanning, process attachment, certificate installation, or actions outside the engagement scope.

## Tool References

- [mitmproxy interfaces](https://docs.mitmproxy.org/stable/overview/getting-started/), [addons](https://docs.mitmproxy.org/stable/addons/overview/), and [certificate pinning limits](https://docs.mitmproxy.org/stable/concepts/certificates/).
- [Burp Proxy](https://portswigger.net/burp/documentation/desktop/tools/proxy) and [Repeater](https://portswigger.net/burp/documentation/desktop/tools/repeater).
