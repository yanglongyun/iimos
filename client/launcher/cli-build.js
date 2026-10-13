// 开发时编译仓库里的出厂界面(app/ui/src → app/ui/dist):npm run build:ui。
// 用户机器上走的是 iimos build / reload,同一份 buildUI。
import path from 'node:path';
import { buildUI } from './build.js';

const result = await buildUI({ workspace: path.resolve(import.meta.dirname, '..', 'app') });
if (!result.ok) { console.error(`界面编译失败:\n\n${result.error}`); process.exit(1); }
console.log(result.skipped ? '没有 ui/src,跳过' : `界面已编译(${result.ms}ms)`);
