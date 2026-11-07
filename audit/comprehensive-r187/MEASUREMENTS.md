# Measurements and interpretation

## Environment

macOS 15.6.1 (24G90), local Apple M1 Pro machine identified by the foundation WebGL run. Chrome 156.0.8078.80, Playwright Firefox 151.0 and WebKit 26.5. Playwright 1.61.1 is a test runner only. Rollup 4.66.0, ESLint 10.13.0, Espree 11.2.0 and Puppeteer 25.16.0 came from the unchanged locked development graph. Puppeteer is not the browser runner used here.

CPU probes report Node v26.4.0; build/bundle scripts report v25.9.0. The commands ran in environments with different Node resolutions, so a single Node version is not assigned retroactively to every artifact. QUnit/browser engine results are separately identified. GPU-completion time was not measured. Native WebGPU backend identity is confirmed, but an adapter/device identity string was not captured for the new WebGPU cases; no cross-adapter performance comparison is claimed.

## New deterministic probes

| Probe | Result | Measurement boundary |
| --- | --- | --- |
| FileLoader response compatibility | 1 fetch; both results ArrayBuffer despite second consumer requesting default text | Actual loader, mocked fetch, cache off |
| FileLoader request headers | 1 fetch; scope-A and scope-B consumers both receive scope-A | Synthetic header/body, no credentials or external data |
| ImageBitmap options | Requested none/flipY; received flipY/flipY | Actual loader, mocked asynchronous fetch/decode, different URLs |
| WebGPU padded RGB | 400,000 allocated CPU bytes; 100,000 views; 1 write / 4 bytes for 1 dirty component | Actual attribute utility, mock queue, 100,000 vertices |
| WebGPU repeated ranges | 256 writes / 4,096 bytes for 16 unique bytes | 256 identical Float32 ranges, actual utility, mock queue |
| Aligned byte fuzz | 500 cases pass exact byte comparison | Deterministic Uint8/Uint16 views with nonzero offsets and random dirty intervals |
| Animation cold binding | 9,500,500 name reads | 1,000 tracks targeting last 1,000 nodes of a flat 10,000-node scene |
| Animation warm/lifetime control | 0 name reads; correct position; 0 cached actions/bindings after uncache | Actual mixer and clip |
| GLB parsing | 3,145,684 slice-copy bytes for 1,573,348-byte valid input | Slice interception; 65,535 vertices, position and normal bufferViews |
| STL preflight | 36,000,000-byte allocation attempted from 84-byte malformed input | Guard intercepts first large constructor before allocation |
| Shared geometry attribute | 78 -> 0 colored pixels, GL error 1282 | Actual WebGL framebuffer; independent-attribute control retains hash/pixels |
| Material subscriptions | 1, 2, 3 after successive renderer.dispose calls; 0 after material.dispose | Event listener counts, not retained heap/GPU bytes |
| Native WebGPU target | 4,096 returned bytes, 256 colored pixels | Actual WebGPU render + asynchronous readback |
| OrbitControls lifecycle | 6 registered listeners -> 0 after dispose | Native EventTarget instrumentation |
| Offline audio lifecycle | Not playing, disconnected, no onended callback | OfflineAudioContext; no physical audio device |

[CPU evidence](evidence/cpu-probes.json) and [browser evidence](evidence/browser-probes.json) preserve numerical results. Assertions in the audit verifier intentionally preserve reproduced upstream failures as expected observations; that verifier passing does not mean those defects were fixed.

## Existing material optimization

The original test/benchmarks/node-material-instance HTML pages were run without source changes, in the same three rotated modes and three rounds as their upstream runner. The audit used Playwright routing instead of a local server/Puppeteer. All original draw/build/program assertions were enforced, with an additional requirement that node cases actually use native WebGPU. Window benchmarkResults supplies the raw values.

Median CPU milliseconds, three rounds:

| Mode | Material creation | First render | Second render | Uniform update | First builds/programs | Draw calls |
| --- | --- | --- | --- | --- | --- | --- |
| node-material | 33.8 | 1639.5 | 53.1 | 44.3 | 10,000 | 10,001 |
| material-instance | 67.7 | 247.4 | 48.8 | 39.4 | 1 | 10,001 |
| shader-material | 8.0 | 130.5 | 17.4 | 14.4 | 1 | 10,000 |

Node cases report node builds; ShaderMaterial reports WebGL programs, which are different metrics. Every uniform update creates zero new builds/programs. First render includes preparation/compilation and command submission; neither first nor steady render waits for GPU completion. All modes use 10,000 meshes, with the native WebGPU path issuing one additional output-pass draw. This is evidence for existing material-instance reuse, not a newly implemented optimization or proof that one graphics API is universally faster. Bundle compilation was running concurrently, adding possible CPU contention; repeat in an isolated environment before adopting timing budgets.

## Build and bundle results

Both original Rollup release configurations were run with output paths redirected to temporary storage. All five unique JS outputs matched checked-in r187 bytes exactly; hashes are in [build-results.json](evidence/build-results.json). The original tree-shake configuration's 11 outputs all compiled without warnings. Minified outputs are shown below; bytes count emitted files rather than JavaScript string length.

| Configuration | Bytes | Gzip bytes |
| --- | --- | --- |
| three.module.bundle.min.js | 783,569 | 196,374 |
| three.webgpu.bundle.min.js | 1,119,102 | 302,067 |
| three.webgpu.nodes.bundle.min.js | 1,117,051 | 301,690 |
| index.bundle.min.js | 520,080 | 125,600 |
| index.webgpu.bundle.min.js | 793,188 | 213,080 |
| index.webgpu.nodes.bundle.min.js | 739,283 | 199,565 |
| index.webgpu.tsl.bundle.min.js | 797,932 | 213,788 |

These are baseline sizes, not a new bundle regression or an optimal minimal bundle claim. Node registration side effects, selected exports and common output passes can affect retained code. Do not change package.sideEffects solely from size totals; test import registration and shader behavior first. The bundle check compiles the configurations; it does not execute their pages or assert an upstream size budget.

## Earlier engine measurements

The [foundation measurement report](../engine-r187/MEASUREMENTS.md) retains allocation cycles, ray-test counts, matrix operation counts, UBO calls and nine real WebGL configurations. Its five prototypes are applied only in isolated test modules or route responses, not engine files. Submitted upload bytes measure API-visible regions; they are not GPU hardware bandwidth or GPU-completion timings.

## Validation counts and known failures

[Suite summary](evidence/suite-summary.json), full per-test records and [lint summary](evidence/lint-summary.json) retain outcomes including failures. Each Chromium core run has one todo; Firefox/WebKit each have 11 failed compute tests on fallback plus 11 soft-skipped tests counted as passes. All addon runs have 145 passes. The dev suite results are source-overlay observations. The preliminary WebKit addon timeout is an audit harness issue, superseded by a passing rerun and retained in [harness-preliminary.json](evidence/harness-preliminary.json).

npm audit reports eight affected dev package entries from two advisory sources, with exact dependency edges in its JSON. An audit exit code of 1 here indicates reported advisories; it is not a crashed build. No dependency fix or lockfile modification was made.
