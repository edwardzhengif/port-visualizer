#!/usr/bin/env node
'use strict';

/**
 * CLI 入口 —— `npx port-visualizer` 走到这里。
 *
 * 这一层只做三件 server/app.js 不该关心的事：解析参数、挑一个能用的端口、开浏览器。
 * 服务本身仍然是 server/app.js 导出的那个 express app，两边没有重复逻辑。
 */

const http = require('node:http');
const os = require('node:os');
const { execFile } = require('node:child_process');

const pkg = require('../package.json');

/* ------------------------------------------------------------ 参数 */

/** 参数出错就明确报错退出，绝不静默回退到默认值 —— 那会让人以为 -p 生效了。 */
function fail(msg) {
  console.error(`${msg}\n用 --help 查看用法`);
  process.exit(1);
}

function toPort(raw, flag) {
  if (raw === undefined) fail(`${flag} 需要一个端口号`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) fail(`端口号必须是 1-65535 之间的整数，收到「${raw}」`);
  return n;
}

function parseArgs(argv) {
  const opts = { port: 3000, host: '127.0.0.1', readonly: false, open: true };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === '-h' || a === '--help') return { help: true };
    if (a === '-v' || a === '--version') return { version: true };
    if (a === '-p' || a === '--port') { opts.port = toPort(argv[i + 1], a); i += 1; }
    else if (a.startsWith('--port=')) opts.port = toPort(a.slice(7), '--port');
    else if (a === '--readonly') opts.readonly = true;
    else if (a === '--no-open') opts.open = false;
    /*
     * 故意不提供 --host。
     *
     * 整个安全模型建立在「只绑回环、只有本机能访问」之上：kill 接口能终止任意进程，
     * 一旦绑到 0.0.0.0，同一个 Wi-Fi 下的任何人都能拿它杀你的进程。
     * 真要这么干的人可以设 PORTVIS_HOST —— 但那得是明知故犯，而不是随手加个参数。
     */
    else fail(`未知参数：${a}`);
  }

  if (process.env.PORTVIS_HOST) opts.host = process.env.PORTVIS_HOST;
  return opts;
}

const HELP = `
  port-visualizer — 看清谁占了本机端口，并安全地终止它

  用法
    npx port-visualizer [选项]

  选项
    -p, --port <号>   指定端口（默认 3000；被占用时自动往后找）
        --readonly    只读模式，禁用一切终止操作
        --no-open     不自动打开浏览器
    -h, --help        显示本帮助
    -v, --version     显示版本

  说明
    服务只监听 127.0.0.1，不接受局域网访问 —— 它带有终止进程的接口，
    绑到外部地址等于把杀进程的能力交给同网段的所有人。

    别人账号下的进程（macOS 的系统服务多属此类）只能查看，
    界面会给出可直接执行的 sudo 命令，工具本身不会自我提权。
`;

/* -------------------------------------------------------- 端口探测 */

/**
 * 从 start 起找一个空闲端口。
 *
 * 一个「端口查看器」因为自己要用的端口被占而启动失败，是很难看的失败方式 ——
 * 何况用户来装它，往往正是因为不知道端口被谁占了。
 */
function findFreePort(start, host, tries = 20) {
  return new Promise((resolve, reject) => {
    const attempt = (port, left) => {
      const probe = http.createServer();
      probe.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) attempt(port + 1, left - 1);
        else reject(err);
      });
      probe.once('listening', () => probe.close(() => resolve(port)));
      probe.listen(port, host);
    };
    attempt(start, tries);
  });
}

/** 打开浏览器。失败不算错误 —— 地址已经打在终端里了，用户自己点得开。 */
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => {});
}

/* ------------------------------------------------------------ 启动 */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(pkg.version); return; }

  if (opts.readonly) process.env.PORTVIS_READONLY = '1';

  const wanted = opts.port;
  let port;
  try {
    port = await findFreePort(wanted, opts.host);
  } catch (err) {
    console.error(`无法监听 ${opts.host}:${wanted} — ${err.message}`);
    process.exit(1);
  }

  // 延迟到这里才 require：app.js 在加载时读 PORTVIS_READONLY，上面刚设好
  // eslint-disable-next-line global-require
  const app = require('../server/app.js');

  const server = app.listen(port, opts.host, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  Port Visualizer');
    console.log(`  → ${url}`);
    if (port !== wanted) console.log(`    （${wanted} 已被占用，改用 ${port}）`);
    console.log(`  ${os.platform()} · 只监听本机${opts.readonly ? ' · 只读模式' : ''}`);
    console.log('  Ctrl+C 停止');
    console.log('');
    if (opts.open) openBrowser(url);
  });

  // 探测和真正 listen 之间有个极窄的窗口，别人可能刚好抢走这个端口
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `端口 ${port} 在启动的瞬间被别的程序抢走了，再跑一次即可`
      : err.message);
    process.exit(1);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
