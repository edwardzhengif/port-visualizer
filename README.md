# port-visualizer

**English** · [中文](https://github.com/edwardzhengif/port-visualizer/blob/main/README.zh.md)

[![CI](https://github.com/edwardzhengif/port-visualizer/actions/workflows/ci.yml/badge.svg)](https://github.com/edwardzhengif/port-visualizer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/port-visualizer)](https://www.npmjs.com/package/port-visualizer)
[![license](https://img.shields.io/npm/l/port-visualizer)](https://github.com/edwardzhengif/port-visualizer/blob/main/LICENSE)

See who's holding a port on your machine — and kill it safely.

```bash
npx port-visualizer
```

Your browser opens automatically. No install, no config, no account.

The UI is in English by default and switches to Chinese automatically if that is your browser language. There is a toggle in the top right either way.



![port-visualizer](https://raw.githubusercontent.com/edwardzhengif/port-visualizer/main/docs/screenshot.png)


---

## The problem

`lsof -i :3000` tells you the PID is `48213` and the process is called `node`. And then what?

What you actually want to know is three things: **what is this, what breaks if I kill it, and why should I believe you.** The command line answers none of them. Neither does Activity Monitor.

So every port comes with an explanation:

```
5432  PostgreSQL database server
      If killed: all connections drop and in-flight transactions roll back.
                 SIGTERM is safe (equivalent to pg_ctl stop); SIGKILL may
                 require recovery on next startup.
      Because:   process name match · default port 5432 · up 9 days
```

The reasoning is laid out for you to check. You don't have to trust the tool's conclusion.

## How to use it — the case you actually hit

You run `npm run dev` and the terminal says
`Error: listen EADDRINUSE: address already in use :::3000`.

```bash
npx port-visualizer
```

1. The browser opens. **Type `3000` in the search box** (or press `/` to focus it).
2. The card tells you what is holding it. Say it reads
   "Vite dev server · node · PID 48213 · you · up 2 hours" — that is the other
   project you forgot to close this morning.
3. Click **Details** and read the "If killed" line: *just start it again; your
   source files are untouched.*
4. Click **Kill**. The confirmation restates the identity and the consequence.
5. Back to the terminal, run `npm run dev` again.

If step 2 had shown **PostgreSQL** instead, "If killed" would read *in-flight
transactions roll back* — at which point you know to change your port rather than
kill it. **That distinction is the entire reason this tool exists.**

### Other things people do with it

| You want to | Do this |
|---|---|
| Find which port the thing I just started landed on | Switch back to the browser, look for the **just appeared** marker |
| See what colleagues on my network can reach | Click **Exposed** in the facet bar |
| See only my own stuff | **My processes** in the toolbar (the default) |
| Tell three identical `node` processes apart | Search matches the **full command line** — search for `vite` or a project name |
| Keep my hands on the keyboard | Console at the bottom: `kill 3000`, `port 5432`, `exposed`, `help` |
| Demo or pair without fat-fingering a kill | `npx port-visualizer --readonly` disables every kill button |

Shortcuts: `/` focus search, `r` refresh, `?` field descriptions.

## Why not Activity Monitor

Activity Monitor does everything — except it **doesn't list listening ports at all**. This tool does one thing, which lets it do what Activity Monitor can't:

- **"Just appeared" markers** — you ran `npm run dev`; which port did it land on? Switch back to the browser and it's flagged.
- **Disappearance alerts** — a service dying quietly is the hardest failure to notice. This one says something.
- **Exposure facet** — which ports are bound to `0.0.0.0` so anyone on your Wi-Fi can reach them? One click.
- **Consequences before you kill** — not a dialog that just says "Are you sure you want to force quit?"

## Security design

This tool can kill processes, so every boundary is deliberate:

| Constraint | Why |
|---|---|
| Binds `127.0.0.1` only | Binding externally hands process-killing power to your whole subnet |
| CSRF token + Host check on every request | Otherwise any web page could drive this API through your browser |
| Two-layer hard block on critical system processes | Frontend disabling is a hint; the server validates independently |
| Re-verifies process identity by PID before killing | Guards against TOCTOU — the PID may have been recycled since you confirmed |
| Never self-escalates privileges | A daemon that can kill anything as root is a bigger risk than the convenience it buys |
| Never runs a concatenated shell string | Everything goes through `execFile`; no shell involved |

Processes owned by other accounts (most macOS system services) are view-only. The UI explains why and hands you a copy-pasteable `sudo kill` command.

### You may not see other accounts' processes at all

**On macOS and Linux, a non-root process can usually only enumerate its own.** This is the OS,
not this tool: `mDNSResponder` is running and holding UDP 5353, yet `lsof` without `sudo`
returns nothing for it.

So on those machines the "All processes" filter shows exactly what "My processes" shows.
The UI says so out loud, rather than letting you conclude that your computer really only
runs processes you own.

To see everything:

```bash
sudo port-visualizer --readonly
```

**The `--readonly` is deliberate, not a suggestion.** Running a long-lived HTTP service as root
that can terminate any process is precisely what this project's threat model wants to avoid.
Read-only gives you full visibility without creating that risk.

## CLI options

```
-p, --port <n>    Port to serve on (default 3000; auto-increments if taken)
    --readonly    Disable all kill operations
    --no-open     Don't open the browser
```

There's also a command console in the UI (the floating capsule at the bottom). Type `help`.

## Extending the knowledge base

Processes the built-in database doesn't recognize are recorded silently. Run `unknown` in the console — it lists them **and prints the full config path**.

The path follows each platform's convention (override with `PORTVIS_DATA_DIR`):

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/port-visualizer/` |
| Linux | `~/.config/port-visualizer/` |
| Windows | `%APPDATA%\port-visualizer\` |

Create `knowledge.local.json` there:

```json
{
  "processes": {
    "my-daemon": {
      "name": "My background service",
      "category": "dev",
      "risk": "low",
      "what": "A cron-ish job I wrote, listens on 9100.",
      "ifKilled": "Just restart it; no data loss."
    }
  }
}
```

Reload the page to apply — no restart needed. Local entries take precedence over built-ins.

## Platform support

| OS | Requires |
|---|---|
| macOS | `lsof` (built in) |
| Linux | `ss` or `lsof` |
| Windows | `netstat` + `tasklist` (built in) |

Node.js 18 or later.

## Development

```bash
git clone https://github.com/edwardzhengif/port-visualizer.git
cd port-visualizer
npm install
npm run build && npm start
```

Split hot-reload:

```bash
npm run dev        # Express on :3000
npm run dev:web    # Vite on :5173, API proxied to 3000
```

### Build fails with `Cannot find module @rollup/rollup-darwin-arm64`

rollup, esbuild and Tailwind all ship **platform-specific native binaries**. If your
`node_modules/` was installed on a different platform (a Linux container, another
machine, a shared folder), the binary for your platform will be missing.

```bash
rm -rf node_modules && npm i
```

**Delete `node_modules` only — keep `package-lock.json`.** The widely-copied advice
says to remove both, but the lockfile here correctly records all 25 platform
variants; deleting it just throws away reproducibility. Only `node_modules` is dirty.

### Tests

Three layers, all run by `npm test`:

- `knowledge.test.js` — process identification and risk grading
- `scanner.test.js` — parsing `lsof` / `ss` / `netstat` output
- `browser.test.js` — loads the **real build output** in jsdom and checks component nesting, event wiring, and whether dialogs actually open

Plus `cli.test.js`, which starts a real server and hits `/api/ports` — so on the
Windows and macOS CI runners it genuinely exercises the platform-specific
`netstat` / `lsof` code path. Fixture tests verify parsing; this layer verifies
that the command itself works on that OS.

That third layer earns its keep: a passing build does not mean it runs. There was a
blank-page bug that produced no build error and no console output.

`npm test` rebuilds first (via `pretest`). Because `browser.test.js` asserts against
`dist/`, running it without a rebuild grades the previous build — and a green suite on
stale output is worse than no suite, since it actively vouches for code you no longer have.

## Known limitations

These are not bugs waiting to be fixed — they are deliberate trade-offs or platform facts.
**You should know them before you rely on this tool.**

| Limitation | Detail |
|---|---|
| **Windows is not verified on real hardware** | The `netstat` / `tasklist` path only runs in CI; the author has no Windows machine. Please open an issue if something breaks |
| **Non-root cannot see other accounts' processes** | An OS restriction on macOS and Linux. "All processes" may therefore show exactly what "My processes" shows; the UI says so |
| **Other accounts' processes are view-only** | Unix signal permissions. The UI hands you a ready `sudo kill` command; the tool never escalates itself |
| **Memory is RSS** | Shared library pages are counted once per process, so it over-reports and is **not comparable across processes**. Useful for order of magnitude only |
| **"Search the web" leaves your machine** | The only action that does. It opens a new tab with the process name in the query. Everything else is offline |
| **Minimal Linux containers may scan empty** | Those images ship neither `ss` nor `lsof` |

## Deliberately out of scope

Written down so it does not have to be re-argued:

- **Self-escalation** (built-in sudo) — a long-running service that can kill anything as root is a bigger risk than the convenience it buys
- **A networked knowledge base** — letting remote data influence "what is safe to kill" puts a supply chain in the most dangerous path
- **A `--host` flag** — `PORTVIS_HOST` exists for people who mean it; a casual flag does not

Planned work lives in [Issues](https://github.com/edwardzhengif/port-visualizer/issues).

## Security

Please use [private vulnerability reporting](https://github.com/edwardzhengif/port-visualizer/security/advisories/new)
rather than a public issue. Threat model and known limitations are in
[SECURITY.md](https://github.com/edwardzhengif/port-visualizer/blob/main/SECURITY.md).

## License

MIT
