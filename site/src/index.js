// morphic.iimos.ai:项目介绍、下载,和形态社区。一个 Worker、一个 D1、一个 R2,都叫 morphic。
//
// 页面
//   /                          首页:它是什么、最新版本下载、最新的形态
//   /shapes                    形态墙(?sort=hot 按换上次数)
//   /s/<id>                    一个形态:封面、它是怎么长出来的、怎么换上
//   /device                    设备授权:用户在这里用谷歌登录,同意自己的 morphic 以自己的名义发布
//   /auth/google(/callback)    谷歌登录;/auth/logout 退出
//   /privacy  /terms           隐私政策、服务条款(谷歌登录要求有)
//
// 给 agent 的接口(说明在 /agent.md,morphic 的提示词里只指向那一页)
//   GET    /api/shapes                列表(?sort=new|hot&q=关键字&limit=)
//   GET    /api/shapes/<id>           详情
//   GET    /api/shapes/<id>/files     全部文件(文本给 content,二进制给 base64);记一次换上(?preview=1 不记)
//   GET    /api/shapes/<id>/cover     封面 PNG
//   POST   /api/shapes                发布(要登录),JSON:{ name, story, parent?, cover?, files: [{ path, content | base64 }] }
//   DELETE /api/shapes/<id>           删除自己发的(要登录)
//   POST   /api/auth/device           拿设备码;POST /api/auth/token 换令牌;GET /api/me 我是谁
//   GET    /api/shapes/<id>/bundle    老客户端(morphic adopt)用的 gzip 包,保留兼容
import { LIMITS, base64, decodeShape, encodeShape, scanSecrets, validateShape } from './shape.js';
import { currentUser, deviceApprove, deviceLookup, deviceStart, deviceToken, googleCallback, googleStart, logout, sha256 } from './auth.js';
import { agentDoc } from './agentdoc.js';
import { detailPage, devicePage, homePage, listPage, notFoundPage, privacyPage, termsPage } from './pages.js';

const PER_HOUR = 20;
// R2 桶 morphic 是整站共用的,形态放在 shapes/ 下
const BUNDLE = (id) => `shapes/bundles/${id}.gz`;
const COVER = (id) => `shapes/covers/${id}.png`;
const REPO = 'yanglongyun/morphic';

// 表结构(和 schema.sql 一致)。每个 isolate 第一次请求时建一次,都是 IF NOT EXISTS,本地开发和线上一样
import SCHEMA from '../schema.sql?raw';
let schemaReady = null;
const ensureSchema = (env) => (schemaReady ||= (async () => {
    await env.DB.batch(SCHEMA.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean).map((s) => env.DB.prepare(s)));
    // 后加的列:老库没有就补上(已经有了会报错,忽略)
    try { await env.DB.prepare('ALTER TABLE shapes ADD COLUMN owner_id TEXT').run(); } catch { /* 已有 */ }
})().catch((error) => { schemaReady = null; throw error; }));

const CORS = { 'access-control-allow-origin': '*' };
const json = (data, status = 200, cache = 'no-store') => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...CORS },
});
const html = (body, status = 200, cache = 'public, max-age=30') => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache } });
const text = (body, type) => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=300', ...CORS } });
const fail = (status, error) => Object.assign(new Error(error), { status });

const newId = () => {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join('');
};

const ROW = 'id, name, story, author, seed_version, lineage, parent_id, file_count, size, has_cover, downloads, created_at, owner_id';
const view = (row, origin) => row && ({
    id: row.id, name: row.name, story: row.story, author: row.author, seedVersion: row.seed_version,
    lineage: JSON.parse(row.lineage || '[]'), parentId: row.parent_id, fileCount: row.file_count, size: row.size,
    cover: row.has_cover ? `/api/shapes/${row.id}/cover` : null, downloads: row.downloads, createdAt: row.created_at,
    url: `${origin || 'https://morphic.iimos.ai'}/s/${row.id}`,
    ...(row.files ? { files: JSON.parse(row.files) } : {}),
});

