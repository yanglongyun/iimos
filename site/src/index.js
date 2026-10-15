// iimos.ai:项目介绍、发布,和形态社区。一个 Worker、一个 D1、一个 R2,都叫 iimos。
//
//   /                          首页:它是什么、最新版本下载、最新的形态
//   /shapes                    形态墙(?sort=hot 按换上次数)
//   /s/<id>                    一个形态:封面、它是怎么长出来的、一条命令换上
//   GET  /api/shapes           列表 JSON
//   GET  /api/shapes/<id>      详情 JSON
//   GET  /api/shapes/<id>/bundle  形态本体(gzip),iimos adopt 用;记一次换上(?preview=1 只看,不记)
//   GET  /api/shapes/<id>/cover   封面 PNG
//   POST /api/shapes           发布(body 是 gzip 的形态,iimos share 用),返回 { id, url, editToken }
//   DELETE /api/shapes/<id>    删除(Authorization: Bearer <editToken>)
//
// 不要账号:发布时给一个删除令牌,只存在作者本机($IIMOS_DATA/shares.json)。按 IP 限流。
import { LIMITS, decodeShape, scanSecrets } from './shape.js';
import { detailPage, homePage, listPage, notFoundPage } from './pages.js';

const PER_HOUR = 10;
// R2 桶 iimos 是整站共用的,形态放在 shapes/ 下
const BUNDLE = (id) => `shapes/bundles/${id}.gz`;
const COVER = (id) => `shapes/covers/${id}.png`;
const REPO = 'yanglongyun/iimos';

// 表结构(和 schema.sql 一致)。每个 isolate 第一次请求时建一次,都是 IF NOT EXISTS,本地开发和线上一样
import SCHEMA from '../schema.sql?raw';
let schemaReady = null;
const ensureSchema = (env) => (schemaReady ||= env.DB.batch(
    SCHEMA.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean).map((s) => env.DB.prepare(s)),
).catch((error) => { schemaReady = null; throw error; }));

const json = (data, status = 200, cache = 'no-store') => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'access-control-allow-origin': '*' },
});
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30' } });

async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomId = (bytes) => {
    const u8 = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const newId = () => {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join('');
};

const ROW = 'id, name, story, author, seed_version, lineage, parent_id, file_count, size, has_cover, downloads, created_at';
const view = (row) => row && ({
    id: row.id, name: row.name, story: row.story, author: row.author, seedVersion: row.seed_version,
    lineage: JSON.parse(row.lineage || '[]'), parentId: row.parent_id, fileCount: row.file_count, size: row.size,
    cover: row.has_cover ? `/api/shapes/${row.id}/cover` : null, downloads: row.downloads, createdAt: row.created_at,
    ...(row.files ? { files: JSON.parse(row.files) } : {}),
});

async function list(env, sort = 'new', limit = 60) {
    const order = sort === 'hot' ? 'downloads DESC, created_at DESC' : 'created_at DESC';
    const { results } = await env.DB.prepare(`SELECT ${ROW} FROM shapes WHERE published = 1 ORDER BY ${order} LIMIT ?`).bind(limit).all();
    return results.map(view);
}

async function get(env, id) {
    return view(await env.DB.prepare(`SELECT ${ROW}, files FROM shapes WHERE id = ? AND published = 1`).bind(id).first());
}

async function children(env, id) {
    const { results } = await env.DB.prepare(`SELECT ${ROW} FROM shapes WHERE parent_id = ? AND published = 1 ORDER BY downloads DESC LIMIT 12`).bind(id).all();
    return results.map(view);
}

async function publish(request, env) {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const ipHash = await sha256(`iimos-shapes:${ip}`);
    const recent = await env.DB.prepare("SELECT count(*) AS n FROM shapes WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')").bind(ipHash).first();
    if (recent.n >= PER_HOUR) return json({ error: '发得太快了,过一小时再来' }, 429);

    const length = Number(request.headers.get('content-length') || 0);
    if (length > LIMITS.bytes) return json({ error: '形态太大' }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > LIMITS.bytes) return json({ error: '形态太大' }, 413);
    let shape;
    try { shape = await decodeShape(bytes); } catch (error) { return json({ error: error.message }, 400); }
    // 客户端扫过,这里再扫一遍:别让谁的 key 挂在公开页面上
    const hits = scanSecrets(shape.files);
    if (hits.length) return json({ error: `像是有密钥:${hits.map((h) => `${h.path}:${h.line}`).join('、')}` }, 400);

    const id = newId();
    const editToken = randomId(24);
    await env.BUCKET.put(BUNDLE(id), bytes, { httpMetadata: { contentType: 'application/gzip' } });
    if (shape.cover) {
        const s = atob(shape.cover);
        const png = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i += 1) png[i] = s.charCodeAt(i);
        await env.BUCKET.put(COVER(id), png, { httpMetadata: { contentType: 'image/png' } });
    }
    const files = shape.files.map((f) => [f.path, Math.floor((f.data.length * 3) / 4)]);
    const parent = shape.lineage.at(-1)?.id || null;
    await env.DB.prepare(`INSERT INTO shapes (id, name, story, author, seed_version, lineage, parent_id, files, file_count, size, has_cover, edit_hash, ip_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, shape.name, shape.story, shape.author, shape.seedVersion, JSON.stringify(shape.lineage), parent, JSON.stringify(files), files.length, shape.size, shape.cover ? 1 : 0, await sha256(editToken), ipHash)
        .run();
    const origin = new URL(request.url).origin;
    return json({ id, url: `${origin}/s/${id}`, editToken }, 201);
}

// 最新发布:读 GitHub Releases,边缘缓存一小时;拿不到就只给 releases 页的链接
async function latestRelease(ctx) {
    const latest = `https://github.com/${REPO}/releases/latest`;
    const fallback = { version: '', dmg: latest, exe: latest, page: latest };
    const key = new Request(`https://iimos.ai/__release/2`);
    const cached = await caches.default.match(key);
    if (cached) return cached.json();
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'iimos.ai', accept: 'application/vnd.github+json' } });
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

