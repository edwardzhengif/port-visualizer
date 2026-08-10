# Security Policy · 安全策略

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/edwardzhengif/port-visualizer/security/advisories/new)

I maintain this in my spare time and make **no promise about response times**. If it is
serious and I have gone quiet for two weeks, feel free to disclose publicly — a silent
maintainer should not become an excuse to keep users in the dark.

请不要用公开 issue 报告安全问题，走上面的私密通道。这是业余维护的项目，
**不承诺响应时限**；如果问题严重而我两周没有回应，你可以自行公开披露 ——
维护者失联不该成为让用户蒙在鼓里的理由。

## Supported versions

Only the latest published version. There are no long-term support branches.

仅支持最新发布版本，没有 LTS 分支。

## Threat model — what this tool assumes

This matters more than a list of features, because it tells you which reports are
in scope. 这一节比功能列表更重要，因为它划出了「什么算漏洞」的边界。

**Assumed trusted:**

- The machine it runs on, and anyone with a shell on it. This tool grants no
  privilege that a local shell does not already have — everything it can do,
  `kill(1)` can already do.
- 本机以及任何能在本机开 shell 的人。这个工具不提供 shell 之外的任何额外权限。

**Assumed hostile:**

- **Every web page open in your browser.** They can issue requests to
  `127.0.0.1:3000`. This is the primary threat, and the reason for the CSRF
  token, the `Host` allowlist, and the CSP.
- **Everyone on your local network.** Hence loopback-only binding.
- 浏览器里打开的任何网页（它们能向 127.0.0.1 发请求）、以及同一局域网内的任何人。

**Out of scope:**

- Anything that requires the attacker to already have code execution as your user.
  At that point they can call `kill()` directly and do not need this tool.
- Binding to a non-loopback address via `PORTVIS_HOST`. That is an explicit,
  documented foot-gun; if you set it, the security model no longer applies.
- 攻击者已经能以你的身份执行代码的场景；以及你自己用 `PORTVIS_HOST` 绑到非回环地址 ——
  那是有文档标注的自伤开关，设了它安全模型就不再成立。

## Design decisions that are security decisions

| Decision | Reason |
|---|---|
| Binds `127.0.0.1` only; no `--host` flag | Binding externally hands process-killing power to the whole subnet. Only an env var, so it cannot be done casually |
| CSRF token in a custom header on every write | Custom headers force a preflight, and we send no CORS headers — so cross-site writes never arrive |
| `Host` header allowlist | Blocks DNS rebinding, where the victim's browser sends the attacker's hostname |
| Client must send the PID it saw; server re-verifies | Prevents TOCTOU: the port may have changed hands between rendering and clicking |
| Critical processes blocked server-side, not just in the UI | The frontend's disabled button is a hint; anyone can `curl` the endpoint |
| `execFile` only, never a concatenated shell string | No shell means no command injection surface |
| Never self-escalates to root | A long-running service that can kill anything as root is a bigger prize than the convenience it buys |
| Knowledge base is fully offline | Letting remote data influence "what is safe to kill" would put a supply chain in the most dangerous path |
| `Sec-Fetch-Site` guard on every request | `<img src>` and `<script src>` send no `Origin`, so the CSRF check alone let cross-site GETs through — enough to make any page you visit fork `lsof` in a loop |

## Running as root

`sudo port-visualizer` is supported but **should always be paired with `--readonly`**.

Without it you are running a long-lived HTTP service, reachable from every page in your
browser, that can `kill(2)` any process on the machine as root. Loopback binding, the CSRF
token and the Host allowlist all still apply — but the value of a successful bypass goes up
by orders of magnitude. Read-only mode gives the same visibility with none of that.

`sudo port-visualizer --readonly` 是被支持的用法；不加 `--readonly` 的 root 运行不建议 ——
所有防线依然生效，但一旦被绕过，代价从「杀你自己的进程」变成「以 root 杀任何进程」。

## Known limitations

- The rate limiter is global, not per-client. Adequate for a loopback-only tool,
  but a runaway local script can saturate it.
- `.knowledge-unknown.json` records process names seen on your machine. It never
  leaves your disk and never contains full command lines, but it does reveal what
  you run. Delete it or set `PORTVIS_DATA_DIR` if that bothers you.
- 限流是全局而非按客户端；`.knowledge-unknown.json` 会记录你机器上出现过的进程名
  （不含完整命令行，也从不外传，但确实反映你装了什么）。
- **The "Search the web" button leaves your machine.** It opens a new tab at a search
  engine with the process name in the query. Nothing else in this tool talks to the network,
  but that button does — by design, on your click. Don't press it for a process whose name
  you consider sensitive.
  「在网上搜索」按钮会把进程名发给搜索引擎（Bing）。工具其余部分完全离线。
  选 Bing 而非 Google/DuckDuckGo 是因为它在最多的网络环境下可达，包括中国大陆。
- Non-root visibility: on macOS and Linux the scanner only sees processes owned by the
  invoking user, so the ownership filter and the `sudo kill` guidance are inert unless you
  run with `sudo --readonly`. The UI reports this rather than hiding it.
  非 root 时扫描器只能看到调用者自己的进程 —— 界面会明说，不隐瞒。
