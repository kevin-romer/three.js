# WebGL program binding cleanup

November 8, 2026. Three.js now releases a program's vertex-array bindings through a reverse index, avoiding a scan of unrelated geometry and objects. The engine cleanup probe demonstrates bounded work as unrelated geometry grows. **The Janus Enhanced 3D replay remains statistically neutral**, with its p95 CPU regression budget passing; no additional frame-rate improvement is established.

This change is in the separate Three.js fork. Atlas source, dependencies and deployments were not changed. Earlier audit manifests and benchmark cohorts remain frozen.

## Engine change and lifecycle

Commit `1db45f2bb215a247fd73ea0aeb89ef6a7b63342d` changes `src/renderers/webgl/WebGLBindingStates.js`. Previously, `releaseStatesOfProgram` traversed every cached geometry/object map to find a program's VAOs. It did so even after geometry disposal had already removed every binding belonging to that program.

The reverse index maps each program ID to the geometry/object maps containing its bindings. Program release visits those maps only; an absent program takes one lookup. Geometry, instanced-object and renderer disposal remove reverse-index entries along with their VAOs. Solid and wireframe variants share one index entry. Cleanup remains proportional to the target program's own bindings when it has many of them. Object-specific release still traverses geometry maps; that separate traversal was not optimized.

The index adds one reference per registered geometry/object/program group. Its registration cost is included in both the Janus campaign and the probe's repeated target release/recreate cycles. Four regressions cover selective program retirement, geometry/object cleanup, mixed lifecycle order and real-WebGL instanced survivors. Repeated disposal and reactivation preserve binding identity where appropriate and delete each retired VAO once. Existing context restoration and bounded program-cache tests pass. These checks do not quantify retained heap or driver residency.

No public option was added. This applies with both the default immediate program release and the existing opt-in inactive cache. Both Janus variants hold `maxInactivePrograms: 16` constant. Checked-in bundles remain unchanged; consumers must build the fork.

## Engine scaling probe

The probe runs the actual engine module against a mock GL boundary, with one target program binding and an unrelated retained pool. Each of five AB/BA pairs warms 32 cycles and measures 256 target release/recreate cycles. Pool population is outside the timed window; maintaining the target's index entry is inside it. Program-ID getter diagnostics run separately from timing, which uses ordinary numeric IDs.

| Unrelated geometry maps | Control / candidate median CPU per cycle, ms | Diagnostic ID reads for populated release | Diagnostic ID reads for empty release |
| --- | ---: | ---: | ---: |
| 256 | 0.03375 / 0.00054 | 259 / 1 | 257 / 1 |
| 4,096 | 0.46839 / 0.00044 | 4,099 / 1 | 4,097 / 1 |
| 16,384 | 2.19581 / 0.00045 | 16,387 / 1 | 16,385 / 1 |

All unrelated sampled bindings survive, each created VAO is deleted exactly once by final disposal, and no logical binding remains. The operation counts and source establish removal of the global program-release scan. **These CPU timings use mock GL calls; they are not browser or GPU speedup estimates.** Real rendering correctness is tested separately. [Raw probe pairs](evidence/binding-probe.json).

## Janus Enhanced 3D benchmark

Control: `64187591f5af7dc940b3a491e8e94a38f7867aea`. Candidate: `1db45f2`. Five fixed alternating AB/BA pairs each warm 120 frames and measure 300, totaling 3,000 measured frames. The primary metric is p95 render CPU; median CPU is secondary. The cohort was declared before timing, includes every pair, and has no outcome-based extensions. Builds, unit tests and the engine probe ran separately. [Declaration](evidence/campaign-declaration.json), [summary and raw rounds](evidence/binding-buildings-summary.json).

| Metric | Paired improvement | 95% bootstrap interval |
| --- | ---: | ---: |
| Render CPU p95, primary | 1.4% | -2.7% to 5.4% |
| Render CPU p50, secondary | 0.6% | -2.9% to 3.9% |
| Native frame interval p95 | 5.0% | -1.2% to 12.2% |

Every interval includes zero. Negative improvement means slower. Statistics resample paired log percentile ratios 10,000 times with fixed published seeds; individual frames are not independent trials. CPU measures synchronous Three.js `render` plus `resetState`, including callbacks executed within those calls. Application preparation outside those calls and GPU completion are outside this CPU metric.

