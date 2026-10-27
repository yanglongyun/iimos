import { randomUUID } from "node:crypto";
import { body, json } from "../http.js";

export default async function post(req, res, context) {
  await body(req, []);
  const id = randomUUID();
  const title = "";
  const now = Date.now();
  context.db
    .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, title, now, now);
  const session = {
    id,
    title,
    created_at: now,
    updated_at: now,
    pin: null,
    preview: "",
    pinned: false,
    running: false,
  };
  return json(res, 201, session);
}
