# Local Reproduction

Confirm the following on the page side before switching back to Node:

- Actual entry function
- Invocation order
- Parameter sources
- Dependent browser objects
- Dependencies on time, random numbers, storage, cookies, UA, canvas, crypto

Start with a minimal reproduction, then incrementally polyfill the environment; do not attempt to simulate the entire browser all at once.