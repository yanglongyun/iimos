// 形态(shape):一份 morphic 长成的样子,可以分享、可以被别人换上。
//
// 一个形态就是 workspace 里被版本管理的全部文件(代码、界面、提示词、AGENT.md),打成一个 gzip 的 JSON:
//
//   {
//     format: 'morphic-shape/1',
//     name, story,              名字;「让它长成这样的话」(可选)
//     author,                   署名(可选)
//     seedVersion,              长出它的出厂版本
//     lineage: [{ id, name }],  它是从哪些形态一路长过来的(最早的在前)
//     cover,                    封面 PNG 的 base64(可选)
//     files: [{ path, data }],  data 是 base64
//   }
//
// 不含任何用户数据:数据在 $MORPHIC_DATA,从来不在 workspace 里。分享前还会扫一遍像密钥的东西,有就拒绝。
// Node(launcher)和 Cloudflare Worker(社区站)都用这一份,所以只用两边都有的 Web API。
export const FORMAT = 'morphic-shape/1';
export const LIMITS = { files: 3000, bytes: 30 * 1024 * 1024, file: 8 * 1024 * 1024, name: 60, story: 4000, author: 40, cover: 2 * 1024 * 1024 };

/** 不进形态的路径:版本库、launcher 的记录、依赖、系统垃圾、日志、数据库。 */
export const EXCLUDE = /^(\.git|\.morphic|\.data|node_modules)(\/|$)|(^|\/)(\.DS_Store|[^/]+\.log|[^/]+\.db(-wal|-shm)?)$/;

const b64 = {
    encode(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    },
    decode(text) {
        const s = atob(text);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
        return out;
    },
};
export { b64 as base64 };

export function safePath(p) {
    return typeof p === 'string' && p.length > 0 && p.length < 400 && !p.startsWith('/') && !p.includes('\\')
        && !p.split('/').some((part) => part === '' || part === '.' || part === '..') && !EXCLUDE.test(p);
}

const clipText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** 检查一个解开的形态,返回整理过的副本;不合格就抛错,错误信息给人看。 */
export function validateShape(shape) {
    if (!shape || typeof shape !== 'object') throw new Error('不是形态');
    if (shape.format !== FORMAT) throw new Error(`不认识的形态格式:${shape.format}`);
    const name = clipText(shape.name, LIMITS.name);
    if (!name) throw new Error('形态要有名字');
    if (!Array.isArray(shape.files) || !shape.files.length) throw new Error('形态里没有文件');
    if (shape.files.length > LIMITS.files) throw new Error(`文件太多(最多 ${LIMITS.files} 个)`);
    let total = 0;
    const seen = new Set();
    const files = shape.files.map((file) => {
        if (!safePath(file?.path)) throw new Error(`不允许的路径:${String(file?.path).slice(0, 80)}`);
        if (seen.has(file.path)) throw new Error(`重复的文件:${file.path}`);
        seen.add(file.path);
        if (typeof file.data !== 'string') throw new Error(`文件内容不对:${file.path}`);
        const size = Math.floor((file.data.length * 3) / 4);
        if (size > LIMITS.file) throw new Error(`文件太大:${file.path}`);
        total += size;
        return { path: file.path, data: file.data };
    });
    if (total > LIMITS.bytes) throw new Error('形态太大(最多 30MB)');
    if (!seen.has('main.js')) throw new Error('形态里没有 main.js,换上了也起不来');
    const lineage = Array.isArray(shape.lineage)
        ? shape.lineage.slice(-20).filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id.slice(0, 40), name: clipText(x.name, LIMITS.name) }))
        : [];
    const cover = typeof shape.cover === 'string' && shape.cover.length * 0.75 <= LIMITS.cover ? shape.cover : null;
    return {
        format: FORMAT, name, story: clipText(shape.story, LIMITS.story), author: clipText(shape.author, LIMITS.author),
        seedVersion: clipText(shape.seedVersion, 20), lineage, cover, files, size: total,
    };
}

async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
}

export async function encodeShape(shape) {
    return pipe(new TextEncoder().encode(JSON.stringify(shape)), new CompressionStream('gzip'));
}

/** 解开、检查。limit 防解压炸弹。 */
export async function decodeShape(bytes, { limit = LIMITS.bytes * 1.5 } = {}) {
    let raw;
    try { raw = await pipe(bytes, new DecompressionStream('gzip')); } catch { throw new Error('形态文件坏了(不是 gzip)'); }
    if (raw.length > limit) throw new Error('形态太大');
    let parsed;
    try { parsed = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('形态文件坏了(不是 JSON)'); }
    return validateShape(parsed);
}

/** 像密钥的东西。分享前扫一遍,有就拒绝 —— 宁可误报。 */
const SECRETS = [
    [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, 'API key(sk-…)'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS 访问密钥'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
    [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
    [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
    [/["']?(?:api[_-]?key|secret|password|access[_-]?token)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i, '写死的密钥 / 密码'],
];

export function scanSecrets(files) {
    const hits = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const file of files) {
        let text;
        try { text = decoder.decode(b64.decode(file.data)); } catch { continue; }   // 二进制不扫
        for (const [pattern, label] of SECRETS) {
            const match = text.match(pattern);
            if (match) {
                const line = text.slice(0, match.index).split('\n').length;
                hits.push({ path: file.path, line, label });
                break;
            }
        }
    }
    return hits;
}
