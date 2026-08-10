'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { scanPorts } = require('./scanner');
const { analyze, fieldTips, categories, normalizeLang } = require('./knowledge');
const knowledgeStore = require('./knowledge-store');
const {
  CSRF_TOKEN,
  hostGuard,
  csrfGuard,
  fetchMetadataGuard,
  securityHeaders,
  createRateLimiter,
} = require('./security');

const ME = (() => {
  try {
    const u = os.userInfo();
    return { uid: u.uid, username: u.username };
  } catch { return { uid: null, username: null }; }
})();

/**
 * 端口行 + 知识库判断，前端拿到的就是可以直接展示的成品。
 *
 * 每次扫描都重读一次本地覆盖层（按 mtime 缓存，没改动时不解析），
 * 所以你编辑完 knowledge.local.json 刷新页面就生效，不用重启服务。
 */
async function scanAndAnalyze(lang) {
  const rows = await scanPorts();
  const overlay = knowledgeStore.loadLocal();

  return rows.map((row) => {
    const analysis = analyze(row, ME, overlay, lang);
    // 静默记录内置库和本地库都不认识的进程，供之后补充条目用
    if (!analysis.known) knowledgeStore.noteUnknown(row);
    return { ...row, analysis };
  });
}

/*
 * 这个模块只导出 express app，不自己 listen —— 监听交给 bin/port-visualizer.js。
 * 之前两边各有一套 listen + 端口占用处理，等于两条启动路径，
 * 而只有其中一条被测试覆盖。合并成一条之后，你跑的和用户跑的是同一段代码。
 */
// 需要一个纯只读模式时（比如共享屏幕演示）可以关掉 kill。
const READONLY = process.env.PORTVIS_READONLY === '1';

/*
 * 只服务构建产物 dist/。
 *
 * 这里曾经会在 dist/ 不存在时回退到 public/ 下一份零构建的原生实现 ——
 * 那是为了「HeroUI Pro 装不上时还有东西可用」。依赖里去掉 Pro 之后，
 * 构建对任何人都能跑通，那份 1500 行的平行实现就只剩维护负担了，已删除。
 */
const PUBLIC_DIR = path.join(__dirname, '..', 'dist');

const app = express();
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(hostGuard);
// 顺序有意义：先挡跨站，再解析 body —— 没必要为一个注定被拒的请求解析 JSON
app.use(fetchMetadataGuard);
app.use(express.json({ limit: '16kb' }));
app.use(csrfGuard);

/* ------------------------------------------------------------ 首页 */

/**
 * 首页单独走一条路由，把本次进程的 CSRF token 注入 meta 标签。
 * 静态目录关掉 index，避免绕过注入直接拿到没有 token 的 index.html。
 */
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
function sendIndex(req, res, next) {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) return next(err);
    res.type('html').send(html.replace('__CSRF_TOKEN__', CSRF_TOKEN));
  });
}
app.get('/', sendIndex);
app.get('/index.html', sendIndex);

app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0 }));

/* ------------------------------------------------------------ 接口文案 */

/**
 * 接口返回的错误也要跟着语言走 —— 界面是英文的、弹窗里蹦出一句中文，
 * 比全中文更糟：用户会以为出了什么诡异的错误。
 * 语言从 query 取，前端每个请求都会带上。
 */
const M = {
  badPort: { en: 'Port must be an integer between 0 and 65535', zh: '端口号必须是 0-65535 之间的整数' },
  badPortShort: { en: 'Invalid port number', zh: '端口号非法' },
  notListening: { en: (n) => `Port ${n} is not being listened on`, zh: (n) => `端口 ${n} 当前没有被监听` },
  readonly: { en: 'Read-only mode (--readonly) is on; terminating is disabled',
    zh: '当前为只读模式（--readonly），终止进程已禁用' },
  needPid: { en: 'You must send the PID you are currently looking at (guards against killing a process that just took over the port)',
    zh: '必须提供你当前看到的 PID（防止误杀抢占同一端口的其它进程）' },
  badSignal: { en: (s) => `Unsupported signal: ${s}`, zh: (s) => `不支持的信号: ${s}` },
  protectedPid: { en: (n) => `Refusing to touch protected process (PID ${n})`, zh: (n) => `拒绝操作受保护的进程 (PID ${n})` },
  critical: { en: (name, why) => `${name} is a critical system process: ${why}`,
    zh: (name, why) => `${name} 是系统关键进程：${why}` },
  changedHands: { en: (port, proc, pid) => `Port ${port} changed hands: it is now ${proc} (PID ${pid}). Cancelled — refresh and try again.`,
    zh: (port, proc, pid) => `端口 ${port} 已易主：现在是 ${proc} (PID ${pid})，已取消操作，请刷新后重试` },
  gone: { en: (port) => `Nothing is listening on port ${port} any more`, zh: (port) => `端口 ${port} 上已经没有进程在监听了` },
  sent: { en: (proc, pid, sig) => `Sent ${sig} to ${proc} (PID ${pid})`, zh: (proc, pid, sig) => `已向 ${proc} (PID ${pid}) 发送 ${sig}` },
  eperm: { en: (pid) => `PID ${pid} does not belong to your account; this tool cannot terminate it directly`,
    zh: (pid) => `PID ${pid} 不属于你的账号，本工具无法直接终止` },
  esrch: { en: (pid) => `Process ${pid} has already exited`, zh: (pid) => `进程 ${pid} 已经退出了` },
  notFound: { en: 'No such endpoint', zh: '接口不存在' },
  serverError: { en: 'Internal server error', zh: '服务器内部错误' },
};

