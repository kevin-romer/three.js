# Three.js performance against Janus Studio

The opt-in inactive WebGL program cache reduces p95 Three.js render/reset CPU time by **21.5%** in the full Studio workspace with 400 deterministic synthetic parcels. Five paired rounds give a 95% paired-bootstrap improvement interval of **17.0% to 25.8%**. The desktop CPU target passes; the overall [performance goal](goal.json) remains active pending the other workload, compatibility and lifetime gates.

This result requires `maxInactivePrograms: 16`. Its default is zero, so replacing the dependency alone does not enable retention. This is an engine change in the separate fork; Atlas application files, dependency manifests and deployment state were not changed.

## Desktop result

Control: upstream r187, commit `7e89746a687bb88271253698fa108b1dd59825d0`. Candidate engine: `ea87fa90a4211920f08120639189344c7f73bd96`. Chrome 156.0.8078.80 used WebGL2 on ANGLE Metal, Apple M1 Pro, at 1440 by 900 CSS pixels and DPR 1.

| Pair | Order | Upstream p95 CPU ms | Fork p95 CPU ms |
| --- | --- | ---: | ---: |
| 1 | Upstream then fork | 40.8 | 29.7 |
| 2 | Fork then upstream | 36.5 | 28.2 |
| 3 | Upstream then fork | 37.9 | 32.5 |
| 4 | Fork then upstream | 37.8 | 28.0 |
| 5 | Upstream then fork | 35.5 | 29.6 |

Each run warms 120 camera frames and measures 300 further frames. All 3,000 measured frames contain geometry, with equal draw/triangle counts between paired variants. Three deterministic framebuffer captures per run match exactly. All ten runs use the same 251-file application snapshot, with no JavaScript, console or GL errors. Profilers and detailed GL counters are disabled during formal timing.

CPU time sums the synchronous Three.js render and resetState calls used for one matching native map frame. It includes submission work and excludes GPU completion. The p95 interval between completed native frames improves by **9.3%**, with a 95% interval of **4.5% to 13.1%**. The 21.5% CPU result must not be presented as a 21.5% increase in whole-application FPS.

[Paired statistics](evidence/desktop-paired-summary.json), the ten `desktop-pair*.json` files, and [source manifest](evidence/desktop-source-manifest.json) include per-frame data, p50/p95/p99 values, long tasks, startup observations, program/geometry counts and exact pixel hashes. `heapUsedApprox` is uncollected page heap, not retained memory or GPU residency. Startup observations include fixture mounting and are not a qualified cold-start improvement.

## Engine change

The renderer can retain a bounded number of compiled programs after their last material is disposed. An inactive program is reactivated on a matching key; exceeding the budget evicts the least recently used inactive program. Active programs are not limited by this idle budget. Geometry binding states are released when a program becomes inactive. Shader stage references survive until eviction, without retaining the material or geometry. Renderer disposal and context restoration clear the cache.

The followup correction refreshes uniforms when a disposed material is reused within the same render. Ten real-WebGL regressions cover default release, validation, LRU order, active programs, custom shader identity, built-in uniforms, onBeforeCompile, failed links, context restoration and disposal.

After building the fork, JavaScript consumers can enable it when constructing the renderer:

```js
const renderer = new THREE.WebGLRenderer({
  canvas,
  maxInactivePrograms: 16
});
```

A count budget does not bound driver program memory in bytes. Retained programs appear in `renderer.info.programs` with `usedTimes === 0`. This new fork option is not yet part of the separately maintained upstream TypeScript declarations.

## Reproduction

Use an authorized local Janus application checkout with its existing dependencies installed, this fork with the r187 tag available, Node.js, Playwright and Chrome with a real GPU. No private application source is included in this repository. The generic adapters import the local Studio fixture and native runtime; generated private fixture modules and Vite caches stay in the supplied output directory.

```sh
node benchmarks/janus-studio/tools/paired-runs.mjs /path/to/atlas-front /path/to/three.js /path/to/private-output desktop
node benchmarks/janus-studio/tools/analyze-pairs.mjs /path/to/private-output desktop
```

Run timing cases serially and keep builds and profiling separate. The server aliases core, addons, `three/src` and worker imports consistently. The control overlays the modified source files with their exact r187 contents; it is not the fork merely configured with a zero budget. Application source hashes must match within each pair, and output/geometry differences fail analysis. The bootstrap resamples five paired log p95 ratios 10,000 times with a fixed seed; frames are not independent runs.

## Qualification status

The Chromium core suite passes 1,992 tests, with zero failures and one existing todo; addons pass 145. Core/test lint passes. All five release outputs compile without warnings into temporary output; checked-in build files remain unchanged. See the [implementation checkpoint](evidence/implementation-checkpoint.json) and [build results](evidence/build-results.json).

The full workspace benchmark uses an explicitly synthetic, unadmitted display layer through its normal runtime API, alongside the actual Studio UI and native renderer. The governed presentation fixture fails on unchanged upstream because its constructed binding key exceeds the style parser's 512-character maximum. That path is unqualified; it was not bypassed or counted as an empty-scene speedup.

Interaction, comparison and lifetime diagnostics, the existing product assertions, current Janus r183 compatibility, other render workloads, and browser/mobile-emulation qualification are still being completed. The broader [28-item engine audit](../../audit/comprehensive-r187/README.md) remains a separate prioritized backlog; these results do not claim its other findings are fixed. No dependency rollout or deployment has occurred.
