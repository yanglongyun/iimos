import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ROOMS = [
  {
    id: "entrance",
    name: "旧城门",
    x: 0,
    y: 1,
    kind: "gate",
    description:
      "铁门在身后缓缓合拢。潮湿的石阶向下延伸，远处有一盏尚未熄灭的灯。带回暮光圣物，然后从这里离开。",
    exits: ["hall"],
  },
  {
    id: "hall",
    name: "回声长廊",
    x: 1,
    y: 1,
    kind: "hall",
    description:
      "脚步声沿着拱顶折返。北侧有兵刃摩擦的声响，东边的地面覆盖着白色碎骨，南侧传来滴水声。",
    exits: ["entrance", "guard", "crypt", "well"],
  },
  {
    id: "guard",
    name: "守卫室",
    x: 1,
    y: 0,
    kind: "enemy",
    description:
      "一名披着锈甲的守卫抬起头。它已经忘记了自己的名字，却仍记得如何挥剑。",
    exits: ["hall", "library"],
    enemy: { name: "锈甲守卫", hp: 12, attack: 4, defense: 10 },
  },
  {
    id: "library",
    name: "无声书库",
    x: 2,
    y: 0,
    kind: "library",
    description:
      "书页已经化成尘土，只有一本铜扣书完好地摆在石桌上。书脊上的月牙，与祭坛石门上的凹槽一致。",
    exits: ["guard", "vault"],
  },
  {
    id: "crypt",
    name: "白骨墓室",
    x: 2,
    y: 1,
    kind: "enemy",
    description:
      "棺盖被从里面推开。白骨骑士举起一把裂开的长剑，眼窝里燃着幽蓝的火。",
    exits: ["hall", "armory", "altar"],
    enemy: { name: "白骨骑士", hp: 16, attack: 5, defense: 11 },
  },
  {
    id: "well",
    name: "熄火营地",
    x: 1,
    y: 2,
    kind: "camp",
    description:
      "一口废井旁留着几段干木柴。这里的风很小，也许能安全地休息片刻。",
    exits: ["hall", "armory"],
  },
  {
    id: "armory",
    name: "遗忘武库",
    x: 2,
    y: 2,
    kind: "armory",
    description:
      "武器架上只剩折断的矛。角落里的一只木箱没有落灰，像是最近才被人放在这里。",
    exits: ["well", "crypt"],
  },
  {
    id: "altar",
    name: "暮光祭坛",
    x: 3,
    y: 1,
    kind: "altar",
    description:
      "紫色的光照亮了整个地下大厅。圣物悬在石台之上，一道带有月牙凹槽的屏障将它隔开。",
    exits: ["crypt", "vault"],
  },
  {
    id: "vault",
    name: "地下宝库",
    x: 3,
    y: 0,
    kind: "enemy",
    description:
      "沉重的锁链横在门前。一尊石像转过脸来，手中的巨斧擦出一串火花。",
    exits: ["library", "altar"],
    enemy: { name: "石像看守", hp: 20, attack: 6, defense: 12 },
  },
];
const roomById = Object.fromEntries(ROOMS.map((room) => [room.id, room]));
const fail = (status, message) => Object.assign(new Error(message), { status });
const die = (sides) => crypto.randomInt(1, sides + 1);