/** 取一条本地化文案。带参数的条目返回函数调用结果。 */
function m(req, key, ...args) {
  const entry = M[key][normalizeLang(req.query.lang)] || M[key].en;
  return typeof entry === 'function' ? entry(...args) : entry;
}

/* ------------------------------------------------------------ API */

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      platform: os.platform(),
      release: os.release(),
      hostname: os.hostname(),
      uptime: Math.round(process.uptime()),
      readonly: READONLY,
    },
    timestamp: new Date().toISOString(),
  });
});

/** 字段的大白话解释。静态内容，前端启动时拉一次。 */
app.get('/api/tips', (req, res) => {
  const lang = normalizeLang(req.query.lang);
  res.json({ success: true, data: { fields: fieldTips(lang), categories: categories(lang), lang } });
});

/*
 * 扫描本身也要限流。
 *
 * 每次 /api/ports 都会 fork 一次 lsof + ps，是这个服务里最贵的操作。
 * fetchMetadataGuard 已经挡住了浏览器侧的跨站触发，但那依赖浏览器发
 * Sec-Fetch-Site；这一层是不依赖任何外部行为的兜底。
 *
 * 30 次 / 10 秒：人手动刷新、多开几个标签页都远远够用，
 * 而循环调用会被立刻卡住。
 */
const scanLimiter = createRateLimiter({ windowMs: 10_000, max: 30 });

