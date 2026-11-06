#!/usr/bin/env node
/* extension.zipを作る。manifest.jsonと「main」のスクリプトを先に、アイコン・LICENSE・README.mdを
 * ルートに固定順・固定日時でまとめる。他のファイルがあるとMyspotiは拒否する。
 * 同じ入力からは常に同一バイトになり、sha256で比較できる。
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 *
 *     node scripts/pack.js [output.zip]
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');

const KEPT = ['icon.png', 'LICENSE', 'README.md'];
const ROOT = path.dirname(__dirname);
const DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00。ZIPが扱える最古の日時。
const ATTRS = 0o100644 * 0x10000; // 通常ファイル(mode 644)。16bitシフトは符号付き32bitを溢れるため掛け算。

function crc32(buf) {
    let table = crc32.t;
    if (!table) {
        table = crc32.t = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = crc >>> 8 ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
}

// 最小のZIPライタ(deflate)。Zip64不要: パッケージは数十KB程度。
const u = (value, bytes) => { const b = Buffer.alloc(bytes); b.writeUIntLE(value, 0, bytes); return b; };

function pack(names, read) {
    const files = [], locals = [];
    let at = 0;
    for (const name of names) {
        const data = read(name), body = zlib.deflateRawSync(data, { level: 9 });
        const nameBuf = Buffer.from(name, 'utf8');
        const local = Buffer.concat([
            u(0x04034b50, 4), u(20, 2), u(0, 2), u(8, 2), u(0, 2), u(DOS_DATE, 2),
            u(crc32(data), 4), u(body.length, 4), u(data.length, 4), u(nameBuf.length, 2), u(0, 2), nameBuf, body,
        ]);
        files.push({ name: nameBuf, body, crc: crc32(data), raw: data.length, at });
        locals.push(local);
        at += local.length;
    }
    const central = files.map(f => Buffer.concat([
        u(0x02014b50, 4), u(20, 2), u(20, 2), u(0, 2), u(8, 2), u(0, 2), u(DOS_DATE, 2),
        u(f.crc, 4), u(f.body.length, 4), u(f.raw, 4), u(f.name.length, 2), u(0, 2), u(0, 2),
        u(0, 2), u(0, 2), u(ATTRS, 4), u(f.at, 4), f.name,
    ]));
    const centralAt = at, centralLen = central.reduce((n, b) => n + b.length, 0);
    const eocd = Buffer.concat([
        u(0x06054b50, 4), u(0, 2), u(0, 2), u(files.length, 2), u(files.length, 2),
        u(centralLen, 4), u(centralAt, 4), u(0, 2),
    ]);
    return Buffer.concat([...locals, ...central, eocd]);
}

function main() {
    const outPath = process.argv[2] || path.join(ROOT, 'extension.zip');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const names = ['manifest.json', manifest.main || 'main.js'];
    if (manifest.icon) names.push(manifest.icon);
    names.push(...KEPT.filter(n => fs.existsSync(path.join(ROOT, n))));
    const seen = new Set();
    const read = name => {
        if (!fs.existsSync(path.join(ROOT, name))) { console.error(name + ' is missing'); process.exit(1); }
        const data = fs.readFileSync(path.join(ROOT, name));
        // テキストはLFに正規化し、WindowsとCIで同一バイトにする。
        return name.endsWith('.png') ? data : Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    };
    const zip = pack(names.filter(n => !seen.has(n) && seen.add(n)), read);
    fs.writeFileSync(outPath, zip);
    console.log(outPath + '  ' + seen.size + ' files  sha256 ' + crypto.createHash('sha256').update(zip).digest('hex'));
}

main();
