# WebGL shader parameter reuse

November 8, 2026. Reusing temporary Three.js shader-parameter records reduces **p95 render CPU by 17.7%** in the validated Janus Enhanced 3D replay, with a paired 95% interval of **15.6% to 19.8%**. Median render CPU improves 8.7%, and p95 native frame intervals improve 2.7%. Both engine versions render the same work and pixels.

The change is in the separate Three.js fork. Atlas source, dependencies and deployments were not modified. Fresh Janus inputs still produce bounds errors on the previous fork, so these gains qualify the validated frozen renderer replay rather than current-source Studio or production performance.

## Engine change

Commit `4057720aade3bccba8a907f86cb30a84a3cf5c59` changes `WebGLPrograms`, `WebGLRenderer` and an internal material hook identity export. The previous renderer allocated a large parameter record whenever it prepared a material program, including repeated hits in the already-compiled program cache. Baseline sampling identified parameter construction as the largest Three.js self-time entry in this replay. [Baseline profile summary](evidence/profile-focus.json).

The renderer now borrows a scratch record for each preparation and returns it in a `finally` block. Features, current geometry, lights, clipping and shader keys are recomputed on every preparation. This is object reuse, not a cache of mutable feature values. Nested preparations acquire separate records. At most four idle records are retained; excess returned records are cleared and discarded. Material, uniform, shader source and shader-stage references are cleared before a record returns to the pool.

Custom `onBeforeCompile` hooks and node builders receive independent, mutable plain records. They may retain or freeze those records. A snapshot of the original empty hook distinguishes it from prototype overrides; only that original no-op is skipped. Newly compiled programs receive owned parameter snapshots. Owned copies preserve optional field presence and property order. Ordinary `getParameters` queries still return independent records. Exception paths return borrowed storage, and program-cache disposal empties the idle pool.

A separate 30-frame allocation diagnostic records **2,730 fresh records in the control**, versus **2,730 reuses, zero fresh records and zero owned copies in the candidate's measured steady frames**. Both variants warm 120 frames first. Pixels and visible work match. These counters measure record creation, not retained heap bytes or garbage-collection time. Cold compilation and custom hooks can still allocate owned records. [Control](evidence/records-control.json), [candidate](evidence/records-candidate.json), [diagnostic protocol](evidence/diagnostic-protocol.json).

No public option was added. The existing inactive program cache remains opt-in; **both measured variants use `maxInactivePrograms: 16`**. Default zero-budget behavior passes correctness tests, but its performance was not measured here. Consumers must build all fork outputs together: the shared core and WebGL module change, while the three other release outputs match checked-in r187 bytes. Checked-in bundles remain unchanged.

## Janus benchmark results

Control: previous fork commit `ea69691dd6bf55acafdce5bbbd87e636173f94b8`. Candidate: `4057720`. Five fixed alternating AB/BA pairs each warm 120 frames and measure 300, totaling **3,000 measured frames**. P95 render CPU is primary; median CPU is a declared secondary metric. The cohort was declared before timing, includes every pair, and has no outcome-based extension. Screening and all profiling, counters, builds and unit tests are excluded from timing. [Declaration](evidence/campaign-declaration.json), [summary and raw rounds](evidence/pool-buildings-summary.json).

| Metric | Median control / candidate, ms | Paired improvement | 95% bootstrap interval |
| --- | ---: | ---: | ---: |
| Render CPU p95, primary | 3.6 / 3.0 | 17.7% | 15.6% to 19.8% |
| Render CPU p50, secondary | 2.7 / 2.5 | 8.7% | 7.4% to 11.3% |
| Native frame interval p95 | 23.0 / 22.5 | 2.7% | 0.8% to 4.5% |

Times are medians of per-run percentiles, not pooled frame statistics. Improvements use geometric means of paired percentile ratios. Intervals resample paired log ratios 10,000 times with fixed published seeds; independent runs, rather than frames, are the resampling units. The candidate was selected after exploratory screening; the qualification cohort is separate. These are descriptive results for this host and workload.

The p95 CPU allowance is the larger of 5% of each control or 0.3ms. The paired mean excess interval is -1.02 to -0.86ms, so the regression budget passes. These incremental percentages must not be added to earlier campaign percentages.

The workload uses the real Janus native map and IllustrationController fixture, retaining 45 synthetic buildings, including 20 at full detail. UUIDs, detail levels and visibility remain fixed through warmup and measurement. Draw, triangle and render-call counts match frame by frame; all three framebuffer captures match within every pair; visible building picks pass. JavaScript, console and GL errors are zero. Detail reduction and extra culling do not contribute to the gain.

