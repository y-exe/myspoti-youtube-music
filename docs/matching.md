# How matching works

`download-source` receives a Spotify-side track and answers with at most one M4A
candidate. Everything happens inside Myspoti's 25 s hook budget.

## Pipeline

1. **Queries.** ISRC first (when the track carries a valid one), then `title + artist`,
   the feat-stripped title + artist, a punctuation-stripped words + artist variant, and
   the bare title. CV-actor suffixes (`【CV: …】`) are removed before any of this.
2. **Languages.** The writing system of title + artist picks the search language, and
   English follows as fallback. Every query runs once per language; a second pass
   re-searches everything with fresh rankings when nothing matched.
3. **Search.** WEB_REMIX `search` with the songs filter; only rows YouTube Music
   classifies as `MUSIC_VIDEO_TYPE_ATV` (official catalog) with an 11-character video
   id, an artist column and a duration are kept.
4. **Scoring.** Candidates that pass the gates are ranked; the best one is resolved to
   an audio URL, which is probed and returned.

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
  ライブ・カバー・歌ってみた・弾いてみた・カラオケ・オルゴール,
  라이브・커버·리믹스·노래방·부르기, 翻唱·现场·混音·卡拉ok·伴奏,
  кавер·караоке·ремикс·инструментал. Refused only when the track's own title does not
  contain the same word.
- **Title similarity ≥ 0.85** (Levenshtein over letters-only, case- and
  width-normalized). Chinese uses 0.75: stores drift between simplified and
  traditional glyphs (`告白气球` vs `告白氣球`).
- **Artist equality or containment ≥ 0.9:** exact match, or 4+ character containment
  (`Official髭男dism` vs `ヒゲダン` would not pass; channel suffixes `- Topic`/`VEVO`
  are stripped first). Chinese additionally accepts similarity ≥ 0.65, because
  `周杰伦` and `周杰倫` are the same artist written differently.
- **Score** = title × 0.6 + artist × 0.25 + length closeness × 0.15. The best total
  wins; ties resolve toward higher bitrate at fetch time.

## Audio resolution

A VISIONOS client session is built from the public `visitor_id` endpoint (anonymous,
one request). The player call filters adaptive formats: no DRM families, no
`signatureCipher`, `audio/mp4` with `mp4a`, a `googlevideo.com/videoplayback` URL,
sane content length, default audio track. The highest average bitrate wins, and both
the first and the last 512 bytes must answer with `206` and the expected
`Content-Range`/`Content-Type` before the candidate is offered as `m4a`.

## The rate-limit ledger

Myspoti refuses an extension's request beyond 120/minute (sliding window), and a batch
of downloads otherwise trips it and fails every remaining search. The extension keeps
its own ledger: 90 requests/minute of its own, waits in ≤ 1.8 s chunks inside the hook
budget (at most ~13 s), and when the app still answers "more than 120 requests in a
minute" it throws "rate limited" — the app treats that as *not answered now*, so the
song is retried later instead of being written off as not found. The `status` probe is
skipped while the ledger is hot so it never consumes a download's quota.
