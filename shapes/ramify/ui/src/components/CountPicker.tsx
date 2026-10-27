// 一次长几个方案(1–6)。
export function CountPicker({ value, onChange, max = 6 }: { value: number; onChange: (n: number) => void; max?: number }) {
    return (
        <div className="count" title="方案数量">
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                <button type="button" key={n} className={value === n ? 'is-selected' : ''} onClick={() => onChange(n)}>{n}</button>
            ))}
        </div>
    );
}
