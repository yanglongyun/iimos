// 发 macOS 版:签名 → 公证 → 装订 → 验。一条命令走完。
//
// **凭据只在第一次要你输一次。** notarytool 把它存进钥匙串,之后所有发版
// 都从那儿取 —— 密码不进环境变量、不进 shell 历史、不进任何脚本参数。
//
// 为什么要这个脚本而不是直接 `npm run release:mac`:
//   · 缺凭据时 electron-builder 只会打一行「skipped macOS notarization」然后
//     照常出包 —— **一个没公证的包和一个公证过的包在产物列表里长得一模一样**,
//     而它在别人机器上打不开。这里改成:没凭据就当场停下来要你补
//   · 发完自己验一遍 spctl。没验的话你只知道「命令跑完了」,
//     不知道「Gatekeeper 认不认」——那两件事不是一回事
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// PROFILE 名沿用 'chatnext':它是钥匙串里已存凭证的名字,改名要重录一遍凭证,零收益
const PROFILE = 'chatnext';
const TEAM_ID = 'DY69LKWHQV';
const APPLE_ID = process.env.SIDER_APPLE_ID || 'woodchange@icloud.com';

const run = (cmd, args, options = {}) =>
    spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...options });

/**
 * App Store Connect API 密钥这条路。
 *
 * **它由团队自己签发,不依赖某个 Apple ID 的成员资格,也不用密码。**
 * Apple ID + app 专用密码那条路要求那个 Apple ID 是团队成员,而这一点
 * 常常卡在邀请没接受、角色不够上 —— 报出来就是一句含糊的 403。
 *
 * 把三样放进 build/appstore.json(已在 .gitignore 里):
 *   { "keyId": "...", "issuerId": "...", "keyFile": "AuthKey_XXXXXXXX.p8" }
 * keyFile 是相对 build/ 的路径。
 */
function apiKeyProfile() {
    const config = join(ROOT, 'build', 'appstore.json');
    if (!existsSync(config)) return false;
    let key;
    try { key = JSON.parse(readFileSync(config, 'utf8')); } catch { return false; }
    const file = resolve(join(ROOT, 'build'), key.keyFile || '');
    if (!key.keyId || !key.issuerId || !existsSync(file)) {
        console.error(`× ${config} 缺 keyId / issuerId,或者 keyFile 指向的文件不在:${file}`);
        return false;
    }
    const stored = run('xcrun', [
        'notarytool', 'store-credentials', PROFILE,
        '--key', file, '--key-id', key.keyId, '--issuer', key.issuerId,
    ]);
    if (stored.status !== 0) return false;
    console.log(`✓ 用 App Store Connect API 密钥存好了凭据(${PROFILE})`);
    return true;
}

/** 钥匙串里有没有那份凭据。有就直接用,没有就想办法存一份。 */
function ensureCredentials() {
    const probe = spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', PROFILE], {
        encoding: 'utf8',
    });
    if (probe.status === 0) {
        console.log(`✓ 钥匙串里已有公证凭据(${PROFILE})`);
        return true;
    }

    // 先试 API 密钥 —— 那条路不用密码,而且不受成员资格影响
    if (apiKeyProfile()) return true;

    console.log(`\n钥匙串里还没有公证凭据。`);
    console.log(`\n**推荐**:App Store Connect API 密钥(不用密码,也不看成员资格)——`);
    console.log(`  appstoreconnect.apple.com → 用户和访问 → 集成 → App Store Connect API`);
    console.log(`  → 团队密钥 → 生成一个 Developer 角色的 → 下载 AuthKey_XXXX.p8`);
    console.log(`  把它放进 build/,再建一个 build/appstore.json:`);
    console.log(`      { "keyId": "…", "issuerId": "…", "keyFile": "AuthKey_XXXX.p8" }`);
    console.log(`  然后重跑这条命令。\n`);
    console.log(`或者走 Apple ID + app 专用密码(要求这个 Apple ID 是 ${TEAM_ID} 的成员):`);
    console.log(`**不带 --password,由 notarytool 自己提示**,所以它不会落进 shell 历史。`);
    console.log(`没有的话去 https://account.apple.com → 登录与安全 → App 专用密码,生成一个。\n`);
    console.log(`  Apple ID:${APPLE_ID}`);
    console.log(`  团队:    ${TEAM_ID}\n`);

    const stored = run('xcrun', [
        'notarytool', 'store-credentials', PROFILE,
        '--apple-id', APPLE_ID,
        '--team-id', TEAM_ID,
    ]);
    if (stored.status !== 0) {
        console.error('\n× 凭据没存上。');
        console.error('  403「Invalid or inaccessible developer team ID」= 这个 Apple ID');
        console.error(`  还不在 ${TEAM_ID} 里(邀请没接受、或者角色不是 Developer / App Manager)。`);
        console.error('  **换密码没用** —— 这一条和密码对不对无关。走上面那条 API 密钥的路。');
        return false;
    }
    return true;
}

