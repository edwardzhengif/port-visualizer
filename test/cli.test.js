'use strict';

/**
 * CLI 层测试。
 *
 * 这一层现在是**唯一**的启动路径 —— server/app.js 只导出 express app，
 * 监听、端口探测、参数解析全在 bin/ 里。以前 app.js 自己也能 listen，
 * 于是「你开发时跑的」和「用户装完跑的」是两段不同的代码，只有一段被测到。
 *
 * 重点测参数出错时**明确失败**：静默回退到默认端口比报错糟得多 ——
 * 用户以为 -p 8080 生效了，实际服务起在 3000，然后开始怀疑人生。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'port-visualizer.js');

function run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { timeout: 15_000, ...opts },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
  });
}

/** 起一个真实服务，回调里拿到端口，结束后收干净。 */
function withServer(args, fn) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [BIN, '--no-open', ...args]);
    let out = '';
    const done = (err, val) => {
      child.kill('SIGTERM');
      if (err) reject(err); else resolve(val);
    };
    child.stdout.on('data', async (chunk) => {
      out += chunk;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (!m) return;
      child.stdout.removeAllListeners('data');
      try { done(null, await fn(Number(m[1]), out)); } catch (e) { done(e); }
    });
    setTimeout(() => done(new Error(`启动超时，输出：${out}`)), 12_000).unref();
  });
}

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

test('--help 和 --version 正常退出', async () => {
  const help = await run(['--help']);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /--readonly/, '帮助里应列出所有选项');
  assert.match(help.stdout, /127\.0\.0\.1|只监听/, '帮助里必须说明只监听本机 —— 这是最该被知道的约束');

  const ver = await run(['--version']);
  assert.strictEqual(ver.code, 0);
  assert.strictEqual(ver.stdout.trim(), require('../package.json').version);
});

test('参数出错时明确失败，不静默回退', async () => {
  for (const args of [['-p'], ['-p', 'abc'], ['-p', '0'], ['-p', '70000'], ['--nope']]) {
    const r = await run(args);
    assert.strictEqual(r.code, 1, `${args.join(' ')} 应该以非零码退出`);
    assert.match(r.stderr, /--help/, '报错里要指路');
  }
});

test('目标端口被占用时自动往后找', async () => {
  // 一个「端口查看器」因为自己要用的端口被占而启动失败，是最难看的失败方式 ——
  // 何况用户来装它，往往正是因为不知道端口被谁占了
  const squatter = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => squatter.once('listening', r));
  const taken = squatter.address().port;

  try {
    await withServer(['-p', String(taken)], (port, out) => {
      assert.notStrictEqual(port, taken, '应该换一个端口');
      assert.match(out, new RegExp(`${taken} 已被占用`), '换端口这件事必须说出来，不能偷偷换');
    });
  } finally {
    squatter.close();
  }
});

test('真的能起来并出货', async () => {
  await withServer([], async (port) => {
    const index = await get(`http://127.0.0.1:${port}/`);
    assert.strictEqual(index.status, 200);
    // token 必须被替换掉 —— 留着占位符意味着前端所有写操作都会 403
    assert.ok(!index.body.includes('__CSRF_TOKEN__'), 'CSRF 占位符没有被替换');
    assert.match(index.body, /name="csrf-token" content="[0-9a-f]{64}"/, 'token 格式不对');

    const api = await get(`http://127.0.0.1:${port}/api/ports`);
    const json = JSON.parse(api.body);
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.data), '应返回端口数组');
  });
});

test('--readonly 会传导到接口', async () => {
  await withServer(['--readonly'], async (port) => {
    const { body } = await get(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(JSON.parse(body).data.readonly, true,
      '--readonly 必须真的传到服务端，只改提示文案等于没做');
  });
});

test('非 localhost 的 Host 头会被拒 —— 防 DNS rebinding', async () => {
  await withServer([], async (port) => {
    const res = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/ports', headers: { Host: 'evil.example.com' } },
        (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, body: b })); })
        .on('error', reject);
    });
    // rebinding 时受害者浏览器发出的 Host 是攻击者域名，这道防线就是拦它的
    assert.strictEqual(res.status, 403, `应拒绝，实际 ${res.status}`);
  });
});

