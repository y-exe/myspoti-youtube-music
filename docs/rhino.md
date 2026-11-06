# Rhino library survey

Question: could an existing YouTube downloader library run inside Myspoti's extension
sandbox (Rhino 1.8.1), so the extension would not need its own request code?

Answer (2026-10-26): **no library fits as-is.** YouTube.js can be made to *load* after
build-time conversion, but loading is not downloading. The shipped extension therefore
speaks the public `youtubei` endpoints directly in a small synchronous script, which
the [full-length fetch proof](verification.md) covers.

## What the sandbox offers

Measured with the unmodified upstream extension CLI
(commit `5b8754d5eeeb5755aa7095744239910ffc2de8db`):

- Rhino 1.8.1, ES6 mode; `Promise`, `Uint8Array`, `BigInt` exist.
- No `require`, `fetch`, `URL`, `TextEncoder`, `ReadableStream`, `WebAssembly`, no Java
  access. `eval`/`Function` are blocked by the upstream prelude (not lifted).
- Hooks are synchronous: `Promise.resolve([])` is read as `{}` ("no format"), so async
  libraries must bridge to sync themselves.

## Candidates

| Candidate | How it was checked | Result |
|---|---|---|
| [YouTube.js](https://github.com/LuanRT/YouTube.js) 18.3.0 | npm bundle, source, load test in the SDK | Loads after build-time conversion; communication, async bridging and URL resolution still missing |
| [node-ytdl-core](https://github.com/fent/node-ytdl-core) | source, load test | Needs `require`, Node streams, `vm`; upstream notes development is stalled |
| [DisTube ytdl-core](https://github.com/distubejs/ytdl-core) | README, package.json | Archived, Node-only, points to YouTube.js |
| [YBD ytdl-core](https://github.com/510ren/ytdl-core) | source, package.json | Browser build exists but archived; extra runtime dependencies |
| [cloud-ytdl](https://github.com/cloudkuimages/cloud-ytdl) | README, npm metadata | Requires Node 18+, undici, streams, child_process |
| [Yt6](https://github.com/snarly/yt6) | source, load test | No `window`; needs DOM, XMLHttpRequest, eval/Function |
| [yt-dlp-ejs](https://github.com/yt-dlp/ejs) | docs, supported runtimes | A fragment of yt-dlp's JS handling, not a downloader; Rhino unsupported |
| [newpipe-extractor-wasm](https://github.com/thegrims/newpipe-extractor-wasm) | design docs | Requires WebAssembly — absent from the sandbox |

## The YouTube.js porting experiment

npm browser bundle (1,580,239 B) → esbuild ES2015 IIFE (793,233 B; Rhino syntax error)
→ Babel ES5 (1,021,542 B; failed on a named-capture regex built from a constant string)
→ that regex rewritten as a literal (1,022,753 B). The last bundle passed the SDK's
`check` and defined `Innertube`.

It stayed an experiment. Under the 1 MiB script cap ~25 KiB remained for a sync HTTP
adapter, and the open problems were unsolved: bridging `fetch` to the synchronous
`myspoti.http`, running async APIs inside sync hooks, the missing `Intl`, and YouTube.js
expecting a JavaScript evaluator for URL deciphering, which the sandbox forbids. The
"first range OK, next range 403" issue from early prototypes was never shown to be
solved by the port. Nothing of it is included in `main.js` or the package.

## Primary sources

- [Myspoti extension API and runtime](https://github.com/kota-zo/myspoti/blob/main/docs/extensions/API.md)
- [YouTube.js runtime and custom interpreters](https://ytjs.dev/guide/getting-started)
- [YouTube.js default evaluator](https://github.com/LuanRT/YouTube.js/blob/204715b6acfb063dc306d8677e36fdbf09f293c5/src/platform/jsruntime/default.ts)
- [yt-dlp EJS role and supported runtimes](https://github.com/yt-dlp/ejs)
