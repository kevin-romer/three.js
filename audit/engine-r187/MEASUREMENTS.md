# Engine measurements and verification

All runtime probes import Three.js source at r187. Each browser configuration runs in a fresh page/module graph, with exactly one candidate enabled. No Atlas/Tessera code, network data, map facade or installed Three.js build is part of the benchmark. The existing Playwright package is used only as a browser runner.

Real WebGL runs used Chrome 156.0.8078.80, Node v26.4.0, and ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version). The machine is an Apple M1 Pro Mac. The test canvas is 512 x 512 with antialiasing off. No WebGPU timing was collected.

## Free ID allocation

Each row is the median of three rounds. Upstream/prototype order alternates by round. Deletion and refill are both timed, so moving work to deletion is visible. Initial instance/geometry construction is outside the timed cycle. All reused IDs are asserted against the upstream smallest-free-ID behavior.

| Instances | Upstream delete ms | Heap delete ms | Upstream refill ms | Heap refill ms | Upstream whole cycle ms | Heap whole cycle ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1024 | 0.021 | 0.028 | 5.594 | 0.101 | 5.615 | 0.127 |
| 4096 | 0.073 | 0.099 | 85.997 | 0.416 | 86.074 | 0.515 |
| 16384 | 0.314 | 0.628 | 1346.812 | 1.405 | 1347.126 | 2.315 |

The result applies to this deliberately large free-pool refill workload, not to the frame rate of every Three.js scene. Small or continuously animated scenes have different costs. Raw trials are in [cpu-results.json](evidence/cpu-results.json).

## Real WebGL upload traces

The main dynamic probes record eight frames. Every frame in each configuration has the same submitted-byte result shown below. Initialization and framebuffer readback are outside those intervals. Byte totals derive from intercepted GL calls/rectangles; they are not measured GPU bandwidth.

| Operation | Upstream bytes per frame | Candidate bytes per frame | Result |
| --- | --- | --- | --- |
| Dirty buffers of 128 invisible-material meshes | 1,179,648 | 0 | Visible child preserved; SHA-256 framebuffer match |
| One matrix plus color edit, capacity 16,384 | 1,310,720 for matrix/color | 80 for matrix/color | SHA-256 framebuffer match |
| Same sparse test including unchanged indirect upload | 1,376,256 total texture bytes | 65,616 total texture bytes | Indirect traffic remains deliberately unfixed in this isolated patch |
| Static BatchedMesh indirect texture, capacity 4,096 | 16,384 | 0 | Changed ordering still uploads; framebuffer matches |

The hidden-material case submits one visible child draw in both versions, and 129 draws after revealing the parent materials. Deferred geometry is then uploaded. The static-indirect case verifies reverse ID order and a reduction from 16 to 15 visible IDs. WEBGL_multi_draw was available in these runs. The alternate extension path was not separately forced.

## Lifecycle and range failure controls

| Reproduction | Upstream | Prototype |
| --- | --- | --- |
| Clone/grow populated batch, standalone resize patch | 0 colored pixels | 20,937 colored pixels; SHA-256 equals populated pre-growth image |
| Clone/grow with sparse-update patch and allocation safeguards | 0 colored pixels | 20,937 colored pixels; SHA-256 equals populated pre-growth image |
| Update a 4 x 4 RGBA texture with component range start 0, count 32 | GL error 1282; requested upload width 8, height 1 | No row-range fix implemented |

The blank resize frame is an upstream failure, not an optimized rendering result. The standalone resize test isolates the three texture-version invalidations from sparse update changes. The row-range failure is also kept as an expected negative control. All other final GL error checks are zero.

## Other CPU operation counts

| Probe | Observation | Interpretation |
| --- | --- | --- |
| 256 changed vec4 uniforms in one 4 KiB UBO | 256 bufferSubData calls; unchanged next frame makes zero calls | Opportunity to coalesce driver writes; mock-driver call count only |
| Static 10,001-node Object3D tree, default flags | 10,001 local compositions and 10,000 world multiplies | Existing auto-update contract repeats unchanged math |
| Same tree with caller-managed local matrices | Zero compositions and world multiplies on the next unchanged update | Existing flags already avoid math; any automatic dirty-tree feature must justify its complexity |
| One-hit InstancedMesh ray, 1,024 instances | 1,024 inner Mesh ray tests | Linear instance broad phase |
| One-hit InstancedMesh ray, 16,384 instances | 16,384 inner Mesh ray tests | Optional maintained spatial acceleration could reduce queries |

## Checks completed

- Nine real WebGL source configurations completed, including the explicit upstream resize and row-range failure controls.
- SHA-256 framebuffer equality passed for the three upload optimizations, with nonempty pixel controls. The standalone resize and sparse/lifecycle prototypes restore the nonempty pre-growth frame.
- Two existing upstream BatchedMesh regression bodies ran against upstream and four BatchedMesh variants: ten successful executions through a minimal Node assert adapter.
- Both allocator implementations passed 2,000 randomized operations, smallest-ID checks, clone/shrink and geometry-ID reuse checks.
- Five standalone patch files pass git apply --check against r187.
- Engine source files remain unchanged. Source hashes, results, report, tools and patches are bound in manifest.json.

Full upstream QUnit/npm test, browser matrix, shader/shadow/animation campaigns, WebGPU execution and GPU timer-query measurements were not run. The repository development dependencies were not installed for this audit. These experiments justify focused engine work and regression tests; they do not qualify a production renderer release.

## Development branch crosscheck

The six source patterns behind E01 through E06 remain in upstream development commit f2b6a71bdd088d9da387fcc62802323341099b92 (November 7, 2026). BatchedMesh and WebGLRenderer have unrelated development changes; WebGLTextures is unchanged from r187. See [development-crosscheck.json](evidence/development-crosscheck.json). Development HEAD was not runtime-benchmarked.