test('看不到别人的进程时，接口如实上报，不假装看全了', async () => {
  /*
   * macOS 上非 root 的 lsof 只枚举调用者自己的进程 —— mDNSResponder 明明在跑、
   * 明明持有 UDP 5353，lsof 一条都不返回。这导致「全部进程 / 我的进程」筛选
   * 在那些机器上只有一个值，而整条「需要 sudo」路径不可达。
   *
   * 沉默的失败比报错更糟：用户会以为「我的电脑上真的只有我自己的进程」，
   * 而那是个错误的世界观 —— 这个工具本该纠正它，不该加固它。
   * 所以 meta 必须带上「这次到底看没看见别人」。
   */
  await withServer([], async (port) => {
    const { body } = await get(`http://127.0.0.1:${port}/api/ports`);
    const { meta, data } = JSON.parse(body);

    assert.strictEqual(typeof meta.canSeeOthers, 'boolean', 'meta 必须给出可见性结论');
    assert.strictEqual(typeof meta.runningAsRoot, 'boolean');

    // 结论必须和数据本身一致，不能是拍脑袋写死的
    assert.strictEqual(meta.canSeeOthers, data.some((p) => !p.analysis.isMine),
      'canSeeOthers 必须由本次扫描结果推出');
    assert.strictEqual(meta.runningAsRoot, process.getuid?.() === 0);
  });
});

test('跨站发起的请求被拒 —— <img src> 不发 Origin，CSRF 那道拦不住它', async () => {
  /*
   * 实测发现的真实缺口：csrfGuard 只在**存在** Origin 时校验它，
   * 而浏览器加载 <img src="http://127.0.0.1:3000/api/ports"> 时根本不发 Origin。
   * Host 是真的 127.0.0.1（过 hostGuard），方法是 GET（csrfGuard 直接放行）——
   * 结果任何一个你打开的网页都能让这台机器反复 fork lsof + ps。
   *
   * 读不到数据（跨源响应不透明），但那是一个免费的本地资源消耗器。
   * Sec-Fetch-Site 是浏览器强制加的、脚本伪造不了的头，用它堵。
   */
  await withServer([], async (port) => {
    const req = (headers) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/ports', headers },
        (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject);
    });

    assert.strictEqual(await req({ 'Sec-Fetch-Site': 'cross-site' }), 403, '跨站必须拒');
    assert.strictEqual(await req({ 'Sec-Fetch-Site': 'same-site' }), 403,
      '同站不同源（另一个本地端口）也要拒 —— 别的本地服务不该能驱动扫描');
    assert.strictEqual(await req({ 'Sec-Fetch-Site': 'same-origin' }), 200, '我们自己的页面要放行');
    assert.strictEqual(await req({ 'Sec-Fetch-Site': 'none' }), 200, '地址栏直接访问要放行');
    // 没有这个头的是 curl 这类非浏览器客户端，而攻击场景的前提就是「在浏览器里」
    assert.strictEqual(await req({}), 200, '非浏览器客户端不该被误伤');
  });
});

test('扫描端点有限流 —— 不依赖浏览器行为的兜底', async () => {
  await withServer([], async (port) => {
    const hit = () => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/ports' },
        (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject);
    });
    const codes = [];
    for (let i = 0; i < 40; i += 1) codes.push(await hit());   // eslint-disable-line no-await-in-loop
    // 每次 /api/ports 都 fork 一次 lsof + ps，是本服务最贵的操作
    assert.ok(codes.includes(429), `连打 40 次应触发限流，实际: ${[...new Set(codes)].join(',')}`);
    assert.ok(codes.filter((c) => c === 200).length >= 25,
      '限流不能太紧 —— 多开几个标签页、手动连点刷新都要还能用');
  });
});
