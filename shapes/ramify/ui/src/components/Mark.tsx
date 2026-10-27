// 品牌标志:一根主干长出三枚创意果实。
export function Mark({ size = 22 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 18V9M10 9C10 5 7 3 3 3M10 11C10 7 13 5 17 5M10 13C10 10 8 8.5 5 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="3" cy="3" r="1.7" fill="#d95b57" />
            <circle cx="17" cy="5" r="1.7" fill="#d95b57" />
            <circle cx="5" cy="8.5" r="1.5" fill="#eec16f" />
        </svg>
    );
}

export function BranchIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 20v-6M12 14c0-4 3-6 7-6M12 14c0-3-2-5-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}
