'use strict';

/**
 * 知识库与风险分级测试。
 * 重点验证「误杀防护」这条主线是否真的成立。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  analyze, lookupProcess, lookupCmdline, humanDuration, fieldTips, FIELD_TIPS, _internal,
} = require('../server/knowledge');

const ME = { uid: 501, username: 'edward' };

const row = (over = {}) => ({
  port: 3000, protocol: 'TCP', state: 'LISTEN', process: 'node', pid: 1234,
  uid: 501, user: 'edward', elapsed: 300, cmdline: 'node server.js',
  addresses: ['*:3000'], families: ['IPv4'], exposure: 'all', ...over,
});

/* -------------------------------------------------------------- 硬拦截 */

test('系统关键进程被标记为禁止终止', () => {
  for (const name of ['launchd', 'systemd', 'kernel_task', 'WindowServer', 'lsass']) {
    const a = analyze(row({ process: name, uid: 0, user: 'root' }), ME);
    assert.strictEqual(a.blocked, true, `${name} 必须被拦截`);
    assert.strictEqual(a.risk, 'critical');
    assert.ok(a.ifKilled.length > 5, `${name} 必须说明终止后果`);
  }
});

test('普通开发进程不会被误拦截', () => {
  for (const name of ['node', 'vite', 'python3', 'ruby']) {
    const a = analyze(row({ process: name }), ME);
    assert.strictEqual(a.blocked, false, `${name} 不该被拦截`);
  }
});

/* ---------------------------------------------------------- 身份识别 */

test('完整命令行能区分同名进程 —— 这是本次改造的核心', () => {
  const dev = analyze(row({ cmdline: 'node /Users/x/app/node_modules/.bin/vite' }), ME);
  const lsp = analyze(row({ cmdline: 'node /Applications/VSCode.app/.../tsserver.js --useInferredProject' }), ME);

  assert.match(dev.title, /Vite/);
  assert.match(lsp.title, /TypeScript/);
  assert.notStrictEqual(dev.title, lsp.title, '同为 node，必须给出不同身份');
  assert.strictEqual(lsp.category, 'editor');
});

test('端口号参与身份识别', () => {
  const a = analyze(row({ process: 'unknownthing', port: 5432, cmdline: '' }), ME);
  assert.match(a.what, /PostgreSQL/);
});

/* ------------------------------------------------------------ 风险推断 */

test('root 运行会抬升风险等级', () => {
  const mine = analyze(row({ process: 'someserver', uid: 501, user: 'edward' }), ME);
  const asRoot = analyze(row({ process: 'someserver', uid: 0, user: 'root' }), ME);
  assert.strictEqual(mine.risk, 'low');
  assert.strictEqual(asRoot.risk, 'high');
  assert.ok(asRoot.reasons.some((r) => r.includes('root')));
});

test('刚启动的自有进程会被点名，帮用户认出「就是它」', () => {
  const a = analyze(row({ elapsed: 90 }), ME);
  assert.ok(a.isMine);
  assert.ok(a.reasons.some((r) => /Started .* ago/.test(r)), a.reasons.join('|'));
  const zh = analyze(row({ elapsed: 90 }), ME, null, 'zh');
  assert.ok(zh.reasons.some((r) => r.includes('刚启动')), zh.reasons.join('|'));
});

test('长期运行会被判为常驻服务并抬升风险', () => {
  const a = analyze(row({ process: 'someserver', elapsed: 30 * 86400 }), ME);
  assert.ok(['medium', 'high', 'critical'].includes(a.risk));
  assert.ok(a.reasons.some((r) => /resident service/.test(r)), a.reasons.join('|'));
});

test('isMine 走 uid 而不是用户名 —— ps 会把长用户名截断', () => {
  const truncated = analyze(row({ uid: 501, user: 'edward…' }), ME);
  assert.strictEqual(truncated.isMine, true, '用户名被截断也必须认出是我的进程');

  const other = analyze(row({ uid: 502, user: 'edward' }), ME);
  assert.strictEqual(other.isMine, false, 'uid 不同就不是我的进程');
});

test('SSH 端口即使进程未知也标为高风险', () => {
  const a = analyze(row({ port: 22, process: 'weird', uid: 501, user: 'edward', cmdline: '' }), ME);
  assert.strictEqual(a.risk, 'high');
});

/* ------------------------------------------------------------ 完整性 */

