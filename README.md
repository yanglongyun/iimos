# iimos

[中文](README.zh-CN.md)

**An agent that can fully modify itself — and lives on your own machine, always awake, reachable from your phone.** It ships as a single chat box. The UI, the server, its tools, its own system prompt — all of it is its own source code, and it can rewrite any of it. Ask for something and it changes itself, rather than handing you a separate artifact.

**"Turn yourself into a Windows XP desktop."** Real recording, from the factory state, middle fast-forwarded:

![](docs/xp.gif)

- **Your machine, your data.** The agent, its code and your data live on your Mac (or your own server). No account.
- **Always awake, in your pocket.** It runs scheduled tasks on its own and pings you when something matters. Scan a QR code and your phone gets the same UI — whatever shape it has grown into — through an end-to-end encrypted relay that only ever sees ciphertext.
- **It has hands.** It can see and operate your Mac (screenshots, clicks, typing — only after you tick a box in the menu bar), use your own Chrome through a small extension, and send you notifications.
- **Shapes are shareable.** `iimos share` publishes what yours has become to [shapes.iimos.ai](https://shapes.iimos.ai); `iimos adopt <id>` turns yours into someone else's, keeping the old one on a branch.
- **Bring your own model.** Any endpoint compatible with the OpenAI Responses API: URL, API key, model name.
- **Breaking it is safe.** A snapshot is taken before every boot; if the new code doesn't come up, it rolls back automatically. There's also a recovery page that loads none of the app's code — on the desktop and on your phone.

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
Check my inbox in Chrome every hour and tell me only if something needs me
```

It edits its own code, reloads, and tells you what's new and how to use it. It answers in whatever language you write in.

## Install

**Mac (Apple Silicon):** download the dmg from [Releases](https://github.com/yanglongyun/iimos/releases).
On first launch it asks, in the chat, for your model settings: endpoint URL, API key, model name, context window size.
It keeps running in the menu bar after you close the window. Open the panel (≡, top right) to pair your phone, see scheduled tasks, and see which hands it has.

**Server (always on):** the brain without a window, on any machine that stays up. On first start it prints a QR code; scan it to open the UI on your phone and configure the model.

```bash
docker build -t iimos .
docker run -d --name iimos --restart unless-stopped -v iimos:/data iimos
docker logs iimos
```

Or without Docker: `npm install && npm run serve`. A server has no screen or browser; to lend it your Mac's hands, run `iimos pair --hands` on the server and `iimos hands link <link>` on the Mac.

**Chrome extension (optional):** `npm run build:extension`, then load `extension/dist/iimos-extension` as an unpacked extension and enter the pairing code the agent gives you.

The API key is stored only in a local `config.json` (mode 600) and sent only to the endpoint you entered. A stronger model does noticeably better; everything above ran on DeepSeek V4 Flash.

## How it works

```text
launcher/   The only part of the install that never changes. Finds the workspace → seeds it on first run /
            upgrades it → bookkeeping → loads the app.
            Snapshots before every boot; two failed boots of the same version → roll back to the last good
            one, the broken version is kept on a crashed-* branch.
            Pure Node, shared by the desktop and the server. The `iimos` CLI: status / snapshot / log / diff /
            rollback / reload / restart / add / pair / hands / share / adopt
            Recovery page: loads none of the app's code; rollback, factory reset, a minimal rescue agent.
            remote.js dials out to the relay (no open ports) and tunnels your phone's requests to the app.

shell/      The Mac app (Electron): windows, menu bar, global shortcuts, the local hands.
hands/      Computer use (a small Swift helper: ScreenCaptureKit, CGEvent, accessibility tree),
            the Chrome extension's local host, notifications. Can be lent to a remote brain.
extension/  The Chrome extension.
relay/      Cloudflare Worker + Durable Object at relay.iimos.ai. Forwards AES-256-GCM frames it can't read;
            serves the phone shell page whose Service Worker tunnels the app's UI. Self-hostable.
community/  shapes.iimos.ai: Cloudflare Worker + D1 + R2.
protocol/   Shared formats: pairing keys and frames, the tunnel, shape bundles.

app/        The app as shipped (the seed). Copied into <data dir>/workspace/ (a git repo) on first launch;
            everything the agent changes happens there. Ships as a chat and a small panel:
  main.js   starts the local server → reports ready (with its URL) to the launcher; pure Node, no Electron
  server/   local server, 127.0.0.1 only, token-protected; conversation, event stream, scheduler
  ai/       model calls (Responses streaming, automatic retry)
  agent/    the agent loop; tools shell / read / write / edit / computer / browser / notify / schedule;
            context auto-compacted at 70%; prompt.md is its base system prompt
  ui/       React + TSX; after a change, `iimos reload` compiles with the esbuild the launcher ships
  AGENT.md  notes the agent keeps for its future self
```

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The only contract the app has to honor (see [launcher/CONTRACT.md](launcher/CONTRACT.md)): report ready to the launcher after starting, and keep user data in `$IIMOS_DATA`, not in the workspace. Everything else is fair game.

Data directory (macOS): `~/Library/Application Support/ai.iimos.desktop/`
— `workspace/` (app code, a git repo) · `data/` (conversation, model config, tasks, memory, paired devices; never rolled back) · `launcher/` (ledger, logs).

Recovery: ⌘⌥⇧R (Windows/Linux: Ctrl+Alt+Shift+R), the menu bar, the `--recovery` flag, or "Recovery" on your phone. Stop all computer use: ⌘⇧Esc.

## Run from source

Node 22.5+.

```bash
npm install
npm run app
```

Use a throwaway data directory:

```bash
IIMOS_HOME=/tmp/iimos-dev npm run app
```

```bash
npm test                # launcher seeding / rollback / upgrade, app end-to-end (fake model), shape format
npm run test:relay      # tunnel end-to-end against a relay (cd relay && npx vite dev --port 8799 first)
npm run serve           # server form, in the foreground
npm run build:hands     # compile the computer-use helper (macOS)
npm run build:app       # unsigned build
npm run ship:mac        # sign + notarize + verify
```

## License

[MIT](LICENSE)
