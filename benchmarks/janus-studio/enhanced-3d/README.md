# Enhanced 3D: WebGL shader parameter records

November 8, 2026. The separate Three.js fork now initializes shader parameter records through a constructor, preserving their plain-object prototype and all existing fields. On the frozen Janus retained-building fixture, this reduces median synchronous render CPU time by **10.1%**. P95 CPU remains statistically neutral. **This does not demonstrate a frame-rate improvement:** p95 frame intervals are 1.1% slower in this cohort.

Atlas source, dependencies and deployment state were not modified. This iteration addresses the shader setup cost identified while profiling Enhanced 3D; the earlier engine and comprehensive audit manifests remain frozen.

## Engine change

Commit `e48c8880d9daf3e3e1c16bf890b69d4bdf1fc335` changes `src/renderers/webgl/WebGLPrograms.js`. Its previous 139-field object literal uses dictionary properties in the local V8 shape probe. Constructor initialization keeps fast properties while setting the same fields in the same order. `Object.getPrototypeOf(parameters)` remains `Object.prototype`; custom `onBeforeCompile` callbacks still receive independent, mutable records. No new public option or persistent parameter cache is introduced.

Sixteen material-state comparisons cover built-in, ShaderMaterial and RawShaderMaterial records, with texture channels, physical features and transparency enabled or disabled. Cache-local shader stage identities are normalized for that comparison. Existing real-WebGL program lifetime, shader identity, uniform refresh and context restoration tests still pass. A new real-WebGL test checks custom shader edits, plain-object semantics and retained record independence. [Shape/equivalence diagnostic](evidence/layout-check.json), [qualification](evidence/qualification.json).

The shape result is specific to Node/V8; browser timing establishes the measured application benefit. Separate Chrome sampling diagnostics cover warmup, readbacks and 300 frames. They show less total sampled time under the renderer, but parameter preparation's own samples increase and caller attribution changes. These single-profile observations do not establish a function-level speedup. Raw profiles remain in the private evidence archive. [Profile aggregates](evidence/profile-summary.json).

Consumers must build the fork to use the source change. Checked-in release bundles remain unchanged. The existing inactive program cache is still opt-in; **both benchmark variants use `maxInactivePrograms: 16`**.

## Janus benchmark

The control is previous fork commit `9c6f26bb55e83416541009ac1444ba611b9a05b1`; the candidate is `e48c888`. Five alternating AB/BA pairs each warm 120 frames and measure 300. The fixed cohort contains 3,000 measured frames. Screening, profiling, builds and unit runs are excluded from timing. The primary metric and secondary median metric were declared before the cohort. [Declaration](evidence/layout-campaign-declaration.json), [summary and raw rounds](evidence/layout-buildings-summary.json).

| Metric | Median control / candidate, ms | Paired improvement | 95% bootstrap interval |
| --- | ---: | ---: | ---: |
| Render CPU p50, secondary | 3.0 / 2.7 | 10.1% | 8.2% to 12.0% |
| Render CPU p95, primary | 3.5 / 3.5 | 0.6% | -1.7% to 3.3% |
| Native frame interval p95 | 22.5 / 22.9 | -1.1% | -2.0% to -0.3% |

Negative improvement means slower. CPU includes synchronous Three.js `render` and `resetState` time per native frame; it excludes GPU completion and substantial application preparation outside those calls. Table times are medians of per-run percentiles, not pooled frame statistics. Intervals use 10,000 paired log-ratio resamples; the five independent pairs, rather than individual frames, are the resampling units. Seeds and all samples are published.

The p95 CPU regression allowance is the larger of 5% of control or 0.3ms. The 95% interval of paired mean excess is -0.42 to -0.24ms, so the CPU budget passes. This allowance does not qualify frame cadence, which worsened slightly. No extra pairs were collected after inspecting the cohort.

The workload uses the real Janus native map and IllustrationController fixture with 45 synthetic buildings, including 20 at full detail. It is a retained Enhanced 3D renderer replay, not the full Studio UI or production data. Every warmup and measured frame preserves model UUIDs, detail level and visibility. Draw/triangle/render-call counts match frame by frame, all three framebuffer captures match within every pair, and visible building picks pass. JavaScript, console and GL errors are zero. No detail reduction or culling change contributes to the result.

