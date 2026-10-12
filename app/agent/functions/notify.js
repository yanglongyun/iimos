// 通知用户:电脑上弹系统通知(有能弹通知的手时),配对过、开了通知的手机收到推送。
// 推送不带内容(中继看不到),用户点开就是这个应用,看对话里你说了什么 —— 所以通知的同时把话在对话里说清楚。
export default async function notify(args) {
    const iimos = globalThis.iimos;
    if (!iimos) throw new Error('没有 launcher(应用是单独跑的),发不了通知');
    if (typeof args.title !== 'string' || !args.title) throw new Error('缺少 title');
    const sent = [];
    if (iimos.hands?.list().some((hand) => hand.tools.includes('notify'))) {
        try { await iimos.hands.call('notify', { title: args.title, body: args.body || '' }); sent.push('电脑'); } catch { /* 没弹出来不算失败 */ }
    }
    if (args.phone !== false && iimos.remote?.status().connected) {
        if (await iimos.remote.push({ title: args.title })) sent.push('手机');
    }
    if (!sent.length) throw new Error('没有能收通知的地方:电脑通知不可用,也没有连着的手机');
    return { text: `已通知(${sent.join('、')})` };
}
