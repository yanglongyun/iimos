// 界面编译:真的跑 esbuild。播种一份真实的出厂 app,在它上面改、编、回滚。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as snap from './snapshot.js';
import * as seed from './seed.js';
import { buildUI } from './build.js';

const APP = path.resolve(import.meta.dirname, '..', 'app');

async function planted() {
    const workspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-build-')), 'workspace');
    await seed.plant({ seedDir: APP, workspace, version: '0.0.0' });
    return workspace;
}
const read = (workspace, file) => fs.readFileSync(path.join(workspace, file), 'utf8');

test('出厂界面能编译,产物带着源码进了版本史', async () => {
    const workspace = await planted();
    assert.ok(fs.existsSync(path.join(workspace, 'ui/dist/main.js')), '出厂就带编好的 dist');
    assert.ok(fs.existsSync(path.join(workspace, 'ui/src/main.tsx')));
    assert.deepEqual(await snap.changes(workspace), [], 'dist 也进了 git,播种后没有未提交的东西');
    const result = await buildUI({ workspace });
    assert.equal(result.ok, true, result.error);
    assert.match(read(workspace, 'ui/dist/main.js'), /createRoot|jsx/);
});

test('编译失败:dist 不动,错误指到文件和行', async () => {
    const workspace = await planted();
    const before = read(workspace, 'ui/dist/main.js');
    fs.writeFileSync(path.join(workspace, 'ui/src/App.tsx'), 'export function App() { return <div>坏了 </section>; }\n');
    const result = await buildUI({ workspace });
    assert.equal(result.ok, false);
    assert.match(result.error, /App\.tsx:1/);
    assert.equal(read(workspace, 'ui/dist/main.js'), before, '窗口还能用上一个版本');
    assert.ok(!fs.existsSync(path.join(workspace, 'ui/dist.next')), '临时目录清掉了');
});

test('改界面 → 编译 → 快照 → 回滚:dist 一起回到旧样子', async () => {
    const workspace = await planted();
    const good = await snap.head(workspace);
    const before = read(workspace, 'ui/dist/main.js');
    const banner = path.join(workspace, 'ui/src/components/Banner.tsx');
    fs.writeFileSync(banner, read(workspace, 'ui/src/components/Banner.tsx').replace('workspace 已就绪', 'workspace 改过了'));
    assert.equal((await buildUI({ workspace })).ok, true);
    assert.match(read(workspace, 'ui/dist/main.js'), /workspace 改过了/);
    await snap.commitAll(workspace, '改了横幅');
    await snap.resetHard(workspace, good, { saveAs: 'before-rollback' });
    assert.equal(read(workspace, 'ui/dist/main.js'), before, '回滚瞬间拿到能跑的产物,不用重新编译');
});

test('应用自己的 build.config.mjs 能改编译选项', async () => {
    const workspace = await planted();
    fs.writeFileSync(path.join(workspace, 'ui/build.config.mjs'), 'export default (options) => ({ ...options, minify: false });\n');
    assert.equal((await buildUI({ workspace })).ok, true);
    assert.match(read(workspace, 'ui/dist/main.js'), /\n {2,}/, '没压缩:有缩进');
});

test('没有 ui/src 的纯静态界面:跳过', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-static-'));
    fs.mkdirSync(path.join(workspace, 'ui'));
    assert.deepEqual(await buildUI({ workspace }), { ok: true, skipped: true });
});
