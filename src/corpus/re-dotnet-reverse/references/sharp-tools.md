# Red Team Sharp* Tool Analysis, Tool Installation Matrix & dnSpy MCP

## Red Team Sharp* Tool Analysis

Red team tools are extensively written in C# (the Sharp* series). Reverse engineering them is a common scenario: understanding detection logic, modifying signatures, and extracting embedded configurations.

### Common Sharp* Tools Quick Reference

| Tool | Functionality | Reverse Engineering Focus |
|------|---------------|---------------------------|
| **Rubeus** | Kerberos attacks (AS-REP roast / Kerberoast / S4U / pass-the-ticket) | Fixed Rubeus project structure; locate `Interop.*` P/Invoke sections to inspect native calls |
| **SharpHound** | BloodHound data collector | LDAP query logic, collected attribute sets |
| **SharpShell / SharpWS** | Remote execution, lateral movement | WMI / WinRM invocations, command obfuscation |
| **Seatbelt** | Information gathering | Collection inventory, evaluation logic |
| **SharpRoast** | Kerberoasting | Ticket request/parsing |
| **Inveigh / SharpSploit** | Man-in-the-Middle / General exploitation framework | Reflective loading, API call chains |

### General Analysis Workflow

```text
1. Open with dnSpyEx (typically unobfuscated; a few teams add ConfuserEx)
2. Inspect Program.Main or entry point command dispatching (Rubeus uses a switch(command) structure)
3. Locate the implementation class/method for the target command
4. Inspect P/Invoke sections (Interop.* namespaces) — native API calls reside here
5. Extract embedded resources (some tools embed configs/templates)
6. If modifying signatures (EDR evasion): modify command strings, API calls, and string constants
```

### Rubeus Structure Example

Rubeus uses command dispatching, assigning one class per subcommand. Locating Kerberoasting logic:

```text
Entry Point: Rubeus.CommandLineParser → parse args
Dispatch: switch(command) → "kerberoast" → execute Ask.TGS(...)
P/Invoke: Rubeus.Interop.Lsa* / Native.cs → native Kerberos API
Key Call: LsaCallAuthenticationPackage (KERB_RETRIEVE_TKT_REQUEST)
```

Modifying signatures (evasion): Change the command string `"kerberoast"` to a custom name, alter the `Rubeus` banner string, and reorder P/Invoke call sequences.

### Embedded Configuration Extraction

Many loaders/tools embed encrypted C2 addresses, keys, and certificates inside resources or fields:

```powershell
# Inspect Resources (Resource Tree) in dnSpyEx
# Or via command line
powershell -c "[System.Reflection.Assembly]::LoadFile('target.exe').GetManifestResourceNames()"
# Once the resource is identified, right-click in dnSpyEx → Extract / Save
```

Configurations decrypted at runtime → Set a dynamic breakpoint at the return point of the decryption method and dump the plaintext (see `common-workflow.md`).

---

## Tool Installation Matrix

### Windows (Preferred; dnSpyEx is a GUI)

```powershell
# Method A: Chocolatey
choco install dnspy ilspy de4dot detect-it-easy

# Method B: Manual release download (Recommended for version control)
# dnSpyEx:    https://github.com/dnSpyEx/dnSpy/releases
# de4dot:     https://github.com/de4dot/de4dot/releases
# ILSpy:      https://github.com/icsharpcode/ILSpy/releases
# DIE:        https://github.com/horsicq/Detect-It-Easy/releases
# dnlib:      dotnet add package dnlib  (NuGet)
```

### Linux / macOS (No dnSpyEx GUI; use CLI)

```bash
# ILSpy CLI decompilation
dotnet tool install -g ilspycmd
ilspycmd target.exe -p -o outdir/         # Decompile to directory

# Cross-platform de4dot (requires mono or dotnet)
# Download the de4dot output .dll from releases and run with dotnet
dotnet de4dot.dll target.exe -o target-clean.exe

# dnlib (scriptable, requires dotnet SDK)
dotnet new console -o dnclean && cd dnclean
dotnet add package dnlib

# DIE CLI (diec)
# Linux: Install from https://github.com/horsicq/Detect-It-Easy
diec target.exe
```

