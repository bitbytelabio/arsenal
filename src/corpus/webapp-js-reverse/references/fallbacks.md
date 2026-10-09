# Fallback Strategy

When no progress is made along the current path, fall back in the following order:

1. Fall back from breakpoints to request inspection
2. Fall back from source code speculation to runtime evidence
3. Fall back from Node environment emulation to in-page evidence collection
4. Fall back from deep deobfuscation to the minimal reproducible execution flow