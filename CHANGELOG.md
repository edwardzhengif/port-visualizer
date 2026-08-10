# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

本项目所有值得留意的改动都记在这里。

## [Unreleased]

## [1.0.0] — 2026-08-08

First public release. 首个公开版本。

### Added

- Per-port explanations answering three questions: **what is this, what breaks if
  I kill it, and why do I think so.** The reasoning chain is shown so you can
  check it rather than trust it.
  每个端口都回答「这是什么 / 杀了会怎样 / 凭什么这么判断」，并摊开判断依据。
- Offline knowledge base: 89 processes, 37 well-known ports, 21 command-line
  heuristics. The tool itself never makes a network request. The one exception is the
  "Search the web" button, which opens a new tab — that is your browser, on your explicit
  click, and it does send the process name to the search engine.
  离线知识库。工具自身不联网；唯一例外是「在网上搜索」按钮，那是你点击后由浏览器新开
  标签页发起的，进程名会随查询词发给搜索引擎。
- Risk grading with a two-layer hard block on critical system processes —
  the UI disables the button, and the server refuses independently.
  风险分级 + 系统关键进程双层硬拦截。
- "Just appeared" markers and disappearance alerts — the two things Activity
  Monitor cannot tell you, because it does not list listening ports at all.
  「刚出现」标记与端口消失提醒。
- Faceted filter bar where every count is clickable. Counts exclude their own
  dimension, so selecting TCP does not make UDP read zero and trap you.
  可点击的分面筛选，计数排除自身维度。
- Card grid (3 columns) and table view, sharing one detail dialog.
- Command console with `help`, `kill`, `port`, `stats`, `unknown` and more.
- English and Chinese UI, including all port explanations. Defaults to English;
  follows the browser language on first visit.
  中英双语，含全部端口解读。
- Light / dark / system theme.
- `npx port-visualizer` CLI with `--port`, `--readonly`, `--no-open`;
  auto-increments when the requested port is taken.
- Local knowledge overlay via `knowledge.local.json` in the per-user data
  directory; unrecognised processes are recorded silently for you to fill in.

- Honest reporting when the scanner cannot see other accounts' processes. On macOS and
  Linux a non-root process only enumerates its own, which makes the ownership filter inert;
  the UI now says so and points at `sudo port-visualizer --readonly` instead of letting you
  conclude your machine only runs processes you own.
  非 root 时看不到别人的进程 —— 界面明说，不沉默。
- Running as root auto-switches the ownership filter to "All processes". Under root,
  "my processes" means root's — following our own `sudo` advice would otherwise hide the
  very processes you started.
  以 root 运行时自动切到「全部进程」—— 否则按我们的建议 sudo 反而看得更少。

### Security

- **`Sec-Fetch-Site` guard.** `<img src>` and `<script src>` send no `Origin`, so the CSRF
  check alone let cross-site GETs reach `/api/ports` — enough for any page you visit to make
  your machine fork `lsof` in a loop. Verified by experiment, then fixed and covered by a test.
  跨站 GET 曾能穿过 CSRF 检查触发扫描，已堵。
- Rate limit on `/api/ports` as a backstop that does not depend on browser behaviour.
- Loopback-only binding. There is deliberately no `--host` flag.
- CSRF token on every write, `Host` allowlist against DNS rebinding, and a CSP
  restricted to same-origin.
- Kill requires the client to send the PID it observed; the server re-verifies
  that this PID still holds that port (TOCTOU guard).
- All external commands run through `execFile`; no shell is ever involved.
- The tool never escalates its own privileges. Processes owned by other accounts
  are view-only, with a copy-pasteable `sudo kill` command and an explanation of
  why your own machine runs processes that are not yours.

[Unreleased]: https://github.com/edwardzhengif/port-visualizer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/edwardzhengif/port-visualizer/releases/tag/v1.0.0
