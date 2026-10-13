# Non-PE / Multi-Format Agent Response Playbook U–AV + AW–DN

> Coexists alongside the PE Anti-Debugging Playbook A–T (`skill://re-reverse-engineering/anti-analysis.md`): Provides "Trigger → One-line Action → Evidence" organized by **file type**.  
> This is **NOT** a secondary master workflow. After identifying the file type via triage, navigate to the corresponding skill + this table.  
> Default scope: **Authorized isolated lab / authorized samples and devices**. For disk wiping, BYOVD, reflective injection, etc., document **detection and forensics**; do not author unauthorized destruction/exploitation tutorials.  
> If bypass or reconstruction fails, Evidence MUST still be recorded; silently assuming "benign" is strictly prohibited.
>
> §1–§8 / U–AV = Original rules (Issue #65). §9–§23 / AW–DN = Extended rules (Issue #87, deduplicated + semantically enhanced + edge-case patches).

## 0. Quick Routing Reference

| Type Indicator | Primary Skill | Chapter in This Table |
|----------------|---------------|-----------------------|
| .bat / .cmd / Batch scripts | malware-analysis | §1, §19 |
| .ps1 / PowerShell | malware-analysis | §2, §20 |
| Office Macros / VBA / XLM / .docm / .xlsm | malware-analysis | §3 (incl. DD OLE extraction, DJ XLM macros) |
| .docx / .xlsx / .pptx OOXML external links / DDE / .rtf OLE | malware-analysis | §10 (incl. DK RTF) |
| Web / Frontend JS Obfuscation, JSVMP | js-reverse | §4, §21 (incl. DE/DF) |
| .sys / Kernel Drivers | reverse-engineering/kernel-driver-reverse.md + cre | §5 |
| .dll specific focus | malware-analysis / re-agent-workflow | §6 (deduplicated against A–T) |
| APK / Magisk / Hidden Icons | apk-reverse | §7–§8, §23 |
| .pdf / PDF Documents | malware-analysis | §9 |
| .wasm / WebAssembly | reverse-engineering | §11 |
| .jar / .class / Java Bytecode | reverse-engineering | §12 |
| .exe(AutoIt) / .au3 | malware-analysis | §13 |
| .hta / HTML Application | malware-analysis | §14 |
| .wsf / .jse / .vbe | malware-analysis | §15 |
| .msi / Windows Installer | malware-analysis | §16 |
| .reg / Registry Scripts | malware-analysis | §17 |
| .vbs / VBScript | malware-analysis | §18 |
| Xposed / LSPosed Modules | apk-reverse | §22 |
| ELF / Linux Binaries | reverse-engineering | → elf-analysis.md, anti-analysis.md |
| Mach-O / macOS/iOS | reverse-engineering | → platforms.md |
| Python Bytecode | reverse-engineering | → languages.md |

## 1. BAT/CMD (U V W)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **U** | Excessive SET single-character variables + %a%%b% concatenation, or ^ line continuations breaking commands | Expand SET lines iteratively; reconstruct command list; batch deobfuscation tools allowed; treating as "no action" without reconstruction is **strictly prohibited** | E-batch-deobf | P0 |
| **V** | Text opens as garbled characters, HEX header is FF FE (UTF-16 LE BOM) | Confirm BOM → convert to UTF-8 before parsing; or use `chcp 65001` + `type` | E-batch-encoding | P2 |
| **W** | Excessive REM/::, redundant GOTO/labels obscuring real logic | Strip comments; trace actual GOTO execution paths; execute in isolation to capture actual cmd command logs | E-batch-deadcode | P1 |

## 2. PowerShell (X Z)

> Numbering retains the author's original convention: **No patch Y**.

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **X** | Multi-layer FromBase64String / Gzip / Compress / nested -replace | Decode **layer by layer**; record results of each layer separately; optional tools (PowerDecode, etc.), otherwise manually or via script | E-ps-decode-layer-N | P0 |
| **Z** | Reversed strings, fragmentation + concatenation followed by Invoke-Expression/IEX | Reconstruct full string; set breakpoints on IEX or inspect script block logs; log plaintext commands into Evidence | E-ps-string-restore | P1 |

## 3. VBA Macros / XLM (AA AB AC DD DJ)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AA** | olevba/OLEDump shows only P-Code, source code stream is empty (VBA Stomping) | Use P-Code decompilation tools; if incomplete, debug via Word/Excel macro debugger; clearly document limitations | E-vba-pcode | P0 |
| **AB** | Extensive Chr() concatenation or Base64 strings, suspected shellcode/nested script | Reconstruct strings via Immediate Window/script; determine payload type post-decoding; dynamically monitor CreateObject/Shell | E-vba-str-decode | P1 |
| **AC** | Meaningless `If 1=2`, or InsertLines/DeleteLines self-modification | Statically follow true execution branch; set dynamic breakpoints on self-modification APIs and dump modified macro | E-vba-selfmod | P2 |
| **DD** | olevba/oledump detects VBA macro project (vbaProject.bin); file extensions: .docm/.xlsm/.pptm | Check OLE stream structure via oledump.py; extract VBA source code via olevba to inspect suspicious APIs; inspect auto-execution macros like AutoOpen/Workbook_Open | E-office-vba | P0 |
| **DJ** | .xls/.xlsm contains Excel 4.0/XLM macros (hidden within cell formulas, not VBA streams); olevba detects XLM macro indicators | Extract XLM macro formulas via `olevba --xlm`; inspect EXEC/CALL/REGISTER functions in hidden worksheets; reconstruct via XLMMacroDeobfuscator dynamic emulation | E-office-xlm | P0 |

## 4. JavaScript (AD AE AF) → Primary Path: js-reverse

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AD** | Custom bytecode array + while/switch interpreter (JSVMP) | Locate VM entry point and opcode dispatcher; trace dynamic execution logs; dual-track AST + dynamic analysis; refer to js-reverse DeepDive | E-js-vmp | P0 |
| **AE** | while(1){switch} + large string array lookups | Refactor via AST/Babel; resolve strings from array indices; optional tools like wakaru; **do not** paste entire PE ollvm-deobfuscation texts | E-js-deobf | P0 |
| **AF** | debugger statements, console hijacking, performance.now discrepancy, DevTools detection | Disable breakpoints / mock fixed time sources / use headless browser; patch detection routines; restrict to authorized pages | E-js-anti-debug | P1 |

## 5. SYS Kernel Drivers (AG AH AI)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AG** | DriverEntry is very short, logic is not located in entry point | Scan MajorFunction[] non-empty slots; prioritize IRP_MJ_DEVICE_CONTROL/CREATE; record address list in Evidence | E-driver-irp-handlers | P0 |
| **AH** | Presence of DeviceIoControl / IOCTL dispatching | Build control code → dispatch handler table; annotate METHOD_* and buffering direction; map user-mode communication surface | E-driver-ioctl | P0 |
| **AI** | Sample loads/drops known vulnerable drivers or abnormally signed drivers (BYOVD pattern) | Correlate against **public** lists such as LOLDrivers; record driver name/hash/signature; analyze **invocation intent**; **do not** elaborate exploit steps | E-driver-byovd | P1 |

For detailed procedures, refer to `skill://re-reverse-engineering/platforms.md`; this table only provides agent action anchors.

## 6. DLL (AJ–AQ) — Deduplicated with A–T / #72

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AJ** | DLL analysis only inspected exports/EP, ignoring TLS or DllMain | **Both TLS callbacks + DllMain MUST be analyzed**; dynamic breakpoint sequence still follows the four-stage rocket (TLS → EP/DllMain → API → ExitProcess) | E-dll-tls-dllmain | P0 |
| **AK** | Export names appear benign initially then malicious, spoofed names, or exports mismatch behavior | Cross-reference export table against actual invocations; document anomalous export list | E-exports-anomaly | P0 |
| **AL** | No exports or minimal exports, yet still loaded | Locate execution logic via entry point, strings, xrefs, and callers; do not abandon analysis due to "no exports" | E-dll-noexport | P0 |
| **AM** | Static IAT lacks DLL, loaded only at runtime | **See A–T Patch R** (Delay-Load / E-delay-import); long-form text is not duplicated here | E-delay-import | P0 pointer |
| **AN** | Need to reconstruct export function parameters and calling conventions | Cross-references + inspect registers/stack dynamically; annotate stdcall/fastcall, etc. | E-dll-export-abi | P1 |
| **AO** | Suspected DLL hijacking / side-loading | Inspect application directory for matching DLL names, search paths, KnownDLLs; document legitimate binary + anomalous DLL combination | E-dll-sideload | P1 |
| **AP** | Fileless mapping / reflective loading indicators | Memory signatures, loader behaviors, pathless modules; forensic analysis in authorized environments | E-dll-reflective | P1 |
| **AQ** | Downranking risk solely because export names "do not appear malicious" | Determining safety based solely on export names is **strictly prohibited**; correlate with section permissions, entry point, strings, dynamic behavior | E-dll-export-priority | P1 |

DLL/SYS hard gates remain: E-imports + E-exports (refer to `re-agent-workflow`).

## 7. Android Device Wiping / Persistence (AR AS AT) → apk-reverse

> **Authorized samples, images, or test devices only.** Actions are detection, IOC extraction, and persistence path mapping, not executing destructive behavior.

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AR** | Magisk module/script containing **wiping signature commands** such as database deletion, flashing, bulk rm of system partitions | Signature command list + module path; flag high-risk destructive capability; do NOT execute wiping commands | E-android-wiper-cmd | P0 |
| **AS** | Infinite loop curl\|sh / remote script pulling, anomalous C2 URLs | Extract URLs; analyze downloaded payload for wiping commands; record temporary paths | E-android-wiper-backdoor | P0 |
| **AT** | /data/adb/service.d, post-fs-data.d, suspicious /system/priv-app, etc. | List persistence scripts/APKs; record content summaries in evidence | E-android-persistence | P1 |

## 8. Android Transparent / Hidden Icons (AU AV) → apk-reverse

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AU** | LAUNCHER icon fully transparent/empty label, Theme.NoDisplay, missing LAUNCHER category, component disabled | aapt dump badging + manifest; decompile to check icon pixels; record anomalies in evidence | E-android-hidden-icon-manifest | P0 |
| **AV** | Installed but no desktop icon, background traffic/autostart/high-risk permissions/dynamic icon restoration | pm list vs desktop; dumpsys package; broadcasts and device_admin; record behaviors in evidence | E-android-hidden-icon-behavior | P1 |

---

> **§9–§23 below are Issue #87 extended rules (AW–DC).**
> Sections duplicating existing files for ELF (→ elf-analysis.md), Mach-O (→ platforms.md), and Python (→ languages.md) have been removed.

## 9. PDF Malicious Documents (AW AX AY AZ)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **AW** | pdfid detects /JS, /JavaScript, /OpenAction, /AA, /Launch count >0 (including obfuscated counts with hex-encoded names such as /4A#61#76#61...) | pdfid -e statistics (compare plain vs obfuscated counts); extract suspicious objects with pdf-parser; peepdf interactive analysis + JS emulation | E-pdf-autoaction | P0 |
| **AX** | pdfid detects /EmbeddedFile >0; object streams contain FlateDecode/ASCIIHexDecode cascaded filter chains; or encoded payloads hidden within /Annot objects | Extract stream data with pdf-parser; decode multi-layer cascaded filters with peepdf (including AES-encrypted streams with security handler r5/r6); inspect Annotation objects; identify decoded result type using file command | E-pdf-embedded | P0 |
| **AY** | Extracted PDF JS contains heavy use of eval, unescape, String.fromCharCode, atob | Trace execution in peepdf JS emulation environment; decode Base64/Hex/ROT13 layer by layer; assist with CyberChef | E-pdf-js-deobf | P1 |
| **AZ** | PDF structural anomalies: /JBIG2Decode, manipulated XREF table, skipping object numbers | Rename suspicious keywords using pdfid -d; check for known CVE exploit patterns; extract exploit trigger conditions | E-pdf-exploit | P1 |

## 10. Office OOXML / DDE / RTF (BA BB DK) → Complementary to §3 VBA

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BA** | After docx/xlsx/pptx ZIP extraction, word/_rels/ or xl/_rels/ contains suspicious external relationships (including remote template injection) | Check external links in *.rels; inspect vbaData.xml; extract embedded OLE objects; check protocol handler abuse (ms-msdt: / search-ms: / ms-officecmd:) | E-office-ooxml | P0 |
| **BB** | Document contains DDEAUTO or DDEEXEC field codes that execute external commands via fields | Scan with olevba --dde; extract DDE command parameters; check if pointing to PowerShell/external executables | E-office-dde | P0 |
| **DK** | .rtf file contains embedded OLE objects (non-OOXML, non-classic OLE compound documents) | Extract embedded OLE objects using rtfobj; analyze object types with oleobj; check Equation Editor exploits (CVE-2017-11882, etc.); identify extracted payload type using file command | E-rtf-ole | P0 |

## 11. WebAssembly (BC BD BE)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BC** | File begins with \x00asm magic bytes; or JS code contains WebAssembly instantiation logic | Convert to text using wasm2wat; inspect import section to identify host environment imported functions; generate pseudo-code with wasm-decompile; check Emscripten glue signatures (__wasm_call_ctors) to determine if compiled from JS | E-wasm-struct | P0 |
| **BD** | High count of WASM functions with simple logic, function bodies broken down into micro-functions; or meaningless block/loop nesting present | Evaluate function minimization level using diswasm; perform in-depth analysis via JEB Pro / IDA WASM plugin; dynamically trace execution logs | E-wasm-obfuscation | P1 |
| **BE** | WASM module interacts with the browser via JS import/export functions, with WebSocket, fetch, WebGL invocations present | Simultaneously analyze JS glue code and WASM module; trace data exchanges using browser DevTools; extract network communication URLs/domains | E-wasm-c2 | P1 |

## 12. Java JAR/Class (BF BG BH BI)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BF** | When opened with JD-GUI/jadx, class/method names are meaningless short strings (a.a.a / _0x prefix / numeric class names); or heavy while/switch control flow obfuscation is present | Identify obfuscator type (ProGuard / Allatori / ZKM); static deobfuscation with Java Deobfuscator; dynamically debug and trace key logic when heavily obfuscated | E-java-obfuscation | P0 |
| **BG** | Heavy use of Class.forName(), Method.invoke(), Constructor.newInstance(); or custom ClassLoader + defineClass() loading classes into memory from byte arrays; import table benign but malicious classes loaded dynamically at runtime | Inspect reflection call details via javap -c -v; trace Class.forName argument strings; inspect source of byte array in defineClass(); dynamically set breakpoints on Method.invoke | E-java-reflection | P0 |
| **BH** | JAR contains .so (Linux/Android) or .dll (Windows); or System.loadLibrary() invocations | Extract native library files; identify format using file command; transition to independent ELF/PE analysis workflow | E-java-native | P1 |
| **BI** | After JAR/ZIP extraction, contains nested JAR/WAR/EAR; high-entropy .dat/.bin/.img files exist in /resources, /assets | Recursively unpack all nested archives; perform entropy analysis to determine encryption/compression; inspect META-INF/MANIFEST.MF and pom.xml | E-java-nested | P1 |

## 13. AutoIt (BJ BK BL DM)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BJ** | PE strings contain AutoIt / AU3 / EA05 / EA06 signatures; or resource section contains AutoIt script resources (distinguish from AutoHotKey, which shares MITRE T1059.010) | Extract compiled script using autoit-ripper; identify encoding family (EA05 = AutoIt3.00 / EA06 = AutoIt3.26); for EA06, extract 8-byte decryption key after the header to decrypt payload; reconstruct source code | E-autoit-extract | P0 |
| **BK** | Extracted script contains heavy use of StringEncrypt/_StringEncrypt; or Execute dynamic execution + meaningless variable names | Static decompilation with myAutToExe; identify anti-debugging techniques; analyze obfuscated control flow | E-autoit-deobf | P1 |
| **BL** | Script contains RegWrite (registry persistence), FileInstall (file dropping), InetGet (network downloading), Run/RunWait | Flag sensitive API call sequences; analyze InetGet URLs; trace FileInstall drop paths | E-autoit-malicious | P0 |
| **DM** | AutoIt acts as loader performing process hollowing: CallWindowProc/EnumWindows callback + shellcode + injection into legitimate processes (regsvcs.exe, etc.), dropping .NET payloads (DarkGate / Snake Keylogger / ArechClient2 pattern) | Inspect DllCall/DllCallbackRegister call chain to kernel32 injection APIs; extract shellcode data; identify injected target process; extract .NET payload for independent analysis | E-autoit-hollowing | P0 |

## 14. HTA / HTML Application (BM BN BO)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BM** | HTML contains HTA:APPLICATION tag, window.execScript, or CreateObject calls | Check HTA:APPLICATION attributes (Application, WindowState); extract VBS/JS within script tags | E-hta-bypass | P0 |
| **BN** | HTA launched via mshta.exe uses XMLHttpRequest / ActiveXObject to pull remote Payload for execution | Extract network request URLs; trace ActiveXObject creation (ADODB.Stream, etc.); reconstruct complete download-and-execute chain | E-hta-download-chain | P0 |
| **BO** | HTA contains only a single extremely long obfuscated string, executed via eval / execScript | Extract and decode Base64/Hex encoded payload; recursively detect encoding types using CyberChef; reconstruct payload | E-hta-oneline | P1 |

## 15. WSF / JSE / VBE (BP BQ BR BS)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BP** | .wsf containing \<job\> + \<script language="..."\> tags, mixing JScript/VBScript/Python | Split code blocks by \<script language\>; analyze each block according to the corresponding language rules | E-wsf-multi | P0 |
| **BQ** | .jse/.vbe starting with #@~^ signature, encoded with Microsoft Script Encoder | Decode using screnc-decoder; if tools are unavailable, perform dynamic execution + dump decoded script | E-jse-decode | P0 |
| **BR** | WSF with multiple \<script\> blocks + \<package\> referencing external resources + \<component\> referencing COM components | Establish cross-block call graph; trace function calls across \<script\> blocks; reconstruct complete execution flow | E-wsf-call-chain | P1 |
| **BS** | WSF containing WshShell.SendKeys to bypass UAC, WshShell.Run with 0 window for hiding, WScript.Sleep for delay evasion | Check whether simulated user interactions are used to bypass security prompts; record stealth execution parameters | E-wsf-anti-detect | P1 |

## 16. MSI Installers (BT BU BV)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BT** | MSI file containing CustomAction table (Binary / Script / DLL custom action types) | Extract contents via msiexec /a or lessmsi; inspect CustomAction table; extract custom action binaries | E-msi-custom-action | P0 |
| **BU** | MSI Binary table containing VBScript/JScript custom action scripts | Extract script binaries from the Binary table and decode into readable scripts; analyze according to VBS/JS rules | E-msi-script | P1 |
| **BV** | MSI silent installation via /quiet /passive /qn; privilege escalation via ALLUSERS=1 | Record installation command-line arguments; analyze Property table privilege configurations; flag silent + privilege escalation combinations | E-msi-privilege | P1 |

## 17. REG Registry Scripts (BW BX BY)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BW** | .reg writing to autorun paths such as HKCU\...\Run or HKLM\...\Run | Extract all paths; flag Run path entries as persistence; record full paths and values | E-reg-persistence | P0 |
| **BX** | .reg modifying HKCR\...\shell\open\command (file association) or HKCR\CLSID\{...}\InprocServer32 (DLL injection) | Check whether shell\open\command points to an unconventional executable; inspect InprocServer32 DLL paths | E-reg-hijack | P0 |
| **BY** | .reg modifying HKLM\...\Policies\System (UAC level), EnableLUA, ConsentPromptBehaviorAdmin | Check default security configurations prior to modification; analyze impact on UAC; flag downgrade behaviors | E-reg-uac-bypass | P1 |

## 18. VBScript (BZ CA CB CC DN)

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **BZ** | .vbs/.js parsed concurrently by VBScript and JScript; conditional compilation (@_win32) or cross-language execution features | Separate VBScript/JScript code blocks; parse syntax independently; identify hybrid execution logic | E-vbs-mixed | P1 |
| **CA** | Script containing CreateObject("WScript.Shell") / CreateObject("Shell.Application") / Scripting.FileSystemObject | Flag high-risk COM object calls; trace Run/Exec parameters; trace file paths created via FSO | E-vbs-com-abuse | P0 |
| **CB** | Script starting with #@~^ signature, encoded with Microsoft Script Encoder (VBS exclusive) | Decode using screnc-decoder; if tools are unavailable, perform dynamic execution + dump decoded script | E-vbs-encoded | P0 |
| **CC** | VBA/VBScript containing WScript.Shell.Run + cmd /c + PowerShell, followed by process injection | Trace CreateObject COM object chain; analyze injection patterns in Run parameters; record complete process creation chain | E-vbs-inject-chain | P0 |
| **DN** | VBScript/JScript achieving fileless persistence via WMI ActiveScriptEventConsumer (no startup folder/registry Run keys) | Inspect WMI event subscriptions (__EventFilter + __FilterToConsumerBinding + ActiveScriptEventConsumer); extract bound script content; flag fileless persistence | E-vbs-wmi-persist | P0 |

## 19. Advanced BAT/CMD Obfuscation (CD–CI) → Complementary to §1 U–W

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **CD** | setlocal enabledelayedexpansion + !var! + dynamic variable names (!var_%i%!) | Expand statement by statement after enabling delayed expansion; automatically expand via Batch-Dump --expand | E-bat-delayed-expand | P0 |
| **CE** | Reading self or external file's :stream alternate data stream (ADS) for execution via type/more/findstr | Check colon-suffixed references (file.bat:payload); list ADS with dir /r; extract via type file:stream | E-bat-ads-hidden | P0 |
| **CF** | Massive echo commands writing line-by-line to .tmp/.cmd temporary files followed by call execution | Extract all echo redirections to restore temporary file contents; monitor scripts generated in temporary directories | E-bat-temp-gen | P1 |
| **CG** | Variable accumulation via for %%i in (...) do set var=%%i; parsing command output line-by-line via for /f | Expand for loops statement by statement to record assignments per iteration; serialize and reconstruct for /f results | E-bat-for-expand | P1 |
| **CH** | Primary batch file receiving arguments via %1 %*, with obfuscated commands passed by parent process/downloader | Inspect invocation context to record passed arguments; decode and reconstruct Base64 arguments; recover full call chain | E-bat-param-call | P1 |
| **CI** | Decoding and execution using combinations of certutil -decode / powershell -Command / echo \| findstr | Extract Base64/Hex strings and decode; verify whether decoded output is an executable script/PE | E-bat-encoded-exec | P0 |

## 20. Advanced PowerShell Bypasses (CJ–CO, DL) → Complementary to §2 X–Z

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **CJ** | AMSI bypasses via [Ref].Assembly.GetType('...AmsiUtils') / amsiInitFailed / GetTypes(), etc. (including hardware breakpoint bypasses: CPU debug registers without memory writes/VirtualProtect) | Identify bypass patterns (Patch / Registry / Environment Variable / Hardware Breakpoint); dynamically verify effectiveness; flag bypass technique type | E-ps-amsi | P0 |
| **CK** | CLM bypass via [PSConstraintLanguage] type manipulation or modifying session state through DefaultRunspace | Identify CLM bypass patterns; flag bypass-clm; analyze post-bypass execution context | E-ps-clm-bypass | P0 |
| **CL** | [ScriptBlock]::Create / $ExecutionContext.InvokeCommand constructors; or overriding ScriptBlock logging configurations | Check whether script disables logging; dynamically verify whether logging is bypassed | E-ps-sb-log-bypass | P1 |
| **CM** | Fileless execution via IEX (New-Object Net.WebClient).DownloadString(...) or [Reflection.Assembly]::Load(FromBase64...) | Extract download URL and verify domain/IP reputation; capture in-memory loaded code via PS logs; isolate network simulation to extract payload | E-ps-reflect-load | P0 |
| **CN** | Nested encoding beyond three layers: outer Base64 → Gzip → XOR → plaintext (exceeding the two-layer scope in §2 X) | Recursively decode to plaintext or until termination; record intermediate states per layer; automate via PowerDecode; add results per layer into evidence | E-ps-multi-decode | P0 |
| **CO** | Set-Alias mapping IEX to single-character aliases; dynamic variable value retrieval via Get-ChildItem variable: | Expand all alias mappings and restore original command names; reconstruct variables using AST analysis | E-ps-alias-decode | P1 |
| **DL** | Script containing ntdll.dll EtwEventWrite patching (stomping) to silence telemetry; frequently combined with AMSI bypasses | Check for EtwEventWrite address acquisition + memory patching (ret 0xC3); inspect concurrently with CJ AMSI bypass; flag dual bypass combination | E-ps-etw-bypass | P0 |

## 21. Advanced JavaScript Obfuscation (CP CQ DE DF) → Complementary to §4 AD–AF

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **CP** | JS using Proxy objects to intercept property accesses + Reflect API to dynamically invoke methods to evade static analysis | Identify Proxy get/set/apply traps; trace actual targets of Reflect.get; flag dynamic interception behavior | E-js-proxy | P1 |
| **CQ** | JS containing _0x... hex string arrays + while(!![]) infinite loops + for+switch control flow (obfuscator.io signatures) | Identify obfuscator.io signatures (string arrays + infinite loops); deobfuscate automatically via de4js / jsnice; add deobfuscated code to evidence | E-js-obfuscator | P0 |
| **DE** | Main JS payload structured as large bytecode array + VM interpreter loop (multiple while/switch), with entry point pointing to eval/Function constructor; business logic entirely unreadable (deepening of §4 AD) | Identify VM entry function and trace opcode-to-handler mappings; dynamically execute in browser hooking eval output; reconstruct AST using JSimplifier; record opcode mapping table | E-jsvmp-deep | P0 |
| **DF** | JS containing eval dynamically generating new code and executing immediately, document.write rewriting the page, or Function constructor dynamically assembling function bodies | Hook eval and Function constructors to record generated code; dynamically execute in browser to capture self-modifying content | E-js-selfmod | P1 |

## 22. Xposed/LSPosed Module Analysis (CR–CX) → apk-reverse

> Analyze the Xposed/LSPosed **module itself** as the reverse engineering target (non-tool usage scenario).

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **CR** | AndroidManifest.xml contains no android:name entry Activity; meta-data specifies xposedmodule=true | Inspect assets/xposed_init to determine the entry class; search for IXposedHookLoadPackage/ZygoteInit/CmdInit interface implementations | E-xp-entry | P0 |
| **CS** | Code contains XposedHelpers.findAndHookMethod / XposedBridge.hookMethod / findClass | Extract the first parameter (target class) + second parameter (target method) of findAndHookMethod; build a target application inventory | E-xp-hook-targets | P0 |
| **CT** | Module contains DexClassLoader/PathClassLoader dynamic loading; or Runtime.exec / ProcessBuilder command execution | Trace DexClassLoader constructor parameters; extract dynamically loaded DEX for independent analysis; inspect exec command parameters | E-xp-dynamic-load | P0 |
| **CU** | Hook targets involve payment/biometrics/SMS/contacts/location/cryptographic keys and other sensitive APIs | Categorize Hook target classes/methods by sensitivity; tag payment/biometrics/SMS & contacts classes; summarize threat levels | E-xp-sensitive-hooks | P0 |
| **CV** | Code contains XposedBridge detection evasion / Zygote injection trace clearing / custom network communications | Inspect stacktrace modification / XposedBridge class reference clearing; inspect independent network requests (OkHttp/Socket); identify C2 targets | E-xp-anti-detection | P1 |
| **CW** | Code contains dynamic Resources replacement / View drawing interception / AccessibilityService declaration | Inspect AssetManager replacement / Resources.updateConfiguration; inspect AccessibilityService configuration; identify UI hijacking | E-xp-ui-hijack | P1 |
| **CX** | AndroidManifest.xml declares lsposed xposedscope meta-data; or code contains package name whitelist checks | Parse xposedscope target application scope; check for dynamic whitelist bypasses (modifying scope via reflection); identify unauthorized global Hook escalation | E-xp-scope-bypass | P1 |

## 23. In-Depth Magisk Module Analysis (CY–DC, DG–DI) → Complementary to §7 AR–AT

> §7 focuses on device bricking/destructive behavior. This section covers non-destructive but suspicious module behavior: installation script analysis, dropped files, Zygisk injection, anti-detection, persistence, privilege escalation, and cross-infection.

| ID | Trigger | Action (Summary) | Evidence | Priority |
|----|---------|------------------|----------|----------|
| **DG** | Magisk module ZIP root contains config.sh / install.sh; META-INF/com/google/android/update-binary is a non-standard installer | Extract on_install/print_modname/set_permissions functions from config.sh/install.sh; check whether update-binary contains extra payloads; flag pm install / dd block devices / mount -o remount,rw operations | E-mg-install-script | P0 |
| **DH** | ZIP contains system/ / vendor/ / data/ directory structures; or post-fs-data.sh / service.sh boot execution scripts | Extract dropped file paths to identify whether APKs are dropped to /system/priv-app/; inspect service.sh + post-fs-data.sh content to identify boot auto-start/background keep-alive/C2 communication; flag all operations writing to system partitions | E-mg-file-drop | P0 |
| **CY** | Module contains zygisk/ directory (arm64-v8a.so and other native libraries); or config.sh declares IS_ZYGISK=true | Extract zygisk/ native libraries to analyze ZygiskModule callbacks (onLoad / preAppSpecialize / postAppSpecialize); inspect JNI Hooks | E-mg-zygisk | P0 |
| **DI** | Module script writes to /data/adb/service.d/ or /data/adb/post-fs-data.d/; or modifies crontab/init.rc (deep dive of §7 AT) | Extract script content written to service.d + post-fs-data.d; check logic for automatically infecting other modules during uninstallation (post-uninstall.sh / module directory monitoring); check protection mechanisms triggered by magisk --remove-modules | E-mg-persistence | P0 |
| **CZ** | Module script contains resetprop system property modifications / magiskhide / DenyList; or integrates Shamiko (hides Zygisk itself) / TrickyStore (tampers with certificate chains) / PlayIntegrityFork (spoofs Play Integrity API) | Extract all resetprop calls to identify modified properties (ro.debuggable / ro.build.tags, etc.); check DenyList self-hiding; identify Shamiko/TrickyStore/PlayIntegrityFork module-level anti-detection | E-mg-anti-detect | P0 |
| **DA** | Module script contains setenforce 0 / mount -o rw,remount /system / chmod 777 sensitive directories | Inspect SELinux operations (setenforce/chcon/restorecon); inspect system partition remounts + dm-verity disabling; flag high-risk privilege escalation | E-mg-privilege | P0 |
| **DB** | Dropped APK/script contains curl/wget/HTTP client; or dropped APK requests sensitive permissions such as INTERNET + READ_CONTACTS/SMS | Extract target URLs/IPs of network requests; analyze permission declarations of dropped APKs; identify data exfiltration logic | E-mg-c2 | P0 |
| **DC** | Script traverses /data/adb/modules/ directory, modifies files of other modules, or writes copies of itself to other modules | Check for malicious command injection into module.prop; check for malicious code appending to service.sh of other modules; identify "parasitic" logic | E-mg-cross-infect | P0 |

---

## 24. Constraints (Global)

1. **Do not run parallel to the main flow**: Stage gates are still subject to re-agent-workflow / individual skills.  
2. **Evidence must be recorded**: Includes failures, partial restorations, and quality= annotations.  
3. **Deduplication against A–T**: PE anti-debugging is not duplicated; AM→R; AJ complements DLL perspective without overturning TLS rocket.  
4. **Missing tools**: Record as n/a + manual equivalent; do not pretend commercial suites were used.  
5. **Authorization**: Destructive/injection/driver vulnerability types are restricted to defensive analysis and forensic statements only.  
6. **Extension rules deduplication**: ELF → elf-analysis.md; Mach-O → platforms.md; Python → languages.md. This table does not duplicate rules for these formats.

## 25. P0 Minimum Checklist (When Type Matches)

```text
□ bat/cmd → U (+ V/W if needed; Advanced CD–CI)
□ ps1 → X (+ Z; Advanced CJ–CO + DL ETW)
□ vba/xlm → AA + DD + DJ (+ AB/AC)
□ office ooxml/rtf → BA + DK (+ BB if DDE is suspected)
□ js heavy obfuscation → AD or AE (+ AF; Advanced CP/CQ/DE/DF)
□ sys → AG + AH (+ AI if BYOVD is suspected)
□ dll → AJ + AK/AL; Delay-Load routes to R
□ apk destructive/hiding → AR/AS or AU (+ AT/AV)
□ pdf → AW + AX (+ AY/AZ)
□ wasm → BC (+ BD/BE)
□ jar/class → BF + BG (+ BH/BI)
□ autoit → BJ + BL + DM (+ BK)
□ hta → BM + BN (+ BO)
□ wsf/jse/vbe → BP + BQ (+ BR/BS)
□ msi → BT (+ BU/BV)
□ reg → BW + BX (+ BY)
□ vbs → CA + CB + CC + DN (+ BZ)
□ xposed module → CR + CS + CT + CU (+ CV–CX)
□ magisk deep-dive → DG + DH + CY + DI + CZ + DA (+ DB/DC)
```