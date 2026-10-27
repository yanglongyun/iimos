// tidy 横向树布局(纯函数):父节点垂直居中于子树,x 按层级推进。移植自独立版 ramify。
import type { Id, TreeNode } from '../types';

export type Pos = { x: number; y: number; w: number; h: number };

// 必须与 style.css 里节点的固定尺寸一致
export const VARIANT_SIZE: [number, number] = [188, 202];
export const ROOT_SIZE: [number, number] = [244, 54];
const GAP_X = 120;
const GAP_Y = 28;

export function sizeOf(n: TreeNode): [number, number] {
    return n.type === 'text' ? ROOT_SIZE : VARIANT_SIZE;
}

export function layoutTree(nodes: TreeNode[]): Map<Id, Pos> {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<Id, Id[]>();
    let rootId: Id | null = null;
    for (const n of nodes) {
        if (n.parent_id === null) rootId = n.id;
        else {
            if (!children.has(n.parent_id)) children.set(n.parent_id, []);
            children.get(n.parent_id)!.push(n.id);
        }
    }
    for (const list of children.values()) list.sort((a, b) => byId.get(a)!.position - byId.get(b)!.position);
    const pos = new Map<Id, Pos>();
    if (!rootId) return pos;
    const kids = (id: Id) => children.get(id) ?? [];

    function subH(id: Id): number {
        const h = sizeOf(byId.get(id)!)[1];
        const ks = kids(id);
        if (!ks.length) return h + GAP_Y;
        let s = 0;
        for (const k of ks) s += subH(k);
        return Math.max(h + GAP_Y, s);
    }

    function place(id: Id, cx: number, top: number) {
        const [w, h] = sizeOf(byId.get(id)!);
        const total = subH(id);
        pos.set(id, { x: cx, y: top + total / 2, w, h });
        let cy = top;
        for (const k of kids(id)) {
            const kw = sizeOf(byId.get(k)!)[0];
            place(k, cx + w / 2 + GAP_X + kw / 2, cy);
            cy += subH(k);
        }
    }

    place(rootId, 0, -subH(rootId) / 2);
    return pos;
}

export function boundsOf(pos: Map<Id, Pos>) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    pos.forEach((p) => {
        x1 = Math.min(x1, p.x - p.w / 2); y1 = Math.min(y1, p.y - p.h / 2);
        x2 = Math.max(x2, p.x + p.w / 2); y2 = Math.max(y2, p.y + p.h / 2);
    });
    if (!isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return { x1, y1, x2, y2 };
}

export function edgePath(p: Pos, c: Pos): string {
    const x1 = p.x + p.w / 2, y1 = p.y;
    const x2 = c.x - c.w / 2, y2 = c.y;
    const mx = (x2 - x1) * 0.55;
    return `M ${x1} ${y1} C ${x1 + mx} ${y1}, ${x2 - mx} ${y2}, ${x2} ${y2}`;
}
