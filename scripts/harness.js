#!/usr/bin/env node
/* PCハーネス。Nodeでmyspoti(http・log・sleep・locale)を再現し、main.jsをそのまま読み込んで
 * 照合(download-source)を検証する。実機の音源取得(Range検証)以外を同じコードで回すため、
 * 言語別の照合結果の回帰テストに使う。
 *
 *     node scripts/harness.js [tracks.json] [--full]
 *
 * --full: debug://matchで打ち切らず、player呼び出しとRange検証まで通す(実ネット要)。
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const FULL = process.argv.includes('--full');
const fixture = process.argv.slice(2).filter(a => a !== '--full')[0] || path.join(__dirname, 'fixture', 'tracks.json');

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
    locale: 'en_US',
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
// '#!/usr/bin/env'-shebangのないmain.jsをそのままrequire(myspotiはグローバルで見える)。
require(path.join(__dirname, '..', 'main.js'));

// --- 実行 --------------------------------------------------------------------
const tracks = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const source = handlers['download-source'];
if (!source) { console.error('download-source is not registered'); process.exit(1); }

const results = [];
for (const t of tracks) {
    let answer;
    try {
        answer = source(t);
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