CPU is synchronous time inside Three.js `render` and `resetState`, including callbacks executed there. Application preparation outside those calls and GPU completion are outside that metric. Frame intervals include the benchmark's native frame-production path and are not a direct display FPS measurement. This is an Enhanced 3D renderer replay, not the full Studio UI or production data.

Hardware is WebGL2 on ANGLE Metal / Apple M1 Pro, Chrome 156.0.8078.80, a 1440 by 900 CSS viewport and DPR 1. Actual Node/runtime versions and source/tool hashes are in every protocol. Mobile, WebGPU performance, GPU completion, full Studio interactions, application teardown and retained heap stability were not measured.

## Current source and rejected candidate

A fresh private snapshot contains 317 files, SHA-256 `a3d11a77d373900086a8074896b76ffed6d3d1659d9e6bd6a574c862e56d40c0`. Five files changed since the prior gate. On the previous fork, its 120 warmup plus 30 measured frame gate produced 154 NaN bounding-sphere console errors, with no JavaScript or GL error. It was excluded before qualification. The geometry failure's root cause is not diagnosed here. [Fresh-source evidence](evidence/current-source-status.json).

Timing therefore uses the previously validated 317-file snapshot, SHA-256 `f49ae9661826cf5876d22c5152bbe91c002bd2b8d8809d6302159f175d4fdfe1`. Its files, engine revisions, measurement tools and actual dependency manifests are verified before and after every member. Current-source Enhanced 3D performance remains unqualified. Private sources and detailed failure logs stay outside the public fork.

An earlier prototype preinitialized material bookkeeping records. Two exploratory pairs showed no gain, so that prototype was discarded. Parameter reuse then showed lower CPU in two exploratory pairs and proceeded to the independently declared qualification cohort. All screening is excluded from the reported estimates. [Rejected candidate](evidence/rejected-screening.json).

## Verification and replay

Final gates pass: **2,010 core tests** with one existing todo; **145 addon tests**; and **217 WebGL-filtered tests each in Chrome, Firefox and WebKit**, with zero failures, skips or soft skips. Seven new tests cover active-lease isolation, the idle-pool bound, reference clearing, field/value/order preservation, exception recovery, retained/frozen hooks, prototype overrides, nested rendering and node builders. Existing uniform refresh, failed-link diagnostics, cache lifetime and context-restoration tests pass. Core/test lint passes; all five release outputs compile without warnings. The addon suite records the existing expected missing `texture.test` request. [Qualification](evidence/qualification.json), [build results](evidence/build-results.json).

Verify the public results without private Janus access:

```sh
node benchmarks/janus-studio/parameter-reuse/tools/verify.mjs /path/to/three.js
```

With authorized frozen application inputs and matching installed dependencies, reproduce timing and analysis:

```sh
BENCH_APP_MANIFEST=/path/to/private-app-source-manifest.json node benchmarks/janus-studio/next-audit/tools/next-paired.mjs /path/to/private-app /path/to/three.js /path/to/private-output pool ea69691dd6bf55acafdce5bbbd87e636173f94b8 4057720aade3bccba8a907f86cb30a84a3cf5c59 buildings timing
node benchmarks/janus-studio/parameter-reuse/tools/analyze.mjs /path/to/private-output
```

For the separate counters, run `parameter-reuse/tools/diagnostic-run.mjs APP THREE OUT control` with `BENCH_ENGINE_REF` set to the control commit and `BENCH_RUN` set to `{"label":"records-control","frames":30}`. Repeat with the candidate commit, candidate variant and `records-candidate` label. The diagnostic server applies source overlays before counter instrumentation.

With the candidate checked out, run `parameter-reuse/tools/run-units.mjs THREE OUT focused` or `full`, setting `PLAYWRIGHT_ROOT` to installed Playwright. Put QUnit 2.25.0 `qunit.min.js` in OUT; its SHA-256 is `1c61c415437fd5b05a18b2d9426e915e4805f87c61392d10d90dc9113554789b`. Build validation uses `audit/comprehensive-r187/tools/build-check.mjs`; lint uses `npm run lint-core` and `npm run lint-test`.

The separate fork is retained for review and further work. Task replay directories, caches and owned browser resources are cleaned after publication, while private replay/profile evidence is archived outside both repositories. No Atlas rollout, service/container restart, upstream PR or deployment occurred. [Completion and archive metadata](evidence/completion.json).
