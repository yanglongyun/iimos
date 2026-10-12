// 端到端加密。Node(launcher、hands)和浏览器(中继外壳页)用同一份,都靠 WebCrypto。
//
// 配对时为每台设备生成一个 32 字节密钥,只存在两端:iimos 的 devices.json 和设备上(链接 # 后面 → localStorage)。
// 每一帧 AES-256-GCM 加密,带随机 12 字节 IV。中继只看得到 { k: 设备 id, iv, c: 密文 }。
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = {
    encode(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(text) {
        const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4));
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
        return out;
    },
};

export function randomBytes(n) {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** 短 id(实例、设备、连接):base64url,默认 16 字节。 */
export const randomId = (n = 16) => b64url.encode(randomBytes(n));

/** 新密钥:base64url 的 32 字节。 */
export const newSecret = () => b64url.encode(randomBytes(32));

export async function importKey(secret) {
    const raw = b64url.decode(secret);
    if (raw.length !== 32) throw new Error('密钥长度不对');
    return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** 加密一个对象。返回 { k, iv, c },k 是设备 id(让对端知道用哪把钥匙)。 */
export async function seal(key, k, value) {
    const iv = randomBytes(12);
    const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
    return { k, iv: b64url.encode(iv), c: b64url.encode(data) };
}

/** 解密。钥匙不对或被篡改会抛错。 */
export async function open(key, frame) {
    const data = await subtle.decrypt({ name: 'AES-GCM', iv: b64url.decode(frame.iv) }, key, b64url.decode(frame.c));
    return JSON.parse(dec.decode(data));
}

export async function sha256(text) {
    return b64url.encode(await subtle.digest('SHA-256', enc.encode(String(text))));
}

/** 配对链接:<relay>/m/<实例>/#<设备>.<密钥>。# 后面的部分浏览器不会发给服务器。 */
export function pairLink({ relay, instance, device, secret }) {
    return `${String(relay).replace(/\/+$/, '')}/m/${instance}/#${device}.${secret}`;
}

export function parsePairLink(link) {
    const url = new URL(link);
    const match = url.pathname.match(/^\/m\/([\w-]+)\/?$/);
    const [device, secret] = url.hash.slice(1).split('.');
    if (!match || !device || !secret) throw new Error('不是 iimos 的配对链接');
    return { relay: url.origin, instance: match[1], device, secret };
}
