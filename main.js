/* YouTube Music Download Helper — Myspoti向けdownload-source拡張
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 * 照合はフォーク(y-exe/myspoti)、構成はテンプレート(kota-zo/myspoti-extension-template)準拠。
 * Spotify音源・アカウント・ネイティブブリッジ・外部サーバーは使わない。
 */
(function () {
    'use strict';
    var MUSIC = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
    var API = 'https://youtubei.googleapis.com/youtubei/v1/';
    // クライアント/セッション項目はNewPipeExtractorとyt-dlpに準拠。動的なコード実行はしない。
    var AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    var CREDITS = /\s*[〔【][^〕】]*cv\s*[:：][^〕】]*[〕】]/gi;
    // 版違いの語(カバー/ライブ/カラオケ等)。曲名に同じ語を含まない候補は拒否する。
    var VERSIONS = /\b(live|cover|remix|remaster(?:ed)?|acoustic|instrumental|karaoke|slowed|sped[ -]?up|nightcore|reverb|8d)\b|ライブ|カバー|歌ってみた|弾いてみた|カラオケ|オルゴール|라이브|커버|리믹스|노래방|부르기|翻唱|现场|現場|混音|卡拉ok|伴奏|кавер|караоке|ремикс|инструментал/gi;
    // 検索は曲の表記言語を優先し、英語をフォールバックに(全地域で索引されている)。
    var LANG = {
        ja: ['ja', 'en'], ko: ['ko', 'en'], zh: ['zh-TW', 'zh-CN', 'en'],
        ru: ['ru', 'en'], ar: ['ar', 'en'], hi: ['hi', 'en'], th: ['th', 'en'],
        el: ['el', 'en'], he: ['he', 'en'], latin: ['en']
    };
    var REGION = { ja: 'JP', ko: 'KR', 'zh-TW': 'TW', 'zh-CN': 'US', en: 'US', ru: 'RU',
        ar: 'SA', hi: 'IN', th: 'TH', el: 'GR', he: 'IL' };
    var cache = {};
    // 返す音源の実用上限(1GiB)。公式楽曲でこれを超えるのは異常値(誤提供・汚染)扱いにする。
    var MAX_SIZE = 1073741824;
    // 検索クライアントの版。本体がHTTP 400/403で拒否してきたときだけ予備の版に切り替える。
    var CLIENT_VERSIONS = ['1.20251013.03.00', '1.20241111.01.00'], CLIENT = 0;
    // 匿名セッション(visitorData)は1時間だけ再利用する。ダウンロード1件ごとの取得要求を省く。
    var SESSION = null;

    // 英語標準。myspoti.localeは毎回読み直し、言語切替を次の呼び出しから反映する。
    function T(en, ja) {
        var tag = '';
        try { tag = myspoti.locale || ''; } catch (e) {}
        return String(tag).replace(/_/g, '-').toLowerCase().split('-')[0] === 'ja' ? ja : en;
    }

    // ログにはURL等を出さない。本体のエラーメッセージの形式が変わっても1箇所で直る。
    function scrub(message) {
        return String(message).replace(/https?:\/\/\S+/g, '<address>');
    }

    // 本体は拡張ごとに120リクエスト/分の上限(スライド窓)。連続保存で触れると以後の
    // 検索が全滅するため、自前の台帳で上限到達前に待機する。
    var LIMIT = 90, WINDOW_MS = 60000, REQUESTS = [], NOTED = false;
    function balance() {
        var now = Date.now();
        while (REQUESTS.length && now - REQUESTS[0] >= WINDOW_MS) REQUESTS.shift();
        return LIMIT - REQUESTS.length;
    }
    var BUDGET = 'hook budget reached';
    var WAITED = 0;
    function sleep(ms) {
        if (!(myspoti.util && typeof myspoti.util.sleep === 'function') || !(ms > 0)) return;
        var step = Math.min(ms, 1800);
        try { myspoti.util.sleep(step); } catch (e) { throw new Error(BUDGET); }
        WAITED += step;
    }
    // フック予算は短い。1回の呼び出しで待機は1分相当まで。
    function govern() {
        while (balance() <= 0 && WAITED < 13000) {
            if (!NOTED) { myspoti.log(T("Waiting: YouTube Music's per-minute cap is near", 'YouTube Musicのレート制限に近づいたため待機します')); NOTED = true; }
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
        return s.toLowerCase();
    }
    function letters(value) {
        return normalized(value).replace(/[^a-z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, '');
    }
    function title(value) {
        return letters(normalized(value).replace(/\s*(?:\(|\[)?(?:feat|ft)\.?\s+.*/i, '')
            .replace(/\b(official|music|video|audio|lyrics?)\b/gi, ''));
    }
    function artist(value) {
        return letters(normalized(value).replace(CREDITS, '')
            .replace(/\s*-\s*topic$|vevo$|\s+official(?:\s+(?:channel|music))?$/i, ''));
    }
    function artistNames(track) {
        var list = [track.artist || ''];
        if (Array.isArray(track.artists)) track.artists.forEach(function (a) { list.push(typeof a === 'string' ? a : a.name || ''); });
        var names = [];
        list.forEach(function (a) { a.split(/,|、/).forEach(function (n) { n = artist(n); if (n && names.indexOf(n) < 0) names.push(n); }); });
        return names;
    }
    // 表記から言語を判定: ハングル=韓国語、漢字のみ=中国語、他は各言語。ラテン字は英語で検索。
    function languageOf(track) {
        var text = normalized((track.title || '') + ' ' + (track.artist || ''));
        return /[\u3040-\u30ff]/.test(text) ? 'ja' : /[\uac00-\ud7af]/.test(text) ? 'ko' :
            /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 'zh' : /[\u0400-\u04ff]/.test(text) ? 'ru' :
            /[\u0370-\u03ff]/.test(text) ? 'el' : /[\u0590-\u05ff]/.test(text) ? 'he' :
            /[\u0600-\u06ff]/.test(text) ? 'ar' : /[\u0900-\u097f]/.test(text) ? 'hi' :
            /[\u0e00-\u0e7f]/.test(text) ? 'th' : 'latin';
    }
    function languages(track) {
        var list = LANG[languageOf(track)];
        return list[0] === 'en' ? list : list.concat(['en']);
    }
    function queries(track) {
        var main = String(track.artist || '').split(',')[0].replace(CREDITS, '').trim();
        var name = String(track.title || '').trim();
        var bare = name.replace(/\s*(?:\(|\[)?(?:feat|ft)\.?\s+.*/i, '').trim();
        var words = bare.replace(/[^a-zA-Z0-9\u00c0-\u024f\u0370-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\s]/g, ' ').replace(/\s+/g, ' ').trim();
        var out = [];
        [name + ' ' + main, bare + ' ' + main, words + ' ' + main, bare].forEach(function (q) {
            q = q.trim(); if (q && out.indexOf(q) < 0) out.push(q);
        });
        // ISRC検索で公式曲に当たることは少ない。まず曲名ベースを出し切ってから出す(台帳の節約)。
        if (/^[a-z]{2}[a-z0-9]{3}[0-9]{7}$/i.test(track.isrc || '')) out.push(track.isrc);
        return out;
    }
    function similarity(a, b) {
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
    function score(hit, track) {
        if (!(track.durationMs > 0) || !sameLength(hit.seconds, track)) return null;
        var unwanted = normalized(hit.title).match(VERSIONS) || [];
        if (unwanted.some(function (v) { return normalized(track.title).indexOf(v) < 0; })) return null;
        // 公式タイトルはSpotifyの表記とずれる(翻訳・リマスター・歌手追加)。近い表記のみ通す。
        // 中国語はストア間の簡体/繁体の字形差があるため、閾値をさらに緩める。
        var wanted = title(track.title), got = title(hit.title);
        if (!wanted || !got) return null;
        var zh = languageOf(track) === 'zh';
        var titleScore = similarity(got, wanted);
        if (titleScore < (zh ? 0.75 : 0.85)) return null;
        var names = artistNames(track), channels = [];
        hit.artists.forEach(function (a) {
            String(a).split(/\s+[/|&]\s+|,|、/).forEach(function (c) {
                c = artist(c);
                if (c && channels.indexOf(c) < 0) channels.push(c);
            });
        });
        var artistScore = 0;
        names.forEach(function (n) {
            channels.forEach(function (c) {
                var points = c === n ? 1.0 :
                    Math.min(c.length, n.length) >= 4 && (c.indexOf(n) >= 0 || n.indexOf(c) >= 0) ? 0.9 :
                    zh && similarity(c, n) >= 0.65 ? 0.9 : 0;
                if (points > artistScore) artistScore = points;
            });
        });
        if (artistScore < 0.9) return null;
        var timeScore = 1 - Math.abs(hit.seconds * 1000 - track.durationMs) / 10000;
        return titleScore * 0.6 + artistScore * 0.25 + timeScore * 0.15;
    }
    function parseSearch(data) {
        var found = {}, hits = [];
        function visit(node) {
            if (!node || typeof node !== 'object') return;
            var row = node.musicResponsiveListItemRenderer;
            if (row) {
                var columns = row.flexColumns || [];
                function runs(i) { return (((columns[i] || {}).musicResponsiveListItemFlexColumnRenderer || {}).text || {}).runs || []; }
                var first = runs(0)[0] || {};
                var watch = (first.navigationEndpoint || {}).watchEndpoint || {};
                var config = (watch.watchEndpointMusicSupportedConfigs || {}).watchEndpointMusicConfig || {};
                var id = (row.playlistItemData || {}).videoId || watch.videoId || '';
                var names = [], seconds = 0, meta = runs(1);
                meta.forEach(function (r) {
                    var browse = (r.navigationEndpoint || {}).browseEndpoint || {};
                    var type = ((browse.browseEndpointContextSupportedConfigs || {}).browseEndpointContextMusicConfig || {}).pageType;
                    if (type === 'MUSIC_PAGE_TYPE_ARTIST' && r.text) names.push(r.text);
                    if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(r.text || '')) seconds = r.text.split(':').reduce(function (n, s) { return n * 60 + Number(s); }, 0);
                });
                if (!names.length && meta[0] && !meta[0].navigationEndpoint && meta[0].text && !/[•:]/.test(meta[0].text)) names.push(meta[0].text);
                if (config.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' && /^[a-zA-Z0-9_-]{11}$/.test(id) && names.length && seconds > 0 && !found[id]) {
                    found[id] = true;
                    hits.push({ id: id, title: runs(0).map(function (r) { return r.text || ''; }).join(''), artists: names, seconds: seconds });
                }
            }
            Object.keys(node).forEach(function (key) { visit(node[key]); });
        }
        visit(data);
        return hits;
    }
    function json(url, body, headers, end) {
        var retried = false;
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
                    // 本体の台帳は自分のものより先に満ちる(見えない呼び出しも数える)。
                    // フックは1分耐えられないので予算内で待ち、だめなら「レート制限中」を
                    // 投げて本体に再試行させる(見つからない誤登録を防ぐ)。
                    if (WAITED >= 13000 || end - Date.now() < 2500) {
                        throw new Error(T('YouTube Music is rate limited, please try again in a minute',
                            'YouTube Musicのレート制限中です。しばらく待ってから再試行してください'));
                    }
                    if (!NOTED) { myspoti.log(T('Rate limited by the per-minute cap, waiting', 'レート制限中: 1分あたりの上限に達したため待機します')); NOTED = true; }
                    sleep(Math.max(400, Math.min(1800, end - Date.now() - 2500)));
                    continue;
                }
                throw e;
            }
        }
        throw new Error(T('YouTube Music did not answer the search', 'YouTube Musicが検索に応じませんでした'));
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
        if (result.error) throw new Error(T('YouTube Music refused the search', 'YouTube Musicが検索を拒否しました'));
        var hits = parseSearch(result);
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
        if (typeof value !== 'string' || !value || value.length > 4096) throw new Error(T('Could not get an anonymous YouTube Music session', '匿名セッションを取得できませんでした'));
        client.visitorData = value;
        SESSION = { time: Date.now(), value: { client: client, headers: headers } };
        return SESSION.value;
    }
    function fileFor(hit, track, end, currentSession) {
        var cpn = nonce(16);
        var result = json(API + 'player?prettyPrint=false&id=' + hit.id + '&t=' + nonce(12),
            { context: { client: currentSession.client }, videoId: hit.id, cpn: cpn, contentCheckOk: true, racyCheckOk: true }, currentSession.headers, end);
        var state = result.playabilityStatus || {}, detail = result.videoDetails || {};
        if (state.status !== 'OK') { myspoti.log(T('Could not get the audio: ', '音源を取得できません: ') + (state.status || 'UNKNOWN')); return null; }
        if (detail.videoId !== hit.id || detail.isLiveContent || !(Number(detail.lengthSeconds) > 0) || !sameLength(Number(detail.lengthSeconds), track)) return null;
        var streams = ((result.streamingData || {}).adaptiveFormats || []).filter(function (s) {
            return (!s.drmFamilies || !s.drmFamilies.length) && !s.signatureCipher && !s.cipher && /^audio\/mp4\s*;.*mp4a\./.test(s.mimeType || '') &&
                /^https:\/\/[^/?#]+\.googlevideo\.com\/videoplayback\?/.test(s.url || '') &&
                Number(s.contentLength) >= 10000 && Number(s.contentLength) < MAX_SIZE &&
                (!s.audioTrack || s.audioTrack.audioIsDefault !== false);
        }).sort(function (a, b) { return (b.averageBitrate || b.bitrate || 0) - (a.averageBitrate || a.bitrate || 0); });
        for (var i = 0; i < streams.length && end - Date.now() > 2000; i++) {
            var s = streams[i], size = Number(s.contentLength);
            var url = s.url + '&cpn=' + encodeURIComponent(cpn);
            try {
                // 先頭だけ取得できる場合があるため、末尾も確認する。
                var ranges = ['bytes=0-511', 'bytes=' + (size - 512) + '-' + (size - 1)];
                var usable = ranges.every(function (range) {
                    if (end - Date.now() < 1200) return false;
                    var probe = grequest({ url: url, method: 'GET', headers: { 'User-Agent': AGENT, Range: range },
                        timeout: Math.min(5000, end - Date.now() - 200) });
                    if (probe.status !== 206) { myspoti.log(T('Range requests refused (HTTP ', '音源の範囲取得が拒否されました (HTTP ') + probe.status + ')'); return false; }
                    var want = range.substring(6) + '/' + size;
                    return probe.headers['content-range'] === 'bytes ' + want &&
                        /^audio\/(mp4|x-m4a)(;|$)/i.test(probe.headers['content-type'] || '');
                });
                if (!usable) continue;
                return { url: url, format: 'm4a', headers: { 'User-Agent': AGENT },
                    sizeHint: size, provider: 'YouTube Music (AAC)', isrcMatched: false };
            } catch (e) { myspoti.log(T('Could not verify the audio URL', '音源URLの確認に失敗しました')); }
        }
        return null;
    }
    myspoti.provide('status', function () {
        // 安価な確認1回(最大3秒)。台帳が温かいうちは省略し、保存の枠を消費しない。
        try {
            if (balance() <= 0) return { live: true, detail: T('Status check skipped: the per-minute cap is near', 'レート制限中のため接続確認を省略しました') };
            REQUESTS.push(Date.now());
            var probe = myspoti.http.get('https://music.youtube.com/', { timeout: 3000 });
            return probe.ok ? { live: true } :
                { live: false, detail: T('Could not reach YouTube Music (HTTP ', 'YouTube Musicに接続できません (HTTP ') + probe.status + ')' };
        } catch (e) {
            var message = String((e && e.message) || e);
            // タイムアウト・DNS失敗・応答なしは本当に届かないときに起きる(死んだVPNを含む)。
            // 正直にlive:falseへ(それはダウンロードも失敗するので、そう報告したほうが実態に合う)。
            if (/timeout|timed\s*out|cannot\s*resolve|unable\s*to\s*resolve|unreachable|no\s*address|econn|enet|etimed|socket|network/i.test(message))
                return { live: false, detail: T('Cannot reach YouTube Music right now', '現在YouTube Musicに接続できません') };
            // それ以外の想定外(本体側の事情など)は不確かさとして扱う(以前のfail-open)。
            return { live: true, detail: T('Status check failed, showing as live: ', '状態を確認できません: ') + scrub(message) };
        }
    });
    myspoti.provide('download-source', function (track) {
        if (!track || !track.title || !artistNames(track).length || !(track.durationMs > 0)) return [];
        WAITED = 0; NOTED = false;
        var end = Date.now() + 25000, list = queries(track), tried = {}, currentSession = null;
        // ランキングは同一リクエストでも揺れる(カラオケ群に公式曲が隠れたり隠れなかったり)。
        // 1巡目の後、予算が許す限り2巡目を回す。
        for (var pass = 0; pass < 2; pass++) {
            if (pass === 1) {
                cache = {};
                myspoti.log(T('No official song in the rankings, searching again', '検索結果に公式楽曲が見つからず、再検索します'));
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
                        myspoti.log(T('Search or fetch failed: ', '検索・取得に失敗しました: ') + scrub(e.message || e));
                        if (e.message === BUDGET) { pass = 2; l = langs.length; q = list.length; }
                        if (String(e.message || e).indexOf('rate limited') >= 0) { pass = 2; l = langs.length; q = list.length; }
                    }
                }
            }
        }
        myspoti.log(Object.keys(tried).length ? T('Found matching candidates but could not fetch the audio', '一致候補はありましたが、音源を取得できませんでした') :
            T('No official song matched beyond doubt', '厳密に一致する公式楽曲が見つかりませんでした'));
        return [];
    });
}());
