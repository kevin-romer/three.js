# Three.js performance against Janus Studio

[Followup E02/C09 engine changes and Janus benchmarks](next-audit/README.md) extend this work. The original cache qualification below is pinned to `2099f6f`; use that revision when running its historical source verifier.

The [performance goal](goal.json) is complete. The fork's opt-in inactive WebGL program cache reduces p95 Three.js render/reset CPU time by **21.5%** in the full Janus Studio workspace with 400 deterministic synthetic parcels. Five paired rounds give a 95% paired-bootstrap improvement interval of **17.0% to 25.8%**. All four timed application workloads and both stable-scene settings pass the render CPU regression budget.

The improvement is in Three.js. Atlas application files, dependency manifests and deployment state were not changed. The broader [28-item engine audit](../../audit/comprehensive-r187/README.md) remains a prioritized backlog; this goal implements and qualifies program reuse plus a bulk-disposal improvement.

## Results

Control is upstream **r187**, commit `7e89746a687bb88271253698fa108b1dd59825d0`. The measured engine commit is `ea87fa90a4211920f08120639189344c7f73bd96`. All formal timing uses Chrome **156.0.8078.80**, WebGL2 on **ANGLE Metal, Apple M1 Pro**, DPR 1. Desktop cases use 1440 by 900 CSS pixels. Mobile emulation uses 390 by 844 with 4x Chrome CPU throttling; it does not qualify a physical mobile device.

| Workload | p95 Three.js CPU improvement | 95% improvement interval | Evidence |
| --- | ---: | ---: | --- |
| Full Studio, 400 synthetic parcels | 21.5% | 17.0% to 25.8% | [Desktop](evidence/desktop-paired-summary.json) |
| Full Studio, 100 synthetic parcels | 44.8% | 41.0% to 49.3% | [Scaling](evidence/scale100-paired-summary.json) |
| Native/illustration renderer, 45 retained buildings | 64.0% | 61.9% to 65.6% | [3D](evidence/buildings-paired-summary.json) |
| Full Studio, 400 parcels, mobile emulation | 11.1% | 6.0% to 15.2% | [Mobile](evidence/mobile-paired-summary.json) |

Each case has five alternating AB/BA pairs, 120 warmup frames and 300 measured frames per run: **12,000 measured application frames** in total. Every timed frame is nonempty. Paired draw/triangle/render-call counts and all three deterministic framebuffer captures per run match exactly. Each pair has identical application sources, browser/backend, dataset and inputs, with zero JavaScript, console or GL errors. All 45 buildings, including 20 at full detail, retain identity, level and visibility on every warmup and measured frame through pan, zoom, bearing and small tilt changes. The 3D case uses the real native map and IllustrationController fixture; it does not include the full Studio UI.

The table below gives the median of the five per-round percentiles, upstream to fork, in milliseconds. The improvement percentages above use paired geometric ratios rather than ratios of these medians.

| Case | CPU p50 | CPU p95 | CPU p99 | Native frame interval p95 |
| --- | ---: | ---: | ---: | ---: |
| Studio 400 | 34.9 to 27.8 | 37.8 to 29.6 | 45.8 to 37.9 | 108.7 to 98.0 |
| Studio 100 | 18.6 to 10.7 | 21.8 to 12.3 | 25.5 to 12.7 | 62.8 to 51.8 |
| Retained buildings | 10.4 to 3.7 | 11.7 to 4.4 | 15.1 to 4.8 | 28.0 to 19.7 |
| Mobile emulation | 132.7 to 116.8 | 150.3 to 135.0 | 179.5 to 153.0 | 471.0 to 438.9 |

CPU sums synchronous Three.js `render` and `resetState` calls used for one native map frame. It measures CPU submission work; GPU completion is unmeasured. Desktop native frame-interval p95 improves **9.3%** (95% interval **4.5% to 13.1%**). The 21.5% CPU result must not be presented as a 21.5% whole-application FPS increase.

[Campaign metrics](evidence/campaign-metrics.json) and all forty `*-pair*.json` files retain per-frame p50/p95/p99, startup observations, observed long tasks, program/geometry counts and pixel hashes. Long-task observation may omit the final pending observer entry. Startup includes local fixture mounting and readiness; neither startup nor long-task improvement is statistically qualified. Formal heap values are approximate, uncollected page heap.

The bootstrap resamples five paired log p95 ratios 10,000 times with seed 20261107; individual frames are not independent runs. The separate [regression-budget analysis](evidence/regression-budget.json) bootstraps paired mean excess over `max(5% of baseline p95, 0.3ms)` with seed 20261108. All six comparisons have their entire 95% budget-excess interval below zero. A stable 1,000-mesh scene passes with cache enabled and with default zero; its variability does not support a separate speedup claim. [Stable-scene results](evidence/stable-scene-summary.json) retain all five triad rounds.