test('每条分析都给出用户需要的四件事', () => {
  const cases = [
    row(), row({ process: 'launchd', uid: 0 }), row({ process: 'zzz-unknown', cmdline: '' }),
    row({ process: 'postgres', port: 5432 }), row({ protocol: 'UDP', port: 5353, process: 'mDNSResponder' }),
  ];
  for (const r of cases) {
    const a = analyze(r, ME);
    assert.ok(a.title, '必须有身份标题');
    assert.ok(a.what && a.what.length > 5, '必须说明这是什么');
    assert.ok(a.ifKilled && a.ifKilled.length > 5, '必须说明终止后果');
    assert.ok(a.riskLabel, '必须有风险标签');
    assert.ok(Array.isArray(a.reasons), '必须有判断依据数组');
  }
});

test('未识别的进程如实说明，不编造', () => {
  const a = analyze(row({ process: 'zzz-nonexistent', port: 44444, cmdline: 'zzz-nonexistent' }), ME);
  assert.strictEqual(a.known, false);
  assert.ok(a.reasons.some((r) => /No record of this process/.test(r)), a.reasons.join('|'));
});

/* ------------------------------------------------------------ 辅助 */

test('humanDuration 两种语言都说人话，且英文有单复数', () => {
  assert.strictEqual(humanDuration(45, 'en'), '45 seconds');
  assert.strictEqual(humanDuration(300, 'en'), '5 minutes');
  // 「1 hours」是最典型的机翻痕迹，单复数必须处理
  assert.strictEqual(humanDuration(3600, 'en'), '1 hour');
  assert.strictEqual(humanDuration(86400, 'en'), '1 day');

  assert.strictEqual(humanDuration(45, 'zh'), '45 秒');
  assert.strictEqual(humanDuration(300, 'zh'), '5 分钟');
  assert.strictEqual(humanDuration(7200, 'zh'), '2 小时');
  assert.strictEqual(humanDuration(172800, 'zh'), '2 天');
});

test('字段说明覆盖界面上出现的每个字段，两种语言都要有', () => {
  for (const lang of ['en', 'zh']) {
    const tips = fieldTips(lang);
    for (const key of ['port', 'protocol', 'exposure', 'process', 'pid', 'user', 'uptime', 'memory', 'risk', 'cmdline']) {
      assert.ok(tips[key], `${lang}: 缺少 ${key} 的说明`);
      assert.ok(tips[key].tip.length > 20, `${lang}: ${key} 的说明太短，不够大白话`);
      // 出现缩写时必须当场解释，不能甩个术语就走
      // （protocol 的说明以 TCP 开头是合理的 —— 它正是要解释的那个词）
      const tip = tips[key].tip;
      for (const abbr of tip.match(/\b[A-Z]{2,}\b/g) || []) {
        assert.ok(tip.length > tip.indexOf(abbr) + abbr.length + 8,
          `${lang}: ${key} 提到了 ${abbr} 却没有跟上解释`);
      }
    }
  }
});

test('进程名匹配不会因子串巧合而误判', () => {
  // 'definitely' 里含 'init'，曾把普通进程误判成 1 号进程（禁止终止级）
  assert.strictEqual(lookupProcess('zzz-definitely-not-real'), null);
  assert.strictEqual(lookupProcess('mygoserver'), null, "'go' 不该命中 'mygoserver'");
  assert.strictEqual(lookupProcess('decode'), null, "'code' 不该命中 'decode'");
  // 但真正的路径与变体仍要认出来
  assert.ok(lookupProcess('/usr/sbin/sshd'), '带路径的 sshd 要认出来');
  assert.strictEqual(lookupProcess('Code Helper (Renderer)').key, 'code helper',
    '长 key 必须优先于短 key');
});

test('lookupProcess 支持前缀与包含匹配', () => {
  assert.ok(lookupProcess('com.docker.backend'));
  assert.ok(lookupProcess('postgres: writer process'));
  assert.ok(lookupProcess('Code Helper (Renderer)'));
  assert.strictEqual(lookupProcess('zzz-definitely-not-real'), null);
});

test('lookupCmdline 识别常见开发工具链', () => {
  assert.match(lookupCmdline('node .../vite/bin/vite.js').label.en, /Vite/);
  assert.match(lookupCmdline('python manage.py runserver 0:8000').label.en, /Django/);
  assert.match(lookupCmdline('/usr/bin/python3 -m http.server').label.en, /static file/);
  assert.strictEqual(lookupCmdline('some random command'), null);
});

/* ------------------------------------------------- 标题与建议必须自洽 */

