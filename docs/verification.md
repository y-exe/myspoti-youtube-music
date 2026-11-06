# Full-length fetch proof

The extension must never offer a URL that plays a few seconds and stops. This record
proves the opposite: a returned candidate downloads completely and decodes end to end.

Verified 2026-10-26 on v0.1.1 (versionCode 2) in the unmodified upstream extension SDK
(commit `5b8754d5eeeb5755aa7095744239910ffc2de8db`, Rhino 1.8.1). Track titles are
anonymized; byte counts and durations are unchanged.

## Method

1. Ran `download-source`; the extension used only `myspoti.http` (search, anonymous
   session, URL resolution, head/tail probes) and returned its standard M4A candidate.
2. Fetched the whole audio on a PC with the URL and `User-Agent` the SDK handed over.
   Node was used for this fetch only — never to run the extension or resolve URLs. No
   private API server was involved.
3. Compared saved bytes with the candidate's `contentLength`; checked container,
   duration and codec with ffprobe.
4. Decoded everything with `ffmpeg -xerror`, so any corrupt frame aborts the run.
5. Re-fetched one track the way Myspoti's own downloader does — two 4 MiB range
   requests joined — and checked every response size against its requested range.

## Results

| Track | Saved bytes (= contentLength) | Real duration | Metadata duration | Format | Full decode |
|---|---:|---:|---:|---|---|
| A | 2,543,152 | 156.972902 s | 156.972 s | AAC / M4A | OK |
| B | 2,195,593 | 135.500 s | 134.750 s | AAC / M4A | OK |
| C | 3,916,231 | 241.834490 s | 241.834 s | AAC / M4A | OK |
| D | 5,285,995 | 326.440 s | 326.842 s | AAC / M4A | OK |

## What had to change

Early drafts asked an iOS `player` endpoint directly and got 403s. The shipped request
builds an anonymous session from the public `visitor_id` endpoint, uses a VISIONOS
client, passes the playback `cpn` to the audio URL, and aligns client fields and
headers — informed by NewPipeExtractor and yt-dlp. No single field was isolated as the
cause, so the fix is a set. To rule out "prefix only", the last 512 bytes are probed
before any candidate is offered.

## Not covered

- Installation, saving, encryption and playback in Myspoti's own UI are verified on
  devices separately, not in this record.
- Not an exhaustive success-rate study: one corpus track returned no candidate under
  strict matching, which does not prove it is absent from YouTube Music.
- No audio comparison against Spotify previews: format, duration and full decode do
  not prove an identical recording, and `isrcMatched` stays false.
- YouTube-side changes, regions and networks can alter results at any time.
