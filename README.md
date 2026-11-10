<div align="center">

<h1>YouTube Music Download Helper</h1>

[![License GPL v3](https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square)](LICENSE)
[![Myspoti](https://img.shields.io/badge/Myspoti-2.0.2%2B-blue?style=flat-square)](https://github.com/kota-zo/myspoti)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](main.js)
[![Category](https://img.shields.io/badge/store-downloads-0e7690?style=flat-square)](https://github.com/kota-zo/myspoti)

Finds a song's official master on YouTube Music and hands the original AAC/M4A to
[Myspoti](https://github.com/kota-zo/myspoti), which downloads, stores and plays it.
No Myspoti fork, no resolver service, nothing running outside Myspoti.

English · [日本語](README.ja.md)

</div>

## What it does

- **Official masters only.** Answers Myspoti's `download-source` hook with songs the YouTube Music catalog classifies as ATV (artist uploads). Ordinary videos, official-MV-only uploads and every non-ATV result are refused. The stream is the original AAC/M4A at the highest available bitrate — head and tail ranges are probed before it is offered, WebM/Opus is never offered, nothing is transcoded or re-labeled.
- **Multilingual search.** The song's writing system picks the search language and region, with English as fallback: kana → `ja` (JP), hangul → `ko` (KR), han → `zh-TW` (TW) then `zh-CN` (US), Cyrillic → `ru`, Greek → `el`, Hebrew → `he`, Arabic → `ar` (SA), Devanagari → `hi` (IN), Thai → `th`, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada and Malayalam → their own language (IN), Persian and Urdu → `fa` / `ur` (picked out of the Arabic script by their own letters; PK for Urdu), Lao → `lo`, Khmer → `km`, Burmese → `my`, Georgian → `ka`, Armenian → `hy`, Amharic → `am`, Latin → `en`. Cover/live/remix/karaoke wording is refused in every one of those languages, and Chinese matching tolerates the simplified/traditional glyph drift between stores.
- **Strict matching.** ISRC is tried first when the track has one, then title + artist queries (feat stripped, punctuation normalized, CV-actor suffixes removed). A candidate must pass title similarity ≥ 0.85, artist equality or containment (≥ 4 chars), and the same length window Myspoti's own download check uses (−5 s / +15 s); the best score wins — with the album name as a ±0.02 ranking nudge (a remastered/live copy usually sits on a different album) and a "(Remastered 2011)"-style note costing 0.08 instead of refusing the candidate. When the rankings hide the official song, a second pass re-searches everything. One track is answered within its 25 s hook budget.
- **Rate-limit aware.** Myspoti caps each extension at 120 requests/minute, which batch downloads used to burst through. The extension keeps its own ledger, self-limits at 90, and waits inside the hook budget. When the cap still eats the budget, it answers `{outcome: rate-limited}` (feature `results`): the app sets the source aside for a while and retries the song later, instead of mislabeling it *not found* — a search that runs out of budget answers `{outcome: network}`, also retried later. On apps without the feature it throws the old "rate limited" error.
- **Honest status.** The `status` hook answers with a cheap probe and shows the extension as inactive when YouTube Music is unreachable. The probe is skipped while the rate ledger is hot, so it never eats a download's quota.
- **Verified.** A Node harness replaying the same search and matching saved 8/8 tracks across Korean (hangul and latin), Chinese (simplified and traditional input), Russian, Thai, Japanese and Spanish, and 12/13 on a Japanese corpus (the one miss is a real catalog difference — the official master runs 25 s longer than Spotify's metadata). Details in [docs/verification.md](docs/verification.md).

## Install

1. **Store**: open Myspoti's extension store and look for *YouTube Music Download Helper* (this repo, via the `myspoti-extension` topic).
2. **From an address**: Settings → Extensions → Install → *Install from an address* → `https://github.com/y-exe/myspoti-youtube-music`.
3. **From a file**: grab `extension.zip` from the [latest release](https://github.com/y-exe/myspoti-youtube-music/releases/latest) (or build it with `node scripts/pack.js`), push it to the phone, and choose *Install from a file*.

Requires Myspoti 2.0.2-beta.4 or newer. All downloading, storage and encryption stay inside Myspoti — the extension only proposes files.

## Limits

- `download.source` is exclusive in Myspoti: while this extension is on, it owns downloads — a lossless source cannot share the duty.
- Streams behind DRM, login or signing are skipped, not bypassed. No cookies, no account tokens; an anonymous visitor id is borrowed from the public API for the duration of one request.
- `isrcMatched` is always false: an ISRC hit is not proof of an identical recording. A metadata match is not a proven recording match — stop using the extension and report if the wrong take is ever saved.
- Titles that only ever appear translated or romanized, masters whose length drifts too far, and songs lost in cover-storm rankings are not found.

## Development

Plain JavaScript for Rhino (no build step for the extension itself). Everything people
read — the store description, the install reasons, and every log line and status
detail — follows Myspoti's display language: 63 translation sets in `i18n.json`
covering all 69 language tags the app offers (Traditional Chinese and Brazilian
Portuguese have their own; other regional variants fall back to their base language,
English is the final fallback and lives in the code itself). Myspoti refuses extra
files in a package, so `pack.js` merges `i18n.json` into `main.js` and `manifest.json`
at package time; the PC harness does the same before loading the script. Release
notes are written in English and Japanese. Package it with Node:

```powershell
node scripts/pack.js          # → extension.zip (deterministic bytes, LF-normalized)
node scripts/check-i18n.js    # every message translated for every app language
```

CI runs the official SDK `check` plus a smoke test, and a pushed `vX.Y.Z` tag matching `manifest.json` becomes a release with `extension.zip`. Layout follows [kota-zo/myspoti-extension-template](https://github.com/kota-zo/myspoti-extension-template).

More: [docs/README.md](docs/README.md) — how matching works, the full-length fetch proof, the Rhino library survey, and device verification.

## Sources and licensing

Audio comes exclusively from YouTube Music's official catalog, fetched through the same public `youtubei` endpoints the YouTube Music web player uses. Nothing is decrypted: DRM streams are skipped, and the app's per-extension rate limits are respected, not avoided. This extension is not affiliated with Myspoti, YouTube or Google.

[GPL-3.0](LICENSE) throughout. The layout and the packaging script follow [kota-zo/myspoti-extension-template](https://github.com/kota-zo/myspoti-extension-template) (MIT); matching criteria adapted from my [Myspoti fork](https://github.com/y-exe/myspoti) (kept for comparison), with the album-name signal and the remaster-note penalty taken from [spotDL](https://github.com/spotDL/spotify-downloader) and [spotify_to_ytmusic](https://github.com/sigma67/spotify_to_ytmusic) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for what was taken from each project and under which license.

---

© 2026 yexe
