# Node Environment Reproduction

Default sequence on the Node side:

1. Import target script
2. Apply minimal shim for host objects
3. Run entry function
4. Record the first exception or first divergence
5. Refer back to page evidence to fill the gaps