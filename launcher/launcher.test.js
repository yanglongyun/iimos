// launcher 的核心逻辑:播种、快照、连续失败回滚、升级。不需要 Electron。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as snap from './snapshot.js';
import * as seed from './seed.js';
import * as guardian from './guardian.js';

function fakeSeed(version, extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    const files = {
        'package.json': JSON.stringify({ version }),
        'AGENT.md': '# agent\n',
        'desktop/main.js': `globalThis.iimos?.ready(); // v${version}\n`,
        'server/index.js': 'export {};\n',
        'ui/index.html': '<p>ui</p>\n',
        'node_modules/dep/index.js': 'module.exports = 1;\n',
        '.data/conversation.json': '{"items":[]}',
        'ui/.DS_Store': 'x',
        ...extra,
    };
    for (const [file, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), body);
    }
    return dir;
}

function setup(version = '1.0.0') {
    const seedDir = fakeSeed(version);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-'));
    return { seedDir, workspace: path.join(root, 'workspace'), ledgerFile: path.join(root, 'body', 'state.json') };
}

test('播种:整份拷进来、打 good;依赖目录、系统垃圾不进 workspace', async () => {
    const { seedDir, workspace } = setup();
    const oid = await seed.plant({ seedDir, workspace, version: '1.0.0' });
    assert.ok(oid);
    assert.equal(await snap.resolve(workspace, 'refs/tags/good'), oid);
    assert.ok(fs.existsSync(path.join(workspace, 'desktop/main.js')));
    assert.ok(fs.existsSync(path.join(workspace, 'ui/index.html')));
    assert.ok(!fs.existsSync(path.join(workspace, 'node_modules')));
    assert.ok(!fs.existsSync(path.join(workspace, 'ui/.DS_Store')));
    assert.ok(!fs.existsSync(path.join(workspace, '.data')), '运行态数据(可能含 key)不能进 workspace');
    assert.deepEqual(await snap.changes(workspace), []);
    // 第二次不再播
    assert.equal(await seed.plant({ seedDir, workspace, version: '1.0.0' }), null);
});

test('真实的出厂 app/ 能播种,入口在', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-'));
    const workspace = path.join(root, 'workspace');
    const appDir = path.resolve(import.meta.dirname, '..', 'app');
    await seed.plant({ seedDir: appDir, workspace, version: seed.readSeedVersion(appDir, '0') });
    for (const file of ['desktop/main.js', 'server/index.js', 'agent/index.js', 'ui/index.html', 'ui/src/main.tsx', 'ui/dist/main.js', 'AGENT.md']) {
        assert.ok(fs.existsSync(path.join(workspace, file)), `缺 ${file}`);
    }
});

test('连续两次没报到 → 回滚到 good,坏版本留成分支,新文件被清掉', async () => {
    const ctx = setup();
    const good = await seed.plant({ ...ctx, version: '1.0.0' });
    let d = await guardian.beginBoot(ctx);
    assert.equal(d.action, 'run');
    guardian.markReady(ctx);

    // agent 改坏了:改一个文件、加一个新文件
    fs.writeFileSync(path.join(ctx.workspace, 'desktop/main.js'), 'throw new Error("坏了")\n');
    fs.mkdirSync(path.join(ctx.workspace, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(ctx.workspace, 'notes/x.js'), 'x');

    d = await guardian.beginBoot(ctx);          // 第一次:pending,带着改动快照
    assert.equal(d.action, 'run');
    assert.notEqual(d.commit, good);
    guardian.markFailed(ctx, new Error('坏了'));
    assert.equal(await guardian.willRecover(ctx), true);

    d = await guardian.beginBoot(ctx);          // 第一次失败,同一版本再试
    assert.equal(d.action, 'run');
    assert.equal(d.rolledBack, null);
    // 这次干脆没报到就死了
    d = await guardian.beginBoot(ctx);
    assert.equal(d.action, 'run');
    assert.ok(d.rolledBack);
    assert.equal(d.commit, good);
    assert.match(fs.readFileSync(path.join(ctx.workspace, 'desktop/main.js'), 'utf8'), /ready/);
    assert.ok(!fs.existsSync(path.join(ctx.workspace, 'notes')));
    assert.ok(await snap.resolve(ctx.workspace, `refs/heads/${d.rolledBack.branch}`));
    assert.ok(guardian.readNotice(ctx.workspace));
});

test('good 本身起不来 → 交给救援', async () => {
    const ctx = setup();
    await seed.plant({ ...ctx, version: '1.0.0' });
    await guardian.beginBoot(ctx);
    guardian.markFailed(ctx, 'x');
    await guardian.beginBoot(ctx);
    guardian.markFailed(ctx, 'x');
    assert.equal(await guardian.willRecover(ctx), false);
    const d = await guardian.beginBoot(ctx);
    assert.equal(d.action, 'recovery');
});

test('报到并稳定后成为 good', async () => {
    const ctx = setup();
    await seed.plant({ ...ctx, version: '1.0.0' });
    fs.writeFileSync(path.join(ctx.workspace, 'AGENT.md'), '# 改过\n');
    const d = await guardian.beginBoot(ctx);
    guardian.markReady(ctx);
    assert.equal(await guardian.promote(ctx), d.commit);
    assert.equal(await snap.resolve(ctx.workspace, 'refs/tags/good'), d.commit);
});

test('升级:没改过就直接换;改过就挂起等合并', async () => {
    const ctx = setup('1.0.0');
    await seed.plant({ ...ctx, version: '1.0.0' });
    const v2 = fakeSeed('2.0.0', { 'server/new.js': 'new\n' });
    let r = await seed.upgrade({ seedDir: v2, workspace: ctx.workspace, version: '2.0.0', previous: '1.0.0' });
    assert.equal(r.kind, 'replaced');
    assert.ok(fs.existsSync(path.join(ctx.workspace, 'server/new.js')));

    fs.writeFileSync(path.join(ctx.workspace, 'AGENT.md'), '# 用户的改动\n');
    await snap.commitAll(ctx.workspace, '用户改了');
    const v3 = fakeSeed('3.0.0');
    r = await seed.upgrade({ seedDir: v3, workspace: ctx.workspace, version: '3.0.0', previous: '2.0.0' });
    assert.equal(r.kind, 'pending');
    assert.equal(fs.readFileSync(path.join(ctx.workspace, 'AGENT.md'), 'utf8'), '# 用户的改动\n');
    assert.equal(seed.readPending(ctx.workspace).to, '3.0.0');
});