if (!ensureCredentials()) process.exit(1);

// 交给 electron-builder:它会签名 → 提交公证 → 等结果 → 装订 → 再打 dmg / zip。
// **顺序要紧**:装订必须发生在打包之前,否则 dmg 和 zip 里那个 app 是没装订的
// **先把旧产物清掉。** electron-builder 看见同名文件存在就跳过重打
// (日志里那行 `skipped archiving reason=Archive file is up to date`)——
// 于是 dmg 是新的、公证过的,zip 还是上一次那个 **adhoc 签名、没装订**的旧货。
// 而 zip 正是自动更新要下发的东西。栽过一次(2026-08-10)。
const distDir = join(ROOT, 'dist');
if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
        if (/\.(dmg|zip|blockmap|yml|exe|7z)$/.test(name)) rmSync(join(distDir, name), { force: true });
    }
    console.log('已清掉上一次的产物 —— 同名文件存在会让 electron-builder 跳过重打');
}

console.log('\n开始:构建 → 签名 → 公证 → 装订(公证通常 2–10 分钟)\n');
const built = run('npm', ['run', 'release:mac'], {
    env: { ...process.env, APPLE_KEYCHAIN_PROFILE: PROFILE },
});
if (built.status !== 0) {
    console.error('\n× 构建或公证失败,上面是原始输出。');
    process.exit(1);
}

// ── 验。**跑完不等于成了。** ──────────────────────────────
const dist = join(ROOT, 'dist');
// 不写死 app 名(写死过 ChatNext.app,改牌后 existsSync 不在,这段验收**静默跳过**——
// 静默跳过的验收比没有验收更糟,它给了一个「验过了」的错觉)
const macDir = join(dist, 'mac-arm64');
const appName = existsSync(macDir) ? readdirSync(macDir).find((name) => name.endsWith('.app')) : '';
const app = appName ? join(macDir, appName) : '';
console.log('\n── 验收 ──────────────────────────────────────\n');

if (!app) {
    console.error('× dist/mac-arm64 里没有 .app —— 构建产物不对,不继续。');
    process.exit(1);
}
{
    const verdict = spawnSync('spctl', ['-a', '-vvv', '-t', 'exec', app], { encoding: 'utf8' });
    const text = `${verdict.stdout || ''}${verdict.stderr || ''}`.trim();
    console.log(text.split('\n').map((line) => `  ${line}`).join('\n'));
    if (!/Notarized Developer ID/.test(text)) {
        console.error('\n× Gatekeeper 还是不认。上面那行 source= 说明卡在哪一步。');
        process.exit(1);
    }
    // 装订票据必须真的在包里 —— 装订失败时 spctl 在**联网**的机器上仍然会过
    // (它会去线上查),而用户断网时就打不开了。这一条只有 stapler 能答
    const ticket = spawnSync('xcrun', ['stapler', 'validate', app], { encoding: 'utf8' });
    console.log(`  stapler: ${ticket.status === 0 ? '票据已装订 ✓' : '**没装订** —— 断网的机器上会打不开'}`);
    if (ticket.status !== 0) process.exit(1);
}

/**
 * DMG 容器自己也要签名 + 公证 + 装订。
 *
 * electron-builder 只管到 .app:它签名、公证、装订那个 app,然后把它装进 dmg。
 * **dmg 本身是裸的** —— `spctl -t open` 会说 no usable signature。
 *
 * 用户路径其实不受影响(挂载后 Gatekeeper 检查的是里面那个 app,实测 accepted),
 * 但 dmg 才是他下载的那个文件,裸着不合适。
 *
 * 顺序不能反:**签名会改变文件内容,原来的公证票据当场作废** ——
 * 所以先签、再公证、最后装订。反过来做,你会得到一个「装订成功」但票据对不上的包。
 */
