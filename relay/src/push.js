// Web Push(VAPID),不带内容。
//
// 推送只说「iimos 找你」,点开以后内容走端到端加密的隧道取 —— 所以不用实现推送内容加密,
// 推送服务商(Apple、Google、Mozilla)也看不到任何东西。
// 密钥:VAPID_PUBLIC(base64url 的 65 字节未压缩公钥)、VAPID_PRIVATE_JWK(私钥 JWK 的 JSON),都放在 Worker 的 secret 里。
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (value) => b64url(new TextEncoder().encode(value));

let signingKey = null;
async function key(env) {
    if (!signingKey) signingKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return signingKey;
}

async function vapidJwt(env, endpoint) {
    const header = text(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const payload = text(JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT || 'mailto:hi@iimos.ai',
    }));
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await key(env), new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${b64url(signature)}`;
}

/** 发一条空推送,返回推送服务的状态码。 */
export async function sendPush(env, sub) {
    if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return 0;
    const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
            TTL: '86400',
            Urgency: 'high',
            Authorization: `vapid t=${await vapidJwt(env, sub.endpoint)}, k=${env.VAPID_PUBLIC}`,
            'Content-Length': '0',
        },
    });
    return res.status;
}
