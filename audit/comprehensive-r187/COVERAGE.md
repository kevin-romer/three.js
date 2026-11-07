# Coverage, methods and boundaries

The audit combines broad structural checks and original upstream tests with targeted source review and synthetic experiments. The source census is an inventory, not a claim that every indexed file was manually inspected. Test execution is reported separately from correctness and performance qualification.

## Structural inventory

Espree parsed 1,649 JavaScript files with zero parse errors across src, examples/jsm, test/unit, editor/js, tsl/js and utils. Each row in [source-census.json](evidence/source-census.json) records relative path, SHA-256, bytes, lines, function declarations and static imports. Vendored libs/vendor/3rdparty directories, binary assets, generated builds and translated docs are excluded. Addons that embed third-party logic directly in authored modules can still appear in the census; parsing them does not establish supply-chain review.

Core domains include 291 renderer files, 220 nodes, 39 materials, 29 math, 25 extras, 22 geometries, 19 loaders, 18 core, 17 textures, 14 animation, 14 objects, 14 lights, 13 helpers, 6 cameras, 5 audio and 3 scenes, plus entrypoints. Authored addon breadth includes 73 loader files, 69 TSL files, 52 shaders, 41 inspector files, 30 postprocessing files, 19 utilities, 13 WebXR files, 9 controls and other addon families. Editor and auxiliary TSL UI receive parse/lint coverage, not a complete interaction test.

There are 283 unit-tree JavaScript files including helpers/fixtures. Static QUnit declarations are not runtime test counts: loops generate additional cases and imports determine which declarations run. Runtime counts come from QUnit itself.

## Subsystem matrix

| Surface | Review / empirical coverage | Findings and remaining qualification |
| --- | --- | --- |
| WebGL traversal, visibility, passes | Renderer/projectObject/render-list/state source; original suites; real pixel/upload experiments | E02, E10-E13, E16; no complete multipass/shadow interaction matrix |
| Instancing and batching | Allocation, copy/resize, texture updates, draw IDs, raycast source; randomized CPU and real WebGL experiments | E01-E07; prototype patches remain Chrome-only experiments |
| Geometry, attributes, VAOs | Ownership and revision source; shared/independent disposal pixel controls; math/geometry/core QUnit | C02, E08; interleaved/shared index/context cases still needed for a fix |
| Texture/upload lifetime | WebGLTextures/state and common TextureUtils paths; multirow error, sparse initialization and disposal checks | E03-E06; full format/mipmap/compressed/array/MSAA matrix not run |
| WebGPU attributes/bindings/pipelines | Utility/common cache source; 500 aligned byte fuzz cases; sparse repack and duplicate range counts | C05/C06, E15; counts use a mock queue, not adapter timings |
| WebGPU rendering and TSL | Full core suite in Chromium, backend identity, native target/readback, original 10k-material pages | Native results local to one machine; fallback test-gating gap C10 |
| Materials and shader graph sharing | Source/cache review, QUnit, 9 benchmark runs with build/program counts | NodeMaterialInstance already shares node builds; complex graph permutations and driver compiler diagnostics not exhaustively tested |
| Scene graph / transforms | Core and object QUnit; default/static matrix operation counts | E09; dirty tracking remains an opt-in API proposal |
| Animation and skinning | Mixer/action/property-binding caches and uncache source; 10k-node binding probe and correct warm update | C08; broad skeleton/blending/morph/retargeting performance matrix not run |
| Load request/cache semantics | FileLoader, ImageBitmapLoader and LoadingManager source; deterministic async request/decode probes | C01/C04; no real authenticated network traffic used |
| Asset parsing and decoding | GLTF/STL targeted allocation/copy probes; PLY/EXR/RGBE/Draco/KTX2 path inspection; addon QUnit | C03/C07; decoder binaries and all loader formats not fuzzed or performance-qualified |
| Math, curves, cameras, geometries | Original upstream suite, AST/lint; bound/traversal call-path inspection | Passing tests are useful baseline; numeric conditioning/extreme coordinate corpus not expanded |
| Lighting, environments, PMREM | Selected generator/cache/source paths and upstream tests | Current PMREM GGX path retained; no photometric/reference-image, PMREM-quality or shadow atlas campaign |
| Postprocessing / render targets | Selected EffectComposer/bloom/SSAO resize/dispose source and addon suite | No all-effects pixel/golden or transient render-target memory campaign |
| Resource lifecycle | Shared-buffer pixels; repeated renderer/assets listener counts; cleanup controls | C02/C09; no long-duration heap/RSS/GPU-residency proof |
| Controls / DOM interaction | OrbitControls connect/key-listen/dispose native listener instrumentation | 6 -> 0 listener control passes; other controls/pointer/touch/accessibility interactions not exhaustively exercised |
| Audio | OfflineAudioContext play/pause/play/stop/disconnect and state checks; parse/lint | Stop/disconnect control passes; no physical sink, positional audio or device lifecycle test |
| XR | WebXRManager session-event setup/cleanup source paths, AST/lint | No real headset/controller/session execution; do not infer XR qualification |
| Exporters / utilities | Original addon QUnit, AST/lint, selected mergeVertices behavior checked | No all-format roundtrip corpus; Math.trunc already avoids the classic bitwise wrap issue |
| Editor, inspector, examples, docs UI | AST and all existing lint scripts | C11; not a browser interaction/screenshot audit of every page |
| Packaging and tools | Fresh 5-file release build; 11 tree-shake configurations; dependency graph audit | C12; all compile, no size threshold claimed; no decoder binary supply-chain clearance |

