// 生成 Web Push 的 VAPID 密钥对,打印出来设成 Worker 的 secret(VAPID_PUBLIC、VAPID_PRIVATE_JWK)。
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
const b64url = (u8) => Buffer.from(u8).toString('base64url');
const jwk = await subtle.exportKey('jwk', pair.privateKey);
console.log(JSON.stringify({ VAPID_PUBLIC: b64url(raw), VAPID_PRIVATE_JWK: JSON.stringify(jwk) }));
