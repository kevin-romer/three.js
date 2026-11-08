# Matrix4 default serialization

November 8, 2026. Directly initializing the array returned by `Matrix4.toArray()` reduces **main-thread script CPU per native Janus Enhanced 3D frame by 1.05%**, with a paired 95% interval of **0.32% to 1.93%**, against the latest fork. Twenty fixed alternating pairs cover **12,000 measured frames**. All paired pixels and visible work match. Frame-interval results are inconclusive; this is a CPU improvement, without a demonstrated FPS gain.

The change is confined to the separate Three.js fork. Atlas files, dependencies and deployment state were not changed. Unlike the preceding campaign, the newly captured Janus source passes its correctness gate. Qualification here covers its native map/IllustrationController renderer fixture, rather than the complete Studio UI or production data.

## Engine change and selection

Control is the previous fork commit `afdba2e26e28ba99d86482ea8c044a749c074c34`; candidate is `469f1adb8daf6f298cb5e66bc2078233a596878b`. The only engine change is in [`Matrix4.toArray`](../../../src/math/Matrix4.js). When no destination is supplied and offset is zero, it returns a dense 16-element array literal initialized from indexed element reads. Previously, it grew an initially empty array through 16 assignments. Every call still returns an independent, owned plain array. No matrix values or output arrays are cached. Supplied destinations and nonzero offsets retain the original writes and coercions; public method arity remains zero.

A fresh exploratory profile ranked default matrix serialization among the remaining engine hotspots: approximately 52.35ms of sampled self time, after buffer attribute and Object3D construction. Those larger constructors entail broader allocation and ownership behavior. This pass selects a small, isolated improvement in the same object-construction path. A separate counter run observes **13,830 default-output calls in 30 measured frames: 461 per frame**, with no supplied targets. [Profile summary](evidence/profile-focus.json), [call diagnostic](evidence/matrix-counts-control.json).

In the exploratory profile, sampled Matrix4 conversion had no Three.js renderer ancestor. Two renderer-only screening pairs were neutral. A separate CPU-boundary screen then informed the declared main-thread CPU metric, before the fixed qualification campaign began. The larger window includes application preparation that invokes Three.js. Profiling, counters and all screens are excluded from qualification. An earlier shader-key memoization prototype recorded zero reuse hits on current Janus inputs and was discarded. [Screening record](evidence/screening.json).

## Results and measurement

| Metric | Median control / candidate, ms | Paired improvement | 95% bootstrap interval |
| --- | ---: | ---: | ---: |
| Mean script CPU per frame, primary | 15.72 / 15.65 | 1.05% | 0.32% to 1.93% |
| Mean task CPU per frame, secondary | 16.70 / 16.63 | 1.07% | 0.34% to 1.91% |
| Render/reset synchronous time p95, secondary | 1.15 / 1.10 | 2.90% | 0.80% to 4.95% |
| Native frame interval p95, secondary | 18.80 / 19.10 | 0.25% | -1.00% to 1.63% |

Times are medians across 20 runs of each variant: per-run means for script/task CPU, and per-run p95 values for the other rows. Improvement estimates use geometric means of paired ratios, so they need not equal ratios of those medians. Intervals resample paired log ratios 10,000 times; run pairs are the resampling units. Published seeds are 20261112/20261113 for script/task CPU and 20261108 for renderer/frame intervals. All 20 pairs are included, with alternating AB/BA order starting AB; there was no outcome-based extension or replacement. Later runs show host drift in both variants, retained in the published data. These are descriptive results on one host and workload. [Pre-campaign declaration](evidence/campaign-declaration.json), [summary and raw rounds](evidence/matrix-buildings-summary.json).

Each member warms 120 frames, captures three deterministic frames, then measures 300 frames. Chrome CDP `Performance` counters use `threadTicks`, sampled immediately before and after the measured loop. ScriptDuration deltas divided by 300 give mean main-thread script CPU per produced frame; TaskDuration also covers other main-thread tasks. Warmup, readbacks, post-run picking and teardown are outside this window. Boundary callbacks are identical for both variants; there is no per-frame CPU-counter IPC. Thread running time excludes idle waiting and does not measure GPU completion or whole-machine CPU. [CDP domain definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Performance.pdl), [Chromium counter implementation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/inspector/inspector_performance_agent.cc).

The existing `engineMs` metric still sums synchronous Three.js `render` and `resetState` wall time; it includes waits inside those calls and excludes preparation elsewhere. Native frame intervals follow the benchmark's frame-production path and are not display FPS. These metrics must not be substituted for script CPU or combined with percentages from earlier campaigns.

The declared shipping rule requires a positive lower bound for primary CPU improvement and a passing renderer regression budget. Both pass. Renderer allowance is `max(5% control p95, 0.3ms)`; the paired mean excess 95% interval is **-0.36 to -0.31ms**. No claim is made for startup, interaction latency, retained heap, GPU time, mobile performance or WebGPU performance.

