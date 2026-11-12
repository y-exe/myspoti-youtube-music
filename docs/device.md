# Verifying on a device

The PC harness replays search and matching, but only a device shows what Orpheon does
with the answer. Two paths exist: the extension store / *Install from an address*
(which fetches this repo), or *Install from a file* with `extension.zip` from a
[release](https://github.com/y-exe/orpheon-youtube-music/releases/latest).

## Verifying the release zip

Releases are built by `scripts/pack.js`, which is byte-stable: the same inputs always
produce the same zip. After downloading a release, check the sha256 shown with the
release before installing:

PowerShell:

```powershell
Get-FileHash .\orpheon-youtube-music-1.0.3.zip -Algorithm SHA256
```

macOS / Linux:

```sh
shasum -a 256 orpheon-youtube-music-1.0.3.zip   # or: sha256sum …
```

The digest must match the one published with the release. A mismatch means the file
was altered in transit — do not install it.

## Reading the extension console

Every extension's detail page (Extensions → the extension) shows its console log. The
extension writes one line per phase:

| Log line | Meaning |
|---|---|
| `Waiting: … per-minute cap is near` / `Rate limited …` | The ledger is holding requests back; the download will finish later, not fail. |
| `No official song in the rankings, searching again` | First pass found no candidate; the second pass re-searches with fresh rankings. |
| `Search or fetch failed: <message>` | A search or player call threw. `<address>` replaces hosts — nothing identifying is logged. |
| `Found matching candidates but could not fetch the audio` | Matching worked; every candidate failed the range probes or the length re-check. |
| `No official song matched beyond doubt` | No candidate passed the gates. Correct for covers-only catalogs; suspicious otherwise. |

Failures of the surrounding app are not extension logs. `Unable to resolve host` means
device DNS (VPN, private DNS), and an internal `NoClassDefFoundError` in the app's own
video resolution is caught upstream and unrelated.

## What to try before reporting

1. Re-run the same song once — the second pass and the ledger handle most transient
   ranking flips and rate-cap collisions.
2. Try the song's native-language title if Spotify shows a translated one; the search
   follows the metadata it is given.
3. Compare the track's metadata duration with YouTube Music's listing. A master longer
   than the metadata + 15 s is refused by design (the app's own check uses the same
   window).

Reports go to [Issues](https://github.com/y-exe/orpheon-youtube-music/issues) with the
console lines, the app version, and the song's title/artist/duration.
