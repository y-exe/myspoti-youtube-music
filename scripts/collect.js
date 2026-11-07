#!/usr/bin/env node
/* フィクスチャ収集。各言語のアーティスト(現地語表記)をDeezer公開APIで検索し、
 * 中程度の有名度(rank)の曲を最低1曲づつ、ISRCと実尺つきでfixture/tracks.jsonに書く。
 * 書き言葉が要求と合わない結果(ローマ字転写など)は読み飛ばす。
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
    hi: { script: /[\u0900-\u097f]/, artists: ['अरिजीत सिंह', 'श्रेया घोषाल', 'सोनू निगम', 'शान'], keywords: ['प्यार', 'दिल'] },
    th: { script: /[\u0e00-\u0e7f]/, artists: ['เบิร์ด ธงไชย', 'ปาล์มมี่', 'นนท์ ธนนท์', 'สิงโต นำโชค'], keywords: ['รัก', 'ใจ'] },
    en: { script: /[a-z]/, artists: ['Real Estate', 'Beach House', 'The Shins', 'Khruangbin'], keywords: ['summer', 'night'] },
};
// 有名度の狙い: Deezerのrank(0-100万)。最大ヒット(70万超)を避けて中段を取る。
const RANK_MIN = 60000, RANK_MAX = 450000, PER_LANG = 2, MAX_SECONDS = 900;
// どの言語でも照合対象になりえない版違い・読み宗教文は最初から外す。
const BAD = /live|ライブ|ライヴ|라이브|现场|現場|remix|리믹스|混音|remaster|instrumental|instrumentale|伴奏|karaoke|カラオケ|노래방|覆盖|翻唱|cover version|سورة|قرآن|quran|demo/i;

function fold(text) { // ギリシャ等の合成文字・大文字を緩めて比較する。
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function getJson(url) {
    return fetch(url, { headers: { 'user-agent': 'myspoti-extension-fixture/1.0 (https://github.com/y-exe/myspoti-youtube-music)' } })
        .then(r => r.json());
}

function isBlank(text) { return text == null || text === ''; }

async function usable(row, spec, requireArtist, probe) {
    const title = row.title || row.title_short || '';
    const who = (row.artist || {}).name || '';
    const rank = row.rank || 0;
    if (!spec.script.test(title) || !spec.script.test(who)) return null; // 現地語表記でない
    if (BAD.test(title) || BAD.test(who)) return null;
    if (!row.duration || row.duration < 60 || row.duration > MAX_SECONDS || rank < RANK_MIN || rank > RANK_MAX) return null;
    if (requireArtist && !fold(who).includes(fold(probe)) && !fold(probe).includes(fold(who))) return null;
    try {
        const detail = await getJson('https://api.deezer.com/track/' + row.id);
        if (isBlank(detail.isrc) || !detail.duration || detail.duration > MAX_SECONDS) return null;
        if (BAD.test(detail.title || '')) return null;
        return { label: row.title_short ? undefined : undefined, track: { title, artist: who, durationMs: detail.duration * 1000, isrc: detail.isrc, rank } };
    } catch (e) { return null; }
}

async function pick(language, spec) {
    const out = [];
    const want = async (rows, requireArtist, probe) => {
        for (const row of ((rows || {}).data || [])) {
            if (out.length >= PER_LANG) return;
            const got = await usable(row, spec, requireArtist, probe);
            if (!got || out.some(x => x.title === got.track.title)) continue;
            out.push(got.track);
            console.log('  + ' + language + '  ' + got.track.title + ' / ' + got.track.artist + '  ' + got.track.durationMs / 1000 + 's  rank ' + got.track.rank + '  ' + got.track.isrc);
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
