# How matching works

`download-source` receives a Spotify-side track and answers with at most one M4A
candidate. Everything happens inside Myspoti's 25 s hook budget.

## Pipeline

1. **Queries.** First `title + artist`, the feat-stripped title + artist, a
   punctuation-stripped words + artist variant, and the bare title — then ISRC, when
   the track carries a valid one (ISRC search rarely lands on the official row, so it
   goes last). CV-actor suffixes (`【CV: …】`) are removed before any of this.
2. **Languages.** The writing system of title + artist picks the search language, and
   English follows as fallback. Every query runs once per language; a second pass
   re-searches everything with fresh rankings when nothing matched.
3. **Search.** WEB_REMIX `search` with the songs filter; only rows YouTube Music
   classifies as `MUSIC_VIDEO_TYPE_ATV` (official catalog) with an 11-character video
   id, an artist column and a duration are kept. If YouTube starts rejecting the
   pinned client version outright (HTTP 400/403), the search switches to a reserve
   version and retries once.
4. **Scoring.** Candidates that pass the gates are ranked; the best one is resolved to
   an audio URL, which is probed and returned. Parenthetical production notes on the
   YouTube side (movie / drama / theme-song / OST markers) are dropped before the
   title and artist comparison, so a store title still matches its official listing
   when YouTube appends a movie annotation, and an artist column still matches when it
   appends a Latin alias.

| Script detected | Languages tried | Region (`gl`) |
|---|---|---|
| kana | `ja`, `en` | JP |
| hangul | `ko`, `en` | KR |
| han (no kana) | `zh-TW`, `zh-CN`, `en` | TW, then US |
| Cyrillic / Greek / Hebrew / Arabic / Devanagari / Thai | own, `en` | RU / GR / IL / SA / IN / TH |
| Latin only | `en` | US |

## Gates

- **Length window:** −5 s / +15 s around the track's `durationMs` — the same window
  Myspoti's own download check uses. Applied to the search row *and* to the resolved
  stream's `lengthSeconds`.
- **Version words refused:** `live`, `cover`, `remix`, `remaster(ed)`, `acoustic`,
  `instrumental`, `karaoke`, `slowed`, `sped up`, `nightcore`, `reverb`, `8d`, plus
  the same words in Japanese, Korean, Chinese and Russian. Refused only when the
  track's own title does not contain the same word.
- **Title similarity ≥ 0.85** (Levenshtein over letters-only, case- and
  width-normalized). Chinese uses 0.75: stores drift between simplified and
  traditional glyphs. A store title that appears verbatim inside the YouTube title
  (transliteration prefixes, leftover notes) counts as 0.9.
- **Artist equality or containment ≥ 0.9:** exact match, or containment of the store
  name in the channel name (or the reverse) — minimum 2 characters for CJK, kana and
  hangul names, 4 for Latin ones, so short CJK artist names survive alias suffixes
  while short Latin fragments never count. Channel suffixes `- Topic`/`VEVO` and
  parenthetical aliases are stripped first. Chinese additionally accepts similarity
  ≥ 0.65, because stores write the same artist in simplified and traditional glyphs.
- **Arabic folding:** hamza seat variants, ى/ي, ة/ه, tatweel and diacritics are folded
  before any comparison — stores and YouTube disagree on them constantly.
- **Score** = title × 0.6 + artist × 0.25 + length closeness × 0.15. The best total
  wins; ties resolve toward higher bitrate at fetch time.

## Audio resolution

A VISIONOS client session is built from the public `visitor_id` endpoint (anonymous)
and reused for an hour, so a batch does not re-request it for every track. The player
call filters adaptive formats: no DRM families, no `signatureCipher`, `audio/mp4` with
`mp4a`, a `googlevideo.com/videoplayback` URL, a content length between 10 KB and
1 GiB, default audio track. The highest average bitrate wins, and both the first and
the last 512 bytes must answer with `206` and the expected `Content-Range`/
`Content-Type` before the candidate is offered as `m4a`. A transient YouTube-side
error (HTTP 5xx) is retried once within the hook budget; everything else surfaces
immediately.

## Status

The `status` hook probes `music.youtube.com` once. Unreachability is answered
honestly (`live: false`) instead of pretending the source works: a timeout, DNS
failure or dead connection — including a VPN that still holds a network slot with no
underlying connectivity — means the downloads will fail with the same cause.
Unexpected non-network errors stay fail-open, because they say nothing about reachability.

## The rate-limit ledger

Myspoti refuses an extension's request beyond 120/minute (sliding window), and a batch
of downloads otherwise trips it and fails every remaining search. The extension keeps
its own ledger: 90 requests/minute of its own, waits in ≤ 1.8 s chunks inside the hook
budget (at most ~13 s), and when the app still answers "more than 120 requests in a
minute" it throws "rate limited" — the app treats that as *not answered now*, so the
song is retried later instead of being written off as not found. The same answer is
thrown when the budget runs out while the ledger is still hot: waiting most of the
budget and then returning nothing would otherwise label a perfectly matchable song
*not found*, which is how batch downloads used to cascade into a wall of failures.
The `status` probe is skipped while the ledger is hot so it never consumes a
download's quota.

## Regression harness

`scripts/harness.js` runs this exact extension code on Node: it stubs `myspoti`
(synchronous HTTP through a per-request child agent, Atomics-based sleep), feeds it
`scripts/fixture/tracks.json`, and reports one line per track. A track passes when the
same gates accept a YouTube Music ATV row; the audio fetch is skipped (`debug://match`)
unless `--full` is given.

The fixture is generated locally and is not part of the repository: it holds
mid-popularity real songs per supported language, collected from the Deezer catalog by
`scripts/collect.js` (ISRC and store duration included). Every candidate is verified
against YouTube Music before it enters the fixture — only songs whose official (ATV)
listing matches the store duration within ±3 s **and** the store title are kept, so a
harness failure means a matching bug, not a missing catalog entry. The search terms
collect.js uses come from a local `fixture/sources.local.json` (see the header of
collect.js for the format).

```sh
node scripts/collect.js 6   # rebuild the fixture (6 songs per language, ~2 min)
node scripts/harness.js     # every listed track must MATCH
node scripts/harness.js --only=<substring>   # run a subset
```

Rejections and per-candidate scores are printed with the `reject …`/`accept …` notes
when the harness runs, which is how language-specific gate problems get diagnosed.
Run the harness at the same song count for every language before releasing: matching
quality should be equal across scripts, not only where the maintainer can read them.