async function remove(request, env, id) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const row = await env.DB.prepare('SELECT edit_hash FROM shapes WHERE id = ?').bind(id).first();
    if (!row) return json({ error: 'not found' }, 404);
    if (!token || (await sha256(token)) !== row.edit_hash) return json({ error: '令牌不对' }, 403);
    await env.DB.prepare('DELETE FROM shapes WHERE id = ?').bind(id).run();
    await env.BUCKET.delete([BUNDLE(id), COVER(id)]);
    return json({ ok: true });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        try {
            await ensureSchema(env);
            if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, authorization' } });
            if (path === '/' && request.method === 'GET') {
                // 旧的形态墙地址 /?sort=hot
                if (url.searchParams.has('sort')) return Response.redirect(`${url.origin}/shapes${url.search}`, 301);
                const [shapes, release] = await Promise.all([list(env, 'new', 6), latestRelease(ctx)]);
                return html(homePage({ shapes, release, origin: url.origin }));
            }
            if (path === '/shapes' && request.method === 'GET') {
                const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
                return html(listPage({ shapes: await list(env, sort), sort, origin: url.origin }));
            }
            const page = path.match(/^\/s\/([\w-]{4,40})\/?$/);
            if (page && request.method === 'GET') {
                const shape = await get(env, page[1]);
                if (!shape) return html(notFoundPage(), 404);
                return html(detailPage({ shape, children: await children(env, shape.id), origin: url.origin }));
            }
            if (path === '/api/shapes') {
                if (request.method === 'GET') return json({ shapes: await list(env, url.searchParams.get('sort') === 'hot' ? 'hot' : 'new') }, 200, 'public, max-age=30');
                if (request.method === 'POST') return await publish(request, env);
            }
            const api = path.match(/^\/api\/shapes\/([\w-]{4,40})(\/bundle|\/cover)?$/);
            if (api) {
                const [, id, part] = api;
                if (request.method === 'DELETE' && !part) return await remove(request, env, id);
                if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
                if (!part) { const shape = await get(env, id); return shape ? json({ shape }, 200, 'public, max-age=30') : json({ error: 'not found' }, 404); }
                const object = await env.BUCKET.get(part === '/bundle' ? BUNDLE(id) : COVER(id));
                if (!object) return json({ error: 'not found' }, 404);
                if (part === '/bundle' && !url.searchParams.has('preview')) ctx.waitUntil(env.DB.prepare('UPDATE shapes SET downloads = downloads + 1 WHERE id = ?').bind(id).run());
                return new Response(object.body, {
                    headers: {
                        'content-type': part === '/bundle' ? 'application/gzip' : 'image/png',
                        'cache-control': part === '/bundle' ? 'no-store' : 'public, max-age=86400',
                        'access-control-allow-origin': '*',
                    },
                });
            }
            if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
            return env.ASSETS.fetch(request);
        } catch (error) {
            console.error(error);
            return json({ error: '出错了' }, 500);
        }
    },
};
