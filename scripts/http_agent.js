#!/usr/bin/env node
/* harness.js専用の子エージェント。1リクエストを1プロセスで同期実行する。
 * stdinに {method,url,headers,body,timeout} のJSON、stdoutに {status,headers,body(base64)}
 * または {error} のJSONを出す。gzip等の圧縮は要求しないので取り扱いは素のままでよい。
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const mod = require('https');
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
    const o = JSON.parse(input);
    const finish = payload => { process.stdout.write(JSON.stringify(payload)); process.exit(0); };
    const fail = message => finish({ error: message });
    let req;
    try {
        req = mod.request(new URL(o.url), { method: o.method || 'GET', headers: o.headers || {} }, r => {
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => {
                const headers = {};
                for (const [k, v] of Object.entries(r.headers)) headers[k.toLowerCase()] = typeof v === 'string' ? v : v.join(', ');
                finish({ status: r.statusCode, headers, body: Buffer.concat(chunks).toString('base64') });
            });
        });
        req.setTimeout(o.timeout || 30000, () => { req.destroy(); fail('timeout after ' + (o.timeout || 30000) + ' ms'); });
    } catch (e) { fail(String((e && e.message) || e)); return; }
    req.on('error', e => fail(String((e && e.message) || e)));
    if (o.body) req.write(o.body, 'utf8');
    req.end();
});
