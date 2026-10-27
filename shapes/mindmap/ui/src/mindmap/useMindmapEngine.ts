// 把参考的 DOM/SVG 画布引擎接进 React。引擎管节点和交互;这里只给挂载点、同步选中和缩放。
import { useCallback, useEffect, useRef, useState } from 'react';

import { saveAdapter } from './adapter';
import { createMindmap } from './engine';
import type { MindmapEngine, Topic } from './types';

export function useMindmapEngine(projectId: string, topics: Topic[] | null, onError: (message: string) => void, onSelection: (id: string | null) => void, enabled = true) {
    const viewport = useRef<HTMLDivElement>(null);
    const world = useRef<HTMLDivElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    const engine = useRef<MindmapEngine | null>(null);
    const topicsRef = useRef(topics);
    topicsRef.current = topics;
    const errorRef = useRef(onError);
    errorRef.current = onError;
    const selectionRef = useRef(onSelection);
    selectionRef.current = onSelection;

    const [selected, setSelected] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [count, setCount] = useState(0);

    const notify = useCallback((message: string) => errorRef.current(message), []);
    const select = useCallback((id: string | null) => { setSelected(id); selectionRef.current(id); }, []);

    useEffect(() => {
        if (!enabled || !topicsRef.current?.length || !viewport.current || !world.current || !svg.current) return undefined;
        const initial = topicsRef.current;
        engine.current = createMindmap({
            viewport: viewport.current,
            world: world.current,
            svg: svg.current,
            topics: initial,
            save: saveAdapter(projectId),
            ui: { onSelection: select, onZoom: setZoom, onCount: setCount, onError: notify },
        });
        setSelected(initial.find((topic) => !topic.parent_id)?.id ?? null);
        return () => { engine.current?.destroy(); engine.current = null; };
    }, [projectId, enabled, notify, select]);

    // agent 或对话改了数据:原地替换,不重建画布,保留缩放和选中。
    useEffect(() => { if (topics) engine.current?.setTopics(topics); }, [topics]);

    return {
        refs: { viewport, world, svg },
        engine,
        selected,
        zoom,
        count,
        /** 没选中主题时改结构按钮不可点;根主题不能删。 */
        canRemove: selected !== null && Boolean(engine.current?.canRemove(selected)),
    };
}
