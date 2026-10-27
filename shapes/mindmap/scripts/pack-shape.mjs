// 生成可发布的 iimos 形态包:排除版本库、依赖和用户数据,校验格式并扫描密钥。
// 用法:node scripts/pack-shape.mjs [cover.png] [out.gz]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeShape, scanSecrets, validateShape } from '../../../site/src/shape.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coverPath = process.argv[2] || '/tmp/mindmap-preview.png';
const outPath = process.argv[3] || '/tmp/mindmap.gz';
const skip = /^(\.git|\.iimos|\.data|node_modules)(\/|$)|(^|\/)(\.DS_Store|[^/]+\.log|[^/]+\.db(-wal|-shm)?)$|^scripts\/pack-shape\.mjs$/;

function walk(dir = '') {
    const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    for (const entry of entries) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (skip.test(rel)) continue;
        if (entry.isDirectory()) walk(rel);
        else if (entry.isFile()) files.push(rel);
    }
}
const files = [];
walk();
const list = files.sort().map((rel) => {
    const bytes = fs.readFileSync(path.join(root, rel));
    const data = bytes.toString('base64');
    return { path: rel, data };
});
const story = '把 iimos 变成一张会生长的思维导图：左边和 agent 对话，右边是同一张图。写下一个中心主题，它先搭出 3–6 个方向；之后选中任意一支继续聊，它会直接加分支、改标题、补备注、移动或删除主题。手动也能双击改、用工具栏加子主题/同级、拖动换层级；画布和大纲双视图，数据存在本机。';
const shape = validateShape({
    format: 'iimos-shape/1', name: 'mindmap', story, author: 'woodchange', seedVersion: '1.0.0',
    lineage: [{ id: 'ramify', name: 'ramify' }],
    cover: fs.readFileSync(coverPath).toString('base64'), files: list,
});
const hits = scanSecrets(shape.files);
if (hits.length) {
    console.error('发现疑似密钥:', hits);
    process.exit(1);
}
const gz = await encodeShape(shape);
fs.writeFileSync(outPath, gz);
const manifest = {
    name: shape.name, story: shape.story, author: shape.author, seedVersion: shape.seedVersion,
    lineage: shape.lineage, coverBytes: Math.floor(shape.cover.length * 0.75),
    fileCount: shape.files.length, size: shape.size,
    files: shape.files.map((file) => [file.path, Math.floor(file.data.length * 3 / 4)]),
};
fs.writeFileSync('/tmp/mindmap-shape.json', JSON.stringify(manifest));
console.log(JSON.stringify({ ...manifest, files: undefined, gzipBytes: gz.length }, null, 2));
