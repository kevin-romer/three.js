# Next Three.js audit fixes: visibility and material lifetime

November 8, 2026. This iteration implements **E02** and **C09** from the [engine audit](../../../audit/engine-r187/README.md) and [comprehensive audit](../../../audit/comprehensive-r187/FINDINGS.md). The changes belong to Three.js. Atlas source, dependencies and deployment state were not modified by this work.

The demonstrated engine benefits are avoided buffer submissions for hidden geometry and released renderer closures when applications retain materials. E02 makes Studio p95 CPU 1.7% slower, within its regression allowance; C09 remains statistically neutral with uncertain budget qualification after ten pairs. No additional Janus render CPU speedup is demonstrated. Negative improvement percentages mean slower CPU time.

## Changes and engine evidence

**E02**, commit `e2c4394c7c528dbae5607132fb0218414eec7e95`, checks single-material visibility before geometry preparation for meshes, lines, points and sprites. Children still traverse, material arrays keep their group behavior, and revealing objects performs deferred uploads. Instanced attributes are covered. **Callback timing changes:** an `onUpload` callback on hidden geometry now waits until that geometry is eligible for upload. Clients relying on uploads to reveal invisible materials need to account for that timing.

A real-WebGL probe with 128 hidden dirty meshes and a visible child reduces 30-frame `bufferSubData` traffic from **3,840 calls / 35,389,440 logical payload bytes to zero**. The child remains green with one draw, revealing the meshes produces 129 draws, and both variants have zero GL errors. This is an engine operation-count result, not a Janus bandwidth gain or a measurement of physical GPU transfer. [Control](evidence/engine-hidden-upload-control.json), [candidate](evidence/engine-hidden-upload-candidate.json).

**C09**, commit `bd07567b61110c675350c57f9df46980ae91a055`, tracks registered materials through weak references and unregisters renderer-owned disposal callbacks on renderer disposal and context restoration. A finalization registry retires dead bookkeeping entries. Material disposal also removes its registration. The registry does not strongly retain unused materials, and disposing one renderer preserves another renderer sharing its material.

In a separate Chrome explicit-GC probe, a disposed renderer remains reachable through a retained material in the control and becomes collectible after the fix. The material's renderer subscription falls from one to zero. An unused material is collectible with a live renderer in both variants, guarding against a strong-reference registry regression. These are targeted reachability checks, not a retained-heap byte measurement or proof of production memory stability. [Control](evidence/engine-lifetime-gc-control.json), [candidate](evidence/engine-lifetime-gc-candidate.json).

Both changes apply after building the fork and add no public options. The earlier program cache remains opt-in; **all comparisons here hold `maxInactivePrograms: 16` constant**. Checked-in release builds remain unchanged, so consumers must build the fork to use its modified source.

## Janus Studio results

Each change is measured against its immediate engine baseline. E02 compares the previous fork commit `2099f6f8c9aba5957567ac6186f5a9eb274bdb75` with `e2c4394`; C09 compares `e2c4394` with `bd07567`. These incremental results cannot be added to the percentages in the [earlier cache campaign](../README.md), which used a different application snapshot.

| Change and workload | Paired rounds | p95 CPU improvement | 95% bootstrap interval | CPU regression budget |
| --- | ---: | ---: | ---: | --- |
| E02, full Studio 400 parcels | 10 | -1.7% | -3.61% to -0.05% | pass |
| E02, retained 45-building renderer | 5 | -1.0% | -6.4% to 4.1% | pass |
| C09, full Studio 400 parcels | 10 | 0.1% | -5.5% to 5.1% | unqualified |

The budget is the larger of 5% of each control p95 or 0.3ms. The paired mean excess over that allowance is bootstrapped: an upper interval bound at or below zero passes; an interval crossing zero remains **unqualified**; a lower bound above zero indicates a reproducible breach. No uncertain result is presented as a pass. Any remaining uncertainty limits CPU qualification for Janus adoption.

The Studio cases use the actual workspace UI and native map with 400 deterministic, explicitly synthetic **unadmitted** parcels through the normal runtime layer API. The 3D case uses the real native/IllustrationController renderer fixture, not the full Studio UI. All 45 buildings, including 20 at full detail, retain UUID, level and visibility on every warmup and measured frame. Picks return the expected visible building.

Every run warms 120 frames and measures 300. Every timed frame has geometry. Draw, triangle and render-call counts match within pairs, as do all three deterministic framebuffer captures per run. JavaScript, console and GL errors are zero. The published raw rounds contain p50/p95/p99, native frame intervals, startup observations, observed long tasks, approximate heap and program/geometry counts.

The following values are medians of per-round CPU percentiles, control / candidate, in milliseconds; they are not pooled frame statistics.

| Change and workload | CPU p50 | CPU p95 | CPU p99 |
| --- | ---: | ---: | ---: |
| E02, full Studio 400 parcels | 18.8 / 19.0 | 20.3 / 20.4 | 23.2 / 22.2 |
| E02, retained 45-building renderer | 3.1 / 3.1 | 3.7 / 3.7 | 4.4 / 4.1 |
| C09, full Studio 400 parcels | 19.6 / 19.5 | 21.5 / 21.6 | 23.4 / 22.7 |

CPU measures synchronous Three.js `render` plus `resetState` time per native frame. GPU completion is unmeasured. Frame-interval statistics are separate in each summary and should not be interpreted as the same CPU speedup. Timing excludes detailed GL/resource instrumentation. The ratio bootstrap resamples paired log p95 ratios 10,000 times with seed 20261108; the budget bootstrap resamples paired mean excess with seed 20261109. Frames are not independent runs.

