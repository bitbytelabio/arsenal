---
name: re-pwn-chain
description: End-to-end exploit engineering from binary vulnerability identification to stable delivery.
domain: re
category: exploitation
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-pwn-chain/SKILL.md
---
## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-pwn-chain/support/field-journal/precedent-reverse.md` — confirm that the operations in this skill are authorized routine operations.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Read `tool-index` (workstation tool inventory) to verify tool availability and actual paths.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

# From Vulnerability Point to Working Exploit (Pwn Chain)

## Scope of Application

Use this skill when the task falls into the following scenarios:

1. **You have a binary + a known vulnerability point** — static analysis/auditing/fuzzing has already found the overflow/UAF/double free, and you need to go from triggering it to getting a shell
2. **A CTF challenge works locally but not against the remote** — differences in the remote environment break the script; stabilization is needed
3. **Binary exploitation of a real target** — in an SRC / red team scenario, a memory corruption vulnerability has already been identified and RCE needs to be constructed
4. **ioctl bug in a Linux kernel driver** — triggered from user space, with the goal of privilege escalation to root

**Prerequisite**: You already know "where it crashes." This skill is not responsible for discovering vulnerabilities (that's fuzzing / auditing); it is only responsible for "writing an exploit from the vulnerability point."

### Division of labor with other skills

| Scenario | What to use |
|------|--------|
| Identifying a custom VM / anti-debug / complex obfuscation | `re-reverse-engineering/` |
| Opening a binary from scratch to do static analysis | `re-ida-reverse/` or `re-radare2/` |
| **You have a vulnerability point and need to write an exploit to reach the remote** | **This skill** |
| Integrating the shell obtained from pwn into a complete attack chain | `attack-chain/` (downstream) |

`re-reverse-engineering/` focuses on "understanding what the program is doing" (pattern recognition, protocol recovery, unraveling weird mechanisms in CTF challenges); this skill focuses on "turning an already-understood vulnerability into a workable attack." The two are often used together, but the division of labor is clear.

## Core Workflow

```text
Step 1: Confirm the vulnerability type + mitigations
   ├─ checksec ./vuln (NX / Canary / PIE / RELRO / Fortify)
   ├─ file ./vuln  + readelf -d ./vuln
   ├─ Vulnerability classification: stack overflow / format string / heap (UAF/DF/OF) / integer / race / kernel
   └─ → Decide which references/ to follow

Step 2: Choose the exploitation strategy
   ├─ NX off + no ASLR → direct shellcode
   ├─ NX on + libc provided → ret2libc / one_gadget
   ├─ NX on + no libc provided → leak, then look it up in libc-database
   ├─ Heap → technique matching the glibc version (tcache/fastbin/unsorted/large)
   └─ Kernel → commit_creds / modprobe_path / core_pattern

Step 3: Prepare libc + gadgets
   ├─ libc-database: ./find puts 0x6f0
   ├─ ROPgadget --binary ./libc.so.6 --only "pop|ret"
   ├─ one_gadget ./libc.so.6
   └─ Compute the base: leak_addr - libc.sym['puts']

Step 4: Write the pwntools template (local process)
   ├─ context.binary = ELF('./vuln')
   ├─ p = process('./vuln')  /  p = gdb.debug('./vuln','b *main+xx')
   ├─ payload = cyclic(N) + p64(ret) + ...
   └─ p.interactive()

Step 5: Get it working locally
   ├─ Repeatedly attach + inspect registers + tune the offset
   ├─ Use pwndbg/GEF's vmmap / heap / bins / telescope
   └─ Once it works, switch to remote()

Step 6: Stabilize against the remote
   ├─ libc offset: use the leak to look it up in libc-database; don't guess
   ├─ Stack alignment: not 16-byte aligned → movaps crashes → add a ret gadget
   ├─ Remote network latency → use recvuntil with an exact anchor string; avoid vague sleeps
   ├─ Remote buffering: sendlineafter is more reliable than sendline
   ├─ Heap spray success rate: increase the spray count + leave padding chunks to prevent coalescing
   └─ Run it many times: write a while True loop to verify a success rate ≥ 95%
```

## Typical Scenarios

### Scenario 1: Remote 64-bit binary (NX+PIE+canary, libc provided)

```text
Given: ./vuln (64-bit ELF, NX, PIE, canary) + ./libc.so.6 + nc host port
Vulnerability: read(buf, 0x200) but buf is only 0x40 bytes → stack overflow
Mitigations: canary blocks us, PIE randomizes .text

Strategy:
1. First leak the canary (stack/format string/partial read)
2. Then leak a libc function address (puts@got)
3. Compute the libc base with libc.address = leaked - libc.sym['puts']
4. one_gadget ./libc.so.6 to pick a magic gadget whose constraints can be satisfied
5. payload = padding + canary + saved_rbp + (pop_rdi + bin_sh + system), or one_gadget directly
6. Add a ret gadget to fix stack alignment (critical!)
```

For a complete template, see `skill://re-pwn-chain/references/stack-pwn.md`.

### Scenario 2: Linux kernel driver ioctl out-of-bounds write → get root

```text
Given: vmlinux + bzImage + initramfs.cpio.gz + a custom vuln.ko
Vulnerability: in ioctl(0x1337, ptr), the copy_from_user length is controllable → kernel heap overflow (kmalloc-64 slab)
Mitigations: SMEP, SMAP, KASLR, KPTI

Strategy:
1. Modify the init script to get a root shell (CTF), or first leak the KASLR base and then continue (real target)
2. Leak the kernel base via /proc/kallsyms (may be restricted) or an uninitialized heap spray
3. Spray tty_struct / msg_msg / pipe_buffer into the kmalloc-64 slab
4. Overwrite a vtable pointer to point to user space → not viable (SMEP); switch to stack pivot + kernel ROP
5. ROP chain: prepare_kernel_cred(0) → commit_creds → swapgs+iretq → user-space execve("/bin/sh")
6. Or, more simply: overwrite modprobe_path with "/tmp/x", write a /tmp/x, then trigger modprobe
```

For a complete template, see `skill://re-pwn-chain/references/kernel-pwn.md`.

## On-Demand Bootstrap

### Tool Dependencies

| Tool | Purpose | Installation Method |
|------|------|---------|
| pwntools | exploit development framework | `pip install pwntools` |
| GEF | gdb enhancement (recommended for both kernel and user space) | `git clone https://github.com/bata24/gef` (actively maintained fork) |
| pwndbg | gdb enhancement (best heap debugging experience) | `git clone https://github.com/pwndbg/pwndbg && ./setup.sh` |
| ROPgadget | gadget search | `pip install ropgadget` |
| Ropper | gadget search (alternative, supports many architectures) | `pip install ropper` |
| one_gadget | libc magic gadget finder | `gem install one_gadget` (requires ruby) |
| libc-database | libc fingerprint lookup | `git clone https://github.com/niklasb/libc-database && ./get` |
| qemu-system-x86_64 | kernel challenge debugging | `apt install qemu-system-x86` |
| binwalk / cpio | initramfs unpacking | `apt install binwalk cpio` |
| patchelf | switching libc versions | `apt install patchelf` |

### Bootstrap Check Script

```bash
# One-shot check + install core tools
for t in pwntools ropgadget ropper; do
  pip show $t >/dev/null 2>&1 || pip install $t
done

command -v one_gadget >/dev/null || gem install one_gadget

[ -d ~/tools/libc-database ] || git clone https://github.com/niklasb/libc-database ~/tools/libc-database
[ -d ~/tools/libc-database/db ] || (cd ~/tools/libc-database && ./get ubuntu debian)

[ -d ~/tools/pwndbg ] || (git clone https://github.com/pwndbg/pwndbg ~/tools/pwndbg && cd ~/tools/pwndbg && ./setup.sh)
```

### After a tool's automatic installation fails twice

Stop retrying and output structured manual installation steps (pip source / gem source / domestic git mirror / apt source) for the user to confirm.

## Routing Context

**Upstream Entry**: `skill://re-pwn-chain/support/SKILL.md` (Master Controller), `skill://re-pwn-chain/support/routing.md`
**Trigger Condition**: You have a binary + an identified vulnerability point and need to write an exploit

**Upstream skills (use them first, then return to this skill)**:
- You don't yet understand what the binary is doing → `re-reverse-engineering/`
- You need detailed static analysis → `re-ida-reverse/`
- Quick reconnaissance to confirm architecture/mitigations → `re-radare2/`

**Downstream skill (after you get a shell)**:
- Integrating into a complete attack chain (lateral movement, privilege escalation, persistence) → `attack-chain/`

**Submodule navigation**:
- Stack-based exploitation (ret2libc / ret2csu / one_gadget / stack alignment) → `skill://re-pwn-chain/references/stack-pwn.md`
- Heap-based exploitation (tcache / fastbin / unsorted / large bin / FILE struct) → `skill://re-pwn-chain/references/heap-pwn.md`
- Kernel pwn (kROP / SMEP-SMAP bypass / KASLR leak / modprobe_path) → `skill://re-pwn-chain/references/kernel-pwn.md`

## Important Notes

- **Don't call it done just because it works locally** — the local libc / ASLR / network environment all differ from the remote; you must run 20+ consecutive times in remote mode to verify stability
- **The libc version must be confirmed** — use the leak + libc-database lookup; don't assume it's the default libc of Ubuntu 22.04
- **Stack alignment is a common 64-bit pitfall** — `movaps xmm0, [rsp]` segfaults when rsp isn't 16-byte aligned; add a bare `ret` gadget to fix it
- **Heap exploitation is extremely sensitive to the glibc version** — tcache was introduced in 2.27, safe-linking in 2.32, and hooks were removed in 2.34; the exploitation path differs for each version
- **For kernel pwn you must first confirm the CPU flags** — whether the qemu boot parameters include +smep +smap +pku directly determines how the ROP chain is written
- **One KASLR leak is enough** — once you have one kernel address, compute all other addresses as offsets; don't leak repeatedly

## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
