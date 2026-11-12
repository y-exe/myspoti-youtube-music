#!/usr/bin/env node
/* フィクスチャ収集エンジン。Deezer公開APIで楽曲を検索し、YouTube Musicの公式(ATV)
 * カタログに掲載が確認できた曲だけをfixture/tracks.jsonに書き出す(ISRC・実尺つき)。
 * 検索語(アーティスト名・キーワード)は fixture/sources.local.json から読む。
 *
 *     node scripts/collect.js [言語あたりの曲数=4]
 *
 * sources.local.json の形式:
 *     { "ja": { "script": "kana",   "artists": ["…"], "keywords": ["…"] },
 *       "en": { "script": "latin",  "artists": ["…"], "keywords": ["…"] }, … }
 * script は kana/hangul/han/cyrillic/greek/hebrew/arabic/devanagari/thai/latin のほか、
 * bengali/gurmukhi/gujarati/tamil/telugu/kannada/malayalam/lao/khmer/myanmar/georgian/
 * armenian/ethiopic/persian/urdu(アラビア文字からの分離)を取る。
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PER_LANG = Number(process.argv[2]) || 4;
const RANK_MIN = 60000, RANK_MAX = 450000, MAX_SECONDS = 900;
// 検索言語/地域(ATV事前検証で使う。拡張本体のLANG/REGIONと同じ対応)。
const HL_GL = {
    ja: ['ja', 'JP'], ko: ['ko', 'KR'], 'zh-TW': ['zh-TW', 'TW'], 'zh-CN': ['zh-CN', 'US'],
    en: ['en', 'US'], ru: ['ru', 'RU'], ar: ['ar', 'SA'], hi: ['hi', 'IN'], th: ['th', 'TH'],
    el: ['el', 'GR'], he: ['he', 'IL'], bn: ['bn', 'IN'], ta: ['ta', 'IN'], te: ['te', 'IN'],
    kn: ['kn', 'IN'], ml: ['ml', 'IN'], gu: ['gu', 'IN'], pa: ['pa', 'IN'], fa: ['fa', 'US'],
    ur: ['ur', 'PK'], lo: ['lo', 'LA'], my: ['my', 'MM'], km: ['km', 'KH'], ka: ['ka', 'GE'],
    hy: ['hy', 'AM'], am: ['am', 'ET'],
};
const HL_OF = { ja: 'ja', ko: 'ko', zh: 'zh-TW', ru: 'ru', el: 'el', he: 'he', ar: 'ar', hi: 'hi', th: 'th',
    en: 'en', bn: 'bn', ta: 'ta', te: 'te', kn: 'kn', ml: 'ml', gu: 'gu', pa: 'pa', fa: 'fa',
    ur: 'ur', lo: 'lo', my: 'my', km: 'km', ka: 'ka', hy: 'hy', am: 'am' };
const SCRIPTS = {
    kana: /[\u3040-\u30ff]/, hangul: /[\uac00-\ud7af]/, han: /[\u3400-\u9fff\uf900-\ufaff]/,
    cyrillic: /[\u0400-\u04ff]/, greek: /[\u0370-\u03ff]/, hebrew: /[\u0590-\u05ff]/,
    arabic: /[\u0600-\u06ff]/, devanagari: /[\u0900-\u097f]/, thai: /[\u0e00-\u0e7f]/, latin: /[a-z]/,
    bengali: /[\u0980-\u09ff]/, gurmukhi: /[\u0a00-\u0a7f]/, gujarati: /[\u0a80-\u0aff]/,
    tamil: /[\u0b80-\u0bff]/, telugu: /[\u0c00-\u0c7f]/, kannada: /[\u0c80-\u0cff]/,
    malayalam: /[\u0d00-\u0d7f]/, lao: /[\u0e80-\u0eff]/, khmer: /[\u1780-\u17ff]/,
    myanmar: /[\u1000-\u109f]/, georgian: /[\u10a0-\u10ff]/, armenian: /[\u0530-\u058f]/,
    ethiopic: /[\u1200-\u137f]/,
    // ペルシャ語・ウルドゥー語はアラビア文字の中の固有文字で分ける(拡張本体と同じ)。
    persian: /[\u067e\u0686\u0698\u06af]/, urdu: /[\u0679\u0688\u0691\u06ba\u06be\u06d2]/,
};
const HL_KEY = { kana: 'ja', hangul: 'ko', han: 'zh', cyrillic: 'ru', greek: 'el', hebrew: 'he',
    arabic: 'ar', devanagari: 'hi', thai: 'th', latin: 'en', bengali: 'bn', gurmukhi: 'pa',
    gujarati: 'gu', tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml', lao: 'lo',
    khmer: 'km', myanmar: 'my', georgian: 'ka', armenian: 'hy', ethiopic: 'am',
    persian: 'fa', urdu: 'ur' };
// どの言語でも照合対象になりえない版違い(ライブ・アコースティック等)・宗教朗読は最初から外す。
// 版違いの語彙は拡張本体のVERSIONSと重なるが、収集側は言語ごとの固有表記も含めて広めに弾く。
const BAD = [
    'live', 'ライブ', 'ライヴ', '라이브', '现场', '現場', 'remix', '리믹스', '混音', 'remaster',
    'instrumental', 'instrumentale', '伴奏', 'karaoke', 'カラオケ', '노래방', '覆盖', '翻唱',
    'cover version', 'سورة', 'قرآن', 'quran', 'demo', 'acoustic', 'акуст', 'unplugged',
    'radio edit', 'instrumental version', 'ミード', '版', 'カバー', 'カヴァー', '커버', 'קאבר',
    '\\bMR\\b',
].join('|');
const BAD_RE = new RegExp(BAD, 'i');
// ATVに無いことが確認済みの曲(ISRC)を外すための扉。通常は空でよい。
let SKIP_ISRC = new Set();
try {
    const local = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture', 'sources.local.json'), 'utf8'));
    SKIP_ISRC = new Set(local.skip_isrc || []);
} catch (e) { /* なければ空 */ }

