# Third-party notices

This extension is original code (GPL-3.0), but its design borrows from several
open-source projects. What was taken from each, and under which license, is listed
here. Nothing was copied verbatim except where noted; the matching ideas were
re-implemented for Rhino (ES5, no build step) and re-verified with the PC harness
(`docs/matching.md`).

## spotDL — https://github.com/spotDL/spotify-downloader

MIT License — Copyright (c) 2021 spotDL Developers

The most battle-tested "find a Spotify track on YouTube Music" implementation.
From its matcher (`spotdl/utils/matching.py`) this extension takes:

- **The album name as a ranking signal.** spotDL folds an album-name similarity into
  the final score for verified (official-catalog) results, because remix, live and
  remastered versions of the same song live on different albums. Here the official
  catalog flag is `MUSIC_VIDEO_TYPE_ATV` and the album name is read from the search
  row's album column; a similarity above 0.6 nudges the score by up to ±0.02, which
  only orders candidates that already passed every gate (no threshold moved).
- **Penalizing version notes instead of refusing them.** spotDL subtracts points for
  "forbidden" words rather than dropping the candidate. `remaster(ed)` moved from the
  refusal list to a −0.08 penalty per occurrence for the same reason: official master
  uploads often carry "(Remastered 2011)" in their title, and refusing them loses
  songs that are in fact the current master. Stronger markers of a different
  recording (live, cover, remix, karaoke, instrumental, …) are still refused outright.

## spotify_to_ytmusic — https://github.com/sigma67/spotify_to_ytmusic

MIT License — Copyright (c) 2022 sigma67

Playlist-transfer tool. Its matcher (`spotify_to_ytmusic/utils/match.py`) compares
the Spotify album name with the YouTube Music album name for song results — the same
album signal as above, taken as a second confirmation that it is worth adding.

## ytmusicapi — https://github.com/sigma67/ytmusicapi

MIT License — Copyright (c) 2026 sigma67

Unofficial YouTube Music API used by both projects above. Not used here as code, but
its parsers document the innerTube request shapes this extension builds by hand
(search filters, region/language fields, the album column of song-shelf rows).

## NewPipeExtractor — https://github.com/TeamNewPipe/NewPipeExtractor

GPL-3.0. Reference for the innerTube client fields (client names, versions, device
descriptions) used in the search and player calls; no code copied.

## yt-dlp — https://github.com/yt-dlp/yt-dlp

Unlicense. Same reference role as NewPipeExtractor for client/session fields and the
audio URL shape; no code copied.

## myspoti-extension-template — https://github.com/kota-zo/myspoti-extension-template

MIT License. The package layout and the packaging script's approach follow the
template (see README).

---

The MIT permission notice, which applies to spotDL, spotify_to_ytmusic,
ytmusicapi and myspoti-extension-template:

> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in the
> Software without restriction, including without limitation the rights to use,
> copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
> Software, and to permit persons to whom the Software is furnished to do so,
> subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
> AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
> WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

This extension as a whole remains GPL-3.0 (see LICENSE). Nothing here is affiliated
with, endorsed by or connected to Myspoti, Spotify, YouTube or Google.