## Current Janus inputs and equivalence

The frozen private snapshot contains 317 files, aggregate SHA-256 `65d8f2bdd7940d1df839c986c3c41bfdf7dfaa5c664d5737cc601430d0120257`. Four files changed from the preceding failed snapshot. Its initial gate on the control and every timed run have zero JavaScript, console and GL errors. The previous NaN-bound failure is absent in these inputs; this pass did not diagnose or change Atlas geometry. [Fresh-source gate](evidence/fresh-source-gate.json).

The current application performs 49 draws per measured frame, compared with 138 in the older validated replay. That application-side difference is present in both control and candidate and contributes nothing to this pass's incremental engine comparison. Historical campaign timings are not comparable across these application snapshots.

Both variants retain all 45 synthetic buildings, including 20 at full detail, with identity, detail and visibility checked throughout warmup and measurement. Draw, triangle and render-call counts match frame by frame; all **60 paired framebuffer captures** match exactly; visible picks pass. No reduction in detail or visible work contributes to the gain. Application files, actual dependency manifests, engine revisions and tool hashes are checked before and after each member. The 201 actually served source files have a separate aggregate digest in every record. Private file names and source contents are omitted from public evidence.

Hardware is WebGL2 on ANGLE Metal / Apple M1 Pro, Chrome 156.0.8078.80, viewport 1440 by 900 and DPR 1. Both engine variants retain the existing `maxInactivePrograms: 16` benchmark setting. This Matrix4 change requires no new option; no zero-cache performance campaign was run. Exact runtime, dependency and tool hashes are in the protocol.

## Verification and reproduction

Final gates pass: **2,013 core tests** with one existing todo, **145 addon tests**, **51 Matrix4 tests each in Chrome, Firefox and WebKit**, and **217 WebGL tests each in those browsers**, with zero failures, skips or soft skips. The addon suite retains its existing expected missing `test/unit/texture.test` request. Three new Matrix4 tests cover owned output arrays, typed/sparse/indexed sources, custom iterators, special numbers, supplied targets/offsets and observable get/set order. A separate seeded comparison of actual baseline/candidate methods passes **10,000 comparisons**, including matching exceptions. Core/test lint passes and five release outputs compile without warnings. Only `three.core.js` differs from the preceding fork build; the two `matchesPublished: false` entries compare against checked-in r187 bundles. Checked-in builds remain unchanged. [Qualification](evidence/qualification.json), [equivalence](evidence/matrix-equivalence.json), [build results](evidence/build-results.json).

Verify the public raw results, fingerprints, gates and recomputed statistics without private Janus access:

```sh
node benchmarks/janus-studio/matrix-serialization/tools/verify.mjs /path/to/three.js
```

With authorized frozen inputs and matching installed dependencies, reproduce timing serially:

```sh
BENCH_APP_MANIFEST=/path/to/private-fresh-app-source-manifest.json node benchmarks/janus-studio/matrix-serialization/tools/paired.mjs /path/to/fresh-app /path/to/three.js /path/to/private-output matrix afdba2e26e28ba99d86482ea8c044a749c074c34 469f1adb8daf6f298cb5e66bc2078233a596878b buildings timing 20
node benchmarks/janus-studio/matrix-serialization/tools/analyze-cpu.mjs /path/to/private-output
node benchmarks/janus-studio/matrix-serialization/tools/matrix-equivalence.mjs /path/to/three.js /path/to/private-output afdba2e26e28ba99d86482ea8c044a749c074c34 469f1adb8daf6f298cb5e66bc2078233a596878b
```

With candidate sources checked out, `tools/run-units.mjs THREE OUT full` runs core/addons and `focused` runs WebGL on all three browsers. For Matrix4, invoke `tools/qunit-progress.mjs THREE OUT` with `BENCH_TEST_FILTER=Matrix4` and `AUDIT_QUUNIT_CASES` selecting the three engines with version `matrix-pass` and suite `core`. Set `PLAYWRIGHT_ROOT` to installed Playwright and put QUnit 2.25.0 `qunit.min.js` in OUT (SHA-256 `1c61c415437fd5b05a18b2d9426e915e4805f87c61392d10d90dc9113554789b`). Build validation uses `audit/comprehensive-r187/tools/build-check.mjs`; lint uses `npm run lint-core` and `npm run lint-test`. All paths above are relative to this campaign unless fully specified. External browser networking is blocked.

The separate fork remains available for review and further work. Private inputs, profiles and exploratory evidence are archived outside both repositories, with task-owned temporary resources cleaned after archive verification. No Atlas rollout, service/container restart, upstream PR or deployment occurred. [Completion and archive metadata](evidence/completion.json).
