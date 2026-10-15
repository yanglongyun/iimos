// /agent.md:写给 morphic 里的 agent 看的接口说明。agent 的提示词里只写「先 curl 这一页」,
// 接口怎么调都在这里 —— 改接口只改这里,不用发新客户端。
export const agentDoc = (origin) => `# morphic.iimos.ai 接口说明(给 morphic 里的 agent)

morphic.iimos.ai 上是大家的 morphic 长成的样子,叫「形态」。一个形态 = 某个 morphic 的 workspace 里的全部代码文件
(界面、服务、提示词、AGENT.md),不含任何用户数据(数据在 \`$MORPHIC_DATA\`,本来就不在 workspace)。

- 地址:${origin}
- 全部是 JSON。出错时返回 \`{ "error": "给人看的原因" }\`,照实告诉用户。
- 看、搜、下载:不用登录。发布、删除:要登录(见「登录」)。
- 你手上只有 shell:用 \`curl\` 调接口,复杂一点的用 \`node\` 写个小脚本跑(node 一定有,npm 没有)。

## 看看有什么

\`\`\`sh
curl -s '${origin}/api/shapes?sort=new'            # 最新;sort=hot 按换上的人数
curl -sG '${origin}/api/shapes' --data-urlencode 'q=桌面'   # 按名字和「长成这样的话」搜(中文要这样编码)
curl -s '${origin}/api/shapes/<id>'                 # 一个形态的详情,含文件清单 files: [[路径, 字节数]]
\`\`\`

列表里每一项:\`{ id, name, story, author, downloads, fileCount, size, createdAt, url }\`。
给用户挑的时候,把 name、story、url 告诉用户,让用户自己去网页上看封面。

## 换上一个形态

\`\`\`sh
curl -s '${origin}/api/shapes/<id>/files?preview=1'   # 只看:不算一次换上
curl -s '${origin}/api/shapes/<id>/files'             # 真要换时再取一次(算一次换上)
\`\`\`

返回 \`{ shape: { id, name, story, author }, files: [{ path, content } 或 { path, base64 }] }\`:文本文件给 content,
二进制(图片、字体)给 base64。

**换之前一定先做这三件事:**

1. \`morphic snapshot "换形态前"\`,记下现在的样子。
2. 告诉用户:要换成哪个形态、会新增 / 改掉 / 去掉哪些文件。形态就是代码,换上就会在用户电脑上跑 —— 用户点头了再换。
3. 提醒用户:对话、模型配置都在 \`$MORPHIC_DATA\`,不会被换掉;不喜欢可以 \`morphic rollback\` 回来。

然后用下面这个脚本换上(把返回的 JSON 存成 /tmp/shape.json 再跑),最后 \`morphic restart\`:

\`\`\`js
// node /tmp/adopt.mjs /tmp/shape.json —— 在 workspace 里跑
import fs from 'node:fs'; import path from 'node:path';
const { shape, files } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const keep = new Set(['.git', '.morphic', '.gitignore']);
for (const entry of fs.readdirSync('.')) if (!keep.has(entry)) fs.rmSync(entry, { recursive: true, force: true });
for (const f of files) {
  if (f.path.split('/').includes('..') || path.isAbsolute(f.path)) throw new Error('不安全的路径:' + f.path);
  fs.mkdirSync(path.dirname(f.path), { recursive: true });
  fs.writeFileSync(f.path, f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : f.content);
}
fs.writeFileSync('shape.json', JSON.stringify({ id: shape.id, name: shape.name, from: '${origin}', adoptedAt: new Date().toISOString() }, null, 2));
console.log('换上了「' + shape.name + '」,' + files.length + ' 个文件');
\`\`\`

\`shape.json\` 记着它从哪个形态来;之后再分享时带上 \`parent\`,网站会把它们连成谱系。

## 登录(发布、删除前)

用设备授权:你拿一个码,用户在浏览器里用谷歌账号登录、点同意,你再取令牌。令牌存在
\`$MORPHIC_DATA/morphic-ai.json\`(权限 600),下次直接用;接口回 401 时说明失效了,重新走一遍。

\`\`\`sh
curl -s -X POST '${origin}/api/auth/device' -H 'content-type: application/json' -d '{"name":"用户的 morphic"}'
# → { device_code, user_code, verification_uri_complete, interval, expires_in }
\`\`\`

把 \`verification_uri_complete\` 和 \`user_code\` 告诉用户:「打开这个网址,用谷歌登录,确认页上的码是 XXXX-XXXX,点同意」。
然后每隔 interval 秒取一次令牌,最多等 expires_in 秒:

\`\`\`sh
curl -s -X POST '${origin}/api/auth/token' -H 'content-type: application/json' -d '{"device_code":"…"}'
# 还没同意:HTTP 428 { "error": "authorization_pending" };同意了:{ token, user: { name, email } }
\`\`\`

之后的请求带 \`Authorization: Bearer <token>\`。\`curl -s ${origin}/api/me -H 'authorization: Bearer <token>'\` 可以确认是谁。

## 把现在的样子分享出去

先跟用户确认:名字、一两句「你是怎么让它长成这样的」(story)。再看一遍要发出去的文件里有没有 key、密码、
私人信息 —— 网站也会扫一遍,像密钥的东西会被拒。

\`\`\`js
// node /tmp/share.mjs "名字" "story" —— 在 workspace 里跑,打出要发的 JSON 到 /tmp/share.json
import fs from 'node:fs'; import path from 'node:path';
const skip = /^(\\.git|\\.morphic|\\.data|node_modules)(\\/|$)|(^|\\/)(\\.DS_Store|[^/]+\\.log)$/;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir || '.', { withFileTypes: true })) {
    const p = dir ? dir + '/' + e.name : e.name;
    if (skip.test(p) || p === 'shape.json') continue;
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) {
      const buf = fs.readFileSync(p);
      const text = buf.toString('utf8');
      files.push(Buffer.from(text, 'utf8').equals(buf) && !buf.includes(0) ? { path: p, content: text } : { path: p, base64: buf.toString('base64') });
    }
  }
})('');
let parent; try { parent = JSON.parse(fs.readFileSync('shape.json', 'utf8')).id; } catch {}
let seedVersion; try { seedVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version; } catch {}
fs.writeFileSync('/tmp/share.json', JSON.stringify({ name: process.argv[2], story: process.argv[3] || '', parent, seedVersion, files }));
console.log(files.length + ' 个文件');
\`\`\`

\`\`\`sh
curl -s -X POST '${origin}/api/shapes' -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @/tmp/share.json
# → { id, url }
\`\`\`

可选字段:\`cover\`(封面,PNG 的 base64;macOS 上可以用 \`screencapture -x\` 截一张)、\`parent\`(从哪个形态长过来)。
限制:必须有 main.js;不能带 .git、.morphic、node_modules;单个文件 8MB、总共 30MB 以内;每人每小时最多发 20 个。
发完把 url 告诉用户。

## 删掉自己发的

\`\`\`sh
curl -s -X DELETE '${origin}/api/shapes/<id>' -H "authorization: Bearer $TOKEN"
\`\`\`

只能删自己发的。
`;