function fold(text) { // ギリシャ等の合成文字・大文字を緩めて比較する。
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// 拡張と同じ文字種の取り方(検証用の簡易版)。
function letters(text) {
    return fold(text).replace(/[^a-z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f\u0e00-\u0e7f\u0e80-\u0eff\u1000-\u109f\u10a0-\u10ff\u1200-\u137f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, '');
}

function similarity(a, b) {
    let row = [0];
    for (let j = 1; j <= b.length; j++) row[j] = j;
    for (let i = 0; i < a.length; i++) {
        const next = [i + 1];
        for (let j = 0; j < b.length; j++) {
            next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a.charAt(i) === b.charAt(j) ? 0 : 1));
        }
        row = next;
    }
    return 1 - row[b.length] / Math.max(a.length, b.length, 1);
}

// ATV行のタイトルがストア側の曲名と同じと言えるか(包含か0.6以上の類似)。
function sameTitle(rowTitle, storeTitle) {
    const x = letters(rowTitle), y = letters(storeTitle);
    if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;
    return similarity(x, y) >= 0.6;
}

// ATV行のアーティスト列がストア側のアーティストと言えるか(拡張と同じ緩め方の簡易版)。
function sameArtist(rowArtist, storeArtist) {
    const c = letters(rowArtist), n = letters(storeArtist);
    if (!c || !n) return false;
    if (c === n) return true;
    const min = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(n) ? 2 : 4;
    if (Math.min(c.length, n.length) >= min && (c.includes(n) || n.includes(c))) return true;
    if (n.length >= 4 && !/^[a-z0-9]*$/.test(n)) { // 文字の多重集合が相手にすべて含まれる(語順の違い)
        let pool = c, ok = true;
        for (const ch of n) {
            const at = pool.indexOf(ch);
            if (at < 0) { ok = false; break; }
            pool = pool.slice(0, at) + pool.slice(at + 1);
        }
        if (ok) return true;
    }
    return !/^[a-z0-9]*$/.test(n) && similarity(c, n) >= 0.6;
}

function getJson(url) {
    return fetch(url, { headers: { 'user-agent': 'myspoti-extension-fixture/1.0 (https://github.com/y-exe/orpheon-youtube-music)' } })
        .then(r => r.json());
}

// YouTube Musicの曲検索。ATV(公式カタログ)行の videoId・タイトル・秒を集める。
async function atvRows(query, language) {
    const [hl, gl] = HL_GL[HL_OF[language] || 'en'];
    const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://music.youtube.com', 'user-agent': 'myspoti-extension-fixture/1.0' },
        body: JSON.stringify({
            context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251013.03.00', hl, gl } },
            query, params: 'EgWKAQIIAWoKEAkQChAFEAMQBA%3D%3D',
        }),
    });
    const data = await res.json();
    const out = [];
    (function visit(node) {
        if (!node || typeof node !== 'object') return;
        const row = node.musicResponsiveListItemRenderer;
        if (row) {
            const cols = row.flexColumns || [];
            const run = i => ((((cols[i] || {}).musicResponsiveListItemFlexColumnRenderer || {}).text || {}).runs || []);
            const first = run(0)[0] || {};
            const watch = (first.navigationEndpoint || {}).watchEndpoint || {};
            const cfg = ((watch.watchEndpointMusicSupportedConfigs || {}).watchEndpointMusicConfig || {}).musicVideoType;
            const id = (row.playlistItemData || {}).videoId || watch.videoId || '';
            let secs = 0; const names = [];
            run(1).forEach(x => {
                const type = ((((x.navigationEndpoint || {}).browseEndpoint || {}).browseEndpointContextSupportedConfigs || {}).browseEndpointContextMusicConfig || {}).pageType;
                if (type === 'MUSIC_PAGE_TYPE_ARTIST' && x.text) names.push(x.text);
                if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(x.text || '')) secs = x.text.split(':').reduce((n, s) => n * 60 + Number(s), 0);
            });
            const bare = run(1).filter(x => !x.navigationEndpoint && x.text && !/[•:]/.test(x.text)).map(x => x.text);
            if (cfg === 'MUSIC_VIDEO_TYPE_ATV' && id && secs > 0) out.push({ id, title: run(0).map(x => x.text || '').join(''), secs, a: names.join('|') || bare.join('|') });
        }
        Object.keys(node).forEach(k => visit(node[k]));
    })(data);
    return out;
}