test('端口只是线索，不能盖过进程身份', () => {
  const ME2 = { uid: 501, username: 'edward' };
  const mk = (o) => ({ protocol: 'TCP', state: 'LISTEN', families: [], addresses: [],
    exposure: 'loopback', uid: 501, user: 'edward', elapsed: 300, ...o });

  // 曾经的 bug：node 监听 5432 会被标成「PostgreSQL」，
  // 建议却是「重新 npm run dev 即可」—— 标题和建议自相矛盾
  const fake = analyze(mk({ port: 5432, process: 'node', pid: 1, cmdline: 'node server.js' }), ME2);
  assert.strictEqual(fake.title, 'node', '进程是 node 就不能标成 PostgreSQL');
  assert.match(fake.ifKilled, /dev server/);
  assert.ok(fake.reasons.some((r) => r.includes('is usually') && r.includes('is holding it')),
    '进程与端口对不上时必须点出来');

  // 真正的 postgres 仍然显示好看的名字
  const real = analyze(mk({ port: 5432, process: 'postgres', pid: 2, cmdline: 'postgres -D /data' }), ME2);
  assert.strictEqual(real.title, 'PostgreSQL');
  assert.match(real.ifKilled, /roll back/);

  // 命令行线索优先级最高
  const vite = analyze(mk({ port: 5432, process: 'node', pid: 3, cmdline: 'node .bin/vite' }), ME2);
  assert.match(vite.title, /Vite/);
});

test('判断依据不重复表述同一件事', () => {
  const a = analyze({ port: 5432, process: 'node', pid: 1, protocol: 'TCP', state: 'LISTEN',
    families: [], addresses: [], exposure: 'loopback', uid: 501, user: 'edward',
    elapsed: 300, cmdline: 'node server.js' }, { uid: 501, username: 'edward' });
  const aboutPort = a.reasons.filter((r) => r.includes('5432'));
  assert.strictEqual(aboutPort.length, 1, `关于 5432 的说明只该出现一次，实际: ${aboutPort.join(' | ')}`);
});

/* ------------------------------------------------------- 知识库增量层 */

test('本地条目优先于内置条目', () => {
  const overlay = {
    processes: {
      node: { name: '我们团队的网关', category: 'network', risk: 'high',
        what: '内部网关服务。', ifKilled: '所有内部调用中断。' },
    },
  };
  const base = analyze(row(), ME);
  const over = analyze(row(), ME, overlay);

  assert.strictEqual(base.title, 'node');
  assert.strictEqual(over.title, '我们团队的网关', '本地条目必须覆盖内置');
  assert.match(over.ifKilled, /内部调用中断/);
  assert.strictEqual(over.risk, 'high');
});

test('没有本地文件时行为完全不变（静默）', () => {
  const a = analyze(row(), ME);
  const b = analyze(row(), ME, null);
  const c = analyze(row(), ME, { processes: {}, ports: {} });
  assert.strictEqual(a.title, b.title);
  assert.strictEqual(b.title, c.title);
  assert.strictEqual(a.risk, c.risk);
});

test('本地端口条目也生效', () => {
  const overlay = { ports: { 9999: { category: 'database', name: '内部指标库', what: '团队自建。', risk: 'medium' } } };
  const a = analyze(row({ port: 9999, process: 'zzz-unknown', cmdline: '' }), ME, overlay);
  assert.match(a.what, /内部指标库|团队自建/);
});

test('未识别记录只留进程名与端口，不留完整命令行', () => {
  const store = require('../server/knowledge-store');
  const drafted = store.draftTemplate(1);
  // 模板本身不含任何路径或参数
  const json = JSON.stringify(drafted);
  assert.ok(!json.includes('/Users/'), '模板不该含家目录');
  assert.ok(!json.includes('--'), '模板不该含命令行参数');
});

/* ------------------------------------------------- 数据文件的落点（发布后才会暴露的坑） */

test('数据文件落在用户数据目录，不在包安装目录里', () => {
  const store = require('../server/knowledge-store');
  const pkgDir = path.join(__dirname, '..');

  /*
   * 曾经用 path.join(__dirname, '..') —— 在「clone 下来自己跑」时没问题，
   * 发成 npm 包之后就全错了：
   *   全局安装 → 写进 node_modules，npm update 一来整个目录被替换，攒的知识全没
   *   npx     → 写进 ~/.npm/_npx/<每版不同的哈希>/，换版本等于从零开始
   * 而 knowledge.local.json 更严重：npx 用户压根没有「项目根目录」可以放它。
   */
  for (const f of [store.LOCAL_FILE, store.UNKNOWN_FILE]) {
    assert.ok(!f.startsWith(pkgDir + path.sep),
      `${f} 不能落在包目录里 —— 升级时会被连同 node_modules 一起替换掉`);
    assert.ok(path.isAbsolute(f), '路径必须是绝对路径');
  }
});

