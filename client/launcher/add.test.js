// iimos add:用一个本地假 CDN 模拟 esm.sh(入口是转一手的小模块,真代码在别的 URL,里面还有相对引用)。
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import * as seed from './seed.js';
import { addPackage, parseSpec, vendorFile } from './add.js';
import { buildUI } from './build.js';

const APP = path.resolve(import.meta.dirname, '..', 'app');

const FILES = {
    '/tiny-fmt@1': '/* esm.sh - tiny-fmt@1.2.3 */\nexport * from "/tiny-fmt@1.2.3/es2022/tiny-fmt.mjs";\nexport { default } from "/tiny-fmt@1.2.3/es2022/tiny-fmt.mjs";\n',
    '/tiny-fmt@1.2.3/es2022/tiny-fmt.mjs': 'import { pad } from "./pad.mjs";\nimport { useState } from "react";\nexport const hooked = typeof useState;\nexport default function fmt(n) { return "TINY-FMT:" + pad(n); }\n',
    '/tiny-fmt@1.2.3/es2022/pad.mjs': 'export const pad = (n) => String(n).padStart(3, "0");\n',
};

let cdn;
const server = http.createServer((req, res) => {
    const body = FILES[new URL(req.url, 'http://x').pathname];
    if (!body) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
cdn = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function planted() {
    const workspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-add-')), 'workspace');
    await seed.plant({ seedDir: APP, workspace, version: '0.0.0' });
    return workspace;
}

test('包名解析', () => {
    assert.deepEqual(parseSpec('dayjs'), { pkg: 'dayjs', version: '', sub: '', name: 'dayjs' });
    assert.deepEqual(parseSpec('dayjs@1.11'), { pkg: 'dayjs', version: '1.11', sub: '', name: 'dayjs' });
    assert.deepEqual(parseSpec('@scope/pkg@2/sub/x'), { pkg: '@scope/pkg', version: '2', sub: '/sub/x', name: '@scope/pkg/sub/x' });
    assert.equal(vendorFile('@scope/pkg/sub'), 'scope__pkg__sub.js');
    assert.throws(() => parseSpec('有 空格'));
});

test('装一个包:整棵引用树打成一个文件,React 留在外面;界面里照常 import', async () => {
    const workspace = await planted();
    const result = await addPackage({ workspace, spec: 'tiny-fmt@1', cdn });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.version, '1.2.3', '从入口注释里读到确切版本');
    const bundled = fs.readFileSync(path.join(workspace, 'ui/vendor/tiny-fmt.js'), 'utf8');
    assert.match(bundled, /TINY-FMT:/);
    assert.match(bundled, /padStart/, '相对引用的 pad.mjs 也打进来了');
    assert.match(bundled, /from"react"/, 'React 没打进去,留成外部');
    const vendor = JSON.parse(fs.readFileSync(path.join(workspace, 'ui/vendor/vendor.json'), 'utf8'));
    assert.equal(vendor['tiny-fmt'].version, '1.2.3');

    // 界面里 import 它,编译时按 vendor.json 自动走别名,React 用 launcher 带的那一份
    fs.writeFileSync(path.join(workspace, 'ui/src/fmt-demo.ts'), "import fmt, { hooked } from 'tiny-fmt';\nexport const demo = fmt(7) + hooked;\n");
    const main = path.join(workspace, 'ui/src/main.tsx');
    fs.appendFileSync(main, "import { demo } from './fmt-demo';\nconsole.log(demo);\n");
    const built = await buildUI({ workspace });
    assert.equal(built.ok, true, built.error);
    const dist = fs.readFileSync(path.join(workspace, 'ui/dist/main.js'), 'utf8');
    assert.match(dist, /TINY-FMT:/);
    assert.equal((dist.match(/react\.production|__SECRET_INTERNALS|ReactSharedInternals/g) || []).length > 0, true);
});

test('包不存在 / 连不上:报清楚,不留半个文件', async () => {
    const workspace = await planted();
    const missing = await addPackage({ workspace, spec: 'no-such-pkg', cdn });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /找不到 no-such-pkg\(404\)/);
    const down = await addPackage({ workspace, spec: 'tiny-fmt', cdn: 'http://127.0.0.1:9' });
    assert.equal(down.ok, false);
    assert.match(down.error, /连不上/);
    assert.ok(!fs.existsSync(path.join(workspace, 'ui/vendor/no-such-pkg.js')));
});
