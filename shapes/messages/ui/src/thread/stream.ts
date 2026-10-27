// 事件通道：一条 SSE，只收不发。断开后浏览器自动重连；连上时通知 store，由它重新拉取当前数据。
import type { ChatEvent } from "./events";

let source: EventSource | null = null;

export function startEvents(
  receive: (event: ChatEvent) => void,
  status: (online: boolean) => void,
) {
  if (source) {
    return;
  }
  source = new EventSource("/api/events");
  source.onopen = () => status(true);
  source.onerror = () => status(false);
  source.onmessage = (message) => receive(JSON.parse(message.data) as ChatEvent);
}

export function stopEvents() {
  source?.close();
  source = null;
}