async function list(env, { sort = 'new', q = '', limit = 60, origin } = {}) {
    const order = sort === 'hot' ? 'downloads DESC, created_at DESC' : 'created_at DESC';
    const n = Math.min(Math.max(Number(limit) || 60, 1), 100);
    const like = `%${String(q).trim().slice(0, 60)}%`;
    const { results } = q
        ? await env.DB.prepare(`SELECT ${ROW} FROM shapes WHERE published = 1 AND (name LIKE ? OR story LIKE ?) ORDER BY ${order} LIMIT ?`).bind(like, like, n).all()
        : await env.DB.prepare(`SELECT ${ROW} FROM shapes WHERE published = 1 ORDER BY ${order} LIMIT ?`).bind(n).all();
    return results.map((r) => view(r, origin));
}

async function get(env, id, origin) {
    return view(await env.DB.prepare(`SELECT ${ROW}, files FROM shapes WHERE id = ? AND published = 1`).bind(id).first(), origin);
}

async function children(env, id) {
    const { results } = await env.DB.prepare(`SELECT ${ROW} FROM shapes WHERE parent_id = ? AND published = 1 ORDER BY downloads DESC LIMIT 12`).bind(id).all();
    return results.map((r) => view(r));
}

/** agent 发来的 JSON → 形态(和 R2 里存的 gzip 是同一种格式)。 */
async function shapeFromJson(env, body, user) {
    if (!body || typeof body !== 'object') throw fail(400, '要 JSON:{ name, story, files: [{ path, content | base64 }] }');
    if (!Array.isArray(body.files)) throw fail(400, 'files 要是数组');
    const files = body.files.map((f) => {
        if (!f || typeof f.path !== 'string') throw fail(400, '每个文件要有 path');
        if (typeof f.base64 === 'string') return { path: f.path, data: f.base64 };
        if (typeof f.content === 'string') return { path: f.path, data: base64.encode(new TextEncoder().encode(f.content)) };
        throw fail(400, `文件 ${f.path} 要有 content(文本)或 base64(二进制)`);
    });
    let lineage = [];
    if (body.parent) {
        const parent = await env.DB.prepare('SELECT id, name, lineage FROM shapes WHERE id = ?').bind(String(body.parent)).first();
        if (parent) lineage = [...JSON.parse(parent.lineage || '[]'), { id: parent.id, name: parent.name }];
    }
    try {
        return validateShape({
            format: 'morphic-shape/1', name: body.name, story: body.story, author: user.name,
            seedVersion: body.seedVersion, lineage, cover: typeof body.cover === 'string' ? body.cover : null, files,
        });
    } catch (error) {
        throw fail(400, error.message);
    }
}

async function publish(request, env, user) {
    if (!user) throw fail(401, '要先登录:见 /agent.md 的「登录」');
    const recent = await env.DB.prepare("SELECT count(*) AS n FROM shapes WHERE owner_id = ? AND created_at > datetime('now', '-1 hour')").bind(user.id).first();
    if (recent.n >= PER_HOUR) throw fail(429, '发得太快了,过一小时再来');
    const length = Number(request.headers.get('content-length') || 0);
    if (length > LIMITS.bytes * 1.5) throw fail(413, '形态太大(最多 30MB)');
    let body;
    try { body = await request.json(); } catch { throw fail(400, '不是 JSON'); }
    const shape = await shapeFromJson(env, body, user);
    // 别让谁的 key 挂在公开页面上
    const hits = scanSecrets(shape.files);
    if (hits.length) throw fail(400, `像是有密钥,没发:${hits.map((h) => `${h.path}:${h.line}(${h.label})`).join('、')}`);

    const id = newId();
    await env.BUCKET.put(BUNDLE(id), await encodeShape(shape), { httpMetadata: { contentType: 'application/gzip' } });
    if (shape.cover) await env.BUCKET.put(COVER(id), base64.decode(shape.cover), { httpMetadata: { contentType: 'image/png' } });
    const files = shape.files.map((f) => [f.path, Math.floor((f.data.length * 3) / 4)]);
    await env.DB.prepare(`INSERT INTO shapes (id, name, story, author, seed_version, lineage, parent_id, files, file_count, size, has_cover, edit_hash, ip_hash, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?)`)
        .bind(id, shape.name, shape.story, shape.author, shape.seedVersion, JSON.stringify(shape.lineage), shape.lineage.at(-1)?.id || null,
            JSON.stringify(files), files.length, shape.size, shape.cover ? 1 : 0, user.id)
        .run();
    return json({ id, url: `${new URL(request.url).origin}/s/${id}` }, 201);
}

