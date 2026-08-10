# 发布到 npm —— 完整流程与常见问题

写给第一次发 npm 包的人。全文按「先做什么再做什么」排列，照着走一遍就能发出去。

> 这份文档只给你自己看，不进 npm 包（`files` 白名单里没有它），但会出现在 GitHub 仓库里。

---

## 零、先搞清楚一件事：npm 发布 ≠ 开源

这两件事经常被混为一谈，但它们是**互相独立**的两个维度：

| | 是什么 | 由什么决定 |
|---|---|---|
| **发布到 npm** | 让别人能 `npm install` 装到你的代码 | 你执行了 `npm publish` |
| **开源** | 授予别人**使用、修改、再分发**的法律权利 | 仓库里的 `LICENSE` 文件 |

四种组合都真实存在：

- **发 npm + 开源** ← 你现在这个（MIT LICENSE + 公开发布）
- **发 npm 不开源** — 比如只发编译产物，配一个「禁止修改和再分发」的专有 license
- **开源不发 npm** — 代码放 GitHub，用户自己 clone 构建
- **都不做** — 自己用

所以：**是 `LICENSE` 文件让你的项目成为开源项目，不是 `npm publish`。** 你的仓库里已经有 MIT LICENSE，`package.json` 里也声明了 `"license": "MIT"`，这一步已经完成了。

还有一个常被忽略的推论：**npm 上的公开包，任何人都能下载并读到你打进包里的所有内容。** 即使不算「开源」，代码也是公开可见的。所以发布前必须确认包里没有任何不该公开的东西——这是下面「发布前检查」的重点。

---

## 一、注册 npm 账号

需要，而且只需要一次。

1. 打开 <https://www.npmjs.com/signup>，用邮箱注册。用户名会成为你的 npm 主页地址，也会显示在包的 maintainer 里。
2. 去邮箱点验证链接。**不验证邮箱发布会被拒绝。**
3. 强烈建议开双因素认证：网页版 → 头像 → Account → Two-Factor Authentication。

   选 **Authorization and Publishing**（不只是登录时验证，发布时也验证）。这是因为 npm 包被劫持的典型路径就是账号密码泄露后被人发一个带后门的新版本——而所有 `npm install` 的用户会自动装上。

4. 在终端登录：

   ```bash
   npm login
   ```

   它会让你在浏览器里完成认证。成功后确认一下：

   ```bash
   npm whoami     # 应该输出你的 npm 用户名
   ```

> **注意**：`npm login` 会把凭据写进 `~/.npmrc`（你的用户主目录，不是项目目录）。项目里的 `.gitignore` 已经把 `.npmrc` 排除了，防止有人手滑在项目里生成一个再提交上去。

---

## 二、发布前检查（这一步最重要）

**npm 发布基本上是不可逆的。** 72 小时内可以 `npm unpublish`，之后就只能 `npm deprecate`（标记为「不建议使用」，但包还在，还能被装到）。而且即使 unpublish 了，这个版本号也**永久作废**，不能再用。

所以顺序是：先看清楚要发什么，再发。

### 1. 确认包名没被占用

```bash
npm view port-visualizer
```

返回 **404** = 名字可用（我已经查过，目前可用）。
返回包信息 = 已被占用，得换名字，或者改用带作用域的名字：

```bash
npm pkg set name="@edwardzhengif/port-visualizer"
```

作用域名字（`@用户名/包名`）永远不会冲突，缺点是用户得输全名。

### 2. 看清楚包里到底有什么

```bash
npm pack --dry-run
```

当前输出是 **13 个文件、约 280 kB**（体积每次构建有几 kB 浮动，看数量级即可）：

```
LICENSE  README.md  package.json
bin/port-visualizer.js
server/*.js  (5 个)
dist/index.html  dist/assets/*.css  dist/assets/*.js
```

