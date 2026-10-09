# iimos

[中文](README.md)

**An AI agent that lives on your computer. It ships with a single chat box; everything else grows out of the conversation.**

Ask for a feature, a panel, a different way of working, and it rewrites itself into that. It can read its own source and change its UI, its server, its tools, even its own system prompt. Once it's done, it *is* the new thing. No two copies of iimos end up alike.

![iimos at factory state: a terminal-style chat prompt](docs/screenshot.png)

- **Everything stays local.** The agent, its code and your data live on your machine. No account, no cloud.
- **Bring your own model.** Any endpoint compatible with the OpenAI Responses API: URL, API key, model name.
- **Breaking it is safe.** A snapshot is taken before every boot; if the new code doesn't come up, it rolls back automatically. There's also a separate recovery window.

## Try it

Open it and type into the prompt:

```text
Add a to-do list on the right
Turn yourself into a vintage instrument panel
Give yourself a tool to read web pages
```

It edits its own code, reloads, and tells you what's new and how to use it. It answers in whatever language you write in.

## Install

macOS (Apple Silicon): download the dmg from [Releases](https://github.com/yanglongyun/iimos/releases).
On first launch it asks, in the chat, for your model settings: endpoint URL, API key, model name, context window size.

The API key is stored only in a local `config.json` (mode 600) and sent only to the endpoint you entered.

## How it works

```text
launcher/   The only part of the install that never changes. Finds the workspace → seeds it on first run /
            upgrades it → bookkeeping → loads the app.
            Snapshots before every boot; two failed boots of the same version → roll back to the last good
            one, the broken version is kept on a crashed-* branch.
            The `iimos` CLI: status / snapshot / log / diff / rollback / reload / restart / add
            Recovery window: loads none of the app's code; rollback, factory reset, a minimal rescue agent.

app/        The app as shipped (the seed). Copied into <data dir>/workspace/ (a git repo) on first launch;
            everything the agent changes happens there. Ships as nothing but a chat:
  desktop/  starts the local server → opens the window → reports ready to the launcher
  server/   local server, 127.0.0.1 only, token-protected; conversation, event stream
  ai/       model calls (Responses streaming, automatic retry)
  agent/    the agent loop; tools shell / read / write / edit; context auto-compacted at 70%;
            prompt.md is its base system prompt
  ui/       React + TSX; after a change, `iimos reload` compiles with the esbuild the launcher ships
  AGENT.md  notes the agent keeps for its future self
```

The only contract the app has to honor (see [launcher/CONTRACT.md](launcher/CONTRACT.md)): report ready to the launcher after starting, and keep user data in `$IIMOS_DATA`, not in the workspace. Everything else is fair game.

Data directory (macOS): `~/Library/Application Support/ai.iimos.desktop/`
— `workspace/` (app code, a git repo) · `data/` (conversation, model config; never rolled back) · `launcher/` (ledger, logs).

Recovery window: ⌘⌥⇧R (Windows/Linux: Ctrl+Alt+Shift+R), or the `--recovery` flag.

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
npm test                # launcher seeding / rollback / upgrade + app end-to-end (fake model)
npm run build:app       # unsigned build
npm run ship:mac        # sign + notarize + verify
```

## License

[MIT](LICENSE)