function sealDmg() {
    const dmg = readdirSync(distDir).find((name) => name.endsWith('.dmg'));
    if (!dmg) return true;
    const path = join(distDir, dmg);
    console.log(`\n  给 ${dmg} 签名 → 公证 → 装订…`);
    const steps = [
        ['codesign', ['--sign', `Developer ID Application: Vidline Inc. (${TEAM_ID})`, '--timestamp', '--force', path]],
        ['xcrun', ['notarytool', 'submit', path, '--keychain-profile', PROFILE, '--wait']],
        ['xcrun', ['stapler', 'staple', path]],
    ];
    for (const [cmd, args] of steps) {
        if (run(cmd, args).status !== 0) {
            console.error(`  × ${cmd} 这一步没过`);
            return false;
        }
    }
    return spawnSync('xcrun', ['stapler', 'validate', path]).status === 0;
}

/**
 * sealDmg 会在 electron-builder 生成 latest-mac.yml **之后**改变 DMG 字节。
 * 不把清单里的哈希和大小同步掉,客户端下载/校验 DMG 时看到的就是签名前那份元数据。
 */
function refreshDmgManifest() {
    const dmg = readdirSync(distDir).find((name) => name.endsWith('.dmg'));
    const manifest = join(distDir, 'latest-mac.yml');
    if (!dmg || !existsSync(manifest)) return false;

    const dmgPath = join(distDir, dmg);
    const sha512 = createHash('sha512').update(readFileSync(dmgPath)).digest('base64');
    const size = statSync(dmgPath).size;
    const escaped = dmg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(\\n  - url: ${escaped}\\n    sha512: )[^\\n]+(\\n    size: )\\d+`);
    const before = readFileSync(manifest, 'utf8');
    const after = before.replace(pattern, `$1${sha512}$2${size}`);
    if (after === before) return false;
    writeFileSync(manifest, after);
    console.log('  latest-mac.yml: DMG 哈希与签名后的文件已同步 ✓');
    return true;
}

/**
 * **验 zip 里那一份,不是 dist/mac-arm64 里那一份。**
 *
 * 自动更新下发的是 zip。上一次就是这么漏的:mac-arm64/ChatNext.app 装订得好好的,
 * 而 zip 里躺着一个上一次构建留下的 adhoc 包 —— 两者在产物列表里长得一模一样,
 * 只有解开来看才知道。
 */
const zip = readdirSync(distDir).find((name) => name.endsWith('-mac.zip'));
if (zip) {
    const temp = mkdtempSync(join(tmpdir(), 'sider-verify-'));
    const extracted = spawnSync('ditto', ['-x', '-k', join(distDir, zip), temp]);
    // 不写死 app 名 —— 写死过 ChatNext.app,改牌子那天验收在这里误报「没装订」
    const appName = extracted.status === 0 ? readdirSync(temp).find((name) => name.endsWith('.app')) : '';
    const inner = appName ? join(temp, appName) : '';
    const ok = Boolean(inner) && existsSync(inner)
        && spawnSync('xcrun', ['stapler', 'validate', inner]).status === 0;
    console.log(`  zip 里那份: ${ok ? '也装订了 ✓' : '**没装订** —— 自动更新会下发一个打不开的包'}`);
    rmSync(temp, { recursive: true, force: true });
    if (!ok) process.exit(1);
}

if (!sealDmg()) {
    console.error('\n× DMG 没封好。');
    process.exit(1);
}
console.log('  dmg 容器: 已签名 + 公证 + 装订 ✓');
if (!refreshDmgManifest()) {
    console.error('\n× latest-mac.yml 里的 DMG 元数据没能更新。');
    process.exit(1);
}

console.log('\n  产物:');
for (const file of readdirSync(dist).filter((n) => /\.(dmg|zip)$/.test(n))) {
    const size = execFileSync('du', ['-h', join(dist, file)], { encoding: 'utf8' }).split('\t')[0];
    console.log(`    ${size.padStart(6)}  ${file}`);
}
console.log('\n✓ 签名 + 公证 + 装订都过了。dmg 给人下载,zip 给自动更新。\n');