Hardware is WebGL2 on ANGLE Metal / Apple M1 Pro, Chrome 156.0.8078.80, 1440 by 900 CSS pixels, DPR 1. Actual Node/package versions and source/tool hashes are in every protocol. Mobile, WebGPU performance, GPU completion, heap stability, teardown performance and full Studio UI performance were not measured for this change. This cohort does not add to the percentages in earlier campaigns.

## Current-source qualification limit

The latest inspected application snapshot produced NaN bounding-sphere errors during baseline discovery. That run recorded 424 console errors and was excluded before engine qualification. An explicit previous-commit confirmation is recorded with the same failure metadata. The geometry failure's root cause is not diagnosed here. Timing a warning-producing baseline would not qualify an engine improvement. [Failure evidence](evidence/current-baseline-failure-summary.json).

Qualified timing therefore uses the previously validated, private frozen snapshot: 317 files, SHA-256 `f49ae9661826cf5876d22c5152bbe91c002bd2b8d8809d6302159f175d4fdfe1`. Both variants verify these files, dependency manifests and engine/tool hashes before and after every run. Current-source Enhanced 3D performance remains unqualified until its baseline renders correctly. Private application source and profiles are excluded from the public fork.

## Candidates rejected before qualification

A bounded GPU buffer reuse prototype eliminated 136,500 create/delete operations across a diagnostic 300-frame run, but neither reuse strategy demonstrated a CPU improvement. It also needs separate shared-attribute ownership work. It was not landed. A RawShaderMaterial parameter fast path was discarded after a diagnostic showed all 2,730 measured preparations were regular ShaderMaterial; it did not address the active steady-frame path. Those prototypes and screening timings are excluded from the five-pair estimate. [Screening evidence](evidence/rejected-screening.json).

## Verification and replay

Final gates pass: **1,999 core tests** with one existing todo; **145 addon tests**; and **206 WebGL tests each in Chrome, Firefox and WebKit**, with zero failures, skips or soft skips. Core/test lint passes. All five release outputs build without warnings; only the WebGL module differs from checked-in upstream output. The addon suite records the existing expected missing `texture.test` request. The unit runner retains legacy case labels, explained in qualification metadata; these runs test the committed parameter layout implementation.

Public evidence can be checked without private application access:

```sh
node benchmarks/janus-studio/enhanced-3d/tools/verify.mjs /path/to/three.js
node --allow-natives-syntax benchmarks/janus-studio/enhanced-3d/tools/check-layout.mjs /path/to/three.js /path/to/private-output
```

For Janus replay, provide authorized private application inputs matching the frozen manifest and their installed dependencies, then use the unchanged preceding campaign harness:

```sh
BENCH_APP_MANIFEST=/path/to/private-app-source-manifest.json node benchmarks/janus-studio/next-audit/tools/next-paired.mjs /path/to/private-app /path/to/three.js /path/to/private-output layout 9c6f26bb55e83416541009ac1444ba611b9a05b1 e48c8880d9daf3e3e1c16bf890b69d4bdf1fc335 buildings timing
node benchmarks/janus-studio/enhanced-3d/tools/analyze.mjs /path/to/private-output
```

Use `next-audit/tools/run-units.mjs` for browser suites with the tested candidate checked out, `PLAYWRIGHT_ROOT` set to installed Playwright, and pinned QUnit 2.25.0 in the private output directory. Build with `audit/comprehensive-r187/tools/build-check.mjs`; run `npm run lint-core` and `npm run lint-test`. Profiling tools in this directory are for separate diagnostic runs.

The separate fork is retained for review and further work. Temporary replay files, caches and owned browser resources are cleaned after evidence publication; private replay/evidence archives are retained outside both repositories. No service/container restart, Atlas rollout, upstream PR or deployment occurred. [Completion and archive metadata](evidence/completion.json).
