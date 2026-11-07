#!/usr/bin/env node
/* フィクスチャ収集。各言語のアーティスト(現地語表記)をDeezer公開APIで検索し、
 * 中程度の有名度(rank)の曲を複数曲、ISRCと実尺つきでfixture/tracks.jsonに書く。
 * 書き言葉が要求と合わない結果(ローマ字転写など)と、版違い(live/cover/remix等)は読み飛ばす。
 *
 *     node scripts/collect.js
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 対応言語ごとに候補アーティスト(現地語)。順に試し、条件に合う曲が集まったら次の言語へ。
// アーティストで集まらない場合はキーワード検索で埋める(現地語の共通語)。
const LANG = {
    ja: { script: /[\u3040-\u30ff]/, artists: ['Aimer', 'ヨルシカ', 'サカナクション', 'ずっと真夜中でいいのに。', 'ミツメ'], keywords: ['夜', '光'] },
    ko: { script: /[\uac00-\ud7af]/, artists: ['백예린', '혁오', '검정치마', '이무진', '임영웅'], keywords: ['사랑', '바람'] },
    zh: { script: /[\u3400-\u9fff]/, artists: ['陳綺貞', '告五人', '田馥甄', '五月天', '周杰倫'], keywords: ['花', '夜'] },
    ru: { script: /[\u0400-\u04ff]/, artists: ['Би-2', 'Сплин', 'Земфира', 'Пилот', 'Дельфин'], keywords: ['осень', 'небо'] },
    el: { script: /[\u0370-\u03ff]/, artists: ['Νατάσα Θεοδωρίδου', 'Πέγκυ Ζήνα', 'Δέσποινα Βανδή', 'Σάκης Ρουβάς'], keywords: ['ζημιά', 'θάλασσα'] },
    he: { script: /[\u0590-\u05ff]/, artists: ['עברי לידר', 'שלמה ארצי', 'ריטה', 'אריאל זילבר'], keywords: ['אהבה', 'לב'] },
    ar: { script: /[\u0600-\u06ff]/, artists: ['كاظم الساهر', 'وائل كفوري', 'إليسا', 'عبادي الجوهر'], keywords: ['حبيبي', 'قلبي'] },
    hi: { script: /[\u0900-\u097f]/, artists: [], keywords: ['प्यार', 'दिल', 'इश्क', 'तेरा', 'सपना', 'बारिश'] },
    th: { script: /[\u0e00-\u0e7f]/, artists: ['เบิร์ด ธงไชย', 'ปาล์มมี่', 'นนท์ ธนนท์', 'สิงโต นำโชค'], keywords: ['รัก', 'ใจ'] },
    en: { script: /[a-z]/, artists: ['Real Estate', 'Beach House', 'The Shins', 'Khruangbin'], keywords: ['summer', 'night'] },
};
// 有名度の狙い: Deezerのrank(0-100万)。最大ヒット(70万超)を避けて中段を取る。
const RANK_MIN = 60000, RANK_MAX = 450000, PER_LANG = 4, MAX_SECONDS = 900;
// どの言語でも照合対象になりえない版違い(ライブ・アコースティック等)・宗教朗読は最初から外す。
const BAD = [
    'live', 'ライブ', 'ライヴ', '라이브', '现场', '現場', 'remix', '리믹스', '混音', 'remaster',
    'instrumental', 'instrumentale', '伴奏', 'karaoke', 'カラオケ', '노래방', '覆盖', '翻唱',
    'cover version', 'سورة', 'قرآن', 'quran', 'demo', 'acoustic', 'акуст', 'אקוסט',
    'unplugged', 'radio edit', 'בהופעה', 'חי באולפן', 'הופעה חיה',
].join('|');
const BAD_RE = new RegExp(BAD, 'i');
// Deezerには在るがYouTube Musicの公式(ATV)カタログに無いことが確認済みの曲(ISRC)。
const SKIP_ISRC = new Set(['IL5841617266']);
// ATV事前検証用の検索言語/地域(拡張本体のLANG/REGIONと同じ対応)。
const HL_GL = {
    ja: ['ja', 'JP'], ko: ['ko', 'KR'], 'zh-TW': ['zh-TW', 'TW'], 'zh-CN': ['zh-CN', 'US'],
    en: ['en', 'US'], ru: ['ru', 'RU'], ar: ['ar', 'SA'], hi: ['hi', 'IN'], th: ['th', 'TH'],
    el: ['el', 'GR'], he: ['he', 'IL'],
};
const HL_OF = { ja: 'ja', ko: 'ko', zh: 'zh-TW', ru: 'ru', el: 'el', he: 'he', ar: 'ar', hi: 'hi', th: 'th', en: 'en' };

function fold(text) { // ギリシャ等の合成文字・大文字を緩めて比較する。
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// 拡張と同じ文字種の取り方(検証用の簡易版)。
function letters(text) {
    return fold(text).replace(/[^a-z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, '');
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

// ATV行のタイトルがDeezer側の曲名と同じと言えるか(包含か0.6以上の類似)。
function sameTitle(rowTitle, storeTitle) {
    const x = letters(rowTitle), y = letters(storeTitle);
    if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;
    return similarity(x, y) >= 0.6;
}

function getJson(url) {
    return fetch(url, { headers: { 'user-agent': 'myspoti-extension-fixture/1.0 (https://github.com/y-exe/myspoti-youtube-music)' } })
        .then(r => r.json());
}

function isBlank(text) { return text == null || text === ''; }

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
            let secs = 0;
            run(1).forEach(x => { if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(x.text || '')) secs = x.text.split(':').reduce((n, s) => n * 60 + Number(s), 0); });
            if (cfg === 'MUSIC_VIDEO_TYPE_ATV' && id && secs > 0) out.push({ id, title: run(0).map(x => x.text || '').join(''), secs });
        }
        Object.keys(node).forEach(k => visit(node[k]));
    })(data);
    return out;
}

async function usable(row, spec, requireArtist, probe, language) {
    const title = row.title || row.title_short || '';
    const who = (row.artist || {}).name || '';
    const rank = row.rank || 0;
    if (!spec.script.test(title) || !spec.script.test(who)) return null; // 現地語表記でない
    if (BAD_RE.test(title) || BAD_RE.test(who)) return null;
    if (!row.duration || row.duration < 60 || row.duration > MAX_SECONDS || rank < RANK_MIN || rank > RANK_MAX) return null;
    if (requireArtist && !fold(who).includes(fold(probe)) && !fold(probe).includes(fold(who))) return null;
    try {
        const detail = await getJson('https://api.deezer.com/track/' + row.id);
        if (isBlank(detail.isrc) || SKIP_ISRC.has(detail.isrc)) return null;
        if (!detail.duration || detail.duration > MAX_SECONDS) return null;
        if (BAD_RE.test(detail.title || '')) return null;
        // YouTube Musicの公式(ATV)カタログに、Deezerの尺(±3秒)と曲名の両方が合う行が
        // 無い曲は「どのみち照合できない」ため、フィクスチャから除外する。
        const rows = await atvRows(title + ' ' + who, language);
        const atv = rows.find(x => Math.abs(x.secs * 1000 - detail.duration * 1000) <= 3000 && sameTitle(x.title, title));
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
    const all = [];
    for (const [language, spec] of Object.entries(LANG)) {
        const picked = await pick(language, spec);
        picked.forEach(t => all.push({ label: language + ':' + t.title.slice(0, 24) + ' / ' + t.artist.slice(0, 20), title: t.title, artist: t.artist, durationMs: t.durationMs, isrc: t.isrc }));
        if (!picked.length) console.error('!! no fixture for ' + language);
        await new Promise(r => setTimeout(r, 400)); // 丁寧な間隔
    }
    const file = path.join(__dirname, 'fixture', 'tracks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, '\t') + '\n');
    console.log('wrote ' + file + ' (' + all.length + ' tracks)');
})();