test('PORTVIS_DATA_DIR 能覆盖数据目录', () => {
  // 测试、CI、并存多份配置都要靠它。用子进程是因为路径在模块加载时就定死了
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, ['-e',
    "console.log(require('./server/knowledge-store').LOCAL_FILE)"],
  { cwd: path.join(__dirname, '..'), env: { ...process.env, PORTVIS_DATA_DIR: '/tmp/pv-custom' } });
  assert.strictEqual(out.toString().trim(), path.join('/tmp/pv-custom', 'knowledge.local.json'));
});

/* --------------------------------------------- 双语一致性（最容易腐烂的地方） */

test('每条知识条目的两种语言都齐全，且不是把另一种语言原样抄过来', () => {
  const { PROCESSES, PORTS, CMDLINE_HINTS } = _internal;
  const hasCJK = (s) => /[一-鿿]/.test(s);

  const checkPair = (v, where) => {
    assert.ok(v && typeof v === 'object', `${where}: 应是 {en, zh} 而不是裸字符串`);
    assert.ok(v.en && v.en.trim(), `${where}: 缺英文`);
    assert.ok(v.zh && v.zh.trim(), `${where}: 缺中文`);
    /*
     * 英文里混进中文，说明有人只改了一边、或者复制粘贴时串了行。
     * 这类错误肉眼很难在 700 行文件里发现，但对用户是直接可见的。
     * 反向不查 —— 中文条目里出现 PostgreSQL、SIGTERM 这类原文是正常的。
     */
    assert.ok(!hasCJK(v.en), `${where}: 英文里混进了中文 —— "${v.en}"`);
  };

  for (const [key, entry] of Object.entries(PROCESSES)) {
    checkPair(entry.what, `PROCESSES.${key}.what`);
    checkPair(entry.ifKilled, `PROCESSES.${key}.ifKilled`);
    if (entry.name) checkPair(entry.name, `PROCESSES.${key}.name`);
  }
  for (const [port, entry] of Object.entries(PORTS)) {
    checkPair(entry.what, `PORTS.${port}.what`);
    checkPair(entry.name, `PORTS.${port}.name`);
  }
  for (const [, label] of CMDLINE_HINTS) checkPair(label, 'CMDLINE_HINTS');
});

test('切换语言只换文案，不改判断', () => {
  // 风险分级、拦截、归属判断是安全边界，绝不能随语言漂移
  const cases = [
    row({ process: 'launchd', uid: 0, user: 'root' }),
    row({ process: 'postgres', port: 5432 }),
    row({ process: 'zzz-unknown', cmdline: '' }),
    row({ port: 22, process: 'weird', cmdline: '' }),
  ];
  for (const r of cases) {
    const en = analyze(r, ME, null, 'en');
    const zh = analyze(r, ME, null, 'zh');
    for (const field of ['risk', 'blocked', 'category', 'isMine', 'isRoot', 'needsSudo', 'known', 'riskOrder']) {
      assert.deepStrictEqual(en[field], zh[field], `${r.process}: ${field} 不该随语言变化`);
    }
    assert.strictEqual(en.reasons.length, zh.reasons.length, '判断依据的条数也该一致');
  }
});

test('未知语言回落到英文，不会崩也不会露出半成品', () => {
  for (const lang of [undefined, null, '', 'fr', 'zh-CN', 'en-US', 'xx', 123]) {
    const a = analyze(row({ process: 'postgres', port: 5432 }), ME, null, lang);
    assert.ok(a.what && a.ifKilled && a.riskLabel, `lang=${lang} 时文案不完整`);
    assert.ok(typeof a.riskLabel === 'string', 'riskLabel 必须已经摊平成字符串，不能把 {en,zh} 丢给前端');
  }
  // zh-CN 应被识别为中文，这是浏览器最常发来的写法
  assert.strictEqual(analyze(row(), ME, null, 'zh-CN').riskLabel, '低风险');
});

test('本地覆盖层用裸字符串也能工作 —— 不该要求用户写双语', () => {
  const overlay = { processes: { 'my-daemon': { name: 'My daemon', category: 'dev', risk: 'low',
    what: 'A thing I wrote.', ifKilled: 'Just restart it.' } } };
  for (const lang of ['en', 'zh']) {
    const a = analyze(row({ process: 'my-daemon' }), ME, overlay, lang);
    assert.strictEqual(a.title, 'My daemon');
    assert.match(a.what, /A thing I wrote/);
  }
});