async function remove(request, env, id, user) {
    const row = await env.DB.prepare('SELECT owner_id, edit_hash FROM shapes WHERE id = ?').bind(id).first();
    if (!row) throw fail(404, '没有这个形态');
    // 老形态(没有账号时发的)还认当时给的删除令牌
    const bearer = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    const legacy = !row.owner_id && bearer && row.edit_hash && (await sha256(bearer)) === row.edit_hash;
    if (!legacy) {
        if (!user) throw fail(401, '要先登录');
        if (row.owner_id !== user.id) throw fail(403, '只能删自己发的');
    }
    await env.DB.prepare('DELETE FROM shapes WHERE id = ?').bind(id).run();
    await env.BUCKET.delete([BUNDLE(id), COVER(id)]);
    return json({ ok: true });
}

/** 形态里的全部文件,给 agent 直接写进 workspace:能当 UTF-8 读的给 content,其余给 base64。 */
async function files(env, id, preview, ctx) {
    const object = await env.BUCKET.get(BUNDLE(id));
    if (!object) throw fail(404, '没有这个形态');
    const shape = await decodeShape(new Uint8Array(await object.arrayBuffer()));
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const out = shape.files.map((f) => {
        const bytes = base64.decode(f.data);
        if (!bytes.includes(0)) { try { return { path: f.path, content: decoder.decode(bytes) }; } catch { /* 二进制 */ } }
        return { path: f.path, base64: f.data };
    });
    if (!preview) ctx.waitUntil(env.DB.prepare('UPDATE shapes SET downloads = downloads + 1 WHERE id = ?').bind(id).run());
    return json({ shape: { id, name: shape.name, story: shape.story, author: shape.author, seedVersion: shape.seedVersion, lineage: shape.lineage }, files: out });
}

