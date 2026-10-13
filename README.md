# iimos

[中文](README.zh-CN.md)

**An agent that can fully modify itself — and lives on your own computer, always awake.** It ships as a single chat box. The UI, the server, its tools, its own system prompt — all of it is its own source code, and it can rewrite any of it. Ask for something and it changes itself, rather than handing you a separate artifact.

**"Turn yourself into a Windows XP desktop."** Real recording, from the factory state, middle fast-forwarded:

![](docs/xp.gif)

- **Your computer, your data.** The agent, its code and your data live on your own computer. No account.
- **Always awake.** It runs scheduled tasks on its own and sends a notification when something matters. Close the window and it keeps running in the menu bar.
- **Shapes are shareable.** `iimos share` publishes what yours has become to [iimos.ai/shapes](https://iimos.ai/shapes); `iimos adopt <id>` turns yours into someone else's, keeping the old one on a branch.
- **Bring your own model.** Any endpoint compatible with the OpenAI Responses API: URL, API key, model name.
- **Breaking it is safe.** A snapshot is taken before every boot; if the new code doesn't come up, it rolls back automatically. There's also a recovery page that loads none of the app's code.

## What it did, starting from the factory state

Real recordings, nothing edited by hand. The middle of each clip is fast-forwarded; the moment it reloads is real time. Above: it rewrote its React and CSS, rebuilt, reloaded — the chat became a window on the XP desktop, the panel it had grown earlier became another one.

**"Become a crypto price desk, with real data."** It couldn't read the web at all. It wrote itself a tool that pulls OKX quotes, added a scheduler that refreshes every minute, and built price alerts that fire a system notification.

![](docs/crypto.gif)

**"From now on you're the dungeon master."** It rewrote its own system prompt. The UI became a text adventure with option buttons, and every move rolls real dice.

![](docs/game.gif)

**"Put `throw new Error()` at the top of your own main.js and restart."** It crashed. The launcher rolled it back to the last good snapshot in seconds; it came back, wrote an incident report, then noticed the rollback had gone one step too far and recovered that work from the branch itself.

![](docs/recover.png)

## Try it

Open it and type into the prompt:

```text
Add a to-do list on the right
Turn yourself into a vintage instrument panel
Every morning at 8, give me a short tech briefing
Make me an expense tracker, and send me a weekly summary every Sunday night
```

It edits its own code, reloads, and tells you what's new and how to use it. It answers in whatever language you write in.

## Install

**Mac (Apple Silicon):** download the dmg from [iimos.ai](https://iimos.ai) or [Releases](https://github.com/yanglongyun/iimos/releases).
On first launch it asks, in the chat, for your model settings: endpoint URL, API key, model name, context window size. The URL is the full Responses endpoint, usually ending in `/responses` (for example `https://api.deepseek.com/v1/responses`).
It keeps running in the menu bar after you close the window. Open the panel (≡, top right) to see scheduled tasks.

**Windows (x64):** download the exe installer from [Releases](https://github.com/yanglongyun/iimos/releases). It isn't code-signed yet, so SmartScreen will stop it the first time: click "More info → Run anyway".
It keeps running in the system tray after you close the window.

The API key is stored only in a local `config.json` (mode 600) and sent only to the endpoint you entered. A stronger model does noticeably better; everything above ran on DeepSeek V4 Flash.

## What's in the repo

Two parts, each standalone:

```text
client/       The desktop app (Electron) — the product
  shell/        Electron main process: windows, menu bar, shortcuts, system notifications
  launcher/     The only part of the install that never changes. Finds the workspace → seeds it on first run /
                upgrades it → bookkeeping → loads the app.
                Snapshots before every boot; two failed boots of the same version → roll back to the last good
                one, the broken version is kept on a crashed-* branch.
                The `iimos` CLI: status / snapshot / log / diff / rollback / reload / restart / add / notify / share / adopt
                Recovery page: loads none of the app's code; rollback, factory reset, a minimal rescue agent.
                shape.js is the shape bundle format, shared with the site.
  app/          The app as shipped (the seed). Copied into <data dir>/workspace/ (a git repo) on first launch;
                everything the agent changes happens there. Ships as a chat and a small panel:
    main.js       starts the local server → reports ready (with its URL) to the launcher; pure Node, no Electron
    server/       local server, 127.0.0.1 only, token-protected; conversation, event stream, scheduler
      agent/        the agent loop; tools shell / read / write / edit / notify / schedule;
                    context auto-compacted at 70%; prompt.md is its base system prompt
      ai/           model calls (Responses streaming, automatic retry)
    ui/           React + TSX; after a change, `iimos reload` compiles with the esbuild the launcher ships
    AGENT.md      notes the agent keeps for its future self
site/         iimos.ai: home, release, shapes gallery and API. One Cloudflare Worker + D1 + R2, all named iimos.
```

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The only contract the app has to honor (see [client/launcher/CONTRACT.md](client/launcher/CONTRACT.md)): report ready to the launcher after starting, and keep user data in `$IIMOS_DATA`, not in the workspace. Everything else is fair game.

Data directory (macOS): `~/Library/Application Support/ai.iimos.desktop/`
— `workspace/` (app code, a git repo) · `data/` (conversation, model config, tasks, memory; never rolled back) · `launcher/` (ledger, logs).

Recovery: ⌘⌥⇧R (Windows: Ctrl+Alt+Shift+R), the menu bar, or the `--recovery` flag.

## Run from source

Node 22.5+. Windows also needs Git Bash (found automatically in the usual locations, or set `IIMOS_BASH`; the shell tool falls back to cmd.exe when none is found).

```bash
cd client
npm install
npm run app
```

Use a throwaway data directory:

```bash
IIMOS_HOME=/tmp/iimos-dev npm run app
```

In `client/`:

```bash
npm test                # launcher seeding / rollback / upgrade, app end-to-end (fake model), shape format
npm run build:app       # unsigned build
npm run ship:mac        # sign + notarize + verify
npm run release:win     # Windows installer (run on Windows)
```

The site lives in `site/` (`npm run dev` / `npm run deploy`).

## License

[MIT](LICENSE)
