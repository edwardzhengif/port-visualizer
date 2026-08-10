'use strict';

/**
 * 浏览器端行为测试：加载 dist/ 里真实构建出来的 bundle，在 jsdom 里跑。
 *
 * 这一层能抓到构建和 SSR 都抓不到的东西 —— 组件嵌套关系错误、
 * 事件绑定失效、弹窗打不开。踩过的两个坑都属于这类：
 *   · <ToastProvider> 包住 App → 整页空白，构建和控制台都没有任何异常
 *   · Modal.Backdrop 与 Container 写成并列 → 只有遮罩，对话框不挂载
 *
 * 需要先 npm run build。没有 dist/ 时整组跳过。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
/*
 * 取「更新的那个」产物，而不是盲目优先 dist/。
 *
 * 两个产物会同时存在：dist/ 是带 license 的真实构建，dist-stub/ 是无 license 环境的构建。
 * 盲目优先 dist/ 时，只要它比 dist-stub/ 旧，测试就在验证一份过期代码 ——
 * 改对了报失败、改错了报通过，两个方向都会误导。被这个坑绊过两次。
 */
const REAL = path.join(ROOT, 'dist');
const STUB = path.join(ROOT, 'dist-stub');
const mtimeOf = (d) => {
  try { return fs.statSync(path.join(d, 'index.html')).mtimeMs; } catch { return -1; }
};
const DIST = mtimeOf(REAL) >= mtimeOf(STUB) ? REAL : STUB;
const IS_STUB = DIST === STUB;

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { /* 下面统一跳过 */ }

const ready = JSDOM && fs.existsSync(path.join(DIST, 'index.html'));

/**
 * 产物比源码旧时必须喊出来。
 *
 * 否则这一层的结论会彻底失真：测试报的是「上一次构建」的行为，
 * 而你以为它验的是刚改完的代码 —— 改对了显示失败，改错了显示通过，两种方向都可能。
 * 实际被这个坑绊过一次。
 */
function newestSourceMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSourceMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

if (ready) {
  if (IS_STUB) console.log('  ⚠ 正在测试桩产物（dist-stub/）—— Pro 组件与样式不是真实实现');
  const builtAt = fs.statSync(path.join(DIST, 'index.html')).mtimeMs;
  const srcAt = newestSourceMtime(path.join(ROOT, 'web', 'src'));
  if (srcAt > builtAt) {
    const mins = Math.round((srcAt - builtAt) / 60000);
    console.log(`  ⚠ ${path.basename(DIST)}/ 比源码旧 ${mins} 分钟 —— 结论不代表当前代码，请先 npm run build`);
  }
}
if (!ready) {
  test('浏览器测试需要 jsdom 与 dist/（先 npm run build）', { skip: true }, () => {});
  return;
}

const { analyze } = require('../server/knowledge');

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace('__CSRF_TOKEN__', 'tok');
const bundleName = fs.readdirSync(path.join(DIST, 'assets')).find((f) => f.endsWith('.js'));
const bundle = fs.readFileSync(path.join(DIST, 'assets', bundleName), 'utf8');

const ME = { uid: 501, username: 'edward' };
const mk = (o) => {
  const r = {
    protocol: 'TCP', state: 'LISTEN', families: ['IPv4'], addresses: [`*:${o.port}`],
    exposure: 'all', uid: 501, user: 'edward', elapsed: 300, ppid: 1, rssBytes: 5e7,
    ...o,
  };
  // id 必须跟着真实协议走 —— 写死 TCP 会让 UDP 行和同端口的 TCP 行撞 key
  return { ...r, id: `${r.protocol}|${r.port}|${r.pid}`, analysis: analyze(r, ME) };
};

