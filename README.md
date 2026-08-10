# port-visualizer

**中文** · [English](./README.en.md)

[![CI](https://github.com/edwardzhengif/port-visualizer/actions/workflows/ci.yml/badge.svg)](https://github.com/edwardzhengif/port-visualizer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/port-visualizer)](https://www.npmjs.com/package/port-visualizer)
[![license](https://img.shields.io/npm/l/port-visualizer)](./LICENSE)

看清谁占了本机端口，并安全地终止它。

```bash
npx port-visualizer
```

浏览器会自动打开。不需要安装，不需要配置，不需要账号。

界面默认英文；浏览器语言是中文时自动切成中文，右上角也能随时手动切。



![port-visualizer](https://raw.githubusercontent.com/edwardzhengif/port-visualizer/main/docs/screenshot.png)


---

## 它解决什么问题

`lsof -i :3000` 能告诉你 PID 是 `48213`、进程叫 `node`。然后呢？

你想知道的其实是三件事：**这是什么、杀了会怎样、你凭什么这么说。** 这三个问题，命令行不回答，活动监视器也不回答。

所以每一个端口都带着一份说明：

```
5432  PostgreSQL 数据库服务
      终止后果：所有连接断开，进行中的事务回滚。SIGTERM 是安全的
                （等同 pg_ctl stop），SIGKILL 可能导致下次启动时需要恢复。
      判断依据：进程名匹配 · 默认端口 5432 · 已运行 9 天
```

判断依据是摊开给你看的，你可以自己复核这条推理链，不必信任这个工具的结论。

## 怎么用 —— 最常见的那个场景

你敲 `npm run dev`，终端吐出 `Error: listen EADDRINUSE: address already in use :::3000`。

```bash
npx port-visualizer
```

1. 浏览器打开，**在搜索框里敲 `3000`**（或者按 `/` 直接聚焦搜索框）。
2. 那张卡片会告诉你占用者是什么。假设写着「Vite 开发服务器 · node · PID 48213 · 你 · 运行 2 小时」——
   那是你上午忘了关的另一个项目。
3. 点**「详情」**，看「终止后果」那一行：*重新启动即可，不影响源码*。
4. 点**「终止」**，确认框会再复述一遍身份和后果。确认。
5. 回终端重跑 `npm run dev`。

如果第 2 步显示的是 **PostgreSQL**，「终止后果」会写*进行中的事务回滚*——
这时你就知道该换个端口，而不是杀它。**这个区别正是这个工具存在的理由。**

### 其它几个高频用法

| 你想干什么 | 怎么做 |
|---|---|
| 我刚起的服务在哪个端口 | 切回浏览器，找带**「刚出现」**标记的那张卡片 |
| 哪些端口同事能连上 | 点分面条上的**「对外暴露」** |
| 只看我自己起的东西 | 工具栏的**「我的进程」**（默认就是它） |
| 从一堆同名 node 里找具体那个 | 搜索框支持匹配**完整命令行**，搜 `vite` 或项目名 |
| 不想动鼠标 | 底部胶囊输入框：`kill 3000`、`port 5432`、`exposed`、`help` |
| 演示或结对时防手滑 | `npx port-visualizer --readonly`，所有终止按钮禁用 |

快捷键：`/` 聚焦搜索、`r` 刷新、`?` 打开字段说明。

## 和活动监视器的分工

活动监视器大而全，但它**根本不列监听端口**。这个工具只做端口这一件事，于是能做到它做不到的：

- **「刚出现」标记** — 你刚 `npm run dev`，它起在哪个端口？切回浏览器就看到那一条被标出来。
- **端口消失提醒** — 服务悄无声息地挂掉是最难察觉的故障，这里会说一声。
- **对外暴露分面** — 哪些端口绑在 `0.0.0.0` 上、同一个 Wi-Fi 下的人能连进来？一次点击筛出来。
- **终止前的后果说明** — 而不是一个只写着「确定要强制退出吗」的对话框。

## 安全设计

这是个能杀进程的工具，所以每条边界都是刻意画的：

| 约束 | 原因 |
|---|---|
| 只监听 `127.0.0.1` | 绑到外部地址 = 把杀进程的能力交给同网段所有人 |
| 每个请求校验 CSRF token + Host | 否则任何网页都能用你的浏览器调这个接口 |
| 系统关键进程双层硬拦截 | 前端禁用只是提示，服务端有独立校验；`launchd` 之类解锁后也拦 |
| 终止前按 PID 二次核对进程身份 | 防 TOCTOU：确认时的 PID 可能已经被别的进程复用 |
| 不自我提权 | 一个能随时以 root 杀进程的常驻服务，风险远大于它省下的麻烦 |
| 从不执行拼接的 shell 字符串 | 全部走 `execFile`，没有 shell 参与 |

别人账号下的进程（macOS 的系统服务多属此类）只能查看。界面会解释原因，并给出可直接复制执行的 `sudo kill` 命令。

### 你可能根本看不到别人的进程

**macOS 和 Linux 上，非 root 进程通常只能枚举自己账号的进程。** 这不是本工具的限制，是系统的：
`mDNSResponder` 明明在跑、明明占着 UDP 5353，不加 `sudo` 的 `lsof` 就是一条都不返回。

后果是「全部进程」这个筛选在这些机器上和「我的进程」看到的一样多。
界面会明说这件事，而不是让你以为自己的电脑上真的只有你自己的进程。

想看全部：

```bash
sudo port-visualizer --readonly
```

**`--readonly` 不是可选的建议，是刻意的。** 以 root 跑一个能终止任意进程的常驻 HTTP 服务，
正是本项目威胁模型里最不希望存在的东西。只读模式下你能看到全部，又不产生那份风险。

## 命令行选项

```
-p, --port <号>   指定端口（默认 3000；被占用时自动往后找）
    --readonly    只读模式，禁用一切终止操作
    --no-open     不自动打开浏览器
```

界面里还有一个命令控制台（底部胶囊输入框），`help` 列出全部命令。

## 补充知识库

内置知识库认不出的进程会被静默记录。在界面的命令控制台里执行 `unknown`，它会列出这些进程**并打印出配置文件的完整路径**。

路径按平台走系统惯例（`PORTVIS_DATA_DIR` 可覆盖）：

| 系统 | 位置 |
|---|---|
| macOS | `~/Library/Application Support/port-visualizer/` |
| Linux | `~/.config/port-visualizer/` |
| Windows | `%APPDATA%\port-visualizer\` |

在那里建 `knowledge.local.json`：

```json
{
  "processes": {
    "my-daemon": {
      "name": "我的后台服务",
      "category": "dev",
      "risk": "low",
      "what": "自己写的定时任务，端口 9100。",
      "ifKilled": "重启即可，不影响数据。"
    }
  }
}
```

保存后刷新页面生效，不用重启。本地条目优先级高于内置。

## 支持的系统

| 系统 | 依赖 |
|---|---|
| macOS | `lsof`（系统自带） |
| Linux | `ss` 或 `lsof` |
| Windows | `netstat` + `tasklist`（系统自带） |

需要 Node.js 18 或更高版本。

## 本地开发

```bash
git clone https://github.com/edwardzhengif/port-visualizer.git
cd port-visualizer
npm install
npm run build && npm start
```

前后端分开热重载：

```bash
npm run dev        # Express，:3000
npm run dev:web    # Vite，:5173，API 已代理到 3000
```

### 构建报错 `Cannot find module @rollup/rollup-darwin-arm64`

rollup、esbuild、Tailwind 都带**平台相关的原生二进制**。如果 `node_modules/`
是在另一个平台（比如 Linux 容器、另一台机器、共享目录）装出来的，在你这台机器上就会找不到。

```bash
rm -rf node_modules && npm i
```

**只删 `node_modules`，不要删 `package-lock.json`。** 网上那个流传很广的答案让你两个都删，
但锁文件里其实完整记录了全部 25 个平台变体，是好的；删掉它反而丢失了可复现性。
真正脏的只有 `node_modules`。

### 测试

分三层，`npm test` 全跑：

- `knowledge.test.js` — 进程识别与风险判定
- `scanner.test.js` — `lsof`/`ss`/`netstat` 的输出解析
- `browser.test.js` — 在 jsdom 里加载**真实构建产物**，验证组件嵌套、事件绑定、弹窗能否打开

还有 `cli.test.js`：它会真的启动服务、真的请求 `/api/ports`，因此在 CI 的
Windows/macOS 机器上会真正执行一遍 `netstat`/`lsof` 那条平台相关代码路径 ——
fixture 测试验的是解析，这一层验的是「命令本身在那个系统上能不能跑」。

第三层是必要的：构建通过不等于跑得起来。曾经有过整页空白但构建和控制台都毫无异常的情况。

## 待办与已知限制

还缺什么、哪些是刻意不做的，都写在 [ROADMAP.md](https://github.com/edwardzhengif/port-visualizer/blob/main/ROADMAP.md)。

## 安全

发现安全问题请走[私密报告通道](https://github.com/edwardzhengif/port-visualizer/security/advisories/new)，
不要开公开 issue。威胁模型与已知限制见 [SECURITY.md](https://github.com/edwardzhengif/port-visualizer/blob/main/SECURITY.md)。

## License

MIT
