# Reproduce the engine audit

The tools run directly against Three.js source. Candidate source transforms are applied in isolated browser route responses or temporary Node modules. They do not overwrite src, build, package.json or a consuming application.

## CPU and regression probes

Use Node 26 or another compatible modern Node release. From the separate Three.js repository:

```sh
RUN_DIR="$(mktemp -d /private/tmp/threejs-engine-repro.XXXXXXXX)"

node audit/engine-r187/tools/cpu-audit.mjs \
  . "$RUN_DIR/cpu-results.json"

node audit/engine-r187/tools/regressions.mjs \
  . "$RUN_DIR/regression-results.json"
```

The CPU probe runs upstream and the min-heap prototype in alternating order for three rounds at 1,024, 4,096 and 16,384 instances. It times deletion, refill and their sum. Object/geometry initialization is outside those intervals. Each reallocation asserts the same smallest free ID. It also checks 2,000 randomized operations per class, clone/shrink and geometry-ID reuse.

Additional probes count the actual engine module's UBO writes against a mock GL interface, local/world matrix operations on a static tree, and per-instance raycast tests. The UBO driver is a call-count test, not a real GPU.

The regression runner executes the two existing test bodies from test/unit/src/objects/BatchedMesh.tests.js against upstream and four BatchedMesh variants using a minimal Node assert adapter. It is not the complete QUnit framework or full Three.js suite. Full npm test was not run: this audit does not install the repository's upstream development dependency set.

## Real WebGL probes

Supply an existing Playwright installation. The harness uses installed Chrome with Metal flags, which is the tested macOS configuration. A Playwright package can live outside this repository; the package is a browser runner, not a source dependency under audit.

```sh
node audit/engine-r187/tools/gpu-audit.mjs \
  . /absolute/path/to/playwright "$RUN_DIR/gpu-results.json"
```

The URL three-engine-audit.test is intercepted entirely by Playwright. Source modules are read from the named checkout and fulfilled in process. No HTTP server is started and no application code or external model/data is loaded. A secure mocked origin makes the browser's SHA-256 API available.

Nine source configurations run sequentially:

1. Invisible materials, upstream and early-guard prototype.
2. Sparse instance edits, upstream and sparse-update prototype.
3. Static draw-index ordering, upstream and changed-only prototype.
4. Clone/capacity growth, upstream and standalone resize prototype.
5. Upstream cross-row DataTexture range, retained as an expected negative control.

Every real WebGL case records the actual GPU and rejects a software renderer. Dirty-frame probes record eight render calls each. Upload interception counts buffer bytes and texture rectangles. Readback, pixel hashing, source loading and initialization are outside the timed frame intervals. Candidate and upstream framebuffers are checked using SHA-256 plus nonzero colored pixels.

The resize probe deliberately verifies upstream's blank frame and the prototype's populated frame. The row-range probe deliberately records GL error 1282. Those expected failure controls are findings; they are not successful rendering qualifications.

The harness currently uses Chrome/Metal. Firefox, WebKit, other GPUs, WebGPU, shadows, all raw state interactions and all dynamic-density regimes remain follow-up qualification. Before drawing performance conclusions on other devices, adapt launch flags and keep backend/device identities separate. Submitted bytes and call counts do not measure GPU execution time.

## Patch review and evidence

- candidates.mjs contains exact source transforms with unique-anchor checks.
- patches/*.patch are standalone diffs against r187. Sparse and resize changes overlap; they are not a sequential patch stack.
- engine-verify.mjs checks delivered hashes, numerical claims, failure controls and framebuffer comparisons without launching a browser.
- source-manifest.json pins reviewed engine files to r187.
- development-crosscheck.json records source-pattern checks against upstream development HEAD. That HEAD was not runtime-benchmarked.

For each patch:

```sh
git apply --check audit/engine-r187/patches/free-id-heap.patch
```

Review and port the candidate into a small engine change with normal upstream tests before merging. The audit commits the report, synthetic evidence, tools and patch files only.
