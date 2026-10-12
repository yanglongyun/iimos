// 打包插件:把源码和图标装进 dist/iimos-extension.zip,上架或者「加载已解压的扩展程序」用 dist/iimos-extension/。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const out = path.join(here, 'dist', 'iimos-extension');
const FILES = ['manifest.json', 'background.js', 'control.js', 'browser.js', 'panel.html', 'panel.js', 'panel.css', 'icon.png'];
fs.rmSync(path.join(here, 'dist'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of FILES) fs.copyFileSync(path.join(here, file), path.join(out, file));
execFileSync('zip', ['-qr', '../iimos-extension.zip', '.'], { cwd: out });
console.log(`插件已打包:${out}(zip 在 dist/iimos-extension.zip)`);
