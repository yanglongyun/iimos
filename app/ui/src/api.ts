// 本地服务的接口。令牌在窗口地址的 ?token= 里(由桌面端生成),每个请求都带上。
export const token = new URLSearchParams(location.search).get('token') || '';

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: { 'x-iimos-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
    return data as T;
}

export const eventsUrl = () => `/api/events?token=${encodeURIComponent(token)}`;