`.github/workflows/ci.yml` 里的 `package` job 每次 PR 都会自动跑一遍这个校验：
白名单之外的文件出现就报错，`dist/` 缺失也报错。手工看一眼仍然值得做 —— 
自动化管的是「有没有多出东西」，你的眼睛管的是「这些东西该不该公开」。

**逐行看一遍。** 你要确认的是：没有 `.env`、没有 `.npmrc`、没有个人路径、没有内网地址、没有任何密钥。

这个项目用了 `files` 白名单（`package.json` 里的 `"files"` 字段），只有列出的路径会被打包。用白名单而不是 `.npmignore` 是刻意的：**漏写一条 ignore 规则会多发文件，漏写一条 files 只会少发文件**——后者的失败方式安全得多。

### 3. 本地装一遍，像真实用户那样

```bash
npm pack                                  # 生成 port-visualizer-<版本>.tgz
cd /tmp && npm install -g /完整路径/port-visualizer-<版本>.tgz
port-visualizer --help                    # 能跑吗
port-visualizer                           # 真的能起来吗
npm uninstall -g port-visualizer          # 测完卸掉
```

这一步能抓到 `npm pack --dry-run` 看不出来的问题，最典型的是：**忘了把 `dist/` 打进包**（因为它被 gitignore 了，很容易顺手也 npmignore 掉），结果用户装上后打开是 404。

> 你的 `package.json` 里挂了 `prepublishOnly: npm run build && npm test`，所以 `npm publish` 会**先构建再测试**，构建不出来或测试挂了就不会发。这条是防呆用的。

### 4. 截图

截图在 `docs/screenshot.png`，两份 README 都已引用。

**引用它必须用 `raw.githubusercontent.com` 的绝对地址。** `docs/` 不在 `files` 白名单里，
也就是说它**不在 npm 包内** —— 写相对路径的话，npm 页面上就是一个裂图。

要换图的话：`npm start`，暗色主题 + 卡片视图，让界面上有真实数据，截 1200–1600px 宽、
包含工具栏和分面条的一张，覆盖同名文件即可，README 不用动。

### 5. 让 CI 先绿

`.github/workflows/ci.yml` 一共 7 格：Linux（Node 20/22/24）、macOS、Windows 各跑一遍
`npm ci && npm run build && npm test`；`Runtime on Node 18` 单独验证 `engines` 声明的下限
（用 Node 22 打包、切到 Node 18 装 tarball 跑起来）；`Package contents` 打印并校验
「这次会发出去哪些文件」。

**特别留意 Windows 那一格。** `server/scanner.js` 里约 100 行 netstat / tasklist /
PowerShell 代码（`parseTasklist` / `parseNetstat` / `scanWindows` / `processDetailsWindows`
四个函数）只有一个字符串 fixture 测试覆盖，从没在真 Windows 上跑过，
而 README 已经写着支持 Windows。CI 是这句承诺唯一的兑现方式。

它红了不是坏消息，是信息。两个诚实的处理方式：修好，或者在 README 里把
Windows 标成实验性。**不诚实的做法是当作没看见照发。**

### 6. 检查 README

npm 包页面直接渲染 `README.md`。它是绝大多数人对这个项目的第一印象，也是唯一印象。

`README.md` 是英文版，`README.zh.md` 是中文版 —— 因为 npm 的读者以英语为主，而这个包面向国际用户。

**`README.md` 里的链接必须写绝对 URL。** 相对链接（`./LICENSE`、`./README.zh.md`）在
GitHub 上没问题，但 npm 页面的基准路径不是仓库根目录，npm 对相对链接的重写并不可靠 ——
赌它能解析对，不如直接写死。`README.zh.md` 只在 GitHub 上出现，相对链接无所谓。

---

## 三、发布

```bash
npm publish
```

就这一条。首次发布**公开包**不需要加参数。

