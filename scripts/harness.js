#!/usr/bin/env node
/* PCハーネス。Nodeでmyspoti(http・log・sleep・locale)を再現し、main.jsをそのまま読み込んで
 * 照合(download-source)を検証する。実機の音源取得(Range検証)以外を同じコードで回すため、
 * 言語別の照合結果の回帰テストに使う。
 *
 *     node scripts/harness.js [tracks.json] [--full] [--locale=pt-BR] [--no-i18n]
 *
 * --full: debug://matchで打ち切らず、player呼び出しとRange検証まで通す(実ネット要)。
 * --locale: myspoti.localeの値(ログやエラー文言の検証用。既定はen_US)。
 * --no-i18n: i18n.jsonを差し込まず英語のみで走らせる。
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const i18n = require('./i18n');

const FULL = process.argv.includes('--full');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : '';
const localeArg = process.argv.find(a => a.startsWith('--locale='));
const LOCALE = localeArg ? localeArg.slice('--locale='.length) : 'en_US';
const fixture = process.argv.slice(2).filter(a => a !== '--full' && !a.startsWith('--only=') && !a.startsWith('--locale=') && a !== '--no-i18n')[0] || path.join(__dirname, 'fixture', 'tracks.json');

// --- myspotiスタブ -----------------------------------------------------------
// httpは実ネット(同期ブリッジ)。本体と同じくオブジェクトを渡し、ok/status/headers/jsonを持つ。
function httpCall(options) {
    const res = cp.spawnSync(process.execPath, [path.join(__dirname, 'http_agent.js')], {
        input: JSON.stringify(options),
        encoding: 'utf8',
        timeout: (options.timeout || 30000) + 5000,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error && /ETIMEDOUT|timed out/.test(String(res.error))) throw new Error('timeout after ' + (options.timeout || 30000) + ' ms');
    const agent = JSON.parse(res.stdout || '{"error":"agent produced no output"}');
    if (agent.error) throw new Error(agent.error);
    const text = Buffer.from(agent.body, 'base64').toString('utf8');
    return {
        ok: agent.status >= 200 && agent.status < 300,
        status: agent.status,
        headers: agent.headers,
        json() { return JSON.parse(text); },
    };
}

let requests = 0;
globalThis.myspoti = {
    locale: LOCALE,
    // 実機と同じくresults機能あり(レート制限時はthrowではなくoutcomeで答える)。
    features: ['results'],
    // 'match': fileForで照合検証として打ち切る。'full': 取得まで通す。note()はどちらでも出る。
    debug: FULL ? 'full' : 'match',
    log: message => console.log('  [ext] ' + message),
    util: {
        sleep(ms) { // Rhinoのutil.sleep相当。NodeではAtomicsで同期待ち。
            const sab = new Int32Array(new SharedArrayBuffer(4));
            Atomics.wait(sab, 0, 0, Math.max(0, Math.min(ms, 60000)));
        },
    },
    http: {
        post(url, body, opts) {
            requests++;
            return httpCall({ method: 'POST', url, body: JSON.stringify(body), headers: Object.assign({ 'content-type': 'application/json' }, (opts && opts.headers) || {}), timeout: (opts && opts.timeout) || 30000 });
        },
        request(options) {
            requests++;
            return httpCall({ method: options.method || 'GET', url: options.url, headers: options.headers || {}, timeout: options.timeout || 30000 });
        },
        get(url, opts) {
            requests++;
            return httpCall({ method: 'GET', url, headers: (opts && opts.headers) || {}, timeout: (opts && opts.timeout) || 30000 });
        },
    },
    provide(name, fn) { handlers[name] = fn; },
};

const handlers = {};
// pack.jsと同じ方法でi18n.jsonをmain.jsへ差し込み、そのテキストを読み込む(myspotiはグローバルで見える)。
const root = path.join(__dirname, '..');
let source;
if (process.argv.includes('--no-i18n')) {
    // マーカーのまま(MESSAGES_I18N=null)でも動く: すべての文言が英語に落ちる。
    source = fs.readFileSync(path.join(root, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
} else {
    if (!i18n.exists(root)) { console.error('i18n.json is missing'); process.exit(1); }
    source = i18n.mainSource(root, i18n.load(root));
}
const loaded = path.join(os.tmpdir(), 'myspoti-ext-harness-main.js');
fs.writeFileSync(loaded, source);
require(loaded);
fs.rmSync(loaded, { force: true });

// --- 実行 --------------------------------------------------------------------
const tracks = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const hook = handlers['download-source'];
if (!hook) { console.error('download-source is not registered'); process.exit(1); }

const results = [];
for (const t of tracks) {
    if (only && !(t.label + ' ' + t.title + ' ' + t.artist).toUpperCase().includes(only.toUpperCase())) continue;
    let answer;
    try {
        answer = hook(t);
    } catch (e) {
        answer = { threw: String(e && e.message || e) };
    }
    const matched = Array.isArray(answer) && answer.length && /debug:\/\/match\//.test(answer[0].url || '');
    const fetched = Array.isArray(answer) && answer.length && answer[0].url && answer[0].url.startsWith('https://');
    results.push({ track: t, matched: matched || fetched });
    console.log((matched ? 'MATCH ' : fetched ? 'FETCH ' : 'FAIL  ') + t.label +
        (answer.threw ? '  threw: ' + answer.threw : ''));
    if (Array.isArray(answer) && answer.length && matched) console.log('        -> ' + answer[0].url.replace('debug://match/', ''));
}

const pass = results.filter(r => r.matched).length;
console.log('\n' + pass + '/' + results.length + ' matched (' + requests + ' requests)');
process.exitCode = pass === results.length ? 0 : 1;
