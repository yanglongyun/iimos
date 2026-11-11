// 栏之间的分隔条:拖动改宽度,双击回默认。
import { useRef } from 'react';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));

export function PaneDivider({ value, defaultValue, min, max, direction, onChange }: {
    value: number; defaultValue: number; min: number; max: () => number; direction: 1 | -1; onChange: (width: number) => void;
}) {
    const drag = useRef({ active: false, x: 0, width: 0 });
    return (
        <div className="pane-divider" role="separator" aria-orientation="vertical"
            onDoubleClick={() => onChange(clamp(defaultValue, min, max()))}
            onPointerDown={(event) => { drag.current = { active: true, x: event.clientX, width: value }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
            onPointerMove={(event) => { if (drag.current.active) onChange(clamp(drag.current.width + (event.clientX - drag.current.x) * direction, min, max())); }}
            onPointerUp={(event) => { drag.current.active = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
            onLostPointerCapture={() => { drag.current.active = false; }} />
    );
}