async function usable(row, spec, requireArtist, probe, language) {
    const title = row.title || row.title_short || '';
    const who = (row.artist || {}).name || '';
    const rank = row.rank || 0;
    if (!spec.script.test(title)) return null; // 現地語表記でない
    if (spec.artist_script !== false && !spec.script.test(who)) return null;
    if (BAD_RE.test(title) || BAD_RE.test(who)) return null;
    if (!row.duration || row.duration < 60 || row.duration > MAX_SECONDS || rank < RANK_MIN || rank > RANK_MAX) return null;
    if (requireArtist && !fold(who).includes(fold(probe)) && !fold(probe).includes(fold(who))) return null;
    try {
        const detail = await getJson('https://api.deezer.com/track/' + row.id);
        if (!detail.isrc || SKIP_ISRC.has(detail.isrc)) return null;
        if (!detail.duration || detail.duration > MAX_SECONDS) return null;
        if (BAD_RE.test(detail.title || '')) return null;
        // YouTube Musicの公式(ATV)カタログに、ストアの尺(±3秒)・曲名・アーティストの
        // すべてが合う行が無い曲は「どのみち照合できない」ため、フィクスチャから除外する。
        // 版違いの語(cover等)がタイトルに入った行は公式行でも対象にしない。
        const rows = await atvRows(title + ' ' + who, language);
        const atv = rows.find(x => Math.abs(x.secs * 1000 - detail.duration * 1000) <= 3000 &&
            !BAD_RE.test(x.title) && sameTitle(x.title, title) && sameArtist(x.a, who));
        if (!atv) { console.log('  - skip (no ATV listing near ' + detail.duration + 's): ' + title + ' / ' + who); return null; }
        return { title, artist: who, durationMs: detail.duration * 1000, isrc: detail.isrc, rank, atv: atv.id + ' ' + atv.secs + 's' };
    } catch (e) { return null; }
}

async function pick(language, spec) {
    const out = [];
    const want = async (rows, requireArtist, probe) => {
        for (const row of ((rows || {}).data || [])) {
            if (out.length >= PER_LANG) return;
            const got = await usable(row, spec, requireArtist, probe, language);
            if (!got || out.some(x => x.title === got.title)) continue;
            out.push(got);
            console.log('  + ' + language + '  ' + got.title + ' / ' + got.artist + '  ' + got.durationMs / 1000 + 's  rank ' + got.rank + '  ' + got.isrc + '  atv ' + got.atv);
        }
    };
    for (const artist of (spec.artists || [])) {
        if (out.length >= PER_LANG) break;
        await want(await getJson('https://api.deezer.com/search?q=' + encodeURIComponent(artist) + '&limit=40'), true, artist).catch(() => {});
    }
    for (const keyword of (spec.keywords || [])) {
        if (out.length >= PER_LANG) break;
        await want(await getJson('https://api.deezer.com/search?q=' + encodeURIComponent(keyword) + '&limit=60'), false, keyword).catch(() => {});
    }
    return out;
}

(async () => {
    const sourcesFile = path.join(__dirname, 'fixture', 'sources.local.json');
    let sources;
    try {
        sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
    } catch (e) {
        console.error('fixture/sources.local.json がありません。形式は冒頭のコメントを参照。');
        process.exit(1);
    }
    const all = [];
    for (const [name, spec] of Object.entries(sources)) {
        if (name === 'skip_isrc') continue;
        const script = SCRIPTS[spec.script];
        if (!script) { console.error('!! unknown script: ' + name + ' (' + spec.script + ')'); continue; }
        const language = HL_KEY[spec.script] || name;
        const picked = await pick(language, { script, artists: spec.artists, keywords: spec.keywords });
        picked.forEach(t => all.push({ label: language + ':' + t.title.slice(0, 24) + ' / ' + t.artist.slice(0, 20), title: t.title, artist: t.artist, durationMs: t.durationMs, isrc: t.isrc }));
        if (!picked.length) console.error('!! no fixture for ' + name);
        await new Promise(r => setTimeout(r, 400)); // 丁寧な間隔
    }
    const file = path.join(__dirname, 'fixture', 'tracks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, '\t') + '\n');
    console.log('wrote ' + file + ' (' + all.length + ' tracks)');
})();
