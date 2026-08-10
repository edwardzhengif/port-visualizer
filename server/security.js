'use strict';

/**
 * 安全中间件。
 *
 * 旧版存在一个可被远程利用的严重问题：
 *   app.use(cors())            → 任意站点都能跨域读取端口列表
 *   app.listen(PORT)           → 绑定 0.0.0.0，同局域网任何人可访问
 *   POST /api/ports/:port/kill → 无任何鉴权
 * 组合起来的后果是：你在浏览器里打开的任何一个网页，只要这个工具在跑，
 * 就能用一行 fetch 杀掉你机器上的任意进程（CSRF）；而 DNS rebinding
 * 还能绕过同源策略把内网地址解析到攻击者控制的域名上。
 *
 * 这里用三道互相独立的防线来堵：
 *   1. 只监听回环地址 —— 局域网根本连不上。
 *   2. Host 白名单 —— 挡 DNS rebinding（rebinding 时 Host 是攻击者域名）。
 *   3. 自定义头携带的 CSRF token —— 自定义头强制触发预检，跨域请求发不出来。
 */

const crypto = require('crypto');

/** 每次进程启动重新生成，重启即失效，不落盘。 */
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostnameOf(value) {
  if (!value) return null;
  // 去掉端口，保留 IPv6 的方括号形式
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  const idx = value.lastIndexOf(':');
  return idx === -1 ? value : value.slice(0, idx);
}

/**
 * 防 DNS rebinding：只接受 Host 指向回环地址的请求。
 * 攻击者把 evil.com 解析到 127.0.0.1 时，Host 仍然是 evil.com，在这里被拒。
 */
function hostGuard(req, res, next) {
  const host = hostnameOf(req.headers.host);
  if (!host || !ALLOWED_HOSTNAMES.has(host)) {
    return res.status(403).json({
      success: false,
      error: '仅接受来自 localhost 的请求',
    });
  }
  next();
}

/**
 * 防 CSRF：
 *  - 有 Origin 头时必须是回环源（浏览器不允许脚本伪造 Origin）。
 *  - 写操作必须带 X-CSRF-Token 自定义头。自定义头会强制浏览器预检，
 *    而预检不会通过（我们不发 CORS 放行头），所以跨站请求根本到不了这里。
 */
function csrfGuard(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return res.status(403).json({ success: false, error: '非法 Origin' });
    }
    if (!ALLOWED_HOSTNAMES.has(originHost)) {
      return res.status(403).json({ success: false, error: '跨源请求已拒绝' });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') return next();

  if (req.get('X-CSRF-Token') !== CSRF_TOKEN) {
    return res.status(403).json({
      success: false,
      error: 'CSRF token 缺失或不匹配，请刷新页面',
    });
  }
  next();
}

/**
 * 拦截跨站发起的请求 —— 补 csrfGuard 的一个真实缺口。
 *
 * csrfGuard 只在**存在** Origin 头时校验它。但浏览器加载子资源时根本不发 Origin：
 *
 *     <img src="http://127.0.0.1:3000/api/ports">
 *     <script src="http://127.0.0.1:3000/api/ports"></script>
 *
 * 这两种写法里，Host 是真的 127.0.0.1（过 hostGuard），没有 Origin（过 csrfGuard 的
 * if 分支），方法是 GET（csrfGuard 直接放行）—— 结果任何一个你打开的网页都能
 * 让这台机器反复 fork lsof + ps。
 *
 * 攻击者**读不到**返回内容（跨源 no-cors 响应对脚本不透明，JSON 当 JS 解析会语法错误），
 * 所以这不是数据泄露；但它是一个免费的本地资源消耗器，还能探测出你在跑这个工具。
 *
 * Sec-Fetch-Site 是浏览器强制加的、脚本无法伪造的头：
 *   same-origin —— 我们自己的页面发的
 *   none        —— 用户直接敲地址栏/点书签
 *   cross-site / same-site —— 别的站点发起的，一律拒
 *
 * 头不存在时放行：那是 curl 这类非浏览器客户端，而攻击场景的前提就是「在浏览器里」。
 */
const SAFE_FETCH_SITES = new Set(['same-origin', 'none']);

function fetchMetadataGuard(req, res, next) {
  const site = req.get('Sec-Fetch-Site');
  if (site && !SAFE_FETCH_SITES.has(site)) {
    return res.status(403).json({
      success: false,
      error: '跨站发起的请求已拒绝 / Cross-site request refused',
    });
  }
  next();
}

/**
 * 安全响应头。CSP 收紧到只允许同源脚本/样式，
 * 顺带堵死「进程名里塞了标签」这类注入的最后一环（前端也已全部用 textContent）。
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  // 端口状态是实时数据，任何缓存都是错误答案。
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
}

/** 给 kill 这类破坏性操作加一个朴素的令牌桶，防手滑连点和脚本刷。 */
function createRateLimiter({ windowMs = 10_000, max = 10 } = {}) {
  let hits = [];
  return function rateLimit(req, res, next) {
    const now = Date.now();
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({
        success: false,
        error: `操作过于频繁，请 ${Math.ceil(windowMs / 1000)} 秒后重试`,
      });
    }
    hits.push(now);
    next();
  };
}

module.exports = {
  CSRF_TOKEN,
  hostGuard,
  csrfGuard,
  fetchMetadataGuard,
  securityHeaders,
  createRateLimiter,
};