The p95 CPU allowance is the larger of 5% of each control or 0.3ms. The paired mean excess interval is -0.52 to -0.20ms, so that regression budget passes. Budget qualification does not turn the neutral result into a demonstrated Janus speedup. This campaign's percentages cannot be added to prior pass results.

The real Janus native map and IllustrationController replay retains 45 synthetic buildings, including 20 at full detail. Model UUIDs, detail and visibility remain fixed through warmup and measurement. Frame-by-frame draws, triangles and render calls match; all three framebuffer captures per run match within pairs; visible building picks pass. JavaScript, console and GL errors are zero. This is a retained-building renderer fixture, not the full Studio UI or production data.

Hardware is WebGL2 on ANGLE Metal / Apple M1 Pro, Chrome 156.0.8078.80, a 1440 by 900 CSS viewport and DPR 1. Node and actual runtime dependencies, engine sources and measurement tools are fingerprinted in each record. Mobile, native WebGPU performance, GPU completion, full Studio interactions and application teardown performance were not measured here.

## Fresh application baseline

The current application changed in three files since the preceding pass's failing snapshot. A fresh private snapshot of 317 files, SHA-256 `8f5de87a605d4314fb7dd0195f8496c56e8282a72bfa4f16740212b2bfbedbe0`, was tested on the previous fork before qualification. Its 120 warmup plus 30 measured frame gate produced 154 NaN bounding-sphere console errors, with no JavaScript or GL error. It was excluded from timing. The geometry failure's root cause is not diagnosed by this pass. [Current-source evidence](evidence/current-source-status.json).

Qualified timing uses the previously validated 317-file snapshot, SHA-256 `f49ae9661826cf5876d22c5152bbe91c002bd2b8d8809d6302159f175d4fdfe1`. Its source and dependency fingerprints remain fixed before and after every member. Current-source Enhanced 3D performance remains unqualified. Fresh source inputs, detailed failure logs and private served-source manifests are retained outside the public fork.

## Verification and replay

Final gates pass: **2,003 core tests** with one existing todo; **145 addon tests**; and **210 WebGL-filtered tests each in Chrome, Firefox and WebKit**, with zero failures, skips or soft skips. The four new tests pass in all three browsers. Core/test lint passes. All five release outputs compile without warnings; four non-WebGL outputs match checked-in r187 bytes. The addon suite records the existing expected missing `texture.test` request. [Qualification](evidence/qualification.json), [build results](evidence/build-results.json).

Verify public evidence or reproduce the engine probe without private Janus access:

```sh
node benchmarks/janus-studio/binding-cleanup/tools/verify.mjs /path/to/three.js
node benchmarks/janus-studio/binding-cleanup/tools/binding-probe.mjs /path/to/three.js /path/to/private-output 64187591f5af7dc940b3a491e8e94a38f7867aea 1db45f2bb215a247fd73ea0aeb89ef6a7b63342d
```

For the Janus campaign, use authorized frozen inputs matching the validated manifest, with dependencies installed from the preserved application lockfile:

```sh
BENCH_APP_MANIFEST=/path/to/private-app-source-manifest.json node benchmarks/janus-studio/next-audit/tools/next-paired.mjs /path/to/private-app /path/to/three.js /path/to/private-output binding 64187591f5af7dc940b3a491e8e94a38f7867aea 1db45f2bb215a247fd73ea0aeb89ef6a7b63342d buildings timing
node benchmarks/janus-studio/binding-cleanup/tools/analyze.mjs /path/to/private-output
```

With the candidate checked out, run `binding-cleanup/tools/run-units.mjs THREE OUT focused` or `full`, setting `PLAYWRIGHT_ROOT` to installed Playwright. Place QUnit 2.25.0 `qunit.min.js` in OUT; its SHA-256 is `1c61c415437fd5b05a18b2d9426e915e4805f87c61392d10d90dc9113554789b`. Build validation uses `audit/comprehensive-r187/tools/build-check.mjs`; lint uses `npm run lint-core` and `npm run lint-test`.

The user-requested separate fork is retained for review and continued work. Task replay directories, caches and owned browser resources are cleaned after evidence publication. Private current-source replay evidence and the earlier validated source archive are retained separately. No Atlas rollout, service/container restart, upstream PR or deployment occurred. [Completion and archive metadata](evidence/completion.json).
