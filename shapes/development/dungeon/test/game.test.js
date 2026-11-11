import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createGameStore } from "../server/game.js";
import runTool from "../server/agent/runner.js";
function setup(t, roll = (sides) => sides) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dungeon-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const game = createGameStore(data, roll);
  let state = game.get();
  const act = (action, target) =>
    (state = game.act({ id: state.id, turn: state.turn, action, target }));
  return {
    data,
    game,
    act,
    get state() {
      return state;
    },
  };
}

test("移动只沿相邻道路；旧回合动作被拒绝，重新打开保留当前冒险", (t) => {
  const run = setup(t);
  const old = run.state;
  assert.throws(() => run.act("move", "altar"), { status: 400 });
  run.act("move", "hall");
  assert.throws(
    () => run.game.act({ id: old.id, turn: old.turn, action: "search" }),
    { status: 409 },
  );
  assert.equal(createGameStore(run.data).get().position, "hall");
  assert.equal(run.state.turn, 1);
});
test("完成完整冒险：战斗、书库钥匙、祭坛圣物与返回城门", (t) => {
  const run = setup(t);
  run.act("move", "hall");
  run.act("move", "guard");
  assert.throws(() => run.act("move", "library"), { status: 400 });
  run.act("attack");
  assert.equal(run.state.enemy, null);
  assert.equal(run.state.hero.attack, 4);
  run.act("move", "library");
  run.act("search");
  assert.equal(run.state.key, true);
  run.act("move", "vault");
  run.act("attack");
  run.act("potion");
  run.act("attack");
  assert.equal(run.state.enemy, null);
  run.act("move", "altar");
  run.act("interact");
  assert.equal(run.state.relic, true);
  run.act("move", "crypt");
  run.act("attack");
  run.act("move", "hall");
  run.act("move", "entrance");
  run.act("interact");
  assert.equal(run.state.status, "victory");
  assert.ok(run.state.journal.some((entry) => entry.roll?.value === 20));
  assert.equal(run.state.journal.length, run.state.turn + 1);
});
test("失败、空药瓶、重复搜索和重新开局的归档都由同一状态源处理", (t) => {
  const run = setup(t, (sides) => (sides === 20 ? 1 : 1));
  run.act("search");
  assert.throws(() => run.act("search"), { status: 400 });
  assert.throws(() => run.act("potion"), { status: 400 });
  const id = run.state.id;
  run.act("new");
  assert.notEqual(run.state.id, id);
  assert.equal(run.state.turn, 0);
  assert.ok(
    fs.existsSync(path.join(run.data, "dungeon/archives", id + ".json")),
  );
});
test("模型 game 工具读取与界面相同的持久化状态", async (t) => {
  const run = setup(t);
  run.act("move", "hall");
  const result = await runTool(
    { name: "game", arguments: JSON.stringify({ action: "inspect" }) },
    { data: run.data },
    new AbortController().signal,
  );
  assert.equal(JSON.parse(result.text).position, "hall");
  assert.equal(JSON.parse(result.text).turn, 1);
});
test("生命耗尽会结束冒险，不能在失败后继续执行战斗动作", (t) => {
  let rollNumber = 0;
  const run = setup(t, (sides) =>
    sides === 20 ? (++rollNumber % 2 ? 1 : 20) : sides,
  );
  run.act("move", "hall");
  run.act("move", "guard");
  for (let count = 0; count < 6; count++) run.act("attack");
  assert.equal(run.state.hero.hp, 0);
  assert.equal(run.state.status, "defeated");
  assert.throws(() => run.act("attack"), { status: 400 });
});
