/* YouTube Music Download Helper — Orpheon(旧Myspoti)向けdownload-source拡張
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 * 照合の基準は私のMyspotiフォークから、アルバム加減・リマスター減点の発想はspotDLから
 * (出典: THIRD_PARTY_NOTICES.md)。Spotify音源・アカウント・外部サーバーは使わない。
 */
(function () {
    'use strict';
    var MUSIC = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
    var API = 'https://youtubei.googleapis.com/youtubei/v1/';
    // クライアント/セッション項目はNewPipeExtractorとyt-dlpに準拠。動的なコード実行はしない。
    var AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    var CREDITS = /\s*[〔【][^〕】]*cv\s*[:：][^〕】]*[〕】]/gi;
    // 版違いの語(別録音の確実な印)。曲名に同じ語を含まない候補は拒否する。
    // リマスター表記は下のREMASTERへ: 公式masterの表記に付くことが多く、拒否ではなく減点。
    var VERSIONS = /\b(live|cover|remix|acoustic|instrumental|karaoke|slowed|sped[ -]?up|nightcore|reverb|8d)\b|ライブ|カバー|歌ってみた|弾いてみた|カラオケ|オルゴール|라이브|커버|리믹스|노래방|부르기|翻唱|现场|現場|混音|卡拉ok|伴奏|кавер|караоке|ремикс|инструментал|লাইভ|কভার|রিমিক্স|ক্যারাওকে|ইনস্ট্রুমেন্টাল|லைவ்|கவர்|ரீமிக்ஸ்|கரோக்கே|లైవ్|కవర్|రీమిక్స్|కరోకే|ಲೈವ್|ಕವರ್|ರೀಮಿಕ್ಸ್|ಕರಾಯೋಕೆ|ലൈവ്|കവർ|റീമിക്സ്|കരോക്കെ|લાઈવ|કવર|રીમિક્સ|કેરોકે|ਲਾਈਵ|ਕਵਰ|ਰੀਮਿਕਸ|ਕਰਾਓਕੇ|زنده|کاور|ریمیکس|بی‌کلام|بی کلام|لائیو|کور|ریمکس|ცოცხალი|ქავერი|რემიქსი|կենդանի|քավեր|ռեմիքս|ቀጥታ|ካቨር|ሪሚክስ|တိုက်ရိုက်|ផ្ទាល់/gi;
    // リマスター表記(減点対象)。「(Remastered 2011)」等。
    var REMASTER = /\bremaster(?:ed)?\b/gi;
    // 検索は曲の表記言語を優先し、英語をフォールバックに(全地域で索引されている)。
    var LANG = {
        ja: ['ja', 'en'], ko: ['ko', 'en'], zh: ['zh-TW', 'zh-CN', 'en'],
        ru: ['ru', 'en'], ar: ['ar', 'en'], hi: ['hi', 'en'], th: ['th', 'en'],
        el: ['el', 'en'], he: ['he', 'en'], latin: ['en'],
        bn: ['bn', 'en'], ta: ['ta', 'en'], te: ['te', 'en'], kn: ['kn', 'en'], ml: ['ml', 'en'],
        gu: ['gu', 'en'], pa: ['pa', 'en'], fa: ['fa', 'en'], ur: ['ur', 'en'],
        lo: ['lo', 'en'], my: ['my', 'en'], km: ['km', 'en'], ka: ['ka', 'en'], hy: ['hy', 'en'],
        am: ['am', 'en'],
    };
    var REGION = { ja: 'JP', ko: 'KR', 'zh-TW': 'TW', 'zh-CN': 'US', en: 'US', ru: 'RU',
        ar: 'SA', hi: 'IN', th: 'TH', el: 'GR', he: 'IL', bn: 'IN', ta: 'IN', te: 'IN',
        kn: 'IN', ml: 'IN', gu: 'IN', pa: 'IN', fa: 'US', ur: 'PK', lo: 'LA', my: 'MM',
        km: 'KH', ka: 'GE', hy: 'AM', am: 'ET' };
    var cache = {};
    // 返す音源の実用上限(1GiB)。公式楽曲でこれを超えるのは異常値(誤提供・汚染)扱いにする。
    var MAX_SIZE = 1073741824;
    // 検索クライアントの版。本体がHTTP 400/403で拒否してきたときだけ予備の版に切り替える。
    var CLIENT_VERSIONS = ['1.20251013.03.00', '1.20241111.01.00'], CLIENT = 0;
    // 匿名セッション(visitorData)は1時間だけ再利用する。ダウンロード1件ごとの取得要求を省く。
    var SESSION = null;

    // ユーザーに見える文字はmyspoti.locale(本体の表示言語)に従う。当て方はmanifestの
    // translationsと同じ(完全一致→基言語→英語)。訳はi18n.jsonからpack時に差し込まれる。
    var MESSAGES = {
        // 台帳待ちの開始(1回だけ出る)。
        'waiting-cap': {
            en: "Waiting: YouTube Music's per-minute cap is near",
        },
        // 本体の台帳も満ちて待ちきれないときに投げる(本体はこの曲を後で再試行する)。
        'rate-limited-throw': {
            en: 'YouTube Music is rate limited, please try again in a minute',
        },
        // 本体の毎分上限に触れて待機に入るとき(1回だけ出る)。
        'rate-limited-log': {
            en: 'Rate limited by the per-minute cap, waiting',
        },
        // 検索が予算内で答えなかった(8回とも失敗)。
        'search-no-answer': {
            en: 'YouTube Music did not answer the search',
        },
        // 検索応答にerrorが入っていた。
        'search-refused': {
            en: 'YouTube Music refused the search',
        },
        // 匿名セッション(visitorData)の取得に失敗した。
        'session-failed': {
            en: 'Could not get an anonymous YouTube Music session',
        },
        // player応答のplayabilityStatusがOK以外({0}: その値)。
        'audio-failed': {
            en: 'Could not get the audio: {0}',
        },
        // 範囲取得(先頭・末尾)が206で答えなかった({0}: 3xxまたはステータス)。
        'range-refused': {
            en: 'Range requests refused (HTTP {0})',
        },
        // 範囲取得の応答検査中の例外。
        'audio-verify-failed': {
            en: 'Could not verify the audio URL',
        },
        // status: 台帳が温かく、保存の枠を消費しないよう確認を省いたときのdetail。
        'status-skipped': {
            en: 'Status check skipped: the per-minute cap is near',
        },
        // status: 応答はあるがYouTube Musicに届かなかった({0}: HTTPステータス)。
        'status-unreachable': {
            en: 'Could not reach YouTube Music (HTTP {0})',
        },
        // status: タイムアウト・DNS失敗など、本当に届かないときのdetail。
        'status-offline': {
            en: 'Cannot reach YouTube Music right now',
        },
        // status: 想定外の例外で確認できなかった({0}: 例外の要約)。
        'status-error': {
            en: 'Status check failed, showing as live: {0}',
        },
        // 1巡目で公式曲が見つからず2巡目に入るとき。
        'research': {
            en: 'No official song in the rankings, searching again',
        },
        // 検索または音源取得で例外が起きた({0}: 要約した例外)。
        'hook-failed': {
            en: 'Search or fetch failed: {0}',
        },
        // 一致候補はあったが、どの音源も取得・検査を通らなかった。
        'candidates-not-fetched': {
            en: 'Found matching candidates but could not fetch the audio',
        },
        // 一致候補もなく予算を使い切った(見つからない扱い)。
        'not-found': {
            en: 'No official song matched beyond doubt',
        },
    };
    // i18n.jsonの訳の差し込み位置(pack.jsがこの行を置き換える。単体では英語で動く)。
    var MESSAGES_I18N = null;
    if (MESSAGES_I18N) {
        Object.keys(MESSAGES_I18N).forEach(function (id) {
            var langs = MESSAGES_I18N[id], target = MESSAGES[id];
            if (!target) return;
            Object.keys(langs).forEach(function (lang) { if (lang !== 'en') target[lang] = langs[lang]; });
        });
    }
    // AndroidのLegacyコード→BCP 47の基言語。
    var LANG_ALIAS = { iw: 'he', in: 'id', fil: 'tl', no: 'nb' };
    // 本体の表示言語をBCP 47風に正規化して小文字化する(ja_JP → ja-jp)。毎回読み直す。
    function localeTag() {
        var tag = '';
        try { tag = String(myspoti.locale || ''); } catch (e) {}
        return tag.replace(/_/g, '-').toLowerCase();
    }
    // {0}の置き換え付き。引数はすべて文字列化し、undefinedは空にする。
    function T(id) {
        var msg = MESSAGES[id], tag = localeTag(), text = '';
        if (!msg) return id;
        if (tag) {
            var base = tag.split('-')[0];
            text = msg[tag] || msg[LANG_ALIAS[base] || base] || '';
        }
        return text || msg.en;
    }
    function TF(id) {
        var text = T(id);
        for (var i = 1; i < arguments.length; i++) {
            text = text.replace(new RegExp('\\{' + (i - 1) + '\\}', 'g'),
                arguments[i] == null ? '' : String(arguments[i]));
        }
        return text;
    }

    // ログにはURL等を出さない。本体のエラーメッセージの形式が変わっても1箇所で直る。
    function scrub(message) {
        return String(message).replace(/https?:\/\/\S+/g, '<address>');
    }

    // 照合の内情。実機ではmyspoti.debugが無いので出ない。PCハーネス(scripts/harness.js)
    // でどのゲートが落としたか・何点で通ったかを見るためのもの。
    function note(message) {
        if (myspoti.debug) myspoti.log(message);
    }

    // 本体は拡張ごとに120リクエスト/分の上限(スライド窓)。連続保存で触れると以後の
    // 検索が全滅するため、自前の台帳で上限到達前に待機する。
    // PCハーネス(myspoti.debugあり)では上限を実質解除し、多数曲の一括照合検証が
    // レート制限で途切れないようにする。
    var LIMIT = myspoti.debug ? 600 : 90, WINDOW_MS = 60000, REQUESTS = [], NOTED = false;
    function balance() {
        var now = Date.now();
        while (REQUESTS.length && now - REQUESTS[0] >= WINDOW_MS) REQUESTS.shift();
        return LIMIT - REQUESTS.length;
    }
    var BUDGET = 'hook budget reached';
    var WAITED = 0;
    // 本体がresults機能(outcome応答)に対応しているか。旧本体にはfeaturesが無い。
    function hasResults() {
        try { return myspoti.features != null && myspoti.features.indexOf('results') >= 0; } catch (e) { return false; }
    }
    // レート制限で答えられないときのoutcome。本体はこの拡張を台帳が空くまで脇に置く
    // (30秒〜15分に丸められる)。曲は「見つからない」ではなく「後で再試行」になる。
    function rateLimited() {
        var wait = REQUESTS.length ? REQUESTS[0] + WINDOW_MS - Date.now() + 200 : 60000;
        return { outcome: 'rate-limited', retryAfterMs: Math.max(30000, Math.min(wait, 900000)) };
    }
    // results対応の本体には投げずにoutcomeで答えるための目印付きエラー。
    function rateLimitedError() {
        var e = new Error(T('rate-limited-throw'));
        e.rateLimited = true;
        return e;
    }
    function sleep(ms) {
        if (!(myspoti.util && typeof myspoti.util.sleep === 'function') || !(ms > 0)) return;
        var step = Math.min(ms, 1800);
        try { myspoti.util.sleep(step); } catch (e) { throw new Error(BUDGET); }
        WAITED += step;
    }
    // フック予算は短い。1回の呼び出しで待機は1分相当まで。
    function govern() {
        while (balance() <= 0 && WAITED < 13000) {
            if (!NOTED) { myspoti.log(T('waiting-cap')); NOTED = true; }
            var until = REQUESTS[0] + WINDOW_MS - Date.now() + 50;
            sleep(Math.max(300, Math.min(until, 1800)));
        }
        REQUESTS.push(Date.now());
    }
    function gpost(url, body, opts) {
        govern();
        return myspoti.http.post(url, body, opts);
    }
    function grequest(options) {
        govern();
        return myspoti.http.request(options);
    }

    function normalized(value) {
        var s = String(value || '');
        if (typeof s.normalize === 'function') s = s.normalize('NFKC');
        else {
            s = s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
            var half = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
            var full = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
            s = s.replace(/[ｦ-ﾝ]/g, function (c) { return full.charAt(half.indexOf(c)); });
            s = s.replace(/([カキクケコサシスセソタチツテトハヒフヘホ])ﾞ/g, function (_, c) { return String.fromCharCode(c.charCodeAt(0) + 1); })
                .replace(/([ハヒフヘホ])ﾟ/g, function (_, c) { return String.fromCharCode(c.charCodeAt(0) + 2); })
                .replace(/ウﾞ/g, 'ヴ').replace(/　/g, ' ');
        }
        // アラビア語の表記ゆれ(ハムザ・マクサ・母音記号)を比較の前に1文字に畳む。
        s = s.replace(/[\u064b-\u0652\u0640]/g, '')
            .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
            .replace(/\u0649/g, '\u064a')
            .replace(/\u0629/g, '\u0647');
        return s.toLowerCase();
    }
    function letters(value) {
        return normalized(value).replace(/[^a-z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f\u0e00-\u0e7f\u0e80-\u0eff\u1000-\u109f\u10a0-\u10ff\u1200-\u137f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, '');
    }
    // 公式側の丸括弧注記(映画・主題歌・OST・アーティスト別名)は情報でない。含む括弧だけ外す。
    var ANNOTATION = /主題曲|主题曲|片尾曲|插曲|電影|电影|電視劇|电视剧|主題歌|映画|劇場版|ドラマ|OST|soundtrack|theme song|韓劇|韩剧/i;
    function stripNotes(s) {
        return s.replace(/[（(【\[][^（(【\[）)】\]]*[）)】\]]/g, function (group) {
            return ANNOTATION.test(group) ? ' ' : group;
        });
    }
    function title(value) {
        var s = stripNotes(normalized(value));
        return letters(s.replace(/\s*(?:\(|\[)?(?:feat|ft)\.?\s+.*/i, '')
            .replace(/\b(official|music|video|audio|lyrics?)\b/gi, ''));
    }
    function artist(value) {
        return letters(stripNotes(normalized(value).replace(CREDITS, ''))
            .replace(/\s*-\s*topic$|vevo$|\s+official(?:\s+(?:channel|music))?$/i, ''));
    }
    function artistNames(track) {
        var list = [track.artist || ''];
        if (Array.isArray(track.artists)) track.artists.forEach(function (a) { list.push(typeof a === 'string' ? a : a.name || ''); });
        var names = [];
        list.forEach(function (a) { a.split(/,|、/).forEach(function (n) { n = artist(n); if (n && names.indexOf(n) < 0) names.push(n); }); });
        return names;
    }
    // 表記から言語を判定。アラビア文字はペルシャ語・ウルドゥー語の固有文字で分け、
    // デーヴァナーガリーはヒンディー語として扱う(マラーティー語等も同じ文字)。
    function languageOf(track) {
        var text = normalized((track.title || '') + ' ' + (track.artist || ''));
        return /[\u3040-\u30ff]/.test(text) ? 'ja' : /[\uac00-\ud7af]/.test(text) ? 'ko' :
            /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 'zh' : /[\u0400-\u04ff]/.test(text) ? 'ru' :
            /[\u0370-\u03ff]/.test(text) ? 'el' : /[\u0590-\u05ff]/.test(text) ? 'he' :
            /[\u0530-\u058f]/.test(text) ? 'hy' :
            /[\u067e\u0686\u0698\u06af]/.test(text) ? 'fa' : /[\u0679\u0688\u0691\u06ba\u06be\u06d2]/.test(text) ? 'ur' :
            /[\u0600-\u06ff]/.test(text) ? 'ar' :
            /[\u0980-\u09ff]/.test(text) ? 'bn' : /[\u0a00-\u0a7f]/.test(text) ? 'pa' :
            /[\u0a80-\u0aff]/.test(text) ? 'gu' : /[\u0b80-\u0bff]/.test(text) ? 'ta' :
            /[\u0c00-\u0c7f]/.test(text) ? 'te' : /[\u0c80-\u0cff]/.test(text) ? 'kn' :
            /[\u0d00-\u0d7f]/.test(text) ? 'ml' : /[\u0900-\u097f]/.test(text) ? 'hi' :
            /[\u0e00-\u0e7f]/.test(text) ? 'th' : /[\u0e80-\u0eff]/.test(text) ? 'lo' :
            /[\u1780-\u17ff]/.test(text) ? 'km' : /[\u1000-\u109f]/.test(text) ? 'my' :
            /[\u10a0-\u10ff]/.test(text) ? 'ka' : /[\u1200-\u137f]/.test(text) ? 'am' : 'latin';
    }
    function languages(track) {
        var list = LANG[languageOf(track)], out = [];
        list.concat(['en']).forEach(function (l) { if (out.indexOf(l) < 0) out.push(l); });
        return out;
    }
    function queries(track) {
        var main = String(track.artist || '').split(',')[0].replace(CREDITS, '').trim();
        var name = String(track.title || '').trim();
        var bare = name.replace(/\s*(?:\(|\[)?(?:feat|ft)\.?\s+.*/i, '').trim();
        var words = bare.replace(/[^a-zA-Z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f\u0e00-\u0e7f\u0e80-\u0eff\u1000-\u109f\u10a0-\u10ff\u1200-\u137f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\s]/g, ' ').replace(/\s+/g, ' ').trim();
        var out = [];
        [name + ' ' + main, bare + ' ' + main, words + ' ' + main, bare].forEach(function (q) {
            q = q.trim(); if (q && out.indexOf(q) < 0) out.push(q);
        });
        // ISRC検索で公式曲に当たることは少ない。まず曲名ベースを出し切ってから出す(台帳の節約)。
        if (/^[a-z]{2}[a-z0-9]{3}[0-9]{7}$/i.test(track.isrc || '')) out.push(track.isrc);
        return out;
    }
    function similarity(a, b) {
        // 計算量はO(長さ²)。異常に長い入力でフック予算を食い尽くさないよう打ち切る。
        a = String(a).slice(0, 300); b = String(b).slice(0, 300);
        var row = [0], i, j;
        for (j = 1; j <= b.length; j++) row[j] = j;
        for (i = 0; i < a.length; i++) {
            var next = [i + 1];
            for (j = 0; j < b.length; j++) {
                next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a.charAt(i) === b.charAt(j) ? 0 : 1));
            }
            row = next;
        }
        return 1 - row[b.length] / Math.max(a.length, b.length, 1);
    }
    // 窓は本体のダウンロード確認と同じ。公式masterは映像分で少し長い/丸めで短いことがある。
    function sameLength(seconds, track) {
        var diff = seconds * 1000 - track.durationMs;
        return diff >= -5000 && diff <= 15000;
    }
    // 非ラテン字の名前同士は語順の違い(姓+名の順が入れ替わる等)を吸収する:
    // ストア名(4字以上)の各文字が重複込みで相手にすべて含まれれば一致扱いにする。
    function contained(name, other) {
        if (name.length < 4) return false;
        var pool = other, i, at;
        for (i = 0; i < name.length; i++) {
            at = pool.indexOf(name.charAt(i));
            if (at < 0) return false;
            pool = pool.slice(0, at) + pool.slice(at + 1);
        }
        return true;
    }
    function score(hit, track) {
        if (!(track.durationMs > 0) || !sameLength(hit.seconds, track)) {
            note('reject ' + hit.id + ': length ' + hit.seconds + 's vs track ' + Math.round(track.durationMs / 1000) + 's');
            return null;
        }
        // 版違いの語。live/cover等は拒否、リマスター表記は減点(公式masterの表記に
        // 付くことがあるため)。いずれもストアの曲名に同じ語を含む場合は対象外。
        var ownTitle = normalized(track.title);
        var hardExtra = (normalized(hit.title).match(VERSIONS) || []).filter(function (v) { return ownTitle.indexOf(v) < 0; });
        if (hardExtra.length) {
            note('reject ' + hit.id + ': version word ' + hardExtra.join(','));
            return null;
        }
        var remasters = (normalized(hit.title).match(REMASTER) || []).filter(function (v) { return ownTitle.indexOf(v) < 0; }).length;
        // 公式タイトルはSpotifyの表記とずれる(翻訳・リマスター・歌手追加)。近い表記のみ通す。
        // 中国語はストア間の簡体/繁体の字形差があるため、閾値をさらに緩める。
        var wanted = title(track.title), got = title(hit.title);
        if (!wanted || !got) return null;
        var zh = languageOf(track) === 'zh';
        var titleScore = similarity(got, wanted);
        // 公式側は曲名の前に転写(ラテン字)を付けたり、注記を残したりする。曲名が
        // そのまま含まれているなら一致とみなす(逆方向は短い別曲を拾う恐れがあるので見ない)。
        if (wanted.length >= 3 && got.indexOf(wanted) >= 0) titleScore = Math.max(titleScore, 0.9);
        if (titleScore < (zh ? 0.75 : 0.85)) {
            note('reject ' + hit.id + ': title ' + titleScore.toFixed(2) + ' (' + got + ' vs ' + wanted + ')');
            return null;
        }
        var names = artistNames(track), channels = [];
        hit.artists.forEach(function (a) {
            String(a).split(/\s+[/|&]\s+|,|、/).forEach(function (c) {
                c = artist(c);
                if (c && channels.indexOf(c) < 0) channels.push(c);
            });
        });
        if (myspoti.debug) note('score ' + hit.id + ': want[' + names.join('|') + '] got[' + channels.join('|') + ']');
        var artistScore = 0;
        names.forEach(function (n) {
            channels.forEach(function (c) {
                // 包含の最短長。漢字・かな・ハングルは2〜3字の名前が普通なので2字を許し、
                // ラテン字は誤一致(短い語の部分一致)を避けるため4字のまま。
                var min = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(n) ? 2 : 4;
                var foreign = !/^[a-z0-9]*$/.test(n);
                var points = c === n ? 1.0 :
                    Math.min(c.length, n.length) >= min && (c.indexOf(n) >= 0 || n.indexOf(c) >= 0) ? 0.9 :
                    zh && similarity(c, n) >= 0.65 ? 0.9 :
                    foreign && contained(n, c) ? 0.9 :
                    foreign && similarity(c, n) >= 0.85 ? 0.9 : 0;
                if (points > artistScore) artistScore = points;
            });
        });
        if (artistScore < 0.9) {
            note('reject ' + hit.id + ': artist ' + artistScore.toFixed(2));
            return null;
        }
        var timeScore = 1 - Math.abs(hit.seconds * 1000 - track.durationMs) / 10000;
        // アルバム名の一致(spotDLと同じ発想: リマスター/ライブ盤は別アルバムに載る)。
        // 順位決め用で判定の門にはしない(±0.02、既存のしきい値は不変)。
        var albumBonus = 0;
        if (hit.album && track.album) {
            var wantAlbum = title(String(track.album).replace(/\s*-\s*(?:single|ep)\s*$/i, ''));
            var gotAlbum = title(String(hit.album).replace(/\s*-\s*(?:single|ep)\s*$/i, ''));
            if (wantAlbum && gotAlbum) {
                var albumScore = similarity(gotAlbum, wantAlbum);
                if (wantAlbum.length >= 4 && (gotAlbum.indexOf(wantAlbum) >= 0 || wantAlbum.indexOf(gotAlbum) >= 0)) albumScore = Math.max(albumScore, 0.9);
                albumBonus = Math.max(-0.02, Math.min(0.02, (albumScore - 0.6) * 0.05));
            }
        }
        var total = titleScore * 0.6 + artistScore * 0.25 + timeScore * 0.15 + albumBonus - remasters * 0.08;
        if (total < 0) total = 0;
        note('accept ' + hit.id + ': title ' + titleScore.toFixed(2) + ' artist ' + artistScore.toFixed(2) +
            (albumBonus ? ' album ' + (albumBonus >= 0 ? '+' : '') + albumBonus.toFixed(3) : '') +
            (remasters ? ' remaster -' + (remasters * 0.08).toFixed(2) : '') + ' total ' + total.toFixed(2));
        return total;
    }
    function parseSearch(data) {
        var found = {}, hits = [];
        function visit(node, depth) {
            if (!node || typeof node !== 'object' || depth > 14) return; // 深いネストの暴走止め
            var row = node.musicResponsiveListItemRenderer;
            if (row) {
                var columns = row.flexColumns || [];
                function runs(i) { return (((columns[i] || {}).musicResponsiveListItemFlexColumnRenderer || {}).text || {}).runs || []; }
                var first = runs(0)[0] || {};
                var watch = (first.navigationEndpoint || {}).watchEndpoint || {};
                var config = (watch.watchEndpointMusicSupportedConfigs || {}).watchEndpointMusicConfig || {};
                var id = (row.playlistItemData || {}).videoId || watch.videoId || '';
                var names = [], seconds = 0, album = '', meta = runs(1);
                meta.forEach(function (r) {
                    var browse = (r.navigationEndpoint || {}).browseEndpoint || {};
                    var type = ((browse.browseEndpointContextSupportedConfigs || {}).browseEndpointContextMusicConfig || {}).pageType;
                    if (type === 'MUSIC_PAGE_TYPE_ARTIST' && r.text) names.push(r.text);
                    if (type === 'MUSIC_PAGE_TYPE_ALBUM' && r.text) album = r.text;
                    if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(r.text || '')) seconds = r.text.split(':').reduce(function (n, s) { return n * 60 + Number(s); }, 0);
                });
                if (!names.length && meta[0] && !meta[0].navigationEndpoint && meta[0].text && !/[•:]/.test(meta[0].text)) names.push(meta[0].text);
                if (config.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' && /^[a-zA-Z0-9_-]{11}$/.test(id) && names.length && seconds > 0 && !found[id]) {
                    found[id] = true;
                    hits.push({ id: id, title: runs(0).map(function (r) { return r.text || ''; }).join(''), artists: names, seconds: seconds, album: album });
                }
            }
            Object.keys(node).forEach(function (key) { visit(node[key], depth + 1); });
        }
        visit(data, 0);
        return hits;
    }
    function json(url, body, headers, end) {
        var retried = false, backed = false;
        for (var attempt = 0; attempt < 8; attempt++) {
            var left = end - Date.now();
            if (left < 1200) throw new Error(BUDGET);
            try {
                var response = gpost(url, body, { headers: headers || {}, timeout: Math.min(left - 200, 7000) });
                if (response.ok) return response.json();
                // YouTube側の一時的な障害(5xx)のときだけ、予算内で1回出し直す。
                if (response.status >= 500 && !retried && left > 3000) {
                    retried = true;
                    sleep(600);
                    continue;
                }
                throw new Error('YouTube HTTP ' + response.status);
            } catch (e) {
                var message = String((e && e.message) || e);
                if (message.indexOf('requests in a minute') >= 0) {
                    // 本体の台帳は自分のものより先に満ちる。予算内で待ち、だめなら
                    // 「レート制限中」を投げて本体に再試行させる(見つからない誤登録を防ぐ)。
                    if (WAITED >= 13000 || end - Date.now() < 2500) {
                        throw rateLimitedError();
                    }
                    if (!NOTED) { myspoti.log(T('rate-limited-log')); NOTED = true; }
                    sleep(Math.max(400, Math.min(1800, end - Date.now() - 2500)));
                    continue;
                }
                // 403はYouTube側の一時的なフラグのことも多い。1秒置いて同じ版で1回だけ
                // 出し直す(それでも403なら検索の予備版切替に任せる)。
                if (!backed && /HTTP 403/.test(message) && end - Date.now() > 4000) {
                    backed = true;
                    sleep(1000);
                    continue;
                }
                // 一時的なネットワークの揺らぎ(タイムアウト等)も予算内で1回だけ出し直す。
                if (!retried && end - Date.now() > 3500 && /timeout|timed\s*out|socket|network|econn|reset/i.test(message)) {
                    retried = true;
                    sleep(500);
                    continue;
                }
                throw e;
            }
        }
        throw new Error(T('search-no-answer'));
    }
    function search(query, language, end) {
        var key = language + ':' + query;
        if (cache[key] && Date.now() - cache[key].time < 300000) return cache[key].hits;
        function call() {
            return json(MUSIC, { context: { client: { clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSIONS[CLIENT], hl: language, gl: REGION[language] || 'US' } },
                query: query, params: 'EgWKAQIIAWoKEAkQChAFEAMQBA%3D%3D' }, { Origin: 'https://music.youtube.com' }, end);
        }
        var result;
        try {
            result = call();
        } catch (e) {
            // 版が退役して拒否される(HTTP 400/403)ときだけ、予備の版に切り替えて1回出し直す。
            if (CLIENT + 1 < CLIENT_VERSIONS.length && /HTTP 40[03]/.test(String((e && e.message) || e))) {
                CLIENT++;
                cache = {};
                result = call();
            } else throw e;
        }
        if (result.error) throw new Error(T('search-refused'));
        var hits = parseSearch(result);
        note('search [' + query + '] / ' + language + ' -> ' + hits.length + ' official rows');
        if (Object.keys(cache).length >= 32) cache = {};
        cache[key] = { time: Date.now(), hits: hits };
        return hits;
    }
    function nonce(length) {
        var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', value = '';
        for (var i = 0; i < length; i++) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        return value;
    }
    function session(end) {
        // 1時間以内に取得したものは再利用する。落ちたら次の呼び出しで再取得する。
        if (SESSION && Date.now() - SESSION.time < 3600000) return SESSION.value;
        var client = { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
            osName: 'visionOS', osVersion: '26.5.23O471', platform: 'MOBILE', hl: 'ja', gl: 'JP', utcOffsetMinutes: 540 };
        var headers = { 'User-Agent': AGENT, 'X-Goog-Api-Format-Version': '2' };
        var visitor = json(API + 'visitor_id?prettyPrint=false', { context: { client: client } }, headers, end);
        var value = (visitor.responseContext || {}).visitorData;
        if (typeof value !== 'string' || !value || value.length > 4096) throw new Error(T('session-failed'));
        client.visitorData = value;
        SESSION = { time: Date.now(), value: { client: client, headers: headers } };
        return SESSION.value;
    }
    // 範囲取得。googlevideoの302転送を追跡し、転送後のURLと応答を返す(206以外ならnull)。
    function probeRange(url, range, end) {
        for (var hop = 0; hop < 4; hop++) {
            if (end - Date.now() < 1200) return null;
            var probe = grequest({ url: url, method: 'GET', headers: { 'User-Agent': AGENT, Range: range },
                timeout: Math.min(5000, end - Date.now() - 200) });
            if (probe.status >= 300 && probe.status < 400 && /^https:\/\//.test(probe.headers['location'] || '')) { url = probe.headers['location']; continue; }
            return probe.status === 206 ? { probe: probe, url: url } : null;
        }
        return null;
    }
    function fileFor(hit, track, end, currentSession) {
        // PCハーネスの照合検証では音源取得が対象外のため、ここで「一致済み」を返す。
        if (myspoti.debug === 'match') return { url: 'debug://match/' + hit.id, format: 'm4a', headers: { 'User-Agent': AGENT }, sizeHint: 0, provider: 'YouTube Music (AAC)', isrcMatched: false };
        var cpn = nonce(16);
        var result = json(API + 'player?prettyPrint=false&id=' + hit.id + '&t=' + nonce(12),
            { context: { client: currentSession.client }, videoId: hit.id, cpn: cpn, contentCheckOk: true, racyCheckOk: true }, currentSession.headers, end);
        var state = result.playabilityStatus || {}, detail = result.videoDetails || {};
        if (state.status !== 'OK') { myspoti.log(TF('audio-failed', state.status || 'UNKNOWN')); return null; }
        if (detail.videoId !== hit.id || detail.isLiveContent || !(Number(detail.lengthSeconds) > 0) || !sameLength(Number(detail.lengthSeconds), track)) return null;
        var streams = ((result.streamingData || {}).adaptiveFormats || []).filter(function (s) {
            return (!s.drmFamilies || !s.drmFamilies.length) && !s.signatureCipher && !s.cipher && /^audio\/mp4\s*;.*mp4a\./.test(s.mimeType || '') &&
                /^https:\/\/[^/?#@\\]+\.googlevideo\.com\/videoplayback\?/.test(s.url || '') &&
                Number(s.contentLength) >= 10000 && Number(s.contentLength) < MAX_SIZE &&
                (!s.audioTrack || s.audioTrack.audioIsDefault !== false);
        }).sort(function (a, b) { return (b.averageBitrate || b.bitrate || 0) - (a.averageBitrate || a.bitrate || 0); });
        for (var i = 0; i < streams.length && end - Date.now() > 2000; i++) {
            var s = streams[i], size = Number(s.contentLength);
            var url = s.url + '&cpn=' + encodeURIComponent(cpn);
            try {
                // 先頭だけ取得できる場合があるため、末尾も確認する。302の転送先も確かめる。
                var head = probeRange(url, 'bytes=0-511', end);
                if (!head) { myspoti.log(TF('range-refused', '3xx')); continue; }
                var tail = probeRange(head.url, 'bytes=' + (size - 512) + '-' + (size - 1), end);
                if (!tail) { myspoti.log(TF('range-refused', '3xx')); continue; }
                var usable = head.probe.headers['content-range'] === 'bytes 0-511/' + size &&
                    tail.probe.headers['content-range'] === 'bytes ' + (size - 512) + '-' + (size - 1) + '/' + size &&
                    /^audio\/(mp4|x-m4a)(;|$)/i.test(head.probe.headers['content-type'] || '');
                // 206でも中身が違う(長さ不一致・音声でない)場合はHTTP番号を出さない。
                if (!usable) { myspoti.log(T('audio-verify-failed')); continue; }
                return { url: head.url, format: 'm4a', headers: { 'User-Agent': AGENT },
                    sizeHint: size, provider: 'YouTube Music (AAC)', isrcMatched: false };
            } catch (e) { myspoti.log(T('audio-verify-failed')); }
        }
        return null;
    }
    myspoti.provide('status', function () {
        // 安価な確認1回(最大3秒)。台帳が温かいうちは省略し、保存の枠を消費しない。
        try {
            if (balance() <= 0) return { live: true, detail: T('status-skipped') };
            REQUESTS.push(Date.now());
            var probe = myspoti.http.get('https://music.youtube.com/', { timeout: 3000 });
            return probe.ok ? { live: true } :
                { live: false, detail: TF('status-unreachable', probe.status) };
        } catch (e) {
            var message = String((e && e.message) || e);
            // タイムアウト等、本当に届かないときは正直にlive:falseへ(その曲も失敗するため)。
            if (/timeout|timed\s*out|cannot\s*resolve|unable\s*to\s*resolve|unreachable|no\s*address|econn|enet|etimed|socket|network/i.test(message))
                return { live: false, detail: T('status-offline') };
            // 想定外(本体側の事情など)は不確かさとして扱う(以前のfail-open)。
            return { live: true, detail: TF('status-error', scrub(message)) };
        }
    });
    myspoti.provide('download-source', function (track) {
        if (!track || !track.title || !artistNames(track).length || !(track.durationMs > 0)) return [];
        WAITED = 0; NOTED = false;
        var end = Date.now() + 25000, list = queries(track), tried = {}, currentSession = null;
        // 予算を使い切って全候補を見切れていない(見つからないと誤登録しないための目印)。
        var outOfTime = false;
        // ランキングは同一リクエストでも揺れる。1巡目の後、予算が許す限り2巡目を回す。
        try {
            for (var pass = 0; pass < 2; pass++) {
                if (pass === 1) {
                    cache = {};
                    myspoti.log(T('research'));
                    currentSession = null;
                }
                for (var q = 0; q < list.length && end - Date.now() > 2000; q++) {
                    // 言語ごとに順位が入れ替わるため、同一クエリを曲の表記言語→英語の順で回す。
                    var langs = languages(track);
                    for (var l = 0; l < langs.length && end - Date.now() > 2000; l++) {
                        try {
                            var hits = search(list[q], langs[l], end).map(function (hit) { return { hit: hit, score: score(hit, track) }; })
                                .filter(function (x) { return x.score !== null; }).sort(function (a, b) { return b.score - a.score; });
                            for (var h = 0; h < hits.length && end - Date.now() > 2000; h++) {
                                var hit = hits[h].hit;
                                if (tried[hit.id]) continue;
                                tried[hit.id] = true;
                                if (!currentSession) currentSession = session(end);
                                var file = fileFor(hit, track, end, currentSession);
                                if (file) return [file];
                            }
                        } catch (e) {
                            myspoti.log(TF('hook-failed', scrub(e.message || e)));
                            if (e.rateLimited) throw e;
                            if (e.message === BUDGET) { outOfTime = true; pass = 2; l = langs.length; q = list.length; }
                        }
                    }
                }
            }
        } catch (e) {
            // レート制限中: results対応の本体にはoutcomeで答える(旧本体では投げる)。
            if (e.rateLimited && hasResults()) return rateLimited();
            throw e;
        }
        // 台帳が満ちたまま答えを返すときも「レート制限中」を返す(見つからない誤登録を防ぐ)。
        if (balance() <= 0) {
            if (hasResults()) return rateLimited();
            throw new Error(T('rate-limited-throw'));
        }
        // 予算を使い切って検索を終えられなかった曲も、見つからないとは書かない。
        if (outOfTime && hasResults()) return { outcome: 'network', detail: T('search-no-answer') };
        myspoti.log(Object.keys(tried).length ? T('candidates-not-fetched') : T('not-found'));
        return [];
    });

    // PC検証用(scripts/harness.js・scripts/check-i18n.js)。本体のRhinoにはmoduleが無いので何もしない。
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MESSAGES: MESSAGES, locale: localeTag, T: T, TF: TF,
            languageOf: languageOf, languages: languages, queries: queries, score: score };
    }
}());