### .NET Runtime Prerequisites

```bash
# Linux
sudo apt install dotnet-runtime-8.0        # Or 6.0/7.0 depending on target
# macOS
brew install --cask dotnet-sdk
```

> dnSpyEx (featuring IL editor + debugger) is Windows GUI only. On Linux/macOS, .NET reverse engineering is limited to `ilspycmd` decompilation + `dnlib` scripted patching, lacking an equivalent interactive debugging GUI. Prioritize Windows when patching is required.

---

## dnSpy MCP Integration

Multiple dnSpy MCP projects exist in the community, exposing dnSpy decompilation/IL inspection as MCP tools for direct invocation by AI — fully aligned with the MCP philosophy of reverse-skill.

### Mainstream dnSpy MCP Projects

| Project | Features | Target Integration |
|---------|----------|--------------------|
| **soufianetahiri/dnspy-mcp** | Core MCP Server exposing tools like decompile and IL inspection | Claude Code / Cursor |
| **AgentSmithers/DnSpy-MCPserver-Extension** | Runs as a dnSpyEx extension, deeply integrated into the GUI | Loaded within dnSpyEx |
| **malwarecakefactory/dnspy-mcp-extension** | 33 tools covering the entire pipeline from triage → deobfuscation | Full-pipeline automation |

### Registering with Claude MCP Configuration

After installing the dnSpyEx extension according to the respective project's README, register it in `~/.claude/mcp.json` (refer to the project README for exact command/args):

```json
{
  "mcpServers": {
    "dnspy": {
      "command": "dotnet",
      "args": ["path/to/dnspy-mcp.dll"]
    }
  }
}
```

After registration, the AI interaction workflow for this skill is: User requests "analyze this .NET binary" → route to `dotnet-reverse/` → prioritize invoking the `dnspy_decompile` / `dnspy_inspect_il` tool interfaces → switch to GUI if that fails.

> dnSpy MCP is not a built-in bootstrap capability of reverse-skill; users must manually install the extension and register it according to the project's README. Consider adding it to `bootstrap-manifest.json` in the future.

---

## Community Resource Index

### Highly Recommended

- **Washi's Blog** — .NET Reverse Engineering Expert: https://blog.washi.dev/posts/misconceptions-about-dotnet/
  - Core Takeaway: **Do not rely overly on dnSpy's C# decompiler; become proficient with the IL editor** (aligned with this project's IL-first principle)
- **dnSpyEx** — Actively maintained fork of dnSpy: https://github.com/dnSpyEx/dnSpy
- **de4dot** — .NET deobfuscator: https://github.com/de4dot/de4dot
- **dnlib** — Metadata manipulation library: https://github.com/dnlib/dnlib

### Practical Tutorials

- Medium "De-obfuscating and reversing a .NET/C# spyware" — dnSpy + de4dot in practice for info-stealer deobfuscation
- YouTube "dnSpy Patch .NET EXEs & DLLs" — Step-by-step patching + keygen tutorial
- Kanxue Forum .NET Reverse Engineering Section — Search for ".net reverse engineering" / "dnSpy" / "ConfuserEx" for numerous practical posts, Nuitka reversing, and AV/EDR evasion discussions
- Guided Hacking "Top 5 .NET Reverse Engineering Tools" — dnSpy still ranks #1
- StackExchange / Reverse Engineering — Advanced topics such as `DynamicMethod` debugging

### Existing .NET Resources in this Repository (Cross-References)

- `reverse-engineering/tools.md` `.NET Analysis` section — dnSpy/ILSpy tool quick reference + Codegate 2013 two-stage XOR+AES-CBC pattern
- `reverse-engineering/field-notes.md` `.NET` section — Tool cheatsheet
- `reverse-engineering/awesome-re-resources.md` — de4dot listed
- `field-journal/seed-014_unity-il2cpp-reverse.md` — Unity IL2CPP (native side, complementary to the .NET managed layer)

In-depth .NET reverse engineering content is consolidated within this module; retain only quick-reference indices inside `reverse-engineering/`.