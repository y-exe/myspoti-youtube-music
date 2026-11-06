# YouTube Music Download Helper for Myspoti

[![License GPL v3](https://img.shields.io/badge/LICENSE-GPL%20v3-green.svg?style=flat-square)](LICENSE)
[![Myspoti](https://img.shields.io/badge/Myspoti-2.0.2%2B-blue.svg?style=flat-square)](https://github.com/kota-zo/myspoti)

An independent [`download-source`](https://github.com/kota-zo/myspoti/blob/main/docs/extensions/API.md) extension for [Myspoti](https://github.com/kota-zo/myspoti). It matches a track's title, artist and length against **YouTube Music's official catalog**, searching in the song's own script and ranking region, and hands the original AAC/M4A to Myspoti, which downloads, stores and plays it. No Myspoti fork needed and no external resolver service.

日本語での説明は末尾の[日本語](#ja)を参照してください。

## Status

Working on Android (Myspoti beta 2.0.2-beta.8 + stable 2.4.0). Verified with real tracks on the device CLI and a Node harness replaying the same search and matching:

- Multilingual corpus (Korean hangul/latin, Chinese simplified/traditional, Russian, Thai, Japanese, Spanish): all 8 saved.
- 13-track Japanese corpus: 12/13 saved (the one miss is a real catalog difference — the official master runs 25 s longer than Spotify's metadata, so the app's length check refuses it).
- Batch of 10 sequential saves at once: fine, no rate-limit refusals.

Not a lossless filler or a note-perfect recording matcher like my [Myspoti fork](https://github.com/y-exe/myspoti), which stays available for comparison. Failure cases on both: titles that only ever appear translated or romanized, versions whose YouTube master length drifts too far, and songs lost in cover-storm rankings.

## Install

- **Store**: the repo is found by Myspoti's store via the `myspoti-extension` topic — nothing to submit.
- **From an address**: Settings → Extensions → Install → *Install from an address*: `https://github.com/y-exe/myspoti-youtube-music`.
- **From a file**: grab `extension.zip` from the [latest release](https://github.com/y-exe/myspoti-youtube-music/releases/latest) (or build it with `node scripts/pack.js extension.zip`), push it to the phone and choose *Install from a file*.

Requires Myspoti 2.0.2-beta.4 or newer. All downloading, storage and encryption stay inside Myspoti — the extension only proposes files.

## What it does

- Searches ISRC, title + artist, title (feat-stripped, punctuation-stripped). Every query first runs in the song's own language ranking — detected from its script: Japanese, Korean, Simplified/Traditional Chinese, Russian, Greek, Hebrew, Arabic, Hindi or Thai — with English as the fallback, then re-searches a second pass when neither hit. A single track is answered within its 25 s budget.
- Matching follows the fork's criteria: title similarity ≥ 0.85 (looser for Chinese, whose simplified and traditional glyphs drift between stores), artist equal or contained (≥ 4 chars), and a length window of −5 s / +15 s (the same window the app's own download check uses); the best score wins. ATV-classified (official) songs only; live/cover/remix/karaoke wordings across those languages are refused.
- Full-width/half-width, case, punctuation and CV-actor suffixes in artist names are normalized away.
- Picks the highest-bitrate available AAC and verifies head and tail ranges answer before returning an M4A. No transcoding, no fake quality, WebM/Opus is never offered.
- `status` keeps the extension's presence honest (Inactive on unreachable YouTube Music).
- **Request self-governance**: the app caps each extension at 120 requests/minute, which batch downloads used to burst through. The extension keeps its own ledger, self-limits at 90 and waits inside the hook budget; when the budget is short it reports "rate limited" so the app can retry later instead of mislabelling the song *not found*.

## Limits

- `download.source` is exclusive in Myspoti: while this extension is on, it owns downloads — a SpotiFLAC-style lossless source cannot share the duty.
- No audio decoding or audio-alignment (fork features): `isrcMatched` is always false; ISRC search is not proof of an identical recording.
- Official MVs, ordinary uploads and every non-ATV result are refused; Spotify audio is never touched.
- Streams YouTube asks to log in, sign or DRM for are out of scope. No cookies or account tokens; anonymous visitor data is borrowed from the public API for the duration of one request.
- A metadata match is not a proven recording match. Stop using the extension and report if the wrong take is ever saved.

## Development

Layout and `scripts/pack.js` follow [kota-zo/myspoti-extension-template](https://github.com/kota-zo/myspoti-extension-template). CI runs the official SDK `check` plus a hook-backed Rhino smoke test; pushing a tag `vX.Y.Z` matching the manifest releases `extension.zip`. Everything in this repository is JavaScript (Node for packaging, no Python). Files: [`main.js`](main.js) (all logic), [`docs/rhino-compatibility.md`](docs/rhino-compatibility.md) (what Rhino offered), [`docs/full-download-verification.md`](docs/full-download-verification.md) (how the full-length fetch was proven).

## Sources and licensing

Audio comes exclusively from YouTube Music's official catalog (ATV-classified songs), fetched through the same public `youtubei` endpoints the YouTube Music web player uses, with anonymous visitor data. Nothing is decrypted: streams served with DRM are skipped, not bypassed; the app's per-extension rate limits are respected, not avoided. FLAC/perfect-recording guarantees are not offered. This extension is not affiliated with Myspoti, YouTube or Google.

## License

[GPL-3.0](LICENSE); packaging scripts from the template are [MIT](LICENSE.txt).

---

<a id="ja"></a>
## 日本語

[Myspoti](https://github.com/kota-zo/myspoti) 向けの独立した `download-source` 拡張です。曲名・アーティスト・長さ（日本語の表記ゆれ対応）をYouTube Music公式カタログと照合し、元のAAC/M4Aを本体に渡します。本体がダウンロード・保存・再生を行い、拡張は音源候補を返すだけです。

- **インストール**: ストアで「YouTube Music Download Helper」を検索 / 「設定 → 拡張機能 → アドレスからインストール」に `https://github.com/y-exe/myspoti-youtube-music` を入力 / [最新リリース](https://github.com/y-exe/myspoti-youtube-music/releases/latest)の `extension.zip` を端末に入れて「ファイルからインストール」。zipビルドは `node scripts/pack.js extension.zip`。
- **実装**: タイトル類似度85%以上・アーティスト一致/包含・長さ−5s/+15sでの照合。曲の表記言語(日本語・韓国語・簡体/繁体中国語・ロシア語など)の検索ランキングを優先し、英語をフォールバックに。見つからなければ2巡。ライブ/カバー/カラオケ表記は各言語で拒否。
- **検証**: betaアプリCLIとPC上のNodeで実トラックを検証済み。バッチ保存時の本体レート制限(120req/分)問題は v0.1.4 で修正（自己台帳で90req/分に制御）。
- **取得できないもの**: 翻訳・ローマ字のみ表記の曲、公式masterの長さが大きく違う曲（SPECIALZ等）、一般投稿・公式MV、DRM音源。Spotify音声は取得しません。

照合の詳細・制限は上の英語セクションを参照してください。
