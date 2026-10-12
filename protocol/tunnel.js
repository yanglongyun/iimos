// 隧道帧。分两层:
//
// 外层(明文,中继看得到也只需要看这些):
//   iimos → 中继     { to: 连接 id, k, iv, c }            发给某个设备
//                   { t: 'push' }                         让中继给订阅了推送的设备发一条不带内容的推送
//   中继 → iimos     { from: 连接 id, k, iv, c }          某个设备发来的
//                   { t: 'join', c } / { t: 'leave', c } 设备连上 / 断开
//   设备 → 中继      { k, iv, c }                          发给 iimos
//                   { t: 'subscribe', k, sub }           交推送订阅(浏览器的 PushSubscription)
//   中继 → 设备      { k, iv, c }                          iimos 发来的
//                   { t: 'machine', online }              iimos 在不在线
//
// 内层(加密在 c 里,只有两端看得到):
//   设备 → iimos     hello  { kind: 'device' | 'hands', name, tools? }
//                   req    { id, method, path, headers, body? }    body 是 base64url
//                   cancel { id }
//                   result { id, ok, value? , error? }             手回复 call
//   iimos → 设备     welcome { instance, app, recovery }
//                   res    { id, status, headers }
//                   chunk  { id, data }                             data 是 base64url,≤ CHUNK 字节
//                   end    { id }
//                   err    { id, error }
//                   call   { id, tool, args }                       调用远处的手
export const CHUNK = 192 * 1024;
export const REQUEST_LIMIT = 8 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 60_000;

/** 不该穿过隧道的请求头:连接层的、会暴露设备环境的。 */
export const DROP_HEADERS = new Set([
    'host', 'connection', 'upgrade', 'content-length', 'transfer-encoding', 'keep-alive',
    'cookie', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
    'x-iimos-token', 'accept-encoding',
]);

/** 远程隧道按路径分给应用还是救援页。 */
export const RECOVERY_PREFIX = '/__recovery';
export const routeOf = (path) => (String(path).startsWith(RECOVERY_PREFIX) ? 'recovery' : 'app');