The first five Studio rounds for both changes left the budget uncertain. One fixed additional block of five pairs was declared for each before collecting further data, continuing AB/BA order. All ten enter each final estimate. Initial summaries and the declarations remain in the evidence directory; the descriptive bootstrap intervals retain that sampling history. The 3D case has five pairs.

## Fixed inputs, compatibility and limits

The machine uses Chrome 156.0.8078.80, WebGL2 on ANGLE Metal / Apple M1 Pro, a 1440 by 900 CSS viewport and DPR 1. Node and actual installed runtime package versions are recorded in every protocol. Software rendering is rejected. Mobile and WebGPU performance were not measured for these changes.

An early attempt detected Atlas changing during the fifth building pair. That pair is invalid. The preliminary Studio pairs individually match their controls but span two application snapshots. Those preliminary observations are preserved separately in [source-drift-recovery.json](evidence/source-drift-recovery.json) and are excluded from the fixed-snapshot qualification. No round was excluded based on its timing.

All final campaigns use a private frozen application snapshot: **317 files**, SHA-256 `f49ae9661826cf5876d22c5152bbe91c002bd2b8d8809d6302159f175d4fdfe1`. It includes the fixture and its served/import-resolution sources, with package manifests and lockfile. Each run verifies those files, engine revisions, measurement tools and actual runtime dependency manifests before and after execution. Application sources and configuration remain outside the public fork. Private replay inputs are preserved separately; configuring an authorized local fixture environment is required.

Selection, style/geometry edits, 100 repeated picks and five comparison cycles match between C09 control and candidate. The tracked comparison subscriptions already retire in the control; this run does not establish additional Janus heap savings. Primary workspace teardown is outside that diagnostic's scope. [Behavior evidence](evidence/janus-behavior.json) includes one post-GC heap batch per variant; whole-page heap stability remains unqualified. Governed presentation and production data are outside these synthetic fixture measurements. Startup and long-task observations are diagnostic; the observer may omit its final pending entry. Driver residency and allocation bytes are unmeasured.

The final source passes **1,998 Chrome core tests**, zero failures and one existing todo; **145 addon tests**; and **205 WebGL-filtered tests each in Chrome, Firefox and WebKit**, without skips or soft skips. Six new real-WebGL regressions cover visibility and material lifetime. The hidden-upload regression fails before E02, and all three lifetime regressions fail before C09. Core/test lint passes. Five release outputs compile without warnings; the four non-WebGL outputs match r187 bytes. The addon fixture's expected `texture.test` request is recorded as missing without failing assertions. [Qualification](evidence/qualification.json) and [build evidence](evidence/build-results.json).

The remaining audit findings are still open, including shared-attribute ownership, loader request identity and BatchedMesh/WebGPU work. No BatchedMesh use was found in the inspected Janus native and illustration paths, so it was deferred from this iteration. No Atlas dependency rollout, service/container restart, upstream PR or deployment occurred.

## Reproduce and verify

The source pins, tool hashes and all qualified raw rounds are public. Run the verifier without private application access:

```sh
node benchmarks/janus-studio/next-audit/tools/verify-next.mjs /path/to/three.js
```

To rerun Janus, use the preserved private source snapshot or an authorized checkout matching its hashes. Initial local discovery records retain `appSources`; use them to freeze imports before timing:

```sh
node benchmarks/janus-studio/next-audit/tools/freeze-app.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output /path/to/private-studio-probe.json /path/to/private-building-probe.json
node benchmarks/janus-studio/next-audit/tools/copy-resolution-targets.mjs /path/to/atlas-front /path/to/private-output
node benchmarks/janus-studio/next-audit/tools/run-diagnostics.mjs /path/to/private-output/private-app /path/to/three.js /path/to/private-output
node benchmarks/janus-studio/next-audit/tools/run-final-campaigns.mjs /path/to/private-output/private-app /path/to/three.js /path/to/private-output
```

Discovery can use `next-paired.mjs APP THREE OUT LABEL CONTROL_REF CANDIDATE_REF studio diagnostic`, and `buildings` in place of `studio`. Keep all inputs and output private and outside both repositories. Install dependencies from the preserved application lockfile if its original dependency directory is unavailable. Frozen configuration must remain private. Timing runs are serial; run builds and diagnostics separately. Copy `e02-frozen-extension-declaration.json` and `c09-extension-declaration.json` from evidence into OUT, then run `run-extensions.mjs APP THREE OUT` to reproduce the ten-pair Studio sampling history. `analyze-next.mjs OUT STAGE SCENE 10` analyzes ten rounds; its default is five.

Browser unit reproduction uses `run-units.mjs THREE OUT focused` or `full`, with `PLAYWRIGHT_ROOT` pointing to the installed Playwright package and QUnit 2.25.0 `qunit.min.js` in OUT. Its SHA-256 is `1c61c415437fd5b05a18b2d9426e915e4805f87c61392d10d90dc9113554789b`. Build validation uses the existing `audit/comprehensive-r187/tools/build-check.mjs`; lint uses `npm run lint-core` and `npm run lint-test`. Task browser/build resources and temporary checkouts are cleaned after publication; private replay source is retained as a separate artifact, as recorded in [completion evidence](evidence/completion.json) and [private replay metadata](evidence/replay-inputs.json).
