#!/usr/bin/env node
/* i18n.jsonとmain.js・manifest.jsonの整合を検査するCI用チェック。
 *
 *     node scripts/check-i18n.js
 *
 * 確認すること:
 *  - MESSAGES(main.js)の全idがi18n.jsonにあり、その逆もない(未知id・訳漏れの検出)
 *  - 全idに英語(基準文)がある
 *  - 本体(Orpheon)が持つ全言語について、T()が英語に落ちない(差し込み後の実行で確認)
 *  - 統合後のmanifestのtranslationsが本体の規則内(80言語以下・文字数制限・アクション名)
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('./i18n');

const ROOT = path.join(__dirname, '..');
const problems = [];

// 本体(Orpheon)が持つ言語。enはmain.js・manifest.jsonの基準文。
const LANGS = ['ja', 'ko', 'zh', 'zh-HK', 'zh-TW', 'es', 'pt', 'pt-BR', 'fr', 'de', 'it', 'nl',
    'ca', 'gl', 'eu', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'sr', 'bg', 'mk', 'lt', 'lv', 'et',
    'hu', 'ro', 'da', 'nb', 'sv', 'is', 'fi', 'ru', 'uk', 'tr', 'el', 'he', 'ar', 'fa', 'ur',
    'hi', 'bn', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'ne', 'or', 'th', 'vi', 'id', 'ms',
    'tl', 'sw', 'af', 'az', 'am', 'zu'];
// 地域差のない言語で当て方(完全一致→基言語)を代表確認する。
const LOCALES = LANGS.concat(['pt-PT', 'es-MX', 'fr-CA', 'en-GB', 'de-DE', 'iw_IL', 'in_ID', 'fil-PH', 'nn-NO']);

if (!i18n.exists(ROOT)) { console.error('i18n.json is missing'); process.exit(1); }
const data = i18n.load(ROOT);

// main.jsを読み込み(差し込み後)、MESSAGESとTを取り出す。
globalThis.myspoti = { locale: 'en', log() {}, provide() {}, http: {}, util: {} };
const loaded = path.join(os.tmpdir(), 'myspoti-ext-check-i18n.js');
fs.writeFileSync(loaded, i18n.mainSource(ROOT, data));
const ext = require(loaded);
fs.rmSync(loaded, { force: true });
if (!ext || !ext.MESSAGES || typeof ext.T !== 'function') { console.error('main.js did not export the message catalog'); process.exit(1); }

const ids = Object.keys(ext.MESSAGES), i18nIds = Object.keys(data.messages);
for (const id of ids) {
    if (!i18nIds.includes(id)) problems.push('main.js message "' + id + '" has no entry in i18n.json');
    if (!ext.MESSAGES[id].en) problems.push('message "' + id + '" has no English text in main.js');
}
for (const id of i18nIds) {
    if (!ids.includes(id)) problems.push('i18n.json has message "' + id + '" that main.js does not define');
    for (const lang of Object.keys(data.messages[id])) {
        if (!LANGS.some(l => l.toLowerCase() === lang)) problems.push('i18n.json message "' + id + '": unknown language "' + lang + '"');
    }
}
for (const lang of LANGS) {
    for (const id of ids) {
        const key = Object.keys(data.messages[id] || {}).find(l => l.toLowerCase() === lang.toLowerCase());
        if (!key || !data.messages[id][key]) problems.push('message "' + id + '": missing translation for ' + lang);
    }
}

// 実行して確かめる: 各言語でT()が英語の基準文をそのまま返していないこと(訳が当たっている証拠)。
for (const locale of LOCALES) {
    globalThis.myspoti.locale = locale;
    for (const id of ids) {
        const text = ext.T(id);
        if (!text || text === id) problems.push('locale ' + locale + ': message "' + id + '" resolves to nothing');
    }
}
// 代表言語では、訳が英語と同じでないことも確かめる(未訳のまま残っていないか)。
for (const locale of LANGS) {
    globalThis.myspoti.locale = locale;
    for (const id of ids) {
        if (ext.T(id) === ext.MESSAGES[id].en) problems.push('locale ' + locale + ': message "' + id + '" still reads as the English text');
    }
}

// 統合後のmanifest(pack.jsが作るもの)を本体の規則で検査する。
const manifest = i18n.manifest(ROOT, data);
const t = manifest.translations || {};
if (Object.keys(t).length > 80) problems.push('manifest translations: ' + Object.keys(t).length + ' languages (80 max)');
const actionNames = manifest.actions.map(a => a.name);
for (const [lang, entry] of Object.entries(t)) {
    if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,2}$/.test(lang)) problems.push('translations "' + lang + '": bad language tag');
    if (entry.description && entry.description.length > 500) problems.push('translations "' + lang + '": description ' + entry.description.length + ' chars (500 max)');
    if (entry.changelog && entry.changelog.length > 2000) problems.push('translations "' + lang + '": changelog ' + entry.changelog.length + ' chars (2000 max)');
    for (const [name, why] of Object.entries(entry.actions || {})) {
        if (!actionNames.includes(name)) problems.push('translations "' + lang + '": action "' + name + '" is not in the manifest');
        if (why.length < 15 || why.length > 80) problems.push('translations "' + lang + '": why for "' + name + '" is ' + why.length + ' chars (15..80)');
    }
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log('i18n OK: ' + ids.length + ' messages x ' + LANGS.length + ' languages, manifest translations ' + Object.keys(t).length + ' languages');
