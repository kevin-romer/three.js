# Three.js engine performance audit

November 7, 2026. Baseline: Three.js r187, commit `7e89746a687bb88271253698fa108b1dd59825d0`.

The highest-value changes found inside Three.js are BatchedMesh free-ID allocation, skipping geometry uploads for invisible materials, sparse BatchedMesh texture updates, and avoiding unchanged indirect-texture uploads. These have isolated engine reproductions and experimental source patches. Two additional engine defects currently obstruct reliable streaming and partial texture updates: BatchedMesh resize can leave its new textures uninitialized on the GPU, and a DataTexture update range crossing a row produces a GL error.

The six source patterns behind E01 through E06 were also checked against upstream development commit `f2b6a71bdd088d9da387fcc62802323341099b92`, dated November 7, and remain present there. Runtime measurements and patches use r187; development HEAD was source-crosschecked only.

This is an audit of Three.js itself. Every finding below identifies engine code and an engine change. Map rendering supplies representative workloads: large batches, sparse selection edits, streaming allocation churn, many passes and repeated picks. The benchmarks import Three.js source directly; they do not load or modify an application, map adapter or product fixture.

## Measured engine opportunities

| ID | Engine behavior | Upstream observation | Experimental result |
| --- | --- | --- | --- |
| E01 | BatchedMesh sorts and shifts its free-ID array for each allocation | A delete/refill cycle for 16,384 instances took a median 1,347.1 ms | Min-heap prototype: median 2.31 ms for the same whole cycle |
| E02 | Invisible materials are checked after geometry upload preparation | 128 hidden meshes uploaded 1,179,648 buffer bytes on each dirty frame | Early material guard: zero hidden buffer bytes; same rendered pixels |
| E03 | A sparse BatchedMesh edit marks entire transform/color textures dirty | At capacity 16,384, one transform and color edit uploaded 1,310,720 bytes for those two textures | Dirty ranges: 80 bytes, with identical pixels |
| E04 | BatchedMesh rewrites its indirect texture even when draw IDs remain unchanged | A static batch of capacity 4,096 uploaded 16,384 indirect-texture bytes per measured render | Compare draw IDs before marking dirty: zero bytes until order changes |
| E05 | Resizing a batch replaces textures without marking copied contents for upload | Clone/grow reproduction rendered zero colored pixels | Explicit texture invalidation restored all 20,937 colored pixels |
| E06 | A DataTexture component range crossing a row becomes an over-wide one-row upload | A 4 x 4 RGBA texture with range (0, 32) issued width 8, height 1 and returned GL_INVALID_OPERATION | Confirmed defect; row-aware range planner proposed, not implemented |
| E07 | InstancedMesh raycasting checks every instance after its aggregate bound passes | 16,384 Mesh ray tests for a ray that hits one instance | Optional instance acceleration hierarchy proposed |
| E08 | WebGL UBO updates submit each changed uniform separately | 256 changed vec4 uniforms generated 256 bufferSubData calls for 4,096 bytes | Dirty-region coalescing proposed; call-count evidence uses a mock GL boundary |

E01 uses three rounds with package/prototype order alternated and includes deletion cost, so it does not hide work moved into deletion. E02 through E06 use actual Chrome WebGL2 through ANGLE Metal on Apple M1 Pro. Upload bytes describe submitted regions, not a direct GPU bandwidth or execution-time measurement. E08 counts calls made by the actual engine module against a mock driver; it is not a GPU timing result.

The patches are independent experiments against r187. They are stored under [patches](patches/) and applied only to modules served by the test harness. Three.js `src/`, its published builds and its package metadata remain unchanged. The sparse-update experiment includes initialization safeguards; its resize changes overlap the standalone resize patch. Do not apply every patch sequentially without rebasing overlaps.

See [MEASUREMENTS.md](MEASUREMENTS.md) for raw results and [REPRODUCE.md](REPRODUCE.md) for commands.

## Findings and engine changes

### E01 Replace repeated free-ID sorting with a min-heap

**Priority 1. Measured and prototyped.**

