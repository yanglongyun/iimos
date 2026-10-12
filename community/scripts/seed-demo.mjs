// 把录 demo 时长出来的几个形态发到社区站(本地开发或线上):
//   node community/scripts/seed-demo.mjs http://localhost:8798
// 那几个是旧版应用(入口 desktop/main.js,用 Electron),先换成纯 Node 的 main.js 再打包。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as snap from '../../launcher/snapshot.js';
import { collect } from '../../launcher/share.js';
import { encodeShape } from '../../protocol/shape.js';

const COMMUNITY = (process.argv[2] || 'http://localhost:8798').replace(/\/+$/, '');
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC = process.env.DEMO_DIR || '/tmp/iimos-x';
const ART = process.env.ART_DIR || path.join(os.homedir(), 'Desktop', 'iimos-素材', '推特');

const main = (window, notify = false) => `// 应用的入口,由 launcher 加载。起本地服务 → 报到 iimos.ready({ url })。纯 Node,不碰 Electron。
import path from 'node:path';

import { startServer } from './server/index.js';

const iimos = globalThis.iimos;
const workspace = iimos?.workspace || process.env.IIMOS_WORKSPACE || import.meta.dirname;
const data = iimos?.data || process.env.IIMOS_DATA || path.join(workspace, '.data');
${notify ? `
// 价格提醒触发时弹系统通知(server/alerts.js 调 notify),经 launcher 的手;手机配对过也会收到
async function notify({ title, body }) {
    try { await iimos?.hands?.call('notify', { title, body }); } catch { console.log(\`[notify] \${title}: \${body}\`); }
    try { await iimos?.remote?.push({ title }); } catch { /* 没有手机 */ }
}
` : ''}
const server = await startServer({ workspace, data, bin: iimos?.bin${notify ? ', notify' : ''} });
iimos?.onShutdown(({ restarting } = {}) => server.close({ restarting }));

if (iimos) iimos.ready({ url: server.url, window: ${JSON.stringify(window)} });
else console.log(server.url);
`;

const DEMOS = [
    {
        dir: 'xp', name: 'Windows XP 桌面', cover: 'xp.png',
        story: '把你自己整个换成 Windows XP 桌面:蓝天绿地的壁纸、任务栏、开始菜单、桌面图标,对话放进一个 XP 窗口里。\n然后:桌面上加一个「待办」,记事本的样子,回车加一行、点方框打勾。',
        window: { width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'iimos', background: '#2a6fc4' },
    },
    {
        dir: 'crypto', name: '加密货币行情台', cover: 'crypto.png', notify: true,
        story: '把自己改成一个加密货币行情台:三栏深色界面,左边自选、中间 K 线、右边价格提醒,对话框缩到右下角。行情走 OKX 每分钟刷新,价格到了弹系统通知。',
        window: { width: 1440, height: 920, minWidth: 900, minHeight: 600, title: 'iimos 行情台', background: '#0b0e11' },
    },
    {
        dir: 'game', name: '地牢文字冒险', cover: 'game.png',
        story: '把自己变成一个像素风的地牢文字冒险游戏:你当地下城主,左边讲故事给选项,右边是角色面板(等级、HP、金币、背包)。掷骰子要真的掷。',
        window: { width: 1200, height: 820, minWidth: 900, minHeight: 600, title: 'iimos 地牢', background: '#0a0810' },
    },
];

for (const demo of DEMOS) {
    const from = path.join(SRC, demo.dir, 'workspace');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), `shape-${demo.dir}-`));
    fs.cpSync(from, work, { recursive: true, filter: (src) => !/node_modules|\.DS_Store/.test(src) });
    fs.rmSync(path.join(work, 'desktop'), { recursive: true, force: true });
    fs.writeFileSync(path.join(work, 'main.js'), main(demo.window, demo.notify));
    // AGENT.md 里的入口说明跟着改
    const doc = path.join(work, 'AGENT.md');
    fs.writeFileSync(doc, fs.readFileSync(doc, 'utf8').replace(/desktop\/main\.js\s+Electron 主进程[^\n]*/, 'main.js             入口(纯 Node):起本地服务 → globalThis.iimos.ready({ url }),窗口由 launcher 开').replaceAll('desktop/main.js', 'main.js'));
    await snap.commitAll(work, '换成纯 Node 的入口 main.js');

    let cover = null;
    const png = path.join(ART, demo.cover);
    if (fs.existsSync(png)) {
        // 缩到 1400 宽,封面限 2MB
        const small = path.join(work, '..', `${demo.dir}-cover.png`);
        const { execFileSync } = await import('node:child_process');
        execFileSync('sips', ['-Z', '1400', png, '--out', small], { stdio: 'ignore' });
        cover = fs.readFileSync(small).toString('base64');
    }
    const { shape } = await collect({ workspace: work, name: demo.name, story: demo.story, author: 'iimos', cover });
    const res = await fetch(`${COMMUNITY}/api/shapes`, { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: await encodeShape(shape) });
    const value = await res.json();
    console.log(demo.name, res.status, value.url || value.error, value.editToken ? '(删除令牌已写到 community/.seed-tokens.json)' : '');
    if (value.editToken) {
        const file = path.join(ROOT, 'community', '.seed-tokens.json');
        const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        all.push({ community: COMMUNITY, id: value.id, name: demo.name, editToken: value.editToken });
        fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
    }
}