The original fifth scaling pair encountered a candidate browser startup hang before any measured frames. The entire pair was replaced; the first four pairs were preserved and no run was selected by its timing. The [recovery record](evidence/scale100-recovery.json) records the excluded attempt and unchanged inputs.

## Engine changes and use

`WebGLRenderer` accepts `maxInactivePrograms`, a nonnegative safe integer defaulting to **zero**. A positive budget retains compiled programs after their final material release. A matching key reactivates the program; exceeding the budget evicts the least recently used inactive program. Active programs are unlimited by this idle budget. Geometry binding states are released when a program becomes inactive. Original custom shader stage references survive until eviction without retaining material or geometry objects. Known failed links are destroyed immediately, with shader diagnostics enabled. Renderer disposal and context restoration clear the cache.

The followup uniform correction refreshes material uniforms when a disposed material is reused within one render. Ten real-WebGL regression tests cover validation/default release, LRU order, active programs, custom shader identity, built-in uniforms, `onBeforeCompile`, failed links, context restoration, exact disposal and same-render reuse.

After building the fork, enable the cache when constructing a renderer:

```js
const renderer = new THREE.WebGLRenderer({
  canvas,
  maxInactivePrograms: 16
});
```

Replacing the dependency alone does not enable retention. A count budget does not bound driver memory in bytes. Retained programs keep their GL uniform state and numeric caches; every material must initialize the custom uniforms it uses, as with ordinary active-program sharing. Idle entries appear in `renderer.info.programs` with `usedTimes === 0`. The new fork option is not yet in the separately maintained upstream TypeScript declarations.

Final engine commit `c42214c41c60194997208b5ef1a34e8b210c6eed` also passes the known tail index during bulk program destruction, avoiding repeated linear searches. A real-WebGL probe at 128 and 512 unique active programs reduces counted search work from 8,256 and 131,328 inspected array slots to zero, with exact deletion counts, unchanged green pixels and no GL errors. Its single-run disposal times do not qualify a wall-time gain. [Disposal evidence](evidence/dispose-scaling.json) and [source comparison](evidence/final-source-scope.json) show that only `destroyProgram` and `dispose` changed after the measured commit; renderer code, other program-manager code and tests are unchanged. The four performance campaigns remain attributed to `ea87fa9`.

## Profiling, transfers and interactions

In a separate 30-frame counter run, upstream creates/links **90** programs; the cache creates/links **zero**. Program/shader info-log queries fall from **90/180** to **zero/zero**. This meets the secondary call-reduction target. Diagnostics remain enabled. Both variants submit **11,571,840 logical geometry-buffer payload bytes in 61,320 `bufferData` calls**. Program reuse does not reduce that geometry churn. No texture upload calls occur in this selected steady-state sample; logical uniform argument counts/bytes are in [counter evidence](evidence/studio-correctness-lifetime.json), not a measurement of physical driver transfer bandwidth.

The separate [sampled CPU profile summary](evidence/profile-summary.json) attributes about 943ms of upstream samples to program/shader log queries and zero in the candidate. Profiles include warmup, correctness readbacks and 30 counted frames, so they do not establish the formal speedup. Ancestor attribution can include native waits and callbacks. Allocation bytes and GPU residency/completion remain unmeasured.

[Interaction diagnostics](evidence/interaction-diagnostics.json) record ten cycles of selection, clearing, style edits/resets and geometry edits/resets. All 120 output checks match the expected control hashes. Upstream/fork p95 action CPU is 0.8/1.8ms for selection, 1.7/1.7ms for style edits and 20.7/18.9ms for geometry edits; corresponding render-event latency is 88.8/96.6, 149.8/162.8 and 202.2/208.4ms. These are one diagnostic run per variant, without confidence intervals. Some candidate latencies are higher; this evidence qualifies output correctness, not interaction speed or a reproducible latency regression. Readback/hash overhead is reported separately and prior verification can affect scheduling. Picking returns the same entity in all repeated queries; raw pick timings are retained in the correctness artifact. Startup/picking was not the selected optimization and no 10% gain is claimed.

## Correctness, lifetime and limits

The final source passes **1,992 Chrome core tests** with zero failures and one existing todo, **145 addon tests**, and **ten cache regressions each in Firefox and WebKit**, without skips. Core/test lint passes. Five release outputs compile without warnings into temporary storage; only the WebGL module differs from r187 and checked-in builds remain unchanged. [Final qualification](evidence/final-qualification.json) links the fresh gates and source hashes. An addon fixture requests `texture.test`, which the harness records as missing; all addon assertions pass.

The three original product callbacks pass on both variants: Studio state/navigation, 320-pixel reflow/accessibility, and enhanced-building retention/picking. Their original assertions are preserved; only test timeout configuration is bridged to the standalone runner. [Product assertion results](evidence/studio-original-assertions-fork.json) record the runner cleanup limitation. Compatibility smokes pass for current installed r183, upstream/fork Firefox and WebKit, and mobile emulation, with matching nonempty images. These short smokes qualify compatibility, not performance. Gains are measured against r187, not attributed to the r183 upgrade.

