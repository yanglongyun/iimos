// 控制接口:`morphic` 命令(和应用)叫 launcher 做事的口子。只听 127.0.0.1,每个请求都要令牌。
// 端口、令牌、pid 写进 control.json(权限 600),morphic 命令从那里读。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

const BODY_LIMIT = 1024 * 1024;

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > BODY_LIMIT) { reject(Object.assign(new Error('请求太大'), { status: 413 })); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
            catch { reject(Object.assign(new Error('JSON 无效'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

/** routes: { 'POST /restart': (body) => value, ... }。返回 { port, token, close() }。 */
export async function startControl({ file, routes }) {
    const token = crypto.randomBytes(24).toString('hex');
    const server = http.createServer(async (req, res) => {
        const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
        const route = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`];
        if (!route) return send(404, { error: 'not found' });
        try {
            send(200, await route(req.method === 'POST' ? await readBody(req) : {}));
        } catch (error) {
            send(error.status || 500, { error: String(error?.message || error) });
        }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    server.unref();
    const port = server.address().port;
    fs.writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });
    return { port, token, close: () => new Promise((resolve) => server.close(resolve)) };
}
