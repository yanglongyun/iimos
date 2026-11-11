import { create } from "zustand";
import { api } from "../lib/api";
import { toast } from "../overlay/toast";
import { startEvents, stopEvents } from "./stream";
import type { ChatEvent } from "./events";
import {
  mergeMessages,
  itemText,
  type RawMessage,
  type Row,
  type Compaction,
  type StoredItem,
  type MessageItem,
  type ReasoningItem,
} from "./thread";

export interface Thread {
  id: string;
  title: string;
  preview: string;
  running: boolean;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}
export interface Status {
  version?: string;
  model: string;
  model_ready: boolean;
  workdir: string;
  browser_connected: boolean;
}
interface Page {
  messages: RawMessage[];
  has_more: boolean;
}
interface Opened extends Page {
  running: boolean;
  compactions: Compaction[];
  streaming: { text: string; reasoning: string } | null;
}
interface ThreadState {
  threads: Thread[];
  /** 列表还有更早的未置顶对话没加载。 */
  threadsMore: boolean;
  loadingThreads: boolean;
  /** 置顶组的顺序（会话 ID），由服务端保存。 */
  pinOrder: string[];
  currentId: string;
  status: Status | null;
  messages: RawMessage[];
  compactions: Compaction[];
  notes: Row[];
  expanded: Record<string, boolean>;
  /** 当前会话正在回复。 */
  busy: boolean;
  stopping: boolean;
  /** 本轮最近一次 error 事件的说明，done 时显示。 */
  lastError: string;
  ready: boolean;
  online: boolean;
  loadError: string;
  viewSeq: number;
  generation: number;
  hasMore: boolean;
  loadingOlder: boolean;
}
export const threadTitle = (thread: Thread | undefined) =>
  thread?.title || thread?.preview || "对话";
export const useThread = create<ThreadState>(() => ({
  threads: [],
  threadsMore: false,
  loadingThreads: false,
  pinOrder: [],
  currentId: "",
  status: null,
  messages: [],
  compactions: [],
  notes: [],
  expanded: {},
  busy: false,
  stopping: false,
  lastError: "",
  ready: false,
  online: false,
  loadError: "",
  viewSeq: 0,
  generation: 0,
  hasMore: false,
  loadingOlder: false,
}));
const set = useThread.setState;
const get = useThread.getState;
const url = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

// 列表只由列表接口加载。其他地方只改某一行自己动过的字段，不拿别的接口返回的数据整行替换。
function editThread(id: string, fields: Partial<Thread>) {
  set((state) => ({
    threads: state.threads
      .map((thread) => (thread.id === id ? { ...thread, ...fields } : thread))
      .sort((a, b) => b.updated_at - a.updated_at),
  }));
}
// 事件只带会话 ID，列表里的运行状态、更新时间和预览从事件推出来。
// 流式增量、用量这类事件不改变列表，直接跳过，免得后台会话每秒重排几十次。
function touchThread(event: ChatEvent) {
  const thread = get().threads.find((entry) => entry.id === event.session_id);
  if (!thread) {
    return;
  }
  const running = event.type !== "done";
  let savedAt = 0;
  if ("item" in event && event.item) {
    savedAt = event.created_at;
  }
  if (thread.running === running && !savedAt) {
    return;
  }
  const fields: Partial<Thread> = { running };
  if (savedAt) {
    fields.updated_at = savedAt;
  }
  if (event.type === "message" && event.item?.role === "user" && !thread.preview) {
    fields.preview = itemText(event.item).replace(/\s+/g, " ").slice(0, 60) || "[图片]";
  }
  editThread(thread.id, fields);
}
function dropThread(id: string) {
  set((state) => ({
    threads: state.threads.filter((thread) => thread.id !== id),
    pinOrder: state.pinOrder.filter((entry) => entry !== id),
  }));
}
function noteFor(status: string, error: string): Row[] {
  if (status === "aborted") {
    return [{ key: crypto.randomUUID(), kind: "system", code: "stopped" }];
  }
  if (status === "incomplete") {
    return [
      { key: crypto.randomUUID(), kind: "system", code: "error", content: error || "回复未完成" },
    ];
  }
  return [];
}

