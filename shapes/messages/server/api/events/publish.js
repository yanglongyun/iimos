// 把一个事件推给所有连接，补上 session_id。前端按 session_id 取用。
export default function publish(context, sessionId, event) {
  const text = `data: ${JSON.stringify({ ...event, session_id: sessionId })}\n\n`;
  for (const res of context.streams) {
    res.write(text);
  }
}
