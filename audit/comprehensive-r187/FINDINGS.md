# Additional findings and upstream acceptance criteria

C01-C12 extend [E01-E16](../engine-r187/README.md). P1 means address before relying on the affected behavior at scale; P2 means targeted improvement with a defined workload; P3 means lower urgency or a proposal needing more evidence. Priorities are engineering triage, not CVSS scores. Reproduced behavior establishes this baseline's result; it does not establish novel discovery, exploitability in an application or a universal performance gain.

## C01 FileLoader shares incompatible requests

**P1. Reproduced against the actual FileLoader with a mocked fetch boundary; cache disabled.**

[FileLoader.load](../../src/loaders/FileLoader.js#L103) uses a module-wide `loading[url]` table before constructing the Request or snapshotting response settings. The completed cache also uses `file:${url}`. Two concurrent loaders requesting the same URL with synthetic scope-A/scope-B headers cause one fetch and both receive scope-A's body. A concurrent arraybuffer loader followed by a default text loader likewise returns ArrayBuffer to both consumers. This is request/response identity loss even with Cache.enabled=false.

Define which requests can share transport and which decoded results can share cache entries. Include canonical headers, credentials, response type/MIME and relevant fetch semantics, or supply an explicit request/cache namespace with safe defaults. Consider sharing raw transport separately from per-consumer decoding. Avoid recording raw authorization values in diagnostic keys. Define independent cancellation and LoadingManager start/end/error accounting for every consumer; one loader's abort must not silently cancel an unrelated request.

Acceptance: equivalent requests still deduplicate; different headers/credentials and text/JSON/arraybuffer/blob/document modes remain isolated; changing options between calls is safe; concurrent success, abort and rejection clear all tables and settle callbacks/managers exactly once. Cover both disabled and enabled caches and multiple managers. The probe establishes a potential sensitive-result mixing primitive inside one JavaScript realm, not a demonstrated cross-user deployment exposure.

## C02 Geometry disposal can invalidate another geometry's shared attribute

**P1. Actual WebGL pixel/readback reproduction, with independent-attribute control.**

[WebGLGeometries.destroyGeometry](../../src/renderers/webgl/WebGLGeometries.js#L16) removes each attribute from the global WebGLAttributes store when one geometry is disposed. [WebGLBindingStates.needsUpdate](../../src/renderers/webgl/WebGLBindingStates.js#L149) compares CPU attribute/data identity, so another geometry's cached VAO does not necessarily recognize a recreated GL buffer. Two geometries share one position BufferAttribute; after both render, remove A, render B, dispose A, mark B's attribute dirty and render again. B drops from 78 colored pixels to zero with GL error 1282. The separate-attribute control retains the same framebuffer hash and 78 pixels without error.

Make the sharing/disposal contract explicit. If shared attributes are supported, track owners or buffer generations so one owner's disposal cannot destroy another owner's live resource. Rebuild affected binding state on buffer replacement; generation checks alone can repair stale bindings but still cause avoidable deletion/reallocation. Reference accounting must handle index, interleaved and instanced attributes, geometry attribute replacement and multiple renderers.

Acceptance: shared and independent controls preserve pixels when either geometry is disposed, actual final-owner disposal releases storage, repeated needsUpdate does not recreate valid buffers, and renderer disposal/context restoration are correct. Include shared index/interleaved buffers and multiple material programs. The reproduction is definitive; whether to guarantee attribute sharing or reject/document it is an API ownership decision. A reference-counting implementation without accounting for setAttribute/deleteAttribute would be incomplete.

## C03 STLLoader allocates from an unchecked declared triangle count

**P1. Guarded malformed-input reproduction; no large allocation performed.**

[STLLoader.isBinary](../../examples/jsm/loaders/STLLoader.js#L122) computes an expected binary size, but a mismatch falls through to header sniffing. Non-ASCII input can still enter [parseBinary](../../examples/jsm/loaders/STLLoader.js#L170), where declared face count controls vertex/normal/color allocations before face body reads validate the buffer. An 84-byte header declaring 1,000,000 faces attempts one 36,000,000-byte Float32Array allocation. The probe intercepts that constructor and throws before allocating it; it does not measure a 72 MB live heap or complete an attack.

Check the minimum header length and that the declared count fits the available 50-byte face records before allocating. Define allowed trailing data and binary headers beginning with `solid` deliberately, rather than treating all size mismatches alike. Add optional decoded geometry budgets and checked size arithmetic so even valid but oversized assets can be rejected predictably.

Acceptance: truncated headers, impossible counts, huge counts in tiny inputs, colored headers, ASCII encodings, valid binary `solid` prefixes and permitted trailing data. Fail with a stable parse error before proportional allocation. Follow up with bounded corpus fuzzing for STL and other parser length/count paths; this audit does not claim equivalent defects in every loader.

## C04 ImageBitmapLoader reads mutable decode options after fetch

**P2. Reproduced with two different URLs, cache disabled.**

[ImageBitmapLoader.load](../../src/loaders/ImageBitmapLoader.js#L181) calls createImageBitmap with `scope.options` after asynchronous fetch/blob resolution. Loading image A with orientation none, then setting flipY and loading image B, passes flipY for both decodes. Capture a copy of decode options before starting asynchronous work. Keep the existing colorSpaceConversion override and avoid later caller mutation of the supplied options object.

Acceptance: concurrent distinct URLs retain their admission-time options; mutate/setOptions after load; success/failure/abort and supported decode options. The loader already documents that its URL cache does not distinguish options. This finding is the separate asynchronous options race with caching off; a compatible cache identity design can be coordinated with C01 without misrepresenting the documented limitation.

## C05 Sparse WebGPU updates repack the entire padded attribute

**P2. Allocation/view/call counts from the actual engine utility at a mock queue boundary.**

[WebGPUAttributeUtils.updateAttribute](../../src/renderers/webgpu/utils/WebGPUAttributeUtils.js#L235) allocates a full padded typed array and loops all vertices before consulting updateRanges. A 100,000-vertex Uint8 RGB attribute with one changed component creates 400,000 bytes of new CPU storage and 100,000 subarray views, then correctly submits just four aligned GPU bytes. The GPU transfer is sparse; CPU preparation is not.

Retain padded staging storage per underlying buffer and repack only vertices intersecting dirty component ranges. Use a density threshold for full repacking. StorageBufferAttribute and StorageInstancedBufferAttribute currently synchronize their exposed arrays to padded layout, so their layout/ownership contract needs explicit treatment. Handle growth, replacement and device destruction without retaining obsolete backing arrays.

Acceptance: all item sizes/types that require padding, partial and overlapping vertices, nonzero view offsets, storage/instanced attributes, dense and sparse writes, resizes and repeated updates. Compare peak/live staging bytes, temporary allocations, CPU time and submitted bytes. Preserve the 500 passing Uint8/Uint16 alignment fuzz cases; do not remove existing alignment safeguards.

## C06 WebGPU dirty ranges are not coalesced

**P2. Queue submission counts reproduced, timing benefit unmeasured.**

The same utility's [range loop](../../src/renderers/webgpu/utils/WebGPUAttributeUtils.js#L295) submits every range separately. For 256 identical four-float ranges, it calls queue.writeBuffer 256 times and submits 4,096 bytes for 16 unique dirty bytes. WebGLAttributes already merges adjacent/overlapping ranges; WebGPU should have equivalent planning after accounting for its alignment and padded layout.

Merge compatible intervals in place or in bounded reusable scratch storage. Map source components to padded/aligned byte intervals before final merging so separately specified ranges that expand onto the same aligned word do not cause redundant writes. Keep full-upload and sparse thresholds driven by measurements.

Acceptance: overlaps, duplicates, adjacency, unsorted input, odd Uint8/Uint16 tails, interleaved and padded data, unchanged frames and dense writes. Verify GPU-visible bytes and calls, then benchmark queue overhead against planner cost on real adapters. No hardware speedup is inferred from the mock queue counts.

## C07 GLTFLoader duplicates uncompressed binary data

**P2. Copy volume measured on a valid synthetic GLB.**

The [binary extension](../../examples/jsm/loaders/GLTFLoader.js#L1971) slices the BIN chunk into a new ArrayBuffer; [loadBufferView](../../examples/jsm/loaders/GLTFLoader.js#L3172) slices its individual views again. A valid 65,535-vertex position/normal asset is 1,573,348 input bytes with 1,572,840 BIN bytes. Parsing copies 3,145,684 bytes through ArrayBuffer.slice: four magic bytes, the whole BIN chunk and both 786,420-byte bufferViews. Parsed geometry counts are checked.

Carry an immutable source-buffer reference plus offset/length into accessors, forming typed views when alignment permits. Decoding/transformation, sparse accessor patching, writable shared data, transfers and plugin APIs may still require owned copies. Offer a deliberate ownership/copy mode if a fully compatible internal conversion is too invasive. Avoid retaining a huge GLB for a tiny surviving accessor without considering the memory tradeoff.

Acceptance: uncompressed/interleaved/misaligned views, sparse accessors, embedded/external buffers, compressed extensions, workers/transfers, plugins and mutation isolation. Measure peak retained bytes and garbage collection as well as copy traffic. The evidence counts known slice copies, not total process RSS, all decoder allocations or GPU residency.

## C08 Animation binding repeatedly searches the same scene

**P2. Cold-path operation count reproduced; warm path and uncache controls pass.**

[PropertyBinding.findNode](../../src/animation/PropertyBinding.js#L266) recursively traverses by name/UUID for each new binding. Binding 1,000 tracks targeting the last 1,000 nodes of a flat 10,000-node scene causes 9,500,500 instrumented name reads. A subsequent mixer.update causes zero name reads, animates the expected position, and stopAllAction/uncacheRoot leaves zero cached actions/bindings. This is cold binding cost, not a per-frame lookup leak.

Build an ephemeral lookup index scoped to binding a root/clip set, preserving the current first depth-first match, root aliases/UUIDs and skeleton lookup precedence. Name, hierarchy and skeleton data are mutable; a permanent index requires revision/invalidation behavior or an explicit caller-managed snapshot. Avoid replacing repeated traversal with a stale global map.

Acceptance: duplicate names, UUID targets, bones, root tracks, escaped names, morph/material/object paths, groups, rename/reparent between clip admissions and uncache/rebind. Measure index construction/memory and small-clip crossover as well as large-scene start latency. Existing mixer binding caches must remain effective.

## C09 Material dispose subscriptions survive renderer disposal

**P2. Listener retention reproduced; retained heap/GPU bytes not quantified.**

[WebGLRenderer.getProgram](../../src/renderers/WebGLRenderer.js#L2239) registers a renderer-specific onMaterialDispose callback. [The callback](../../src/renderers/WebGLRenderer.js#L1155) removes itself on material disposal, but renderer.dispose does not remove all such subscriptions from still-live materials. Rendering one reusable geometry/material/texture with three fresh renderers and disposing each renderer leaves material listener counts 1, 2, 3. Geometry and texture listener counts are zero after each cycle. Disposing the material finally clears all subscriptions.

Track registered materials with disposal-aware ownership and unsubscribe at renderer disposal. Avoid turning a WeakMap into a permanent strong-reference collection that retains unused materials throughout renderer lifetime. Existing programCache/properties disposal should remain correct, and double disposal must be harmless.

Acceptance: repeated renderer replacement with retained assets, materials disposed before/after renderer, arrays/shared programs, context restoration and unrendered materials. Add heap-snapshot/WeakRef qualification for actual closure retention and GPU/program accounting separately. The probe demonstrates stale subscriptions; it does not prove a specific byte leak or broken texture/geometry cleanup.

## C10 GPU tests can label a WebGL fallback as WebGPU

**P2. Original upstream suites, actual backend observation and preserved failures.**

[gpu-test-utils.getSharedRenderer](../../test/unit/src/nodes/tsl/gpu-test-utils.js#L246) initializes WebGPURenderer for a requested backend named webgpu and caches it after init, without checking whether initialization selected WebGL fallback. [rawComputeTest](../../test/unit/src/nodes/tsl/gpu-raw-test-utils.js#L24) therefore runs WebGPU compute expectations on a fallback renderer unless a specific requiredFeature gate intervenes.

On Firefox 151 and WebKit 26.5, requested webgpu actually means WebGL here. Each core suite fails the same 11 atomic/barrier/workgroup tests. Examples of failure include unsupported storageTexture and missing getScopedArray in GLSLNodeBuilder as well as numerical workgroup/atomic mismatches. Chromium records a native WebGPU backend and passes all 1,982 non-todo core tests. These results do not establish 11 native WebGPU implementation bugs.

The helpers also use assert.ok(true, 'SKIPPED: ...'), so unsupported cases are counted as passes: 11 tests in each fallback core run contain such messages while QUnit's skipped count remains zero. Test capability coverage should not depend on inspecting a passing assertion's prose.

Acceptance: verify backend after init; native-WebGPU jobs must fail early if no native adapter is available, while explicitly capability-limited jobs should record structured skips. Run native WebGPU, fallback WebGL and forced WebGL as distinct configurations; gate unsupported operations explicitly and test promised fallback semantics separately. Keep all existing numerical assertions. The audit changed observation only, not renderer selection or assertions.

## C11 Optional lint surfaces contain baseline failures

**P3. All eight existing lint scripts executed.**

Core, addons, tests, TSL, editor and utilities pass. Examples report 11 errors and 2 warnings; manual reports 15 errors. [Detailed records](evidence/lint-summary.json) link through each sanitized lint-*.json to file/line/rule messages. Examples include assigning read-only Ammo/parent globals and an unused shadertoy builder; the two undefined-info reports are warnings. Manual includes repeated this.min self-assignment, a globalThis redeclaration, prefer-spread and unused variables.

Fix actual example mistakes, and scope globals/configuration corrections narrowly where a warning is caused by environment declarations. Add a deliberate CI policy for the surfaces expected to remain clean. `npm test` currently runs the core lint alias only, so a passing default command does not cover every authored example/manual file. These lint results are maintenance findings; they do not independently establish a renderer runtime defect.

Acceptance: the targeted script passes without blanket disabling useful rules; check affected interactive examples/manual pages after changes. Keep the baseline fixture failures separate from newly introduced lint regressions.

## C12 Development tooling has two advisory sources

**P2. npm audit snapshot plus primary advisory review, November 7, 2026.**

[npm audit JSON](evidence/dependency-audit.json) reports eight affected package entries propagated through the development dependency graph: two low and six moderate, no high/critical. That is two underlying advisory sources, not eight independent CVEs and not eight runtime Three.js dependencies.

- [deepmerge prototype poisoning advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): low severity, affected 4.2.0 through 4.3.1, no patched version listed at review; reached via the Rollup resolve tooling.
- [minimatch globparts amplification advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249): moderate severity, affected 7 through versions below 11.0.1; patched 11.0.1. The reported amplification needs attacker-controlled patterns and optimizationLevel at least 2. Reachable through lint tooling dependencies; actual exploitability in this repository was not demonstrated.

Update compatible tooling/transitives where available and isolate tooling inputs where no patch exists. Audit's fixAvailable suggestions include incompatible major downgrades, so do not apply npm audit fix --force blindly. Check lock resolution, plugin compatibility, all lint scripts and both build/bundle suites after any update. There are no production npm dependencies declared by the audited package; vendored codec JS/WASM supply chains require a separate inventory and are not cleared by this result.

## Change boundaries and performance acceptance

Keep C01/C04 loader request/decode semantics separate from renderer optimizations. Keep C02 ownership and C09 subscription cleanup separate: the first loses live rendering, the second retains callbacks. C05/C06 may share a range planner, but need independent tests for padding cost and redundant submissions. C07 and C08 target loading/activation latency, not steady-frame draw speed.

For all measured candidates, compare against baseline on equal visible output and actual backend identity. Record initialization, steady state, sparse/dense edits, teardown and peak retained bytes separately. Profile CPU preparation, driver submissions and GPU completion separately; an empty framebuffer, deferred failure or unbounded cache must not count as a performance win. See the foundation audit for E01-E16's individual acceptance criteria and experimental patch limitations.