app.get('/api/ports', scanLimiter, async (req, res) => {
  try {
    const lang = normalizeLang(req.query.lang);
    const ports = await scanAndAnalyze(lang);
    res.json({
      success: true,
      data: ports,
      meta: {
        platform: os.platform(),
        total: ports.length,
        readonly: READONLY,
        currentUser: ME.username,
        lang,
        mine: ports.filter((p) => p.analysis.isMine).length,
        /*
         * 这次扫描到底有没有看见别的账号。
         *
         * macOS 上非 root 的 lsof 只枚举调用者自己的进程 —— mDNSResponder 明明在跑、
         * 明明持有 UDP 5353，lsof 就是一条都不返回。Linux 非 root 也类似。
         * 后果是「全部进程 / 我的进程」这个筛选在那些机器上只有一个值，
         * 而「需要 sudo」整条路径永远走不到。
         *
         * 与其让用户以为「我的电脑上真的只有我自己的进程」（一个错误的世界观，
         * 而这个工具本该纠正它），不如把「我看不全」这件事说出来。
         */
        canSeeOthers: ports.some((p) => !p.analysis.isMine),
        runningAsRoot: ME.uid === 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 单端口详情。
 * 这里仍然要做一次全量扫描（系统没有「只查一个端口」的原语），
 * 但前端已经不再为了看详情而调用它 —— 列表数据里已经有全部字段。
 * 保留这个端点是为了给命令行 / curl 用。
 */
app.get('/api/ports/:port', async (req, res) => {
  const portNumber = Number.parseInt(req.params.port, 10);
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535) {
    return res.status(400).json({
      success: false,
      error: m(req, 'badPort'),
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const ports = await scanAndAnalyze(normalizeLang(req.query.lang));
    const matches = ports.filter((p) => p.port === portNumber);
    if (matches.length === 0) {
      return res.status(404).json({
        success: false,
        error: m(req, 'notListening', portNumber),
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ success: true, data: matches, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 待补充的知识条目。
 * 只读，返回观察到的进程名 / 端口 / 可执行文件名，不含完整命令行。
 */
app.get('/api/unknown', (req, res) => {
  res.json({
    success: true,
    data: knowledgeStore.listUnknown(),
    draft: knowledgeStore.draftTemplate(),
    localFile: knowledgeStore.LOCAL_FILE,
  });
});

/* ------------------------------------------------------------ kill */

const killLimiter = createRateLimiter({ windowMs: 10_000, max: 10 });

/** 绝不能碰的 PID：内核/init，以及本工具自己。 */
function isProtectedPid(pid) {
  return pid <= 1 || pid === process.pid;
}

const ALLOWED_SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT']);

/**
 * 终止进程。
 *
 * 与旧版最重要的差别：客户端必须回传它当时看到的 PID，服务端校验
 * 「这个 PID 现在是否仍然占着这个端口」，不一致就拒绝。
 *
 * 旧版的做法是拿端口号重新扫一遍再杀 —— 典型的 TOCTOU：
 * 用户看到 3000 是自己的 dev server，点下按钮的瞬间它恰好退出、
 * 另一个进程抢占了 3000，被杀掉的就是那个无辜进程。
 *
 * 另外这里用 process.kill() 而不是拼 shell 命令，signal 由白名单约束，
 * 不存在任何字符串拼接进 shell 的路径。
 */
app.post('/api/ports/:port/kill', killLimiter, async (req, res) => {
  if (READONLY) {
    return res.status(403).json({
      success: false,
      error: m(req, 'readonly'),
      timestamp: new Date().toISOString(),
    });
  }

  const portNumber = Number.parseInt(req.params.port, 10);
  const pid = Number.parseInt(req.body?.pid, 10);
  const signal = String(req.body?.signal || 'SIGTERM').toUpperCase();

  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535) {
    return res.status(400).json({ success: false, error: m(req, 'badPortShort') });
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return res.status(400).json({
      success: false,
      error: m(req, 'needPid'),
    });
  }
  if (!ALLOWED_SIGNALS.has(signal)) {
    return res.status(400).json({ success: false, error: m(req, 'badSignal', signal) });
  }
  if (isProtectedPid(pid)) {
    return res.status(403).json({
      success: false,
      error: m(req, 'protectedPid', pid),
    });
  }

  try {
    // 二次确认：这个 PID 现在还在这个端口上吗？
    const lang = normalizeLang(req.query.lang);
    const ports = await scanAndAnalyze(lang);
    const target = ports.find((p) => p.port === portNumber && p.pid === pid);

    // 系统关键进程硬拦截。前端会禁用按钮，但后端必须独立成立 ——
    // 前端的禁用只是提示，任何人都能直接 curl 这个接口。
    if (target?.analysis?.blocked && req.body?.acknowledgeCritical !== true) {
      return res.status(423).json({
        success: false,
        error: m(req, 'critical', target.process, target.analysis.ifKilled),
        blocked: true,
        analysis: target.analysis,
        timestamp: new Date().toISOString(),
      });
    }

    if (!target) {
      const stillThere = ports.find((p) => p.port === portNumber);
      return res.status(409).json({
        success: false,
        error: stillThere
          ? m(req, 'changedHands', portNumber, stillThere.process, stillThere.pid)
          : m(req, 'gone', portNumber),
        timestamp: new Date().toISOString(),
      });
    }

    process.kill(pid, signal);

    res.json({
      success: true,
      message: m(req, 'sent', target.process, pid, signal),
      data: { port: portNumber, pid, process: target.process, signal },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'EPERM') {
      // 光说「权限不足」等于把人堵在墙前面。把能直接粘进终端的命令给出来。
      return res.status(403).json({
        success: false,
        error: m(req, 'eperm', pid),
        needsSudo: true,
        command: `sudo kill -${signal === 'SIGKILL' ? '9' : '15'} ${pid}`,
        timestamp: new Date().toISOString(),
      });
    }
    const reason = error.code === 'ESRCH'
      ? m(req, 'esrch', pid)
      : error.message;
    res.status(500).json({ success: false, error: reason, timestamp: new Date().toISOString() });
  }
});

/* ------------------------------------------------------------ 兜底 */

app.use((req, res) => {
  res.status(404).json({ success: false, error: m(req, 'notFound') });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('未处理的错误:', err);
  res.status(500).json({ success: false, error: m(req, 'serverError') });
});

module.exports = app;
