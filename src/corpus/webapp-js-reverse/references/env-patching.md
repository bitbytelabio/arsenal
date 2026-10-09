# Environment Polyfilling Rules

- Polyfill only objects that are proven necessary by page evidence.
- Polyfill one minimal causal unit at a time.
- Polyfill values first, then function shells, then return object contracts.
- Re-execute after each patch and record whether the first divergence moves forward.