> **为什么不用 GitHub Actions 自动发布？**
>
> 自动发布看起来更「工程化」，但对单人项目是**净损失**：它要求你把一个
> npm 发布令牌存进 GitHub Secrets，于是任何拿到仓库写权限的人（或任何一个被
> 投毒的 action）都能替你发版 —— 而你刚刚开的 2FA 恰恰是为了防这件事，
> 现在被自己绕过去了。
>
> 手动 `npm publish` + 发布时 2FA，意味着**每一次发版都需要你本人当场按一下**。
> 对一个能杀进程的工具，这个摩擦是值得的。团队规模上去、发版频繁到手动成为瓶颈时
> 再自动化，那时候的取舍才不一样。

> 如果你用了作用域名字（`@edwardzhengif/port-visualizer`），必须显式声明公开，否则 npm 默认当成私有包，而私有包要付费：
>
> ```bash
> npm publish --access public
> ```

发完验证：

```bash
npm view port-visualizer
npx port-visualizer@latest --version
```

包页面在 <https://www.npmjs.com/package/port-visualizer>。

---

## 四、发布后续版本

npm **不允许覆盖已发布的版本号**。改了代码要发新版，必须先升版本号。

```bash
npm version patch     # 1.0.0 → 1.0.1   修 bug
npm version minor     # 1.0.0 → 1.1.0   加功能，不破坏现有用法
npm version major     # 1.0.0 → 2.0.0   有破坏性改动
npm publish
```

`npm version` 会自动改 `package.json` 并打一个 git tag。记得 `git push --follow-tags` 把 tag 也推上去。

**怎么区分 minor 和 major？** 问一句：老用户升级后，原来的用法还成立吗？成立就是 minor，不成立就是 major。比如把 `--port` 改名成 `--listen`，就是 major。

---

## 五、你自己怎么用

发布之后，你有三种用法，按「用得有多频繁」来选：

### 偶尔用一次 —— 直接 npx

```bash
npx port-visualizer
```

不安装，每次现下现跑（有缓存，第二次很快）。这也是你推荐给别人的方式。

### 天天用 —— 全局安装

```bash
npm install -g port-visualizer
port-visualizer                 # 之后随时敲这一条
```

想更省事，在 `~/.zshrc` 里加个别名：

```bash
alias ports='port-visualizer'
```

升级：`npm update -g port-visualizer`

### 要改代码 —— 本地链接

```bash
cd /path/to/port-visualizer     # 换成你自己的项目路径
npm link
```

这会把全局的 `port-visualizer` 命令指向你的**本地源码目录**。之后你改一行代码、`npm run build`，敲 `port-visualizer` 立刻就是新的，不用重新发布。

解除：`npm unlink -g port-visualizer`

> 开发时其实更常用 `npm run dev` + `npm run dev:web`（前后端分别热重载），`npm link` 主要用来验证「装成命令之后是不是真的能跑」。

---

## 六、GitHub 那一侧

npm 和 GitHub 是两件事，都做了才完整：npm 让人装得到，GitHub 让人看得到、提得了 issue。

```bash
cd /path/to/port-visualizer     # 换成你自己的项目路径
git init                        # 如果还没初始化
git add -A
git commit -m "初始提交"
git branch -M main
git remote add origin https://github.com/edwardzhengif/port-visualizer.git
git push -u origin main
```

推之前**务必**确认 `git status` 里没有 `node_modules/`、`dist/`、`.env`。`.gitignore` 已经配好了，但养成推之前扫一眼的习惯。

仓库建好后，在 GitHub 页面右侧 About 里填上描述和 `npmjs.com/package/port-visualizer` 链接，加几个 topic（`cli`、`developer-tools`、`nodejs`）——这决定了别人能不能搜到它。

---

## 七、常见问题

**Q：发布之后能删掉吗？**
72 小时内可以 `npm unpublish port-visualizer@<版本>`。超过 72 小时，只有在「没有任何其它包依赖它」且「周下载量很低」时才可能删，否则得联系 npm 支持。实际操作中请当成**不可撤销**。替代方案是 `npm deprecate port-visualizer "已废弃，请改用 X"`，用户安装时会看到警告。

