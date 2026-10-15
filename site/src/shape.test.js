// 形态格式:打包解包、路径安全、密钥扫描。launcher 和社区站共用这一份。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64, decodeShape, encodeShape, safePath, scanSecrets, validateShape } from './shape.js';

const file = (path, text) => ({ path, data: base64.encode(new TextEncoder().encode(text)) });
const shape = (files, extra = {}) => ({ format: 'morphic-shape/1', name: '测试', files, ...extra });

test('打包再解开,内容一字不差', async () => {
    const original = shape([file('main.js', 'console.log(1)'), file('ui/index.html', '<p>你好</p>')], { story: '长成这样', lineage: [{ id: 'abc12345', name: '祖先' }] });
    const back = await decodeShape(await encodeShape(original));
    assert.equal(back.name, '测试');
    assert.equal(back.story, '长成这样');
    assert.deepEqual(back.lineage, [{ id: 'abc12345', name: '祖先' }]);
    assert.equal(new TextDecoder().decode(base64.decode(back.files[1].data)), '<p>你好</p>');
});

test('路径:不许越出 workspace,不许带版本库、依赖、launcher 记录', () => {
    for (const bad of ['../x', '/etc/passwd', 'a/../../x', '.git/config', '.morphic/state.json', 'node_modules/a.js', 'a\\b', 'x/.DS_Store', '']) assert.equal(safePath(bad), false, bad);
    for (const good of ['main.js', 'ui/src/App.tsx', '.gitignore']) assert.equal(safePath(good), true, good);
    assert.throws(() => validateShape(shape([file('main.js', ''), file('../evil.js', '')])), /不允许的路径/);
    assert.throws(() => validateShape(shape([file('ui/a.js', '')])), /没有 main\.js/);
    assert.throws(() => validateShape({ ...shape([file('main.js', '')]), format: 'x' }), /不认识/);
});

test('坏文件给人看得懂的错', async () => {
    await assert.rejects(decodeShape(new Uint8Array([1, 2, 3])), /坏了/);
});

test('密钥扫描:sk-、私钥、写死的密码都拦下;正常代码不误报', () => {
    const hits = scanSecrets([
        file('a.js', "const k = 'sk-abcdefghijklmnopqrstuvwxyz123456';"),
        file('b.pem', '-----BEGIN RSA PRIVATE KEY-----\nxx'),
        file('c.json', '{ "apiKey": "abcd1234efgh5678ijkl" }'),
        file('ok.js', "const apiKey = readConfig(data).apiKey; // 从 $MORPHIC_DATA 读"),
    ]);
    assert.deepEqual(hits.map((h) => h.path), ['a.js', 'b.pem', 'c.json']);
});