// 收到一个完整 item：按数据库 ID 合并。流式行和发送中的用户消息由它接替，保留原来的 key。
function addItem(item: StoredItem, id: number, createdAt: number) {
  set((state) => {
    if (state.messages.some((entry) => entry.id === id)) {
      return {};
    }
    const index = state.messages.findIndex(
      (entry) =>
        (entry.streaming && entry.item.type === item.type) ||
        (entry.sending && item.type === "message" && item.role === "user"),
    );
    const row: RawMessage = { id, item, created_at: createdAt };
    if (index < 0) {
      return { messages: inOrder([...state.messages, row]) };
    }
    const messages = [...state.messages];
    messages[index] = { ...row, key: messages[index].key };
    return { messages: inOrder(messages) };
  });
}
// 已存库的按 ID 排序；还没有 ID 的（流式、发送中）留在最后。
function inOrder(messages: RawMessage[]) {
  const saved = messages.filter((entry) => entry.id > 0).sort((a, b) => a.id - b.id);
  return [...saved, ...messages.filter((entry) => entry.id === 0)];
}
function addDelta(type: "message" | "reasoning", delta: string) {
  set((state) => {
    const index = state.messages.findIndex((entry) => entry.streaming && entry.item.type === type);
    let text = delta;
    if (index >= 0) {
      text = itemText(state.messages[index].item as MessageItem | ReasoningItem) + delta;
    }
    const item = streamingItem(type, text);
    if (index >= 0) {
      const messages = [...state.messages];
      messages[index] = { ...messages[index], item };
      return { messages };
    }
    const row = { id: 0, key: crypto.randomUUID(), item, streaming: true, created_at: Date.now() };
    return { messages: [...state.messages, row] };
  });
}
function streamingItem(type: "message" | "reasoning", text: string): StoredItem {
  if (type === "message") {
    return { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
  }
  return { type: "reasoning", summary: [{ type: "summary_text", text }] };
}

export function receiveEvent(event: ChatEvent) {
  touchThread(event);
  if (event.session_id !== get().currentId) {
    return;
  }
  switch (event.type) {
    case "message":
    case "reasoning":
      if (event.item) {
        addItem(event.item, event.id, event.created_at);
      } else {
        addDelta(event.type, event.delta);
      }
      set({ busy: true });
      return;
    case "function_call":
    case "function_call_output":
      addItem(event.item, event.id, event.created_at);
      return;
    case "compact":
      if (event.status === "started") {
        toast("正在压缩上下文…");
        return;
      }
      set((state) => ({
        compactions: [
          ...state.compactions,
          {
            id: event.id,
            message_id: event.message_id,
            summary: event.summary,
            created_at: event.created_at,
          },
        ],
      }));
      return;
    case "usage":
      // 服务端把 usage 写在这次响应最后存下的那条上，这里同样挂到最后一条已存的消息。
      if (event.usage) {
        const usage = event.usage;
        set((state) => {
          let index = state.messages.length - 1;
          while (index >= 0 && state.messages[index].id === 0) {
            index--;
          }
          if (index < 0) {
            return {};
          }
          const messages = [...state.messages];
          messages[index] = { ...messages[index], usage };
          return { messages };
        });
      }
      return;
    case "retry":
      toast(`请求失败，${event.delayMs / 1000} 秒后重试（${event.attempt}/${event.maxRetries}）`);
      return;
    case "error":
      set({ lastError: event.error });
      return;
    case "done":
      set((state) => ({
        messages: state.messages.filter((entry) => !entry.streaming),
        notes: noteFor(event.status, state.lastError),
        lastError: "",
        busy: false,
        stopping: false,
      }));
      return;
  }
}

export function dispose() {
  stopEvents();
  set((state) => ({
    generation: state.generation + 1,
    online: false,
    ready: false,
    busy: false,
    stopping: false,
  }));
}
function reset() {
  set((state) => ({
    generation: state.generation + 1,
    messages: [],
    compactions: [],
    notes: [],
    expanded: {},
    busy: false,
    stopping: false,
    lastError: "",
    ready: false,
    loadError: "",
    hasMore: false,
    loadingOlder: false,
  }));
}
export async function loadStatus() {
  try {
    set({ status: await api.get<Status>("/api/status") });
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "服务状态加载失败");
    return false;
  }
}
interface ThreadPage {
  sessions: Thread[];
  has_more: boolean;
}
// 第一页：全部置顶对话加最近更新的 50 个。
export async function loadThreads() {
  try {
    const data = await api.get<ThreadPage>("/api/sessions");
    set({
      threads: data.sessions,
      threadsMore: data.has_more,
      pinOrder: data.sessions.filter((thread) => thread.pinned).map((thread) => thread.id),
    });
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "会话列表加载失败");
    return false;
  }
}
// 列表滚到底时接着加载更早的未置顶对话，以已加载的最后一个为起点。
export async function loadMoreThreads() {
  const { threads, threadsMore, loadingThreads } = get();
  const last = threads.filter((thread) => !thread.pinned).at(-1);
  if (!threadsMore || loadingThreads || !last) {
    return;
  }
  set({ loadingThreads: true });
  try {
    const data = await api.get<ThreadPage>(
      `/api/sessions?before=${last.updated_at}&before_id=${encodeURIComponent(last.id)}`,
    );
    set((state) => ({
      threads: [
        ...state.threads,
        ...data.sessions.filter((thread) => !state.threads.some((entry) => entry.id === thread.id)),
      ],
      threadsMore: data.has_more,
    }));
  } catch (error) {
    toast(error instanceof Error ? error.message : "会话列表加载失败");
  } finally {
    set({ loadingThreads: false });
  }
}
export async function init() {
  // 每次连上（包括重连）都重新拉取，补上断线期间错过的事件。
  startEvents(receiveEvent, (online) => {
    set({ online });
    if (online) {
      void loadThreads();
      const currentId = get().currentId;
      if (currentId) {
        void openThread(currentId, true);
      }
    }
  });
  await Promise.all([loadStatus(), loadThreads()]);
}
// 打开对话：一个 GET 拿到消息、压缩记录，以及正在运行时已输出的流式文字。
export async function openThread(id: string, force = false) {
  if (!id || (!force && get().currentId === id && (get().ready || get().busy))) {
    return;
  }
  reset();
  set({ currentId: id });
  const generation = get().generation;
  try {
    const opened = await api.get<Opened>(url(id));
    if (get().generation !== generation) {
      return;
    }
    const streaming: RawMessage[] = [];
    if (opened.streaming?.reasoning) {
      streaming.push({
        id: 0,
        key: crypto.randomUUID(),
        item: streamingItem("reasoning", opened.streaming.reasoning),
        streaming: true,
      });
    }
    if (opened.streaming?.text) {
      streaming.push({
        id: 0,
        key: crypto.randomUUID(),
        item: streamingItem("message", opened.streaming.text),
        streaming: true,
      });
    }
    set((state) => ({
      // 请求期间已经推来的完整 item 按 ID 合并，不会丢也不会重复。
      messages: [
        ...mergeMessages(
          opened.messages,
          state.messages.filter((entry) => entry.id > 0),
        ),
        ...streaming,
      ],
      compactions: opened.compactions,
      hasMore: opened.has_more,
      busy: opened.running,
      ready: true,
      viewSeq: state.viewSeq + 1,
    }));
  } catch (error) {
    if (get().generation === generation) {
      set({ loadError: error instanceof Error ? error.message : "对话加载失败" });
    }
  }
}
export function createDraft() {
  reset();
  set((state) => ({ currentId: "", ready: true, viewSeq: state.viewSeq + 1 }));
}
export async function loadOlder() {
  const { currentId, hasMore, loadingOlder, busy, generation, messages } = get();
  if (!currentId || !hasMore || loadingOlder || busy) {
    return;
  }
  set({ loadingOlder: true });
  try {
    const page = await api.get<Page>(
      `${url(currentId)}/messages?limit=60&before=${messages[0].id}`,
    );
    if (get().generation === generation) {
      set((state) => ({
        messages: mergeMessages(page.messages, state.messages),
        hasMore: page.has_more,
      }));
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : "历史消息加载失败");
  } finally {
    if (get().generation === generation) {
      set({ loadingOlder: false });
    }
  }
}
export function send(
  text: string,
  retryRow: Row | null = null,
  onCreated?: (id: string) => void,
  images: string[] = [],
): boolean {
  const content = text.trim();
  if ((!content && images.length === 0) || get().busy || !get().ready) {
    return false;
  }
  if (images.length > 5) {
    toast("每条消息最多发送 5 张图片");
    return false;
  }
  if (!get().status?.model_ready) {
    toast("请先在设置中配置模型");
    return false;
  }
  const key = retryRow?.key || crypto.randomUUID();
  const item: MessageItem = { type: "message", role: "user", content: [] };
  if (content) {
    item.content.push({ type: "input_text", text: content });
  }
  for (const image of images) {
    item.content.push({ type: "input_image", image_url: image, detail: "auto" });
  }
  const user: RawMessage = { id: 0, key, item, created_at: Date.now(), sending: true };
  set((state) => ({
    messages: [...state.messages.filter((entry) => entry.key !== key), user],
    notes: [],
    busy: true,
    viewSeq: state.viewSeq + 1,
  }));
  void submit(content, images, user, get().generation, onCreated);
  return true;
}
async function submit(
  text: string,
  images: string[],
  user: RawMessage,
  generation: number,
  onCreated?: (id: string) => void,
) {
  let id = get().currentId;
  try {
    if (!id) {
      const session = await api.post<Thread>("/api/sessions");
      if (get().generation !== generation) {
        return;
      }
      id = session.id;
      set((state) => ({ currentId: session.id, threads: [session, ...state.threads] }));
      onCreated?.(id);
    }
    const uploaded: string[] = [];
    for (const image of images) {
      if (image.startsWith("/api/images/")) {
        uploaded.push(image);
      } else {
        const result = await api.post<{ url: string }>(`${url(id)}/images`, { image });
        uploaded.push(result.url);
      }
    }
    if (get().generation !== generation) {
      return;
    }
    const saved = await api.post<{ id: number; created_at: number }>(`${url(id)}/messages`, {
      text,
      images: uploaded,
    });
    if (get().generation === generation) {
      addItem(user.item, saved.id, saved.created_at);
    }
  } catch (error) {
    if (get().generation !== generation) {
      return;
    }
    toast(error instanceof Error ? error.message : "发送失败");
    set((state) => ({
      messages: [
        ...state.messages.filter((entry) => entry.key !== user.key),
        { ...user, sending: false, failed: true },
      ],
      busy: false,
      stopping: false,
    }));
  }
}
export const retrySend = (row: Row, onCreated?: (id: string) => void) =>
  row.failed ? send(row.content || "", row, onCreated, row.images) : false;