[BatchedMesh.addInstance](../../src/objects/BatchedMesh.js#L595) sorts `_availableInstanceIds` and shifts its first element on every reuse. [addGeometry](../../src/objects/BatchedMesh.js#L692) repeats the pattern for geometry IDs. Reusing a large free pool therefore repeatedly processes the remaining pool. The observed 1,024 / 4,096 / 16,384-instance curves show the problem increasing sharply with pool size.

Maintain both free-ID collections as min-heaps. Deletion inserts in O(log n); allocation removes the minimum in O(log n), preserving the current smallest-free-ID behavior. Keep resizing's explicit ascending sort where it removes high trailing IDs; an ascending array also satisfies the min-heap invariant. Clone/copy must preserve or establish that invariant.

The prototype covers instance and geometry IDs, 2,000 randomized operations per implementation, smallest-ID reuse, cloning and shrinking. It also executes the existing setInstanceCount and setGeometrySize regression bodies. Additional upstream tests should cover randomized geometry deletion/reuse, failed allocation, large pool copying and mixed capacity changes.

For streamed buildings, parcels or scene chunks, this removes an engine allocation bottleneck without requiring the application to reorganize its scene.

### E02 Reject invisible materials before geometry uploads

**Priority 1. Measured and prototyped.**

[WebGLRenderer.projectObject](../../src/renderers/WebGLRenderer.js#L1923) calls `objects.update(object)` before inspecting `material.visible`. [WebGLObjects](../../src/renderers/webgl/WebGLObjects.js#L14) then updates geometry and instanced attributes. A mesh can therefore allocate or refresh GPU buffers while its material guarantees that it will not draw.

Check single-material visibility before geometry update preparation in the Mesh/Line/Points and Sprite branches. Continue traversing children: hiding a parent's material does not hide its descendants. Preserve material-array/group semantics; the experimental guard deliberately leaves material arrays on the existing path.

The real WebGL test uses 128 dirty hidden meshes with a visible child. Pixels and the one visible draw match upstream. Revealing the material correctly produces 129 draws and uploads the deferred geometry. This demonstrates both the avoided work and the absence of the common incorrect early-return optimization that drops children.

Before merge, cover instanced attributes, sprites, all material-array visibility combinations, shared geometries, clipping, render targets and deferred onUpload callbacks. The callback timing moves to actual eligibility for upload.

### E03 Track sparse BatchedMesh transform and color ranges

**Priority 1. Measured and prototyped.**

[BatchedMesh.setMatrixAt](../../src/objects/BatchedMesh.js#L1089) writes 16 components and marks the entire matrix DataTexture dirty. [setColorAt](../../src/objects/BatchedMesh.js#L1123) writes up to four components and similarly marks its whole texture. The generic texture uploader already supports partial RGBA component ranges, but these engine setters do not supply them.

Add component ranges for transform, color and recycled-instance initialization. Matrix textures use four pixels per matrix with a row width divisible by four, so each individual matrix range fits one row. Colors occupy one RGBA pixel. Initial allocation must upload all required contents, rather than applying sparse ranges to uninitialized GPU storage. The prototype explicitly handles allocation in WebGLTextures and marks resized copied textures dirty.

At capacity 16,384, the measured matrix and color uploads drop from 1 MiB + 256 KiB to 64 + 16 bytes. The unchanged original indirect-texture upload remains 64 KiB in this isolated experiment: total measured texture traffic drops from 1,376,256 to 65,616 bytes per edit. E04 addresses the separate indirect cost.

Dense writes can make thousands of range objects and sorting more expensive than a full upload. A production version needs a dirty-density threshold, bounded range storage and bulk initialization/edit benchmarks. Also test multiple renderers, new contexts, clone/copy, growth, shrink, repeated edits, untouched colors and loss/restoration. The measured sparse result is not a guarantee that partial uploads always win.

### E04 Mark the indirect texture dirty only when its data changes

**Priority 1. Measured and prototyped.**

[BatchedMesh._updateDrawParameters](../../src/objects/BatchedMesh.js#L1581) may need to recull and sort every render, but it unconditionally sets `indirectTexture.needsUpdate` after filling the draw-ID array. With defaults enabling culling and sorting, an unchanged visible order still uploads the full index texture.

Compare each produced ID with the previous value and accumulate a changed flag. Mark the texture dirty when the used prefix changes or the texture has never been initialized. Draw counts and CPU draw ranges still update even when the ID texture does not. This optimization removes redundant GPU traffic; it does not remove the O(n) cull/sort work.

The prototype preserves pixels, skips all eight static-frame uploads, uploads again after a forced reverse ordering, and correctly reduces the visible draw count after hiding an instance. Shadow cameras and multiple camera passes can change ordering and must still trigger the required uploads.

Next tests should cover count-only changes, zero draws followed by reuse, geometry remapping, compaction, index-type changes, wireframe, shadow/main alternation and both WEBGL_multi_draw and its fallback. A WebGPU-specific path exists in onBeforeRender and needs its own design and tests; this patch targets the WebGL path only.

### E05 Initialize GPU texture versions after BatchedMesh resize

**Priority 1 correctness prerequisite for streaming. Reproduced and prototyped.**

[BatchedMesh.setInstanceCount](../../src/objects/BatchedMesh.js#L1280) disposes its instance textures, creates replacements and copies CPU data into them. The replacement matrix and color textures are not marked `needsUpdate` after those copies. The test cloned a populated batch, grew its capacity, changed a color and rendered it: upstream produced a blank result without a final GL error.

Mark the copied indirect, transform and color textures dirty. The standalone patch contains only those lifecycle invalidations; the sparse-update experiment includes the same safeguard. Its tested clone/grow result matches the populated pre-growth frame exactly.

Treat this as correctness work before performance claims about persistent/resizable batches. Test initial unused capacity, growth and shrink without any subsequent edits, color textures absent/present, cloned materials and restored contexts. A frame that submits no useful pixels must never become the benchmark's apparent optimization.

### E06 Make DataTexture ranges row-aware

**Priority 1 correctness prerequisite for partial uploads. Reproduced; no patch claimed.**

[WebGLTextures.updateTexture](../../src/renderers/webgl/WebGLTextures.js#L859) converts a component range into `width = pixelCount`, `height = 1`. It does not split a range across texture rows. A range covering two rows of a 4 x 4 RGBA texture becomes a width-eight upload into a width-four texture and generates error 1282.

The public [Texture.updateRanges description](../../src/textures/Texture.js#L320) explicitly describes subregions and rows. Improve the engine's range planner to support a partial first row, an interior rectangle of full rows and a partial last row. Coalesce compatible rectangles and preserve pixel-storage state. Account for component alignment: a range starting within one pixel and ending in the next needs both pixels uploaded.

Validate bounds and define supported format/type/mipmap behavior. Tests should include row-aligned multirow ranges, arbitrary component starts, touching/overlapping ranges, first allocation, cloned textures, several contexts and upload errors. Handle full-texture initialization before sparse updates. Do not merely suppress the GL error or discard the excess range.

This directly enables efficient engine-managed atlas, feature-state and scientific raster updates.

### E07 Add optional acceleration for instance raycasts

**Priority 2. Linear work measured; acceleration not prototyped.**

[InstancedMesh.raycast](../../src/objects/InstancedMesh.js#L258) performs one aggregate sphere check, then tests every instance through a temporary Mesh. [BatchedMesh.raycast](../../src/objects/BatchedMesh.js#L1418) likewise iterates active visible instances. The CPU probe observes exactly 1,024 and 16,384 Mesh tests for those instance counts while each ray returns one hit.

Provide an optional engine-owned per-instance hierarchy or a maintained spatial chunk index, with explicit rebuild/refit behavior on transform, geometry, count and visibility changes. Preserve instanceId, face/material results, near/far limits and all-hit ordering. A first-hit traversal could be an additional explicit query mode.

Keep a linear path for small/dynamic batches. Benchmark hierarchy construction and refitting as well as query latency and memory. A triangle BVH alone does not eliminate this outer per-instance scan. Negative scales, shear, stale bounds and dense overlap need dedicated cases.

### E08 Coalesce WebGL uniform-buffer writes

**Priority 2. Driver call count measured; optimization not prototyped.**

[WebGLUniformsGroups.updateUniform](../../src/renderers/webgl/WebGLUniformsGroups.js#L107) issues one bufferSubData for each changed uniform. The actual module submits 256 writes for 256 changed vec4 uniforms occupying one 4 KiB UBO. An unchanged group correctly submits zero writes.

Maintain a packed backing buffer plus dirty regions, then merge adjacent regions before submission. Compare sparse writes against a full-block threshold instead of always choosing either one full upload or one call per uniform. Preserve STD140 padding, integer/float types, arrays, matrices and binding-point behavior.

This can reduce CPU/driver crossings in scenes with many small changing uniforms. The mock-driver evidence establishes call count only; a hardware benchmark must establish the crossover and the effect of packing/copy cost. Typed-array uniforms currently always count as changed, so an optional explicit revision/range contract is another engine opportunity.

### E09 Add opt-in dirty transform propagation

**Priority 2. Repeated operations measured; API design required.**

[Object3D.updateMatrixWorld](../../src/core/Object3D.js#L1186) calls updateMatrix when matrixAutoUpdate is enabled. That marks the world matrix dirty, propagating forced world multiplication through descendants. An unchanged 10,001-node default tree recomposed all 10,001 local matrices and performed 10,000 world multiplications in the probe.

The existing matrix flags already remove that math when the caller manages local matrices; this is not missing functionality. The engine improvement would be an opt-in tracked transform/subtree mechanism that retains automatic correctness for unchanged trees without asking every application to manage matrix flags.

Direct writes to Vector3 components and arbitrary matrix edits make an unconditional cache unsafe. Preserve current mutable APIs by default. Require explicit invalidation for untracked writes, account for reparenting, animation and camera ancestry, and benchmark dirty fractions from zero to 100 percent. Include overhead added to heavily animated scenes.

### E10 Reuse frame preparation across explicit WebGL passes

**Priority 2. Source confirmed; benefit unmeasured.**

[WebGLRenderer.render](../../src/renderers/WebGLRenderer.js#L1667) prepares scene matrices, frustum, render lists and lights for each render call. The renderer frame counter also advances per call, so geometry/skeleton updates keyed through [WebGLObjects](../../src/renderers/webgl/WebGLObjects.js#L7) can repeat version checks or work across application passes.

Consider an explicit prepare/submit transaction for one scene/camera state, with filtered opaque/transparent submissions and a caller-declared frame scope. Do not silently reuse by requestAnimationFrame time: objects, materials, render targets and callbacks can change between calls.

Require invalidation for camera, object/geometry/material state, clipping, lights, environment and custom sort changes. Preserve onBeforeRender semantics, upload ordering and nested render behavior. Measure this against existing matrix flags and separate scenes before expanding the renderer API.

WebGPU already has [BundleGroup](../../src/renderers/common/BundleGroup.js) and render-bundle support. A generic proposal must not duplicate that API without addressing the different WebGL preparation path.

### E11 Retain useful render-list order without retaining stale visibility

**Priority 3. Source confirmed; benefit unmeasured.**

[WebGLRenderLists](../../src/renderers/webgl/WebGLRenderLists.js#L56) retains render-item objects, clears active arrays and rebuilds them, then sorts opaque/transmissive/transparent items. The common renderer has a similar sort stage. These are already pooled objects; claiming all render items are newly allocated every frame would be wrong.

Experiment with persistent order/ranks or cheap unchanged-order validation for large stable memberships. Preserve material variants, group/render order, depth direction and custom sort callbacks. Never sort transparent objects by material to reduce bindings. Stable or nearly sorted inputs may already be handled efficiently by the JavaScript engine, so compare against the existing sort before adding a cache.

Include camera sweeps, insertion/removal, changing transparency and material variant changes. Record comparison counts, allocations and wall time separately.

### E12 Offer scoped renderer state invalidation

**Priority 3. Source confirmed; benefit unmeasured.**

[WebGLState.reset](../../src/renderers/webgl/WebGLState.js#L1210) emits many state-setting calls and clears caches. This is appropriate after arbitrary external GL access. It is heavier than invalidating only the affected domains.

An engine API could accept explicit invalidation domains such as program/VAO, buffers, textures/samplers, pixel storage, framebuffer/viewport and blend/depth/stencil. Keep the existing full reset as the safe default. Let the next draw lazily establish invalidated state, where valid.

Test foreign GL changes and pixel-store caching, render targets, nested passes and reversed depth. This is an engine interoperability improvement; removing reset calls from one application would not establish an engine fix.

### E13 Separate shader error checking from optional warning-log collection

**Priority 3. Source confirmed; benefit unmeasured here.**

[WebGLProgram.onFirstUse](../../src/renderers/webgl/WebGLProgram.js#L823) requests program and shader logs when shader checking is enabled, then checks link status. Such driver queries may synchronize with compilation.

Expose an explicit diagnostics policy that can retain link/error checking while deferring optional successful-program warning logs, with backward-compatible defaults. Preserve full diagnostics on errors and existing callbacks. Investigate collecting successful logs after asynchronous compilation has completed.

Three.js already supports compileAsync and KHR_parallel_shader_compile. Do not claim that asynchronous compilation is missing, or count disabling every shader check as the engine improvement. Benchmark cold shader creation and steady program reuse separately.

### E14 Reuse bounded readback staging buffers

**Priority 3. Source confirmed; benefit unmeasured.**

[WebGLRenderer.readRenderTargetPixelsAsync](../../src/renderers/WebGLRenderer.js#L3245) allocates a pixel-pack buffer per request, inserts a fence, waits, copies data and deletes the buffer. Repeated selection/capture/readback can churn buffers even when sizes repeat.

Evaluate a size-classed bounded pool of idle pixel-pack buffers and fence records. Limit in-flight requests and total retained bytes; release on disposal/context loss and handle rejection. Preserve framebuffer and pixel-pack state across asynchronous work.

Compare repeated small reads and large captures, including idle memory cost and driver behavior. The existing asynchronous API already avoids the simplest blocking-read pattern. Pooling is a candidate improvement, not a demonstrated timing gain.

### E15 Reduce CPU work retained by WebGPU bundles

**Priority 3. Source reviewed only.**

The common renderer already caches pipelines, render objects and binding groups. [Bindings._update](../../src/renderers/common/Bindings.js#L450) constructs a cache-key string only when bindings actually require an update. [RenderObjects](../../src/renderers/common/RenderObjects.js#L145) also guards rebuilding by versions/cache keys. These existing optimizations should be retained.

The cached-bundle path in [Renderer._renderBundle](../../src/renderers/common/Renderer.js#L1767) still visits render objects and can refresh nodes, geometry and bindings. Investigate a group-level unchanged epoch for genuinely static groups, leaving dynamic per-object refresh intact. Compare pipeline-build time, bind-group changes, CPU refresh cost and GPU execution independently.

Directly mutable node/material/texture state makes a cache invalidation contract essential. No WebGPU runtime speedup is claimed by this audit; WebGPU needs its own adapter/device runs and pipeline/bundle invalidation tests.

### E16 Add low-overhead engine performance counters

**Priority 2 enabling work. Source confirmed.**

WebGLInfo exposes useful draw and object counts, but it does not provide a complete byte/cause trace for uploads, program creation, cull/sort work, cache invalidation and staging allocations. This audit had to intercept GL calls to obtain the decisive upload evidence.

Provide optional counters or trace hooks at WebGLAttributes, WebGLTextures, WebGLProgram, render-list preparation and batch allocation, with corresponding common/WebGPU counters where applicable. Keep the disabled path close to zero cost; avoid per-draw event objects by default.

Expose bytes requested, ranges/calls and cause/version transitions separately from GPU timer results. Include render-pass attribution so a final render call's counters do not erase the preceding passes. Counters should make E01 through E15 reproducible upstream without a product integration.

## Areas reviewed with existing safeguards

| Area | Existing behavior to preserve | Follow-up |
| --- | --- | --- |
| Buffer attributes | WebGLAttributes merges overlapping/adjacent update ranges in place | Evaluate density thresholds rather than implementing partial updates again |
| Texture upload | Cached pixel storage and range support already exist | Repair row handling and sparse initialization first |
| Batched draw submission | WEBGL_multi_draw has a per-draw fallback | Run both paths; a batch is not guaranteed to be one driver call on every device |
| Instancing | InstancedMesh and BatchedMesh already reduce submission overhead | Improve allocator, uploads and query scaling inside those classes |
| Program/pipeline caches | WebGL program sharing and common-renderer pipeline caches already exist | Measure invalidation causes before adding another cache |
| WebGPU static work | BundleGroup and cached render bundles already exist | Improve retained CPU refresh rather than proposing a duplicate bundle API |
| Geometry/texture lifetime | Explicit disposal and current r187 cleanup paths are present | Track bytes/peaks and test resize/context behavior; do not infer residency from object counts alone |
| Codecs | Draco/KTX2 loaders have worker controls and buffer/task caches | Shared decoder pools may merit a separate addon audit; no uncached-decode claim is made |

This covers the renderer/core hot paths relevant to large dynamic scenes. Shader graph, animation, skinning, shadow, transmission and codec workloads need dedicated runtime campaigns before claiming comprehensive performance results for those subsystems. XR, audio, editor and unrelated examples are not measured here.

## Recommended upstream sequence

1. Fix E05 and E06 as small correctness changes with upstream regression tests.
2. Submit E01 independently. Its algorithmic effect is large and does not depend on GPU availability.
3. Submit E02 with visibility, child traversal and deferred-upload tests.
4. Build E03 on correct allocation/range semantics, including sparse-versus-dense thresholds.
5. Submit E04 independently with multi-camera/shadow/order tests.
6. Prototype E07 and E08 with memory/update-cost tradeoffs.
7. Require new measurements before expanding APIs or caches for E09 through E15. Add the tracing in E16 to support those decisions.

Five experimental patches and their source transformations are supplied for review. They are not merged into engine source, and do not constitute production or cross-browser qualification. The existing upstream BatchedMesh test bodies, custom CPU checks and real WebGL pixel/upload checks passed within the stated scopes; the multirow-range GL error and upstream blank resize frame remain explicitly recorded as findings.