// 最新发布:读 GitHub Releases,边缘缓存一小时;拿不到就只给 releases 页的链接
async function latestRelease(ctx) {
    const latest = `https://github.com/${REPO}/releases/latest`;
    const fallback = { version: '', dmg: latest, exe: latest, page: latest };
    const key = new Request(`https://morphic.iimos.ai/__release/2`);
    const cached = await caches.default.match(key);
    if (cached) return cached.json();
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'morphic.iimos.ai', accept: 'application/vnd.github+json' } });
        if (!res.ok) return fallback;
        const data = await res.json();
        const asset = (ext) => (data.assets || []).find((a) => a.name.endsWith(ext))?.browser_download_url || data.html_url;
        const release = { version: String(data.tag_name || '').replace(/^v/, ''), date: String(data.published_at || '').slice(0, 10), dmg: asset('.dmg'), exe: asset('.exe'), page: data.html_url };
        ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(release), { headers: { 'cache-control': 'public, max-age=3600' } })));
        return release;
    } catch {
        return fallback;
    }
}

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    // HEAD 和 GET 走同一条路(运行时会去掉响应体);监控、链接检查常用 HEAD
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const origin = url.origin;

    if (method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, authorization' } });

    // 页面
    if (method === 'GET' && path === '/') {
        if (url.searchParams.has('sort')) return Response.redirect(`${origin}/shapes${url.search}`, 301);
        const [shapes, release] = await Promise.all([list(env, { limit: 6, origin }), latestRelease(ctx)]);
        return html(homePage({ shapes, release, origin }));
    }
    if (method === 'GET' && path === '/shapes') {
        const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
        return html(listPage({ shapes: await list(env, { sort, origin }), sort, origin }));
    }
    const page = path.match(/^\/s\/([\w-]{4,40})\/?$/);
    if (page && method === 'GET') {
        const shape = await get(env, page[1], origin);
        if (!shape) return html(notFoundPage(), 404);
        return html(detailPage({ shape, children: await children(env, shape.id), origin }));
    }
    if (method === 'GET' && path === '/privacy') return html(privacyPage(), 200, 'public, max-age=3600');
    if (method === 'GET' && path === '/terms') return html(termsPage(), 200, 'public, max-age=3600');
    if (method === 'GET' && (path === '/agent.md' || path === '/llms.txt')) return text(agentDoc(origin), 'text/markdown');

    // 登录
    if (method === 'GET' && path === '/auth/google') return googleStart(request, env);
    if (method === 'GET' && path === '/auth/google/callback') return googleCallback(request, env);
    if (method === 'GET' && path === '/auth/logout') return logout(request, env);
    if (path === '/device') {
        const user = await currentUser(request, env);
        const code = (method === 'POST' ? (await request.formData()).get('code') : url.searchParams.get('code')) || '';
        const device = code ? await deviceLookup(env, code) : null;
        if (method === 'POST') {
            if (!user) return Response.redirect(`${origin}/auth/google?next=${encodeURIComponent(`/device?code=${code}`)}`, 302);
            const ok = device && await deviceApprove(env, code, user);
            return html(devicePage({ user, code, device, done: ok, error: ok ? '' : '这个码不对或者过期了,让 morphic 重新要一个' }), 200, 'no-store');
        }
        return html(devicePage({ user, code, device, error: code && !device ? '这个码不对或者过期了,让 morphic 重新要一个' : '' }), 200, 'no-store');
    }

    // 接口
    if (path === '/api/auth/device' && method === 'POST') return json(await deviceStart(request, env));
    if (path === '/api/auth/token' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch { /* 空 */ }
        const result = await deviceToken(env, body.device_code);
        return result ? json(result) : json({ error: 'authorization_pending' }, 428);
    }
    if (path === '/api/me' && method === 'GET') {
        const user = await currentUser(request, env);
        return user ? json({ user: { name: user.name, email: user.email } }) : json({ error: '没登录或令牌失效了' }, 401);
    }
    if (path === '/api/shapes') {
        if (method === 'GET') return json({ shapes: await list(env, { sort: url.searchParams.get('sort') === 'hot' ? 'hot' : 'new', q: url.searchParams.get('q') || '', limit: url.searchParams.get('limit'), origin }) }, 200, 'public, max-age=30');
        if (method === 'POST') return publish(request, env, await currentUser(request, env));
    }
    const api = path.match(/^\/api\/shapes\/([\w-]{4,40})(\/files|\/bundle|\/cover)?$/);
    if (api) {
        const [, id, part] = api;
        if (method === 'DELETE' && !part) return remove(request, env, id, await currentUser(request, env));
        if (method !== 'GET') throw fail(405, 'method not allowed');
        if (!part) { const shape = await get(env, id, origin); return shape ? json({ shape }, 200, 'public, max-age=30') : json({ error: '没有这个形态' }, 404); }
        if (part === '/files') return files(env, id, url.searchParams.has('preview'), ctx);
        const object = await env.BUCKET.get(part === '/bundle' ? BUNDLE(id) : COVER(id));
        if (!object) throw fail(404, '没有');
        if (part === '/bundle' && !url.searchParams.has('preview')) ctx.waitUntil(env.DB.prepare('UPDATE shapes SET downloads = downloads + 1 WHERE id = ?').bind(id).run());
        return new Response(object.body, {
            headers: { 'content-type': part === '/bundle' ? 'application/gzip' : 'image/png', 'cache-control': part === '/bundle' ? 'no-store' : 'public, max-age=86400', ...CORS },
        });
    }
    if (path.startsWith('/api/')) throw fail(404, 'not found');
    return env.ASSETS.fetch(request);
}

export default {
    async fetch(request, env, ctx) {
        try {
            await ensureSchema(env);
            return await route(request, env, ctx);
        } catch (error) {
            if (error.status) return json({ error: error.message }, error.status);
            console.error(error);
            return json({ error: '出错了' }, 500);
        }
    },
};
