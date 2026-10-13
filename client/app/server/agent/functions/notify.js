// 通知用户:弹一条系统通知(launcher 经桌面壳弹)。通知只是叫一声,话要在对话里说清楚。
export default async function notify(args) {
    const iimos = globalThis.iimos;
    if (!iimos?.notify) throw new Error('没有 launcher(应用是单独跑的),发不了通知');
    if (typeof args.title !== 'string' || !args.title) throw new Error('缺少 title');
    await iimos.notify({ title: args.title, body: args.body || '' });
    return { text: '已通知' };
}
