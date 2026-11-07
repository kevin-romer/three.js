# Reproduce and verify

Run from the separate Three.js checkout containing this audit. The baseline source is r187 (`7e89746a687bb88271253698fa108b1dd59825d0`); the audit branch only adds audit files. Tools accept repository root and output directory. Use a current compatible Node version; CPU probes originally used Node 26.4.0, build tools Node 25.9.0. See evidence/provenance.json for exact revision and QUnit hash.

## Verify delivered evidence without browsers

```sh
node audit/engine-r187/tools/engine-verify.mjs
node audit/comprehensive-r187/tools/verify.mjs
```

These verify source/artifact hashes and numerical relationships, including known negative controls. Passing the verifier confirms the recorded evidence is internally consistent and belongs to this baseline; it does not turn observed upstream failures into passing engine behavior.

## Locked dependencies and isolated outputs

```sh
AUDIT_OUT="$(mktemp -d "${TMPDIR:-/tmp}/threejs-audit-repro.XXXXXXXX")"
PUPPETEER_SKIP_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund

node audit/comprehensive-r187/tools/census.mjs . "$AUDIT_OUT"
node audit/comprehensive-r187/tools/cpu-probes.mjs . "$AUDIT_OUT"
node audit/comprehensive-r187/tools/build-check.mjs . "$AUDIT_OUT"
node audit/comprehensive-r187/tools/bundle-check.mjs . "$AUDIT_OUT"
npm audit --json > "$AUDIT_OUT/dependency-audit.json"
```

Dependency audit output is date-sensitive and is expected to exit 1 when advisories are present. Do not run automatic forced fixes as part of reproducing the baseline. Build and tree-shake tools load the unchanged upstream Rollup configurations but redirect generated files beneath AUDIT_OUT. Source, lockfile and checked-in builds are not overwritten.

Run the eight existing lint scripts, preserving failures:

```sh
for scope in core addons test tsl editor utils examples manual; do
  npm run "lint-$scope" -- --format json --output-file "$AUDIT_OUT/lint-$scope.json"
done
```

Examples and manual have baseline failures. Summarization keeps file/line/rule messages and removes absolute checkout paths and redundant embedded source. Inspect each script's exit/output rather than using the final loop exit as a combined pass/fail result.

## Browser prerequisites

Use an existing Playwright 1.61.1 installation by setting PLAYWRIGHT_ROOT to its absolute package directory, or install the runner outside the repository:

```sh
npm install --prefix "$AUDIT_OUT/runner" --no-save --package-lock=false playwright@1.61.1
export PLAYWRIGHT_ROOT="$AUDIT_OUT/runner/node_modules/playwright"
"$AUDIT_OUT/runner/node_modules/.bin/playwright" install firefox webkit
```

The tested Chromium configuration uses installed Google Chrome, headless, GPU enabled and ANGLE Metal. Chrome must be installed separately. Adapt launch flags for other platforms and retain actual backend/device identities; the macOS flags are not portable GPU qualification. Browser installation/network access is setup, not an engine runtime dependency.

Stage the exact test library requested by upstream HTML, then verify its bytes:

```sh
curl -fL https://cdn.jsdelivr.net/npm/qunit@2.25.0/qunit/qunit.min.js -o "$AUDIT_OUT/qunit.min.js"
shasum -a 256 "$AUDIT_OUT/qunit.min.js"
```

Expected SHA-256: `1c61c415437fd5b05a18b2d9426e915e4805f87c61392d10d90dc9113554789b`.

## Full upstream unit pages and focused browser probes

```sh
node audit/comprehensive-r187/tools/qunit-suites.mjs . "$AUDIT_OUT"
node audit/comprehensive-r187/tools/browser-probes.mjs . "$AUDIT_OUT"
node audit/comprehensive-r187/tools/material-benchmark.mjs . "$AUDIT_OUT"
```

The suite runner defaults to Chromium r187 core/addons plus the pinned development source overlay core/addons. The dev commit must exist locally (`git fetch upstream dev` if needed); AUDIT_DEV_REF can explicitly select another revision, but that becomes a different baseline. The two QUnit pages and assertions are upstream originals. An observation hook records requested/actual backend after init, without changing feature gates or assertions. QUnit CSS is omitted because assertions do not depend on it. Blob/data schemes continue through the browser. Source/assets are served from the checkout via intercepted synthetic-origin requests; no application code or server is involved.

For Firefox/WebKit core and addon pages:

```sh
export AUDIT_QUUNIT_CASES='[{"engine":"firefox","version":"r187","suite":"core"},{"engine":"firefox","version":"r187","suite":"addons"},{"engine":"webkit","version":"r187","suite":"core"},{"engine":"webkit","version":"r187","suite":"addons"}]'
node audit/comprehensive-r187/tools/qunit-suites.mjs . "$AUDIT_OUT"
unset AUDIT_QUUNIT_CASES
```

The runner collects test failures and incomplete records without stopping later cases. Read result.counts, backend records and incomplete artifacts; a zero runner exit alone is not suite success. Firefox/WebKit compute failures here are preserved, not filtered. Chromium CDP raw coverage is gzip JSON. Function summaries union the core/addon r187 records and exclude module wrappers; execution does not imply asserted coverage.

After all commands (including all eight suite cases), summarize reproducible evidence:

```sh
node audit/comprehensive-r187/tools/summarize.mjs . "$AUDIT_OUT"
```

The originally delivered preliminary WebKit harness record is optional for reproduction. Summarization records it only if present. Keep regenerated output separate from delivered evidence; timings and date-sensitive advisories can differ. The new probes intentionally assert baseline defect observations and can fail after engine fixes, at which point port their acceptance criteria into normal upstream regressions.

## Experimental patches and cleanup

The five earlier candidate patches and real WebGL harness are documented in [the foundation reproduction guide](../engine-r187/REPRODUCE.md). Its statement that full QUnit/dependencies were not run applies to that earlier audit phase; this expanded phase installs the locked dev graph and runs the full original unit pages. Earlier patch variants have not been requalified across Firefox/WebKit or native WebGPU by the new baseline suite runs.

Browser tools close their pages/browser processes in finally blocks. Remove only the task-created AUDIT_OUT directory after preserving wanted results. Keep the separate fork checkout; it is the intended deliverable. No deployment, container rebuild or service restart is required.
