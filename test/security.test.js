'use strict';

/**
 * 安全中间件的单元测试。
 *
 * 这些都是纯函数式的中间件，不碰网络也不 fork 进程 —— 所以断言是确定性的。
 *
 * 限流这一条原本写在 cli.test.js 里，做法是连打 40 次 /api/ports 看有没有 429。
 * 那个写法在 CI 上暴露了真正的问题：**它断言的是机器够不够快，不是限流逻辑对不对**。
 * 每次 /api/ports 都会 fork 一次 lsof + ps；Linux 容器上 40 次不到一秒跑完，
 * 稳稳触发限流；macOS 每次几百毫秒、Windows 还要起 PowerShell，40 次超过 10 秒的
 * 窗口期，滑动窗口早把前面的请求过期了，于是永远攒不满阈值。
 *
 * 教训：**一个依赖 wall-clock 速度的断言，不是测试，是掷骰子。**
 * 逻辑本身用假的时钟测，wiring 靠代码评审看那一行 `app.get('/api/ports', scanLimiter, …)`。
 */

const test = require('node:test');
const assert = require('node:assert');

const { createRateLimiter, hostGuard, csrfGuard, fetchMetadataGuard } = require('../server/security');

/** 造一个最小的 req/res/next 三元组，只暴露中间件真正用到的那几个方法。 */
function ctx({ headers = {}, method = 'GET', path = '/api/ports' } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  let statusCode = 200;
  let body = null;
  let nexted = false;
  return {
    req: { method, path, headers: lower, get: (h) => lower[h.toLowerCase()], query: {} },
    res: {
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; },
      setHeader() {},
    },
    next: () => { nexted = true; },
    result: () => ({ status: nexted ? 200 : statusCode, blocked: !nexted, body }),
  };
}

const run = (mw, opts) => { const c = ctx(opts); mw(c.req, c.res, c.next); return c.result(); };

/* ------------------------------------------------------------------ 限流 */

test('限流：窗口内超过阈值就拒，且拒的是第 N+1 个', () => {
  const limit = createRateLimiter({ windowMs: 10_000, max: 3 });
  const hit = () => run(limit);

  assert.strictEqual(hit().blocked, false, '第 1 个应放行');
  assert.strictEqual(hit().blocked, false, '第 2 个应放行');
  assert.strictEqual(hit().blocked, false, '第 3 个应放行');

  const fourth = hit();
  assert.strictEqual(fourth.blocked, true, '第 4 个应被拒');
  assert.strictEqual(fourth.status, 429, '必须是 429，不是笼统的 403/500');
  assert.match(fourth.body.error, /10|频繁|frequent/i, '错误信息要告诉用户等多久');
});

test('限流：窗口滑过之后要放行 —— 否则就成了永久封禁', async () => {
  // 用极短窗口，让「时间流逝」这件事在测试里可控且快
  const limit = createRateLimiter({ windowMs: 60, max: 2 });
  run(limit); run(limit);
  assert.strictEqual(run(limit).blocked, true, '第 3 个在窗口内应被拒');

  await new Promise((r) => setTimeout(r, 90));
  assert.strictEqual(run(limit).blocked, false, '窗口过后必须恢复');
});

/* ------------------------------------------------------ 跨站 / Host 防线 */

test('fetchMetadataGuard：只放行同源与直接访问', () => {
  /*
   * <img src="http://127.0.0.1:3000/api/ports"> 这类子资源加载**不发 Origin**，
   * 所以 csrfGuard 的 if(origin) 分支根本不进，GET 被直接放行 ——
   * 任何你打开的网页都能让这台机器循环 fork lsof。Sec-Fetch-Site 是浏览器
   * 强制加的、脚本伪造不了的头，用它堵这个洞。
   */
  const cases = [
    ['same-origin', false, '我们自己的页面'],
    ['none', false, '用户直接敲地址栏'],
    ['cross-site', true, '别的站点发起'],
    ['same-site', true, '同站不同源 —— 另一个本地服务也不该能驱动扫描'],
  ];
  for (const [site, shouldBlock, why] of cases) {
    const r = run(fetchMetadataGuard, { headers: { 'Sec-Fetch-Site': site } });
    assert.strictEqual(r.blocked, shouldBlock, `${site}（${why}）`);
    if (shouldBlock) assert.strictEqual(r.status, 403);
  }
  // 没有这个头的是 curl 之类的非浏览器客户端，而攻击场景的前提就是「在浏览器里」
  assert.strictEqual(run(fetchMetadataGuard).blocked, false, '非浏览器客户端不该被误伤');
});

test('hostGuard：只认回环主机名 —— 防 DNS rebinding', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'localhost']) {
    assert.strictEqual(run(hostGuard, { headers: { host } }).blocked, false, `${host} 应放行`);
  }
  // rebinding 时受害者浏览器发出的 Host 是攻击者域名，这道防线就是拦它的
  for (const host of ['evil.example.com', 'evil.example.com:3000', '192.168.1.9:3000', '']) {
    assert.strictEqual(run(hostGuard, { headers: { host } }).blocked, true, `${host} 应被拒`);
  }
});

test('csrfGuard：写操作必须带 token，读操作放行', () => {
  const { CSRF_TOKEN } = require('../server/security');

  assert.strictEqual(run(csrfGuard, { method: 'GET' }).blocked, false, 'GET 放行');
  assert.strictEqual(run(csrfGuard, { method: 'HEAD' }).blocked, false, 'HEAD 放行');

  const noToken = run(csrfGuard, { method: 'POST' });
  assert.strictEqual(noToken.blocked, true, '无 token 的 POST 必须拒');
  assert.strictEqual(noToken.status, 403);

  assert.strictEqual(
    run(csrfGuard, { method: 'POST', headers: { 'X-CSRF-Token': CSRF_TOKEN } }).blocked,
    false, '带正确 token 的 POST 应放行',
  );
  assert.strictEqual(
    run(csrfGuard, { method: 'POST', headers: { 'X-CSRF-Token': 'wrong' } }).blocked,
    true, 'token 不匹配要拒',
  );
  // 浏览器不允许脚本伪造 Origin，所以有 Origin 时它是可信的信号
  assert.strictEqual(
    run(csrfGuard, { method: 'GET', headers: { Origin: 'https://evil.example' } }).blocked,
    true, '跨源 Origin 即使是 GET 也要拒',
  );
});
