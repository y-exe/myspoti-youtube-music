# Rhino環境でのYouTube取得ライブラリ調査

2026-10-26時点。本家Myspotiの拡張環境を変えず、外部サーバーなしで使える実装を調べました。

## その後のフル尺検証

本家SDKで動く同期JavaScript実装を修正し、4曲のフル尺保存と全デコードに成功しました。YouTube.js全体の移植ではありません。公開APIから匿名visitor情報を取得し、再生要求と音源取得の識別子・ヘッダーを揃えた経路を使っています。以前の403の直接原因を一つの項目に特定できたわけではありません。[検証結果と実機未確認の範囲](full-download-verification.md)を参照してください。

以下は修正前に行ったライブラリ互換性調査の記録です。

## 初回調査の結果

**そのまま使える既存のYouTubeダウンローダーは見つかっていません。移植候補として最も有望だったのはYouTube.jsです。**

YouTube.js 18.3.0は、ビルド時の構文・正規表現変換と圧縮を行うと、本家SDKのRhino 1.8.1でライブラリを読み込むところまで成功しました。**このライブラリ移植実験では音源URLの取得や曲全体のダウンロードには到達していません。** 読み込み成功を、ダウンロード対応とは扱いません。

## 候補の比較

| 候補 | 確認方法 | 結果 |
|---|---|---|
| [YouTube.js](https://github.com/LuanRT/YouTube.js) 18.3.0 | npm配布物・ソース・Rhinoと本家SDKでの読み込み | 変換後は読み込み可。通信・非同期処理・音源URL解決の対応が必要 |
| [node-ytdl-core](https://github.com/fent/node-ytdl-core) | ソース・SDKでエントリーを読み込み | `require` がなく失敗。Nodeのstream・vm等に依存。READMEでも開発休止を明記 |
| [DisTube ytdl-core](https://github.com/distubejs/ytdl-core) | 公式README・package.json | アーカイブ済み。Node向けで、YouTube.jsへの移行を案内 |
| [YBD ytdl-core](https://github.com/510ren/ytdl-core) | 公式ソース・package.json | ブラウザ版はあるがアーカイブ済み。Web APIや追加ランタイムへの依存がある |
| [cloud-ytdl](https://github.com/cloudkuimages/cloud-ytdl) | 公式README・npm 1.0.5-nextのメタデータ | Node 18以上、undici・stream系・child_process等を前提としている |
| [Yt6](https://github.com/snarly/yt6) | ソース・本家SDKで読み込み | `window` がなく失敗。DOM・XMLHttpRequest・eval/Function等への依存もある |
| [yt-dlp-ejs](https://github.com/yt-dlp/ejs) | 公式ドキュメント・対応ランタイム | yt-dlpのJS処理の一部で、単独ダウンローダーではない。Rhinoは対応ランタイムに含まれない |
| [newpipe-extractor-wasm](https://github.com/thegrims/newpipe-extractor-wasm) | 公式設計文書・Rhino機能確認 | WebAssembly等を前提とするため、現在の拡張環境へそのまま持ち込めない |

## 実測した環境

本家の `5b8754d5eeeb5755aa7095744239910ffc2de8db` を基に、標準の `:extensions-cli:installDist` をビルドして実行しました。アプリ本体やSDKの制限は変更していません。

- Rhino 1.8.1、ES6モード。本家のsandbox初期化コードでも比較しました。
- `Promise`、`Uint8Array`、`BigInt` は存在します。
- `require`、`fetch`、`URL`、`TextEncoder`、`ReadableStream`、`WebAssembly`、Javaへのアクセスは提供されません。
- `eval` と `Function` 系は本家のpreludeが禁止します。これらの禁止を解除する方法は使っていません。
- フックは同期です。`Promise.resolve([])` をダウンロード結果として返すと、SDKは中身を待たず `{}` として扱い、`format` がないというエラーになりました。

## YouTube.jsの移植実験

1. npmの18.3.0を取得。配布ブラウザバンドルは1,580,239 bytes。
2. esbuildでIIFE化・ES2015化・圧縮すると793,233 bytes。ただしRhinoで構文エラーになりました。
3. BabelのES5変換と再圧縮で1,021,542 bytes。今度は定数文字列から構築する名前付きキャプチャ正規表現で失敗しました。
4. ビルド時に、その定数のRegExpをBabelで変換可能な正規表現リテラルへ直して処理すると1,022,753 bytes。本家SDKの `check` に通り、`Innertube` が関数として定義されることを確認しました。

1 MiBのスクリプト上限には入りますが、通信アダプター等を追加できる余裕は約25 KiBです。必要な機能だけに絞るバンドルも検討対象です。これらはローカルの移植実験であり、現在のmain.jsや配布パッケージには組み込んでいません。

未解決事項:

- fetch/Request/Response/Headers等を、同期の `myspoti.http` へ正しく接続する必要があります。
- 非同期APIを同期フックで利用する設計が必要です。Promiseが存在するだけでは足りません。
- 初期化の試行では `Intl` 不在にも到達しました。設定や互換実装で扱う必要があります。
- 現在のYouTube.jsは、音源URLのdecipherに呼び出し側のJavaScript evaluatorを要求します。本家の動的コード実行禁止と両立する解決方法は確認できていません。
- 既存の試作で出た「先頭範囲だけ取得でき、次の範囲は403」という問題が、この移植で解消するかは未検証です。

この調査時点では、既製ライブラリをそのまま採用できるとは結論できませんでした。その後の同期JavaScript実装での全体取得は冒頭の検証結果を参照してください。

## 一次資料

- [Myspoti拡張API・実行環境](https://github.com/kota-zo/myspoti/blob/5b8754d5eeeb5755aa7095744239910ffc2de8db/docs/extensions/API.md)
- [YouTube.jsの実行環境とcustom interpreter](https://ytjs.dev/guide/getting-started)
- [YouTube.jsの既定evaluator](https://github.com/LuanRT/YouTube.js/blob/204715b6acfb063dc306d8677e36fdbf09f293c5/src/platform/jsruntime/default.ts)
- [yt-dlp EJSの役割と対応ランタイム](https://github.com/yt-dlp/ejs)
