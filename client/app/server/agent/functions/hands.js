// 手:电脑操作、浏览器、通知。都不在应用里实现 —— 经 globalThis.iimos.hands 交给 launcher,
// launcher 再交给本机的手或远处借来的手(见 launcher/CONTRACT.md「globalThis.iimos」)。
//
// 截图(结果里的 png)不塞进文字结果:存成文件,返回 { text, image },agent 循环把它作为一张图给模型看下一眼。
import fs from 'node:fs';
import path from 'node:path';

export default async function hands(tool, args, config, signal) {
    const api = globalThis.iimos?.hands;
    if (!api) throw new Error('没有 launcher(应用是单独跑的),用不了手');
    signal?.throwIfAborted();
    const result = await api.call(tool, args);
    signal?.throwIfAborted();
    if (result && typeof result === 'object' && typeof result.png === 'string') {
        const { png, ...rest } = result;
        const dir = path.join(config.data, 'shots');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${tool}.png`);
        fs.writeFileSync(file, Buffer.from(png, 'base64'));
        // 只留最近 50 张
        const all = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
        for (const old of all.slice(0, Math.max(0, all.length - 50))) fs.rmSync(path.join(dir, old), { force: true });
        return { text: JSON.stringify({ ...rest, screenshot: file }, null, 2), image: file };
    }
    const text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);
    return { text: text.length > config.max_output ? `${text.slice(0, config.max_output)}\n…(输出已截断)` : text };
}
