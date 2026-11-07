# Comprehensive Three.js audit

November 7, 2026. Engine and authored addons. Baseline: [r187](https://github.com/mrdoob/three.js/releases/tag/r187), package 0.187.0, commit `7e89746a687bb88271253698fa108b1dd59825d0`. Development source crosscheck: `f2b6a71bdd088d9da387fcc62802323341099b92`.

The strongest opportunities are to repair resource ownership and loader request identity, prevent malformed assets from driving unchecked allocations, and reduce batch allocation, redundant uploads, WebGPU repacking, GLB copying and animation binding work. This audit contains 28 prioritized items: the 16 renderer/core items in the [foundation audit](../engine-r187/README.md), plus 12 additional findings across loaders, lifecycle, animation, WebGPU and project validation. The register distinguishes reproduced behavior, instrumented operation counts, experimental patches and proposals whose benefit remains unmeasured. These are not 28 independently confirmed bugs.

All proposed changes target Three.js or its own test/build infrastructure. The fork contains reports, synthetic reproductions, evidence and five earlier experimental patches. Engine source, published builds, package metadata and lockfile are unchanged. No consuming application, private dataset or application integration is part of the measurements.

## What to fix first

| Priority | Item | Reproduction / measured cost | Concrete engine change |
| --- | --- | --- | --- |
| P1 | C01 FileLoader request identity | With cache disabled, concurrent same-URL requests with different headers receive the first request's result; arraybuffer + text consumers both receive ArrayBuffer | Key in-flight sharing by compatible request/response semantics; define cache and cancellation isolation |
| P1 | C02 shared attribute ownership | Disposing geometry A blanks geometry B sharing its position attribute: 78 colored pixels becomes 0; GL error 1282; independent attributes remain correct | Define ownership, retain shared buffers until last owner, invalidate VAOs on buffer replacement |
| P1 | C03 STL allocation preflight | An 84-byte malformed header attempts a 36 MB Float32Array allocation before body validation; guard prevented the allocation | Validate declared size/count before allocation and offer explicit asset budgets |
| P1 | E05 batch resize | Populated cloned/grown batch renders blank; explicit invalidation restores 20,937 colored pixels | Initialize replacement texture versions after copies |
| P1 | E06 texture ranges | A two-row update becomes an invalid over-wide one-row upload | Plan row-aware bounded upload rectangles |
| P1 | E01 free-ID allocation | 16,384-instance delete/refill cycle: median 1,347.1 ms vs 2.31 ms in heap experiment | Replace repeated sort/shift with minimum-ID heaps |
| P1 | E02 hidden-material uploads | 128 hidden dirty meshes submit 1,179,648 buffer bytes/frame | Reject invisible single materials before geometry upload preparation; preserve children |
| P1 | E03 sparse batch textures | One transform/color edit: 1,310,720 bytes vs 80 bytes for those textures | Track dirty ranges with correct initialization and dense-update fallback |
| P1 | E04 stable batch draw IDs | Static capacity-4,096 batch uploads 16,384 redundant bytes/render | Mark indirect texture dirty only when contents change |
| P2 | C04 ImageBitmap options race | Different URLs, same loader, options changed between calls: both use the later orientation | Snapshot decode options at load admission |
| P2 | C05 WebGPU padded attribute | One component edit causes 400,000 new CPU bytes and 100,000 temporary views before a 4-byte GPU write | Retain padded staging storage and repack dirty vertices |
| P2 | C06 WebGPU overlapping ranges | 256 identical ranges produce 256 writes / 4,096 submitted bytes for 16 unique bytes | Merge aligned dirty intervals before queue submission |
| P2 | C07 GLB copies | Valid 1,573,348-byte GLB causes 3,145,684 bytes of ArrayBuffer.slice copying | Carry buffer offsets/views through BIN and bufferView parsing |
| P2 | C08 animation cold binding | 1,000 tracks on 10,000 nodes cause 9,500,500 name reads; warm updates cause zero | Build a scoped lookup index for a binding pass |
| P2 | C09 renderer/material lifecycle | Reusing assets across 3 disposed renderers leaves 1, 2, 3 material dispose listeners; geometry and texture listeners return to zero | Remove renderer-owned material subscriptions at renderer disposal |

The remaining items cover instance ray acceleration (E07), WebGL UBO write coalescing (E08), opt-in transform tracking (E09), explicit multipass preparation reuse (E10), render-list order reuse (E11), scoped state invalidation (E12), shader diagnostics policy (E13), bounded readback pools (E14), cached-bundle CPU refresh (E15), optional tracing (E16), backend-aware GPU tests (C10), example/manual lint debt (C11), and development dependency advisories (C12).

[New findings and acceptance criteria](FINDINGS.md) explain causes, compatibility constraints and upstream change boundaries. [findings.json](findings.json) is the complete machine-readable register, including all 28 items. The earlier [five source patches](../engine-r187/patches/) remain experiments, with overlapping sparse/resize edits; they are not a sequential production patch stack.

## Validation results

| Check | Result | Qualification |
| --- | --- | --- |
| Structural source census | 1,649 JavaScript files parsed; zero parse errors | Authored source/addons, unit tests, editor/TSL UI and utilities; indexing is not manual review of every line |
| r187 Chromium core QUnit | 1,982 passed, 0 failed, 1 todo | Native WebGPU and forced WebGL backend identities recorded |
| r187 Firefox / WebKit core QUnit | Each: 1,971 passed, 11 failed, 1 todo | Requested WebGPU actually fell back to WebGL; failures concern compute features, not demonstrated native WebGPU defects |
| r187 addon QUnit, all three browsers | Each: 145 passed, 0 failed | Original tests; expected placeholder texture request returns 404 |
| Development source overlay, Chromium | Core 1,982 passed + 1 todo; addons 145 passed | Source/test overlay from pinned dev commit; not a rebuilt development package or cross-browser dev qualification |
| Eight repository lint scripts | Core/addons/test/TSL/editor/utils pass; examples 11 errors + 2 warnings; manual 15 errors | Exact file/line/rule evidence retained; no unrelated lint fixes applied |
| Release build reproduction | All 5 output files match published r187 bytes; no Rollup warnings | Rebuilt into temporary output directory |
| Upstream tree-shake configurations | All 11 bundle configurations compile; no warnings | Size measurements retained; no browser execution or size budget assertion implied |
| Native WebGPU render/readback | Actual WebGPU backend; 4,096 readback bytes; 256 colored pixels | One basic target/readback case on this machine |
| Material benchmark | 9 runs; all upstream count/build/program assertions pass | Unchanged 10,000-mesh pages; rotated order, 3 rounds; CPU submission time only |
| Lifecycle controls | OrbitControls listeners 6 -> 0; offline audio stops/disconnects; geometry/texture subscriptions clear | Positive controls, not an exhaustive leak proof |
| Driver-boundary probes | 500 aligned Uint8/Uint16 dirty-range fuzz trials pass | Mock queue with exact byte checks, not a hardware performance result |
| Dependency audit | 8 affected dev-package entries: 2 low, 6 moderate; 0 high/critical; 2 underlying advisory sources | No runtime npm dependency vulnerabilities demonstrated; bundled decoders are outside npm audit coverage |

The first WebKit addon attempt timed out because this audit's route handler mishandled blob URLs. Continuing browser-owned blob/data requests fixed the harness; the final addon rerun passes. Both the preliminary record and explanation are preserved. No upstream test was removed or changed to force a passing result. Firefox/WebKit each also report 11 tests with assertion-message-based soft skips counted as passes, which makes backend-aware qualification important (C10).

## Existing strengths to retain

The engine already pools render items, merges WebGL buffer update ranges, shares WebGL programs, caches WebGPU pipelines/bind groups/render objects, supports render bundles, exposes asynchronous readback, and offers explicit matrix update controls. Those mechanisms should be extended only where evidence shows remaining work.

The upstream NodeMaterialInstance benchmark is particularly useful: native WebGPU first-render medians were 1,639.5 ms for 10,000 separate node materials and 247.4 ms for material instances, with 10,000 versus 1 node builds. Second-render medians were 53.1 versus 48.8 ms; uniform-update medians were 44.3 versus 39.4 ms with zero rebuilds. This is an existing r187 optimization, not a new audit patch. WebGL ShaderMaterial issued one shared program and 10,000 draws; it is a different renderer path and is not a controlled WebGPU speedup baseline. These runs overlapped bundle compilation, so timings are illustrative and may include CPU contention; build/draw counts are the stronger result.

WebGPU's current Info.memory already reports attribute, texture, uniform, program and readback byte estimates. E16 should fill WebGL and cause/pass tracing gaps, rather than duplicate existing WebGPU byte counters. BufferGeometryUtils.mergeVertices already uses Math.trunc; the familiar bitwise coordinate-wrap criticism does not apply to this release.

## Suggested implementation sequence

1. Land independent correctness work: C01, C03, C04, E05, E06. Resolve the shared-attribute ownership contract in C02 and add a rendering regression before changing buffer lifetime.
2. Land E01 and E02 as separate small engine changes with regressions. They do not require a new public API.
3. Implement E03/E04 with initialization, density, multiple-camera and context-loss tests. Extend the same interval planning discipline to C05/C06 and E08.
4. Reduce cold-path memory/work in C07/C08; measure retained backing-buffer memory and index construction as well as allocation/copy counts. Repair C09 subscriptions with heap-retention measurements.
5. Fix backend-aware test reporting (C10), clear lint debt (C11), and update/isolate affected dev tools compatibly (C12). Keep native WebGPU, fallback WebGL and explicit forced-WebGL jobs separate.
6. Require controlled benchmarks and invalidation contracts before E09-E15 API/cache expansion. Use E16 to attribute work and retain existing optimizations.

The highest-priority streaming work improves reusable engine behavior for large dynamic scenes, sparse edits and frequent resource turnover. No map-renderer redesign is required to realize those library changes.

## Scope and reproducibility

See [COVERAGE.md](COVERAGE.md) for subsystem coverage, measured function execution and outstanding qualification. [REPRODUCE.md](REPRODUCE.md) gives commands, environment requirements and artifact verification. [MEASUREMENTS.md](MEASUREMENTS.md) separates bytes/calls, CPU time and pixel correctness. Evidence is hashed in [manifest.json](manifest.json).

This is a broad source and empirical audit, not exhaustive verification of every shader, asset format, browser/driver, device or interaction. Full example screenshot/e2e sweeps, mobile/discrete GPU testing, real WebXR sessions, codec fuzzing, long-running heap/GPU residency qualification and photometric reference-image comparisons were not run. Source-only areas and unmeasured proposals are labeled explicitly. The published source remains r187; findings are proposed work, not fixes already delivered to engine users.