const PORTS = [
  mk({ port: 3000, process: 'node', pid: 101, cmdline: 'node /app/node_modules/.bin/vite' }),
  mk({ port: 5432, process: 'postgres', pid: 202, cmdline: 'postgres -D /data', elapsed: 9 * 86400 }),
  mk({ port: 1, process: 'launchd', pid: 1, uid: 0, user: 'root', cmdline: '/sbin/launchd' }),
  // 别人账号下的进程：kill 一定 EPERM，界面应提前给出 sudo 路径。
  // mDNS 真实场景就走 UDP，顺便让样本覆盖到两种协议 —— 只有 TCP 的样本测不出协议分面
  mk({ port: 5353, protocol: 'UDP', state: '', process: 'mDNSResponder', pid: 303,
    uid: 65, user: '_mdnsre…', cmdline: '/usr/sbin/mDNSResponder' }),
  mk({ port: 8080, protocol: 'UDP', state: '', process: 'node', pid: 404,
    addresses: ['127.0.0.1:8080'], exposure: 'loopback', cmdline: 'node udp-relay.js' }),
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一个装好真实 bundle 的页面。initialView 用来复现「偏好停在表格视图」的场景。 */
async function boot(initialView = 'cards', { theme, systemDark = false, onlyMine, lang = 'en', navLang, asRoot = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:3000/' });
  const { window } = dom;

  // React 19 的调度器靠 MessageChannel 排任务，jsdom 没实现 ——
  // 不补的话 createRoot().render() 会静默地什么都不做，且不报错
  window.MessageChannel = class {
    constructor() {
      const L = {};
      const mk2 = (me, other) => ({
        set onmessage(f) { L[me] = f; },
        get onmessage() { return L[me]; },
        postMessage(d) { setTimeout(() => L[other]?.({ data: d }), 0); },
        addEventListener(_t, f) { L[me] = f; },
        removeEventListener() { L[me] = null; },
        start() {}, close() {},
      });
      this.port1 = mk2('a', 'b');
      this.port2 = mk2('b', 'a');
    }
  };
  // matchMedia 必须挂在 window 上，只挂 globalThis 无效
  window.matchMedia = (q) => ({
    matches: /prefers-color-scheme:\s*dark/.test(q || '') ? systemDark : false,
    media: q || '', onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.scrollTo = () => {};
  window.navigator.clipboard = { writeText: async () => {} };
  window.open = () => null;
  Object.defineProperty(window.document.body, 'scrollHeight', { value: 4000, configurable: true });

  if (navLang) Object.defineProperty(window.navigator, 'languages', { value: [navLang], configurable: true });

  window.localStorage.setItem('pv.view', JSON.stringify(initialView));
  // navLang 用于测「首次访问按浏览器语言猜」，此时不能有存档
  if (!navLang) window.localStorage.setItem('pv.lang', JSON.stringify(lang));
  if (theme) window.localStorage.setItem('pv.theme', JSON.stringify(theme));
  if (onlyMine !== undefined) window.localStorage.setItem('pv.onlyMine', JSON.stringify(onlyMine));

  const calls = { kill: null, langs: [] };
  window.fetch = async (u, opts = {}) => {
    const url = String(u);
    const qLang = /[?&]lang=([^&]*)/.exec(url)?.[1];
    if (qLang) calls.langs.push(qLang);
    const zh = qLang === 'zh';
    if (url.startsWith('/api/ports') && !url.includes('/kill')) {
      const data = PORTS.map((p) => ({ ...p, analysis: analyze(p, ME, null, qLang || 'en') }));
      return { ok: true, json: async () => ({ success: true, data,
        meta: { platform: 'darwin', total: data.length, readonly: false, currentUser: 'edward', mine: 2,
          canSeeOthers: data.some((p) => !p.analysis.isMine), runningAsRoot: asRoot } }) };
    }
    if (url.startsWith('/api/tips')) {
      return { ok: true, json: async () => ({ success: true, data: { fields: {
        port: zh
          ? { title: '端口', tip: '可以理解成一栋楼的门牌号，同一时间只能挂给一个程序。' }
          : { title: 'Port', tip: 'Think of it as a street number on a building.' },
      } } }) };
    }
    if (false) {
      return null;
    }
    if (url === '/api/unknown') return { ok: true, json: async () => ({ success: true, data: [], localFile: 'x' }) };
    if (url.includes('/kill')) { calls.kill = JSON.parse(opts.body); return { ok: true, json: async () => ({ success: true, message: 'ok' }) }; }
    return { ok: false, json: async () => ({ success: false, error: '404' }) };
  };

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  window.eval(bundle);
  await wait(1200);

  /**
   * 往受控输入框里打字。
   *
   * 不能直接 `el.value = x` 再 dispatch('input')：React 给 value 装了一个
   * 「值追踪器」，直接赋值会把追踪器一起改掉，React 比对后认为没变化，
   * onChange 根本不触发 —— 测试于是在一个永远空着的输入框上按回车。
   * 之前控制台那两个测试就是这么「通过」的：断言的字串恰好在页面别处出现。
   * 必须走原型上的原生 setter，绕开追踪器。
   */
  const type = (el, text) => {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };

  return {
    window, errors, calls, type,
    $: (s) => window.document.querySelector(s),
    $$: (s) => [...window.document.querySelectorAll(s)],
    root: () => window.document.getElementById('root'),
    text: () => window.document.body.textContent || '',
    buttons: () => [...window.document.querySelectorAll('button')],
  };
}

test('应用能渲染，且没有触发错误边界', async () => {
  const t = await boot();
  assert.ok(t.root().childElementCount > 0, '整棵树被吞掉了（检查 ToastProvider 是否包住了 App）');
  assert.ok(!t.text().includes('渲染失败'), t.text().slice(0, 200));
  assert.ok(t.text().includes('5432'), '端口数据应上屏');
});

test('表格视图能渲染 —— Table 必须有 Table.Content 这一层', async () => {
  const t = await boot('table');
  assert.ok(!t.text().includes('渲染失败'), t.text().slice(0, 200));
  assert.ok(t.$('table'), '没有 <table>，collection 层次可能又错了');
  assert.ok(t.$$('table tbody tr').length > 0);
});

test('字段说明弹窗真的有内容，不只是一层遮罩', async () => {
  const t = await boot();
  const btn = t.buttons().find((b) => b.textContent.trim() === 'What do these mean?');
  assert.ok(btn, '找不到字段说明按钮');
  btn.click();
  await wait(600);

  // Modal.Backdrop / Container / Dialog 写成并列时，遮罩在但对话框不挂载
  assert.ok(t.$('[role="dialog"]'), '对话框没有挂载（检查 Modal 的嵌套关系）');
  assert.match(t.text(), /street number/, '弹窗里应有实际说明文字');
});

test('终止确认弹窗写明后果，并回传 PID', async () => {
  const t = await boot();
  const kill = t.buttons().find((b) => b.textContent.trim() === 'Kill' && !b.disabled);
  assert.ok(kill, '找不到可用的终止按钮');
  kill.click();
  await wait(600);

  assert.match(t.text(), /If killed:/);
  assert.match(t.text(), /Risk level:/);

  const ok = t.buttons().find((b) => b.textContent.trim() === 'Terminate');
  assert.ok(ok, '确认按钮不在');
  ok.click();
  await wait(400);
  assert.ok(t.calls.kill?.pid > 0, '必须回传用户当时看到的 PID');
});

test('归属筛选在筛选行里，且默认隐藏 root 进程', async () => {
  const t = await boot();
  // 「只看我的进程」已从孤立开关改为筛选行里的下拉
  assert.ok(t.text().includes('My processes'), '归属筛选不在');
  assert.ok(!t.text().includes('launchd'), 'root 进程默认应被隐藏');
  assert.match(t.text(), /not owned by you are hidden/, '应明确告知隐藏了多少');
});

test('悬浮胶囊是单行输入，不是多行 composer', async () => {
  const t = await boot();
  const dock = t.$('.dock');
  assert.ok(dock, '胶囊不在');

  const ta = dock.querySelector('.capsule textarea');
  assert.ok(ta, '胶囊里没有输入框');
  // 之前用组件库时默认变体是 280px 高的多行 composer，形状完全不对。
  // 现在单行是布局本身的性质：rows=1 + CSS 的 min-height，没有选错变体的余地
  assert.strictEqual(ta.rows, 1, '起始必须是一行');

  // $ 在左栏、操作键在右栏，两栏都是固定 32px 高，才能和输入框首行对齐
  assert.match(dock.querySelector('.capsule__start')?.textContent || '', /\$/, '$ 应在左栏');
  assert.ok(dock.querySelector('.capsule__end'), '右栏槽位应存在');
});

test('产物里不含任何 HeroUI Pro 代码', async () => {
  // Pro 是商业授权包，禁止再分发其源码。这条断言是「仓库可开源」的底线，
  // 一旦有人手滑 import 回来，这里会立刻炸
  assert.ok(!/heroui-pro/i.test(bundle), 'JS 产物里出现了 heroui-pro 的痕迹');
  const cssName = fs.readdirSync(path.join(DIST, 'assets')).find((f) => f.endsWith('.css'));
  const css = fs.readFileSync(path.join(DIST, 'assets', cssName), 'utf8');
  assert.ok(!/heroui-pro/i.test(css), 'CSS 产物里出现了 heroui-pro 的痕迹');
  // sourcemap 有 4.4MB，里面是 Pro 的**原始源码**，属于字面意义上的再分发
  assert.strictEqual(fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.map')).length, 0,
    '不该产出 sourcemap');
});

test('工具栏与卡片共用同一套视觉语言（宽度与圆角）', async () => {
  const t = await boot();
  const toolbar = t.$('.sticky');
  const card = t.$('article, [class*="card"]');
  assert.ok(toolbar, '工具栏不在');

  // 之前工具栏用 -mx-5 撑出容器的 px-5，比卡片每边宽 20px
  assert.ok(!/-mx-/.test(toolbar.className),
    `工具栏不能用负 margin 撑出容器，会比卡片宽（当前 class="${toolbar.className}"）`);
  assert.match(toolbar.className, /rounded-xl/, '工具栏圆角要和卡片一致');
  if (card) assert.match(card.className, /rounded-xl/, '卡片圆角要和工具栏一致');
});

test('表格点端口号原地开弹窗，不切走视图', async () => {
  const t = await boot('table');
  assert.ok(t.$('table'), '应处于表格视图');

  const portBtn = t.$$('table button').find((b) => /^\d+$/.test(b.textContent.trim()));
  assert.ok(portBtn, '表格里找不到端口号按钮');
  portBtn.click();
  await wait(600);

  // 之前的行为是切到卡片视图再展开：表格消失、滚动位置丢失、还得手动切回来
  assert.ok(t.$('table'), '表格必须还在 —— 不能把人踢去卡片视图');
  assert.ok(t.$('[role="dialog"]'), '应原地弹出详情');
  assert.match(t.text(), /If killed:/, '弹窗里应有完整详情');
});

test('卡片不再画左侧风险色带，风险只由徽标承载', async () => {
  const t = await boot();
  const card = t.$('article, [class*="card"]');
  assert.ok(card, '卡片不在');
  // inset 阴影是之前画色带的手法
  assert.ok(!/inset_3px/.test(card.className),
    `卡片不该再有左侧色带（当前 class="${card.className}"）`);
  // 但风险信息本身不能丢
  assert.match(t.text(), /Low risk|Medium risk|High risk|Do not kill/, '风险徽标必须还在');
});

/* ------------------------------------------------------------------ 主题 */

test('默认深色，且首帧之前就落定（不闪）', async () => {
  const t = await boot();
  const el = t.window.document.documentElement;
  assert.ok(el.classList.contains('dark'), '默认应为深色');
  assert.strictEqual(el.dataset.theme, 'dark', 'data-theme 也要设上，HeroUI 两个都认');
});

test('亮色偏好被记住', async () => {
  const t = await boot('cards', { theme: 'light' });
  const el = t.window.document.documentElement;
  assert.ok(!el.classList.contains('dark'), '选了亮色就不该带 dark 类');
  assert.strictEqual(el.dataset.theme, 'light');
});

test('跟随系统时按系统偏好走，两个方向都要对', async () => {
  const dark = await boot('cards', { theme: 'system', systemDark: true });
  assert.ok(dark.window.document.documentElement.classList.contains('dark'),
    '系统是深色时应为深色');

  const light = await boot('cards', { theme: 'system', systemDark: false });
  assert.ok(!light.window.document.documentElement.classList.contains('dark'),
    '系统是亮色时应为亮色');
});

test('主题切换器有三档且可点', async () => {
  const t = await boot();
  const seg = t.$$('[aria-label="Theme"] button')
    .filter((b) => /Light|Dark|Follow system/.test(b.getAttribute('aria-label') || ''));
  assert.strictEqual(seg.length, 3, `应有三档，实际 ${seg.length}`);

  const light = seg.find((b) => b.getAttribute('aria-label') === 'Light');
  light.click();
  await wait(300);
  assert.ok(!t.window.document.documentElement.classList.contains('dark'), '点亮色后应切走深色');
});

/* ------------------------------------------------- 端口变化检测（AM 做不到的） */

test('首屏不把所有端口都标成「刚出现」', async () => {
  const t = await boot();
  // 一进页面全部标记等于没标记
  const marks = (t.text().match(/just appeared/g) || []).length;
  assert.strictEqual(marks, 0, `首屏不该有「刚出现」标记，实际 ${marks} 个`);
});

test('卡片视图有排序入口，且「最近出现」在列', async () => {
  const t = await boot();
  // 之前卡片视图完全没有排序入口，只有表格能靠表头排
  assert.ok(t.text().includes('Recently appeared') || t.$$('[aria-label="Sort by"]').length > 0,
    '卡片视图应提供排序');
});

test('表格有「出现」列，且可排序', async () => {
  const t = await boot('table');
  const heads = t.$$('table th, [role="columnheader"]').map((h) => h.textContent.trim());
  assert.ok(heads.some((h) => h.includes('Seen')), `表头应含「出现」列，实际: ${heads.join(' / ')}`);
});

test('内存标注了口径，不假装精确', async () => {
  const t = await boot();
  const toggle = t.$$('button').find((b) => b.textContent.trim() === 'Details');
  assert.ok(toggle, '找不到详情按钮');
  toggle.click();
  await wait(400);
  // RSS 含共享库、跨进程不可比 —— 不写清楚就是在误导
  assert.match(t.text(), /RSS/, '内存字段应标明是 RSS');
  assert.match(t.text(), /shared libraries|not comparable/, '应说明 RSS 的口径限制');
});

/* ------------------------------------------------------- 卡片视图的栅格 */

test('卡片视图是三列网格，不是一行一张', async () => {
  const t = await boot();
  const card = t.$('article, [class*="card"]');
  assert.ok(card, '卡片不在');

  // 通栏卡片一屏只放得下六七张，和表格的差异只剩行高，卡片视图就没有存在理由了
  const grid = card.closest('[class*="grid-cols"]');
  assert.ok(grid, `卡片容器必须是网格，实际父级 class="${card.parentElement?.className}"`);
  assert.match(grid.className, /lg:grid-cols-3/, '宽屏应为三列');
  // 350px 是这套内容排布的下限，窄屏必须能退回去，否则内容会挤成一团
  assert.match(grid.className, /grid-cols-1/, '窄屏应能退回单列');
  assert.match(grid.className, /md:grid-cols-2/, '中等宽度应为两列');
});

test('卡片详情走弹窗，不在格子里就地撑开', async () => {
  const t = await boot();
  const before = t.$$('article, [class*="card"]').length;

  const detail = t.$$('button').find((b) => b.textContent.trim() === 'Details');
  detail.click();
  await wait(500);

  // 网格里就地展开会把整行三张卡片一起撑高 —— 你只点了一张，旁边两张跟着变形
  assert.ok(t.$('[role="dialog"]'), '卡片详情应开弹窗');
  assert.strictEqual(t.$$('article, [class*="card"]').length >= before, true, '列表不该被替换掉');
  assert.match(t.text(), /If killed:/, '弹窗里应有完整详情');
});

/* --------------------------------------------------- 分面筛选（原来只是死文字） */

test('页头不吐内核代号，改说系统名和当前用户', async () => {
  const t = await boot();
  // darwin 是内核代号，是实现细节泄漏；地址栏里已经写着 localhost:3000
  assert.ok(!/darwin/.test(t.text()), '不该出现 darwin');
  assert.match(t.text(), /macOS/, '应显示系统名');
  // 「我的进程」是按谁算的，必须写出来，否则这个概念没有锚点
  assert.match(t.text(), /you are\s*edward/, '应显示当前登录用户');
});

test('统计数字可点，点了真的筛', async () => {
  const t = await boot('cards', { onlyMine: false });
  const facet = (label) => t.buttons().find((b) => b.textContent.trim().startsWith(label));

  const exposed = facet('Exposed');
  assert.ok(exposed, `找不到「对外暴露」分面，实际按钮: ${t.buttons().map((b) => b.textContent.trim()).join(' / ')}`);
  assert.strictEqual(exposed.getAttribute('aria-pressed'), 'false', '初始不该选中');

  exposed.click();
  await wait(400);
  assert.strictEqual(facet('Exposed').getAttribute('aria-pressed'), 'true', '点了要进选中态');
  // mDNSResponder 是 exposure:'all'，launchd 同理；仅本机的应被筛掉
  assert.match(t.text(), /5353/, '对外暴露的端口应还在');

  // 再点一次取消 —— 少一个「清除」按钮，也少一次找按钮的眼动
  facet('Exposed').click();
  await wait(400);
  assert.strictEqual(facet('Exposed').getAttribute('aria-pressed'), 'false', '再点应取消');
});

test('分面计数排除自身维度，不会把自己锁死', async () => {
  const t = await boot('cards', { onlyMine: false });
  const facet = (label) => t.buttons().find((b) => b.textContent.trim().startsWith(label));
  const num = (label) => Number(facet(label).textContent.replace(/\D+/g, ''));

  const udpBefore = num('UDP');
  assert.ok(udpBefore > 0, 'UDP 本来就该有数');

  facet('TCP').click();
  await wait(400);

  // 天真的实现会拿「当前可见结果」去数 UDP，于是选中 TCP 后 UDP 恒为 0，
  // 你就再也点不回 UDP —— 界面把自己锁死了
  assert.strictEqual(num('UDP'), udpBefore,
    'UDP 的计数必须先把协议这一维摘掉再算，否则选中 TCP 后就切不回去了');
});

test('工具栏不再重复提供协议/暴露/风险下拉', async () => {
  const t = await boot();
  // 同一件事留两个入口，用户得先想「该用哪个」——这本身就是负担
  for (const label of ['Protocol filter', 'Exposure filter', 'Risk filter']) {
    assert.strictEqual(t.$$(`[aria-label="${label}"]`).length, 0, `${label} 应已被分面条取代`);
  }
  // 但归属筛选留着：它切的是数据集范围，不是在结果里再切一刀
  assert.ok(t.$$('[aria-label="Process ownership filter"]').length > 0, '归属筛选应保留');
});

/* --------------------------------------------- 砍功能之后的回归 */

test('导出已移除，界面与命令里都不该再出现', async () => {
  const t = await boot();
  const btns = t.buttons().map((b) => b.textContent.trim());
  assert.ok(!btns.some((x) => /导出|Export/.test(x)), `工具栏仍有导出按钮: ${btns.join(' / ')}`);

  // 命令表里也要清干净，否则 help 会列出一个执行不了的命令
  t.$('#cmd, .dock textarea, .dock input')?.focus();
  const ta = t.$('.dock textarea') || t.$('.dock input');
  assert.ok(ta, '胶囊输入框不在');
  t.type(ta, 'help');
  ta.dispatchEvent(new t.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(400);
  // 先确认 help 真的执行了，否则下面那条断言是在空页面上「通过」的
  assert.match(t.text(), /List all commands/, 'help 没有真正执行');
  assert.ok(!/导出 CSV|Export CSV/.test(t.text()), 'help 里还列着已移除的 export 命令');
});

test('自动刷新改成聚焦触发，不再定时轮询', async () => {
  const t = await boot();
  const btn = t.buttons().find((b) => /Refresh on focus/.test(b.textContent));
  assert.ok(btn, `找不到「回到页面时刷新」按钮，实际按钮: ${t.buttons().map((b) => b.textContent.trim()).join(' / ')}`);

  // 定时轮询每 5 秒 fork 一次 lsof，而端口变化由「你敲了条命令」决定，不由时钟决定
  assert.ok(!/自动刷新|Auto-refresh/.test(t.text()), '不该再出现「自动刷新」这个说法');
});

test('控制台保留且仍能执行命令', async () => {
  const t = await boot();
  const ta = t.$('.dock textarea') || t.$('.dock input');
  t.type(ta, 'stats');
  ta.dispatchEvent(new t.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(400);
  assert.match(t.text(), /\$ stats/, '命令应被回显');
  assert.match(t.text(), /ports total/, '控制台命令应有输出');
});

/* ------------------------------------------------- 非本账号进程的 sudo 路径 */

test('别人账号的进程：按钮说「需要 sudo」，不发注定失败的请求', async () => {
  // 直接从 localStorage 关掉「只看我的进程」—— 比模拟点下拉更确定
  const t = await boot('cards', { onlyMine: false });

  // 定位到 mDNSResponder 那张卡 —— launchd 虽然也不是你的，但它是 blocked，
  // 显示的应该是更强的那个约束（禁止终止），不是「需要 sudo」
  const card = t.$$('article, [class*="card"]').find((c) => /mDNSResponder/.test(c.textContent));
  assert.ok(card, '找不到 mDNSResponder 的卡片');
  const sudoBtn = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Needs sudo');
  assert.ok(sudoBtn, `mDNSResponder 应显示「需要 sudo」，实际: ${[...card.querySelectorAll('button')].map((b) => b.textContent.trim()).join(' / ')}`);

  sudoBtn.click();
  await wait(500);
  // 不该发 kill 请求 —— 那一定是 403，白跑一趟还给用户一个失败
  assert.strictEqual(t.calls.kill, null, '不该对别人账号的进程发 kill 请求');
  assert.match(t.text(), /administrator privileges|sudo kill/,
    `应解释原因并给出命令。dialog 数: ${t.$$('[role="dialog"]').length}，正文尾部: ${t.text().slice(-260)}`);
});

test('sudo 说明解释了「为什么我的电脑有不属于我的进程」', async () => {
  const t = await boot('cards', { onlyMine: false });
  const card2 = t.$$('article, [class*="card"]').find((c) => /mDNSResponder/.test(c.textContent));
  [...card2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Needs sudo')?.click();
  await wait(500);
  // 只给命令不解释原因，用户下次还是会困惑
  assert.match(t.text(), /restricted account|its own .*account/, '应说明 macOS 的权限分离设计');
  assert.match(t.text(), /sudo kill -15 303/, '应给出可直接粘贴的命令');
});

test('自己的进程不受影响，仍是普通的「终止」', async () => {
  const t = await boot();
  const kill = t.buttons().find((b) => b.textContent.trim() === 'Kill' && !b.disabled);
  assert.ok(kill, '自己的进程应能直接终止');
  assert.ok(!t.buttons().some((b) => b.textContent.trim() === 'Needs sudo'),
    '只看我的进程时不该出现 sudo 按钮');
});

test('禁止终止 强于 需要 sudo —— 同时命中时显示更强的约束', async () => {
  const t = await boot('cards', { onlyMine: false });
  const card = t.$$('article, [class*="card"]').find((c) => /launchd/.test(c.textContent));
  assert.ok(card, '找不到 launchd 卡片');
  const labels = [...card.querySelectorAll('button')].map((b) => b.textContent.trim());
  // launchd 既不是你的账号、也是系统关键进程。标成「需要 sudo」会让人以为加 sudo 就能杀
  assert.ok(!labels.includes('Needs sudo'),
    `launchd 应显示禁止终止而非「需要 sudo」，实际: ${labels.join(' / ')}`);
});

/* ------------------------------------------------------------------ 语言 */

test('默认英文；浏览器是中文时直接给中文', async () => {
  // 这个包发在 npm 上，点进来的人多数读英文 —— 默认英文是覆盖面最大的选择
  const en = await boot('cards', { navLang: 'fr-FR' });
  assert.match(en.text(), /My processes/, '非中文浏览器应得到英文');

  // 但已经是中文环境的人不该先看一屏英文再去找开关
  const zh = await boot('cards', { navLang: 'zh-CN' });
  assert.match(zh.text(), /我的进程/, 'zh-CN 应直接给中文');
});

test('切到中文后，界面文案和端口解读一起变', async () => {
  const t = await boot('cards', { lang: 'en' });
  assert.match(t.text(), /My processes/);

  const zhBtn = t.buttons().find((b) => b.getAttribute('aria-label') === '中文');
  assert.ok(zhBtn, `找不到中文切换按钮，实际: ${t.buttons().map((b) => b.getAttribute('aria-label')).filter(Boolean).join(' / ')}`);
  zhBtn.click();
  await wait(700);

  assert.match(t.text(), /我的进程/, '界面文案要换');
  // 端口解读是服务端按语言生成的，切换后必须重新取一次 —— 否则界面是中文、
  // 卡片里的「Vite dev server / Low risk」还是英文，比全英文更难看
  assert.ok(t.calls.langs.includes('zh'), `切换后应带 lang=zh 重新请求，实际: ${t.calls.langs.join(',')}`);
  assert.match(t.text(), /低风险|中等风险|高风险/, '风险标签应变成中文');
});

test('语言切换器用语言自称，不用 EN/ZH 缩写', async () => {
  const t = await boot();
  // 看不懂当前界面语言的人，恰恰最需要找到这个开关 —— 「中文」他一定认得
  const labels = t.buttons().map((b) => b.getAttribute('aria-label')).filter(Boolean);
  assert.ok(labels.includes('中文'), `应有「中文」按钮，实际: ${labels.join(' / ')}`);
  assert.ok(labels.includes('English'), '应有 English 按钮');
});

test('html lang 跟着变 —— 影响断行、字体回退和读屏发音', async () => {
  const en = await boot('cards', { lang: 'en' });
  assert.strictEqual(en.window.document.documentElement.lang, 'en');
  const zh = await boot('cards', { lang: 'zh' });
  assert.strictEqual(zh.window.document.documentElement.lang, 'zh-CN');
});

test('界面上不该出现未翻译的 key', async () => {
  // makeT 缺 key 时返回 key 本身，正是为了让这种错误刺眼可见
  for (const lang of ['en', 'zh']) {
    const t = await boot('cards', { lang });
    const text = t.text();
    // 驼峰且无空格的长串就是漏翻的 key，例如 facetRisky / dlgKillTitle
    const leaked = text.match(/\b(facet|dlg|detail|col|empty|theme|sort)[A-Z][A-Za-z]{3,}\b/g) || [];
    assert.deepStrictEqual(leaked, [], `${lang}: 界面上出现了未翻译的 key`);
  }
});

test('以 root 运行时自动切到「全部进程」', async () => {
  /*
   * 上一条建议自带的坑：文档让用户 `sudo port-visualizer --readonly` 去看到更多，
   * 但 root 身份下「我的进程」筛的是 root 自己的进程 —— 用户那些 node / vite
   * 反而全被藏起来。想看更多结果看到更少，且没有任何解释。
   */
  const t = await boot('cards', { onlyMine: true, asRoot: true });
  await wait(500);
  // launchd 是 root 的、node 是 501 的；切到全部之后两者都该在
  assert.match(t.text(), /3000/, '用户自己的进程不该因为你用了 sudo 就消失');
  assert.match(t.text(), /launchd/, 'root 的进程也该在');
});

test('分面计数：无筛选时互补两格守恒，有筛选时按分面语义收缩', async () => {
  /*
   * 这条测试的第一版是**错的**，而代码是对的 —— 记下来提醒自己。
   *
   * 我看着一张截图（当时「需留意」是激活的）发现 TCP+UDP 不等于 All，
   * 以为计数漏了。实际上分面计数的语义是「点我之后会剩几条」：
   *   · TCP / UDP 排除的是协议维度，但**仍受当前风险筛选约束** → 和是「筛选后的总数」
   *   · 需留意 / 可随手关 排除的正是风险维度 → 和才回到全集
   *   · 「全部」代表清掉三个维度 → 永远是全集
   * 每个数字都自洽，只是不能横着相加。
   *
   * 教训和之前那次一样：**用错误的心智模型当对照组，会把正确的代码判成 bug。**
   * 所以这里两种状态都断言，把语义本身钉住。
   */
  const t = await boot('cards', { onlyMine: false });
  const facet = (name) => t.$(`[data-facet="${name}"]`);
  const num = (name) => {
    const b = facet(name);
    assert.ok(b, `找不到分面 ${name}`);
    return Number(b.textContent.replace(/\D+/g, ''));
  };

  // ① 无筛选：三组互补分面各自都该等于全集
  const all = num('all');
  assert.ok(all > 0, '全集不该是 0');
  assert.strictEqual(num('tcp') + num('udp'), all, '无筛选时 TCP + UDP 应等于全部');
  assert.strictEqual(num('exposed') + num('loopback'), all, '无筛选时 对外暴露 + 仅本机 应等于全部');
  assert.strictEqual(num('risky') + num('safe'), all, '无筛选时 需留意 + 可随手关 应等于全部');

  // ② 激活风险筛选后：协议/暴露两组收缩到「筛选后的总数」，风险那组仍是全集
  facet('risky').click();
  await wait(400);
  const risky = num('risky');
  assert.ok(risky < all, '「需留意」应该是全集的真子集，否则这个筛选没有意义');
  assert.strictEqual(num('tcp') + num('udp'), risky,
    '协议两格仍受风险筛选约束 —— 它们回答的是「再点我还剩几条」');
  assert.strictEqual(num('exposed') + num('loopback'), risky, '暴露两格同理');
  assert.strictEqual(num('risky') + num('safe'), all,
    '风险两格排除的正是自己这一维，所以必须仍等于全集 —— 否则就切不回去了');
  assert.strictEqual(num('all'), all, '「全部」代表清掉三个维度，不受任何筛选影响');
});
