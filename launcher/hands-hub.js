// 手的总线。本机的手(桌面宿主里)、经中继连进来的手(另一台电脑),对应用只露一个接口:
//
//   iimos.hands.list()                 [{ id, name, remote, tools: ['computer', 'browser', 'notify'] }]
//   await iimos.hands.call(tool, args) 找一只有这个工具的手去做;本机的手优先
//
// 一只手 = { id, name, tools, call(tool, args) → Promise }。
export function createHandsHub({ log }) {
    const hands = new Map();

    function pick(tool, prefer) {
        if (prefer) {
            const hand = hands.get(prefer);
            if (!hand) throw new Error(`没有这只手:${prefer}`);
            return hand;
        }
        const all = [...hands.values()].filter((h) => h.tools.includes(tool));
        return all.find((h) => !h.remote) || all[0] || null;
    }

    const api = {
        list: () => [...hands.values()].map(({ id, name, tools, remote }) => ({ id, name, tools, remote: Boolean(remote) })),
        async call(tool, args = {}, { hand: prefer } = {}) {
            const hand = pick(tool, prefer);
            if (!hand) {
                const reason = hands.size
                    ? `连着的手都不会「${tool}」(有:${[...new Set([...hands.values()].flatMap((h) => h.tools))].join('、') || '无'})`
                    : '这里没有手 —— 服务器上没有屏幕和浏览器。在电脑上装 iimos,用 iimos hands link 连到这里,就能借那台电脑的手';
                throw new Error(reason);
            }
            return hand.call(tool, args);
        },
    };

    return {
        api,
        /** 挂上一只手,返回摘下它的函数。 */
        attach(hand) {
            hands.set(hand.id, hand);
            log?.(`手连上了:${hand.name}(${hand.tools.join('、')})`);
            return () => {
                if (hands.get(hand.id) === hand) {
                    hands.delete(hand.id);
                    log?.(`手断开了:${hand.name}`);
                }
            };
        },
        async stop() {
            for (const hand of hands.values()) await hand.stop?.();
            hands.clear();
        },
    };
}