export function createGameStore(data, roll = die) {
  const directory = path.join(data, "dungeon");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "campaign.json");
  function fresh() {
    return {
      id: crypto.randomUUID(),
      turn: 0,
      status: "playing",
      position: "entrance",
      previous: "entrance",
      visited: ["entrance"],
      searched: [],
      rested: false,
      relic: false,
      key: false,
      hero: {
        name: "旅人",
        role: "游侠",
        hp: 24,
        maxHp: 24,
        attack: 3,
        armor: 12,
        gold: 0,
        potions: 2,
      },
      enemies: Object.fromEntries(
        ROOMS.filter((room) => room.enemy).map((room) => [
          room.id,
          { ...room.enemy },
        ]),
      ),
      journal: [
        {
          turn: 0,
          title: "暮光之下",
          text: "你来到废弃的暮光城。传说藏在地下的圣物能让长夜结束。先找到通往祭坛的钥匙，再带着圣物返回旧城门。",
          kind: "story",
        },
      ],
    };
  }
  function save(state) {
    fs.writeFileSync(file + ".tmp", JSON.stringify(state, null, 2));
    fs.renameSync(file + ".tmp", file);
    return view(state);
  }
  function load() {
    if (!fs.existsSync(file)) {
      const state = fresh();
      save(state);
      return state;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  function view(state) {
    const room = roomById[state.position];
    return {
      ...state,
      room,
      enemy:
        state.enemies[state.position]?.hp > 0
          ? state.enemies[state.position]
          : null,
      rooms: ROOMS.map((value) => ({
        id: value.id,
        name: value.name,
        x: value.x,
        y: value.y,
        kind: value.kind,
        exits: value.exits,
        visited: state.visited.includes(value.id),
        reachable: room.exits.includes(value.id),
        enemy:
          state.visited.includes(value.id) && state.enemies[value.id]?.hp > 0,
      })),
    };
  }
  function act(input) {
    const state = load();
    if (input.id !== state.id || input.turn !== state.turn)
      throw fail(409, "冒险状态已更新，请重试。");
    if (input.action === "new") {
      const archive = path.join(directory, "archives");
      fs.mkdirSync(archive, { recursive: true });
      fs.writeFileSync(
        path.join(archive, state.id + ".json"),
        JSON.stringify(state, null, 2),
      );
      return save(fresh());
    }
    if (state.status !== "playing") throw fail(400, "本次冒险已经结束。");
    const room = roomById[state.position];
    const enemy = state.enemies[state.position];
    const fighting = enemy && enemy.hp > 0;
    let title = "",
      text = "",
      result = null;
    function enemyTurn(guard = 0) {
      if (!fighting || enemy.hp <= 0) return;
      const attack = roll(20);
      if (attack >= state.hero.armor + guard) {
        const damage = roll(enemy.attack);
        state.hero.hp = Math.max(0, state.hero.hp - damage);
        text += ` ${enemy.name}反击，掷出 ${attack}，你受到 ${damage} 点伤害。`;
      } else {
        text += ` ${enemy.name}反击掷出 ${attack}，未能击中你。`;
      }
    }
    switch (input.action) {
      case "move": {
        if (fighting) throw fail(400, "先结束战斗，或选择撤退。");
        if (!room.exits.includes(input.target))
          throw fail(400, "这里没有通往该房间的道路。");
        state.previous = state.position;
        state.position = input.target;
        if (!state.visited.includes(input.target))
          state.visited.push(input.target);
        title = roomById[input.target].name;
        text = roomById[input.target].description;
        break;
      }
      case "attack": {
        if (!fighting) throw fail(400, "这里没有敌人。");
        const attack = roll(20);
        result = { die: 20, value: attack, label: "攻击检定" };
        if (attack >= enemy.defense) {
          const damage = roll(6) + state.hero.attack + (attack === 20 ? 6 : 0);
          enemy.hp = Math.max(0, enemy.hp - damage);
          text = `你掷出 ${attack}，${attack === 20 ? "暴击！" : ""}对${enemy.name}造成 ${damage} 点伤害。`;
          if (enemy.hp === 0) {
            const gold = state.position === "vault" ? 24 : 12;
            state.hero.gold += gold;
            text += ` ${enemy.name}倒下了。你获得 ${gold} 枚金币。`;
            if (state.position === "guard") {
              state.hero.attack += 1;
              text += " 你拾起一把精制短剑，攻击加值提升 1。";
            }
          }
        } else {
          text = `你掷出 ${attack}，攻击被${enemy.name}挡开了。`;
        }
        title = "刀刃与回声";
        enemyTurn();
        break;
      }
      case "guard":
        if (!fighting) throw fail(400, "这里不需要防御。");
        title = "稳住阵脚";
        text = "你退到石柱后，防御临时提高 5 点。";
        enemyTurn(5);
        break;
      case "flee": {
        if (!fighting) throw fail(400, "你可以直接前往相邻房间。");
        const value = roll(20);
        result = { die: 20, value, label: "撤退检定" };
        title = "寻找退路";
        if (value >= 8) {
          state.position = state.previous;
          text = `你掷出 ${value}，成功退回${roomById[state.position].name}。`;
        } else {
          text = `你掷出 ${value}，退路被挡住了。`;
          enemyTurn();
        }
        break;
      }
      case "potion":
        if (state.hero.potions < 1) throw fail(400, "恢复药水已经用完。");
        if (state.hero.hp === state.hero.maxHp)
          throw fail(400, "你的生命值已满。");
        state.hero.potions -= 1;
        {
          const hp = state.hero.hp;
          state.hero.hp = Math.min(state.hero.maxHp, hp + 10);
          title = "温暖的药剂";
          text = `你喝下一瓶恢复药水，恢复 ${state.hero.hp - hp} 点生命。`;
          enemyTurn();
        }
        break;
      case "rest":
        if (fighting || room.kind !== "camp")
          throw fail(400, "只能在安全的营地休息。");
        if (state.rested) throw fail(400, "营地的木柴已经用尽。");
        state.rested = true;
        state.hero.hp = state.hero.maxHp;
        title = "短暂的安宁";
        text = "你重新点燃营火。一个时辰后，生命值已全部恢复。";
        break;
      case "search": {
        if (fighting) throw fail(400, "战斗中无法搜寻。");
        if (state.searched.includes(room.id))
          throw fail(400, "这个房间已经搜寻过了。");
        state.searched.push(room.id);
        title = "尘埃中的发现";
        if (room.id === "library") {
          state.key = true;
          text = "铜扣书里没有文字，只有一把月牙钥匙。你将它收入行囊。";
        } else if (room.id === "armory") {
          state.hero.potions += 1;
          state.hero.gold += 8;
          text = "木箱里有一瓶恢复药水和 8 枚金币。";
        } else if (room.id === "vault") {
          state.hero.gold += 30;
          text = "你在石像身后的壁龛中找到 30 枚金币。";
        } else {
          const value = roll(20);
          result = { die: 20, value, label: "搜寻检定" };
          if (value >= 12) {
            state.hero.gold += 4;
            text = `你掷出 ${value}，在石缝中找到 4 枚金币。`;
          } else {
            text = `你掷出 ${value}，没有发现可用的物品。`;
          }
        }
        break;
      }
      case "interact": {
        if (fighting) throw fail(400, "先解决眼前的敌人。");
        if (room.kind === "altar") {
          if (state.relic) throw fail(400, "圣物已经在你的行囊里。");
          if (!state.key)
            throw fail(400, "祭坛的屏障需要月牙钥匙。去书库寻找线索。");
          state.relic = true;
          title = "暮光圣物";
          text =
            "月牙钥匙嵌入凹槽。屏障散去，圣物落在你的掌心。现在，带着它返回旧城门。";
        } else if (room.kind === "gate" && state.relic) {
          state.status = "victory";
          title = "黎明归来";
          text = `你推开旧城门，第一缕晨光落在身上。暮光城的长夜结束了。你带回圣物，获得 ${state.hero.gold} 枚金币，并留下 ${state.turn + 1} 回合的冒险记录。`;
        } else throw fail(400, "这里没有可以交互的物品。");
        break;
      }
      default:
        throw fail(400, "未知的冒险动作。");
    }
    state.turn += 1;
    if (state.hero.hp === 0) {
      state.status = "defeated";
      title = "最后一盏灯";
      text += " 你的火把落在地上。这次冒险结束了，记录会被保留。";
    }
    state.journal.push({
      turn: state.turn,
      title,
      text,
      kind: result ? "roll" : "story",
      ...(result ? { roll: result } : {}),
    });
    return save(state);
  }
  return { get: () => view(load()), act };
}