// 停止：等服务端真正停下才返回，结束状态由随后的 done 事件更新。
export async function stopRun() {
  const { busy, currentId } = get();
  if (!busy || !currentId) {
    return;
  }
  set({ stopping: true });
  try {
    await api.del(`${url(currentId)}/run`);
  } catch (error) {
    set({ stopping: false });
    toast(error instanceof Error ? error.message : "停止失败");
  }
}
export async function renameThread(id: string, title: string) {
  try {
    await api.patch(url(id), { title });
    editThread(id, { title });
  } catch (error) {
    toast(error instanceof Error ? error.message : "重命名失败");
  }
}
export async function removeThread(id: string) {
  try {
    await api.del(url(id));
    dropThread(id);
    if (get().currentId === id) {
      createDraft();
    }
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败");
    return false;
  }
}
export async function pinThread(id: string, pinned: boolean) {
  try {
    await api.patch(url(id), { pinned });
    editThread(id, { pinned });
    // 新置顶的排在置顶组最前，与服务端一致；取消置顶就移出。
    set((state) => ({
      pinOrder: pinned
        ? [id, ...state.pinOrder.filter((entry) => entry !== id)]
        : state.pinOrder.filter((entry) => entry !== id),
    }));
  } catch (error) {
    toast(error instanceof Error ? error.message : "置顶失败");
  }
}
// 拖拽结束后保存置顶组的完整顺序；失败时以服务端为准重新加载。
export async function reorderPins(ids: string[]) {
  const previous = get().pinOrder;
  set({ pinOrder: ids });
  try {
    await api.put("/api/sessions/pins", { ids });
  } catch (error) {
    set({ pinOrder: previous });
    toast(error instanceof Error ? error.message : "排序保存失败");
    void loadThreads();
  }
}
