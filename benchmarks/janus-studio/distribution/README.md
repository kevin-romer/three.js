# Janus fork distribution

The `janus-r187-469f1ad.1` release packages the measured engine source at `469f1adb8daf6f298cb5e66bc2078233a596878b`, with rebuilt ESM outputs matching the Matrix4 campaign build hashes. `build/janus-fork.json` records source and output identities. The CommonJS compatibility entry and the three other ESM outputs retain their existing bytes.

The release archive is created with `npm pack --ignore-scripts` after `npm run build`. Its runtime package contains the normal Three.js build, source, addon and MIT license files. Installation requires no Git checkout, build tools or lifecycle scripts. Atlas pins the archive URL and SHA-512 lockfile integrity. The accompanying checksums record the distribution Git commit and archive bytes.

[Download the package](https://github.com/kevin-romer/three.js/releases/download/janus-r187-469f1ad.1/three-0.187.0-janus-469f1ad.tgz). Import it with the normal `three` and `three/addons` entry points. The upstream-compatible package version remains `0.187.0`; the archive and immutable source pin distinguish the fork. To enable the measured inactive program retention, construct WebGLRenderer with `maxInactivePrograms: 16`.

[Qualification and limitations](../matrix-serialization/README.md) apply to this source. No new engine change is made by packaging.