**注意**：撤包**不能**收回版本号 —— 撤掉的 `1.0.0` 永远不能再发一次，只能往上走 `1.0.1`。而且如果撤掉的是**唯一**版本，等于把整个包撤光，**24 小时内不能发任何新版本**。

**Q：会有人乱改我的包吗？**
不会。只有你的账号能发布这个包名下的新版本。别人可以 fork 代码、可以发一个不同名字的包，但动不了你的。**前提是你的账号没被盗**——这就是为什么要开 2FA。

**Q：MIT 协议意味着别人能拿去卖钱吗？**
能。MIT 允许任何人使用、修改、再分发，包括商业用途，唯一要求是保留你的版权声明和许可证文本。如果你不想让人闭源商用，需要换成 GPL 之类的传染性协议——但那也会限制别人把它嵌进自己的项目。对一个本地小工具来说，MIT 是合理默认。

**Q：我不轮换那个 HeroUI token，有什么实际风险？**
项目已经完全不依赖 HeroUI Pro 了，token 也不在任何文件里，所以**这个仓库和这个 npm 包不会泄露它**。真正的风险面只剩「它曾经出现在一次对话记录里」。风险是否可接受由你判断——这是你的订阅，不是技术问题。唯一要守住的红线是：以后任何时候都别把它写进项目文件或 CI 配置。

**Q：`npm i` 报错 `Cannot find module @rollup/rollup-darwin-arm64` 怎么办？**
`rm -rf node_modules && npm i`。**只删 node_modules，别删锁文件** —— 本项目的
锁文件完整记录了 25 个平台变体，是好的；网上让你两个都删的答案会白白丢掉可复现性。
成因是 `node_modules` 曾在另一个平台上安装过（容器、另一台机器、共享目录）。
README 的开发章节里也写了这条。

**Q：包里会不会不小心带上 `node_modules`？**
不会。npm 天然忽略 `node_modules`，加上你用了 `files` 白名单，双重保险。用 `npm pack --dry-run` 就能确认。

**Q：用户装完发现 `lsof` 不存在怎么办？**
macOS 和 Windows 都自带所需命令。Linux 上极简容器镜像可能两个都没有，这时扫描会返回空列表。这属于已知限制，README 的「支持的系统」里写清楚了。

**Q：为什么运行时依赖只有 express 一个？**
React、HeroUI、Tailwind 全部在**构建期**被打进 `dist/`，运行时不需要它们，所以它们在 `devDependencies` 里。这意味着用户 `npx` 时只下载 express 及其依赖，而不是两百多个包。这是刻意的——放错位置会让每个用户多下几十 MB。

**Q：怎么知道有多少人在用？**
包页面会显示周下载量，也可以 `npm view port-visualizer` 看。真实使用量通常低于下载量（CI 会重复下载）。

**Q：有人提 issue 或 PR，我有义务回应吗？**
没有。MIT 协议里那段全大写的免责声明就是这个意思：软件按现状提供，不承担任何担保责任。开源不等于承诺提供支持。如果你不想维护，在 README 里写一句「本项目按现状提供，不保证响应 issue」，是完全正当的做法。

**Q：改了代码要记得更新 CHANGELOG 吗？**
要。`CHANGELOG.md` 的 `[Unreleased]` 段落是给你随手记的，发版时把它挪到新版本号下面。
不写的后果不是「不专业」，而是半年后你自己都想不起 1.2.0 到底改了什么。

**Q：CHANGELOG 和 SECURITY.md 为什么不进 npm 包？**
它们是给「参与项目的人」看的，不是给「使用工具的人」看的。npm 包只装用户运行所需的
东西（13 个文件、约 280 kB）。README 里指向它们的链接用的是绝对 GitHub 地址，
正是因为相对链接在 npmjs.com 上会指不到。

**Q：Dependabot 为什么设成每月而不是每周？**
每天推 PR 的 Dependabot 最后一定会被无视，而**被无视的告警等于没有告警**。
每月一批是「你会真的看一眼」的量级。安全更新不受这个节奏限制，GitHub 会即时单独推。