## Function execution observations

V8 precise coverage was captured for Chromium's full r187 core and addon runs, then unioned by script/function range. It observed 809 loaded source/addon JS files, including three vendored addon library files imported by tests. Excluding unnamed top-level module wrappers, 4,317 of 7,326 observed functions executed at least once. [Per-file/group evidence](evidence/function-execution.json) and both compressed raw CDP records are supplied.

These are function execution observations within loaded files, not assertion, branch or line coverage and not a percentage of the whole package. AST function counts differ from V8's compiled function ranges; do not divide one by the other. Imported functions can execute during module initialization without their output being asserted. Loading nearly all renderer/node modules through entrypoints does not establish that every shader/path is tested.

| Domain | Loaded files | Functions executed / observed |
| --- | --- | --- |
| Renderers | 290 | 969 / 1,778 |
| Nodes | 220 | 955 / 1,903 |
| Core | 18 | 191 / 251 |
| Math | 29 | 543 / 624 |
| Materials | 39 | 135 / 233 |
| Objects | 14 | 69 / 129 |
| Animation | 14 | 91 / 173 |
| Loaders (core) | 19 | 80 / 139 |
| Textures | 17 | 31 / 61 |
| Audio | 5 | 5 / 55 |
| Loaders (addons) | 27 | 658 / 959 |

Additional targeted probes are outside this coverage collection and should not be silently added to these counts.

## Backend-aware results

The original QUnit HTML import maps resolve `three`, `three/webgpu` and `three/tsl` to checkout source. Tests run via route-served files at a secure synthetic origin; they do not load a consuming application. QUnit 2.25.0 is staged locally with its exact hash. Browser-owned blob/data requests continue normally; external network requests are blocked. Each addon run records the existing placeholder `test/unit/texture.test` 404 from MaterialX fixtures; all addon assertions still pass.

For r187 core reruns, the only served-source observation change pushes requested/actual backend identity immediately after renderer.init in the shared GPU helper. Assertions, feature gating and renderer selection are unchanged. Firefox/WebKit fallback failures and soft skips remain visible. Raw failure names/messages/stacks are preserved. The development run overlays changed src/test/unit/examples/jsm files from the pinned commit; other files are release-identical. Its initial capture predates backend/soft-skip observation, so absence of those records must not be interpreted as native WebGPU confirmation.

## Unrun qualification

The upstream full examples screenshot/e2e corpus was not run. Neither were test-e2e-webgpu, full documentation generation, long-duration stress/heap campaigns, native GPU timing queries, mobile/browser/device fleet checks, physical XR/audio, exhaustive render-feature permutations, external asset corpora, or native/wasm codec fuzzing. No service deployment, container rebuild or application source edit was involved.

For implementation work, add each finding's regression first, then qualify relevant backend/device/lifecycle permutations. A complete library audit can identify and prioritize these gaps without claiming that a passing unit suite proves every subsystem correct.
