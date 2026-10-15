// 登录。只有一种身份:谷歌账号。两种拿到身份的方式:
//
//   浏览器:/auth/google → 谷歌 → /auth/google/callback,种一个会话 cookie(morphic_session,30 天)。
//   agent:  设备授权(像电视登录)——
//           POST /api/auth/device   → { device_code, user_code, verification_uri_complete, interval, expires_in }
//           用户打开 verification_uri_complete,用谷歌登录,点「同意」
//           POST /api/auth/token { device_code } → 还没同意:428 authorization_pending;同意了:{ token, user }
//           之后请求带 Authorization: Bearer <token>。
//
// 会话、令牌、设备码都只存哈希。谷歌的 client id / secret 是 Worker 的 secret:GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET。
const SESSION_COOKIE = 'morphic_session';
const SESSION_DAYS = 30;
const DEVICE_TTL_S = 600;

export async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const randomToken = (bytes = 32) => {
    const u8 = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/** 给人看的短码:XXXX-XXXX,去掉容易看错的字符。 */
function userCode() {
    const alphabet = 'BCDFGHJKLMNPQRSTVWXZ23456789';
    const c = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
}

function cookie(request, name) {
    const raw = request.headers.get('cookie') || '';
    for (const part of raw.split(/;\s*/)) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
    return null;
}
const setCookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** 从 cookie 或 Bearer 令牌认出用户,认不出就 null。 */
export async function currentUser(request, env) {
    const bearer = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) {
        const row = await env.DB.prepare(`SELECT u.id, u.email, u.name, u.picture FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?`)
            .bind(await sha256(bearer)).first();
        if (row) {
            await env.DB.prepare(`UPDATE tokens SET last_used = datetime('now') WHERE hash = ?`).bind(await sha256(bearer)).run();
            return row;
        }
        return null;
    }
    const session = cookie(request, SESSION_COOKIE);
    if (!session) return null;
    return env.DB.prepare(`SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.hash = ? AND s.expires_at > datetime('now')`).bind(await sha256(session)).first();
}

/** 只允许站内跳转,防开放重定向。 */
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function googleStart(request, env) {
    if (!env.GOOGLE_CLIENT_ID) return new Response('还没配置谷歌登录', { status: 503 });
    const url = new URL(request.url);
    const state = randomToken(16);
    const next = safeNext(url.searchParams.get('next'));
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
    }).toString();
    return new Response(null, {
        status: 302,
        headers: [
            ['location', google.toString()],
            ['set-cookie', setCookie('morphic_oauth', `${state}|${next}`, 600)],
        ],
    });
}

export async function googleCallback(request, env) {
    const url = new URL(request.url);
    const [state, next] = (cookie(request, 'morphic_oauth') || '').split('|');
    if (!state || url.searchParams.get('state') !== state) return new Response('登录过期了,回去再点一次', { status: 400 });
    const code = url.searchParams.get('code');
    if (!code) return new Response('没登录上', { status: 400 });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${url.origin}/auth/google/callback`, grant_type: 'authorization_code',
        }),
    });
    if (!tokenRes.ok) return new Response('谷歌那边没认,回去再试一次', { status: 502 });
    const { access_token: accessToken } = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
    if (!infoRes.ok) return new Response('拿不到谷歌账号信息', { status: 502 });
    const info = await infoRes.json();
    if (!info.sub || !info.email_verified) return new Response('这个谷歌账号的邮箱还没验证', { status: 403 });

    const id = `g:${info.sub}`;
    await env.DB.prepare(`INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, last_login = datetime('now')`)
        .bind(id, info.email, info.name || info.email.split('@')[0], info.picture || '').run();
    const session = randomToken();
    await env.DB.prepare(`INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
        .bind(await sha256(session), id).run();
    return new Response(null, {
        status: 302,
        headers: [
            ['location', safeNext(next)],
            ['set-cookie', setCookie(SESSION_COOKIE, session, SESSION_DAYS * 86400)],
            ['set-cookie', setCookie('morphic_oauth', '', 0)],
        ],
    });
}

export async function logout(request, env) {
    const session = cookie(request, SESSION_COOKIE);
    if (session) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256(session)).run();
    return new Response(null, { status: 302, headers: [['location', '/'], ['set-cookie', setCookie(SESSION_COOKIE, '', 0)]] });
}

/** agent 要一个设备码。name 是它给自己起的名字(在同意页上给用户看)。 */
export async function deviceStart(request, env) {
    let name = 'morphic';
    try { name = String((await request.json()).name || name).slice(0, 60); } catch { /* 没带 body */ }
    const deviceCode = randomToken();
    const code = userCode();
    await env.DB.prepare(`DELETE FROM devices WHERE expires_at < datetime('now')`).run();
    await env.DB.prepare(`INSERT INTO devices (hash, user_code, name, expires_at) VALUES (?, ?, ?, datetime('now', '+${DEVICE_TTL_S} seconds'))`)
        .bind(await sha256(deviceCode), code, name).run();
    const origin = new URL(request.url).origin;
    return {
        device_code: deviceCode,
        user_code: code,
        verification_uri: `${origin}/device`,
        verification_uri_complete: `${origin}/device?code=${code}`,
        expires_in: DEVICE_TTL_S,
        interval: 3,
    };
}

export async function deviceLookup(env, code) {
    return env.DB.prepare(`SELECT user_code, name, user_id FROM devices WHERE user_code = ? AND expires_at > datetime('now')`).bind(String(code || '').toUpperCase()).first();
}

export async function deviceApprove(env, code, user) {
    const result = await env.DB.prepare(`UPDATE devices SET user_id = ? WHERE user_code = ? AND user_id IS NULL AND expires_at > datetime('now')`)
        .bind(user.id, String(code || '').toUpperCase()).run();
    return result.meta.changes > 0;
}

/** agent 拿令牌:没同意就 null,过期抛错;同意了发一个长期令牌,设备码作废。 */
export async function deviceToken(env, deviceCode) {
    const hash = await sha256(String(deviceCode || ''));
    const row = await env.DB.prepare(`SELECT name, user_id, expires_at > datetime('now') AS live FROM devices WHERE hash = ?`).bind(hash).first();
    if (!row || !row.live) throw Object.assign(new Error('expired_token'), { status: 400 });
    if (!row.user_id) return null;
    const token = randomToken();
    await env.DB.batch([
        env.DB.prepare(`INSERT INTO tokens (hash, user_id, name) VALUES (?, ?, ?)`).bind(await sha256(token), row.user_id, row.name),
        env.DB.prepare('DELETE FROM devices WHERE hash = ?').bind(hash),
    ]);
    const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(row.user_id).first();
    return { token, user: { name: user.name, email: user.email } };
}
