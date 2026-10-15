# Real depth regression fixtures

Derived from this project's four original sample cards, using local WebGPU model
depth output and the hero layer alpha >=128 as ground truth. No private images.
`generate.py` uses Pillow offline; Node tests use only built-in zlib and byte reads.

Each `cardN.bin.z` is a zlib stream: little-endian RGB565 (width × height × 2
bytes), original alpha (width × height bytes), little-endian uint16 depth (twice
that size, divide by 65535), then binary hero mask (same). Each block uses byte
deltas from the previous pixel in its row (first pixel unchanged). JSON records
dimensions and the original full-resolution audit baseline. RGB565 bounds RGB
error to 4/2/4 levels; alpha, sampled depth and sampled mask stay exact. Each group
is below 300 KB.
Images use BOX reduction, depth and mask use matching NEAREST pixel centers.

Ghost is an audit proxy: hero pixels still assigned to the background (>0.5
membership), plus covered hero pixels whose filled RGB differs from source by
at most 16 in every channel. It is not a visual/browser acceptance verdict.

Regression tests check band membership at stored resolution, then replicate
samples fourfold for ghost measurements: the two-pixel inset should keep the
original audit's spatial scale. Ghosts are asserted against `stats.json` limits.
This approximate fixture check is complemented by a lossless original-size local
audit, which must also remain below those limits.
For a local lossless audit, generate with `--width 1008 --height 1408 --lossless`
into a temporary directory, then run `node tests/ai/depth-audit.mjs --fixtures DIRECTORY`.
To compare exact band pixels with a saved pre-optimization implementation, add
`--before DIRECTORY` (containing `depth-before.ts` and `image-ops-before.ts`).
`--head` additionally compares the committed implementation.

For performance, run `node --expose-gc tests/ai/depth-audit.mjs --bench-only`.
It uses card 2's stored normalized depth as raw input to `depthToImage`, produces
4096×3072 pixels, and requests three bands with opaque patterned source RGB.
This is reproducible without a model or external files; it is different from
the earlier private raw-model benchmark. `--profile` measures each stage by
instrumenting source in memory. Five timed calls follow warmup; version order
alternates and output buffers are released between calls. Total acceptance uses
the uninstrumented median (≤2000 ms), with slowest also reported. The unit test
uses a 6000 ms ceiling solely to tolerate machine contention. Large audit data
and saved implementation snapshots are local scratch files, not committed.
