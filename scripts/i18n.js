#!/usr/bin/env node
'use strict';
/* i18n.jsonの読み込みと、main.js・manifest.jsonへの統合。
 * pack.js(パッケージ化)・harness.js(PC検証)・check-i18n.js(CI検査)の3か所で同じ
 * 統合を使うため、ここにまとめる。Orpheonはパッケージに余分なファイルを許さないため、
 * i18n.jsonはリポジトリに置き、パッケージ化のときにmain.jsとmanifest.jsonへ差し込む。
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
const fs = require('fs');
const path = require('path');

// 言語タグの表記は本体の規約に合わせて正規化する(残りはそのまま)。
const CANONICAL = { 'zh-hk': 'zh-HK', 'zh-tw': 'zh-TW', 'pt-br': 'pt-BR' };
// main.jsの差し込み位置。pack/harnessはこの行を訳のオブジェクトで置き換える。
const MARKER = 'var MESSAGES_I18N = null;';

function file(root) { return path.join(root, 'i18n.json'); }
function exists(root) { return fs.existsSync(file(root)); }

/** i18n.jsonを{ messages, manifest }で返す。 */
function load(root) { return JSON.parse(fs.readFileSync(file(root), 'utf8')); }

/** LF正規化済みのmain.js本文に、i18n.jsonのmessagesを差し込んで返す。 */
function mainSource(root, data) {
    const text = fs.readFileSync(path.join(root, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
    const injected = text.replace(MARKER, MARKER.replace('null', JSON.stringify(data.messages)));
    if (injected === text) throw new Error('MESSAGES_I18N marker not found in main.js');
    return injected;
}

/** translations(各言語の説明・changelog・アクション理由)を統合したmanifestを返す。 */
function manifest(root, data) {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    m.translations = {};
    for (const [lang, entry] of Object.entries(data.manifest)) {
        const t = { description: entry.description, actions: entry.actions };
        if (entry.changelog) t.changelog = entry.changelog;
        m.translations[CANONICAL[lang] || lang] = t;
    }
    return m;
}

module.exports = { CANONICAL, MARKER, file, exists, load, mainSource, manifest };