Five primary/comparison cycles preserve picks, visible edits and comparison images. Tracked GL API handles stay bounded between cycles and reach zero after full teardown, including context loss for context-owned handles. Six renderers each add/remove three owned canvas subscriptions, leaving zero. **Whole-page retained heap and all-page listener counts grow in both upstream and fork and remain unqualified.** They are measured independently from renderer-owned resources. Direct primary-runtime teardown produces the same pre-existing missing-canvas AggregateError on both variants. [Lifetime evidence](evidence/studio-correctness-lifetime.json) keeps those outcomes separate; it does not prove production memory stability.

The full Studio workload uses synthetic, explicitly **unadmitted** display data through the normal runtime layer API. The governed presentation fixture fails on unchanged upstream because its constructed binding key exceeds the style parser's 512-character maximum. The governed path remains unqualified. No admission/authentication/parser behavior was changed. Results cover one M1 Pro host and controlled local fixtures, not production data or all devices.

## Reproduction

Use an authorized local Janus checkout with existing dependencies, this fork with r187 available, Node.js and Playwright browsers. The recorded application snapshot and package hashes identify the tested local sources; changing application code requires a new qualification. No private application source, credentials, generated fixture modules or raw CPU/heap profiles are published. External browser networking is blocked by the harness.

The original desktop adapters remain frozen under `tools/`; additional campaigns use `qualification-tools/`. Both alias core, addons, `three/src` and worker imports consistently. The upstream control overlays changed source files with exact r187 contents; it is not the candidate with cache disabled. Every additional run fingerprints tools, engine, package and fixture-helper inputs before and after execution. Keep timing serial, with builds/profiling in separate runs.

```sh
node benchmarks/janus-studio/tools/paired-runs.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output desktop
node benchmarks/janus-studio/tools/analyze-pairs.mjs /path/to/private-output desktop
node benchmarks/janus-studio/qualification-tools/paired-runs.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output buildings
node benchmarks/janus-studio/qualification-tools/analyze-pairs.mjs /path/to/private-output buildings
```

Use `scale100` or `mobile` instead of `buildings` for the other Studio cases. Use a checkout at `ea87fa9` to reproduce the exact measured engine. The baseline source manifest is [desktop-source-manifest.json](evidence/desktop-source-manifest.json); subsequent adapters are identified by the [qualification tools manifest](evidence/qualification-tools-manifest.json).

```sh
node benchmarks/janus-studio/qualification-tools/stable-scene.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output
node benchmarks/janus-studio/qualification-tools/analyze-stable.mjs /path/to/private-output
node benchmarks/janus-studio/qualification-tools/interaction-campaign.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output
node benchmarks/janus-studio/qualification-tools/dispose-scaling.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output
node benchmarks/janus-studio/qualification-tools/analyze-regressions.mjs /path/to/private-output
node benchmarks/janus-studio/qualification-tools/verify-completion.mjs /path/to/three.js
```

The completion verifier rechecks public results without private application access. Browser unit reproduction uses the published `qunit-progress.mjs` and `qunit-cache-tests.mjs` with `PLAYWRIGHT_ROOT` pointing to the local Playwright package and `AUDIT_QUUNIT_CASES` choosing engine/version/suite. Place QUnit 2.25.0 `qunit.min.js` in the private output directory (SHA-256 `1c61c415437fd5b05a18b2d9426e915e4805f87c61392d10d90dc9113554789b`); the source is [QUnit's pinned CDN artifact](https://cdn.jsdelivr.net/npm/qunit@2.25.0/qunit/qunit.min.js). Non-`dev` labels load the working tree. Release validation uses `node audit/comprehensive-r187/tools/build-check.mjs /path/to/three.js /path/to/private-build-output`, followed by `npm run lint-core` and `npm run lint-test`.

The separate fork is retained. Temporary fixture modules, profiles, caches and task-owned browser processes are cleaned after evidence publication, as recorded in [completion evidence](evidence/completion.json). No service/container restarts, dependency rollout, upstream PR or deployment occurred.

A subsequent [Enhanced 3D parameter-layout campaign](enhanced-3d/README.md) measures a 10.1% median render CPU reduction against the previous fork, with neutral p95 CPU and slightly slower frame intervals. Its current-source qualification limit and frozen replay results are recorded separately.

The subsequent [WebGL program binding cleanup pass](binding-cleanup/README.md) removes global geometry scans during program retirement. The engine scaling probe improves; the retained Janus Enhanced 3D replay remains statistically neutral and passes its CPU regression budget.

The subsequent [shader parameter reuse pass](parameter-reuse/README.md) reduces retained Enhanced 3D replay p95 render CPU by 17.7% and p95 native frame intervals by 2.7% against the previous fork, using independent paired timing and matching visible work. Current-source qualification limits remain explicit in that report.
