// 发 macOS 版:签名 → 公证 → 装订 → 验。一条命令走完。
//
// 签名和公证用 Chuan Zhi 这个团队(92696T726U)。
// **凭据只在第一次要你输一次。** notarytool 把它存进钥匙串,之后所有发版都从那儿取 ——
// 密码不进环境变量、不进 shell 历史、不进任何脚本参数。
//
// 为什么要这个脚本而不是直接 `npm run release:mac`:
//   · 缺凭据时 electron-builder 只会打一行「skipped macOS notarization」然后照常出包 ——
//     一个没公证的包和一个公证过的包在产物列表里长得一模一样,而它在别人机器上打不开。
//     这里改成:没凭据就当场停下来要你补
//   · 发完自己验一遍 spctl 和 stapler。「命令跑完了」和「Gatekeeper 认」不是一回事
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = 'iimos-chuanzhi';
const TEAM_ID = '92696T726U';
const IDENTITY = `Developer ID Application: Chuan Zhi (Chengdu) Information Technology Co., Ltd. (${TEAM_ID})`;
const APPLE_ID = process.env.IIMOS_APPLE_ID || 'woodchange@icloud.com';

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...options });

/**
 * App Store Connect API 密钥这条路:由团队自己签发,不依赖某个 Apple ID 的成员资格,也不用密码。
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
    const stored = run('xcrun', ['notarytool', 'store-credentials', PROFILE, '--key', file, '--key-id', key.keyId, '--issuer', key.issuerId]);
    if (stored.status !== 0) return false;
    console.log(`✓ 用 App Store Connect API 密钥存好了凭据(${PROFILE})`);
    return true;
}

/** 钥匙串里有没有那份凭据。有就直接用,没有就想办法存一份。 */
function ensureCredentials() {
    const probe = spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', PROFILE], { encoding: 'utf8' });
    if (probe.status === 0) {
        console.log(`✓ 钥匙串里已有公证凭据(${PROFILE})`);
        return true;
    }
    if (apiKeyProfile()) return true;

    console.log(`\n钥匙串里还没有 ${TEAM_ID} 的公证凭据。两条路任选:\n`);
    console.log(`A. App Store Connect API 密钥(不用密码,也不看成员资格):`);
    console.log(`   appstoreconnect.apple.com → 用户和访问 → 集成 → App Store Connect API`);
    console.log(`   → 团队密钥 → 生成一个 Developer 角色的 → 下载 AuthKey_XXXX.p8`);
    console.log(`   放进 build/,再建 build/appstore.json:{ "keyId": "…", "issuerId": "…", "keyFile": "AuthKey_XXXX.p8" }`);
    console.log(`   然后重跑这条命令。\n`);
    console.log(`B. Apple ID + app 专用密码(要求 ${APPLE_ID} 是 ${TEAM_ID} 的成员)。`);
    console.log(`   下面会提示输密码,不带 --password,所以它不会落进 shell 历史。`);
    console.log(`   没有的话去 https://account.apple.com → 登录与安全 → App 专用密码,生成一个。\n`);

    const stored = run('xcrun', ['notarytool', 'store-credentials', PROFILE, '--apple-id', APPLE_ID, '--team-id', TEAM_ID]);
    if (stored.status !== 0) {
        console.error('\n× 凭据没存上。');
        console.error(`  403「Invalid or inaccessible developer team ID」= 这个 Apple ID 还不在 ${TEAM_ID} 里`);
        console.error('  (邀请没接受、或者角色不够)。换密码没用,走 A 那条路。');
        return false;
    }
    return true;
}

if (!ensureCredentials()) process.exit(1);

// 先把旧产物清掉:electron-builder 看见同名文件存在就跳过重打,你会拿到上一次那个包
const distDir = join(ROOT, 'dist');
if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
        if (/\.(dmg|zip|blockmap|yml)$/.test(name)) rmSync(join(distDir, name), { force: true });
    }
}

console.log('\n开始:构建 → 签名 → 公证 → 装订(公证通常 2–10 分钟)\n');
const built = run('npm', ['run', 'release:mac'], { env: { ...process.env, APPLE_KEYCHAIN_PROFILE: PROFILE } });
if (built.status !== 0) {
    console.error('\n× 构建或公证失败,上面是原始输出。');
    process.exit(1);
}

// ── 验。跑完不等于成了。 ──────────────────────────────
console.log('\n── 验收 ──────────────────────────────────────\n');
const macDir = join(distDir, 'mac-arm64');
const appName = existsSync(macDir) ? readdirSync(macDir).find((name) => name.endsWith('.app')) : '';
if (!appName) {
    console.error('× dist/mac-arm64 里没有 .app —— 构建产物不对,不继续。');
    process.exit(1);
}
const app = join(macDir, appName);
{
    const verdict = spawnSync('spctl', ['-a', '-vvv', '-t', 'exec', app], { encoding: 'utf8' });
    const text = `${verdict.stdout || ''}${verdict.stderr || ''}`.trim();
    console.log(text.split('\n').map((line) => `  ${line}`).join('\n'));
    if (!/Notarized Developer ID/.test(text)) {
        console.error('\n× Gatekeeper 还是不认。上面那行 source= 说明卡在哪一步。');
        process.exit(1);
    }
    // 装订票据必须真的在包里:没装订时联网的机器上 spctl 照样过(它去线上查),用户断网就打不开了
    const ticket = spawnSync('xcrun', ['stapler', 'validate', app]);
    console.log(`  stapler: ${ticket.status === 0 ? '票据已装订 ✓' : '**没装订** —— 断网的机器上会打不开'}`);
    if (ticket.status !== 0) process.exit(1);
}

/**
 * DMG 容器自己也要签名 + 公证 + 装订。electron-builder 只管到 .app,dmg 本身是裸的。
 * 顺序不能反:签名会改变文件内容,原来的公证票据当场作废 —— 先签、再公证、最后装订。
 */
const dmg = readdirSync(distDir).find((name) => name.endsWith('.dmg'));
if (!dmg) {
    console.error('× 没有 dmg。');
    process.exit(1);
}
const dmgPath = join(distDir, dmg);
console.log(`\n  给 ${dmg} 签名 → 公证 → 装订…`);
for (const [cmd, args] of [
    ['codesign', ['--sign', IDENTITY, '--timestamp', '--force', dmgPath]],
    ['xcrun', ['notarytool', 'submit', dmgPath, '--keychain-profile', PROFILE, '--wait']],
    ['xcrun', ['stapler', 'staple', dmgPath]],
]) {
    if (run(cmd, args).status !== 0) {
        console.error(`  × ${cmd} 这一步没过`);
        process.exit(1);
    }
}
if (spawnSync('xcrun', ['stapler', 'validate', dmgPath]).status !== 0) {
    console.error('  × dmg 的票据没装订上');
    process.exit(1);
}
console.log('  dmg 容器: 已签名 + 公证 + 装订 ✓');

const size = execFileSync('du', ['-h', dmgPath], { encoding: 'utf8' }).split('\t')[0];
console.log(`\n✓ 签名 + 公证 + 装订都过了:${size.trim()}  dist/${dmg}\n`);
