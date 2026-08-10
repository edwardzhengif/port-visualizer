'use strict';

/**
 * 解析器测试。
 * 用固定样本喂内部函数，不依赖当前机器上真的开着什么端口 ——
 * 否则测试结果会随环境漂移，等于没测。
 *
 * 运行：npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const { _internal } = require('../server/scanner');

const { parseLsof, parseSs, parseNetstat, parseTasklist, mergeRows, splitAddress, classifyExposure } = _internal;

/* ------------------------------------------------------------- 地址解析 */

test('splitAddress 处理 IPv4 / IPv6 / 通配', () => {
  assert.deepStrictEqual(splitAddress('127.0.0.1:3000'), { host: '127.0.0.1', port: 3000 });
  assert.deepStrictEqual(splitAddress('*:8080'), { host: '*', port: 8080 });
  assert.deepStrictEqual(splitAddress('[::1]:5432'), { host: '::1', port: 5432 });
  assert.strictEqual(splitAddress('no-port-here'), null);
  assert.strictEqual(splitAddress('1.2.3.4:99999'), null);
});

test('classifyExposure 区分本机与对外', () => {
  assert.strictEqual(classifyExposure('127.0.0.1'), 'loopback');
  assert.strictEqual(classifyExposure('::1'), 'loopback');
  assert.strictEqual(classifyExposure('*'), 'all');
  assert.strictEqual(classifyExposure('0.0.0.0'), 'all');
  assert.strictEqual(classifyExposure('192.168.1.5'), 'specific');
});

/* ---------------------------------------------------------------- macOS */

const LSOF = [
  'p1234', 'cnode',
  'f20', 'tIPv4', 'PTCP', 'n*:3000', 'TST=LISTEN',
  'f21', 'tIPv6', 'PTCP', 'n*:3000', 'TST=LISTEN',
  'f22', 'tIPv4', 'PTCP', 'n127.0.0.1:52341->140.82.121.4:443', 'TST=ESTABLISHED',
  'p567', 'cChrome',
  'f10', 'tIPv4', 'PUDP', 'n*:5353',
  'p890', 'cpostgres',
  'f7', 'tIPv4', 'PTCP', 'n127.0.0.1:5432', 'TST=LISTEN',
].join('\n');

test('parseLsof 读出真实协议，不再硬编码 TCP', () => {
  const rows = parseLsof(LSOF);
  const udp = rows.filter((r) => r.protocol === 'UDP');
  assert.strictEqual(udp.length, 1, 'UDP 必须被解析出来（旧版永远是 0）');
  assert.strictEqual(udp[0].process, 'Chrome');
  assert.strictEqual(udp[0].port, 5353);
});

test('parseLsof 丢弃已建立的连接，只保留监听', () => {
  const rows = parseLsof(LSOF);
  assert.ok(rows.every((r) => r.state === 'LISTEN' || r.state === 'UNCONN'));
  assert.ok(!rows.some((r) => r.port === 52341), '出站连接不应出现在监听列表里');
});

test('parseLsof 不受进程名长度影响（旧版按列号取值会错位）', () => {
  const longName = ['p42', 'cthis-is-a-very-long-process-name-indeed',
    'f3', 'tIPv4', 'PTCP', 'n0.0.0.0:8080', 'TST=LISTEN'].join('\n');
  const rows = parseLsof(longName);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].port, 8080);
  assert.strictEqual(rows[0].process, 'this-is-a-very-long-process-name-indeed');
});

test('mergeRows 合并 IPv4/IPv6 双栈的重复行', () => {
  const merged = mergeRows(parseLsof(LSOF));
  const node = merged.filter((r) => r.port === 3000);
  assert.strictEqual(node.length, 1, '同一进程的双栈监听应合并为一行');
  assert.deepStrictEqual(node[0].families.sort(), ['IPv4', 'IPv6']);
  assert.strictEqual(node[0].exposure, 'all');
});

test('mergeRows 按端口升序输出', () => {
  const merged = mergeRows(parseLsof(LSOF));
  const ports = merged.map((r) => r.port);
  assert.deepStrictEqual(ports, [...ports].sort((a, b) => a - b));
});

/* ---------------------------------------------------------------- Linux */

const SS = [
  'tcp   LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=1234,fd=6))',
  'udp   UNCONN 0      0            0.0.0.0:68        0.0.0.0:*    users:(("dhclient",pid=567,fd=5))',
  'tcp   LISTEN 0      4096       127.0.0.1:3000      0.0.0.0:*    users:(("node",pid=890,fd=20))',
  'tcp   ESTAB  0      0          10.0.0.2:443       10.0.0.9:5522',
].join('\n');

test('parseSs 保留 UDP 的 UNCONN 状态，不硬编码 LISTEN', () => {
  const rows = parseSs(SS);
  const udp = rows.find((r) => r.protocol === 'UDP');
  assert.ok(udp, 'UDP 行必须被解析');
  assert.strictEqual(udp.state, 'UNCONN');
  assert.strictEqual(udp.process, 'dhclient');
});

test('parseSs 过滤掉非监听的 TCP 连接', () => {
  const rows = parseSs(SS);
  assert.ok(!rows.some((r) => r.port === 443), 'ESTAB 连接不应出现');
});

test('parseSs 缺少进程信息时如实标注', () => {
  const rows = parseSs('tcp   LISTEN 0 511 0.0.0.0:22 0.0.0.0:*');
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].process, /sudo/);
  assert.strictEqual(rows[0].pid, 0);
});

/* -------------------------------------------------------------- Windows */

const TASKLIST = [
  '"svchost.exe","1234","Services","0","12,345 K"',
  '"node.exe","4567","Console","1","98,765 K"',
].join('\n');

const NETSTAT = [
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234',
  '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       4567',
  '  TCP    10.0.0.5:52000         13.107.4.50:443        ESTABLISHED     4567',
  '  UDP    0.0.0.0:500            *:*                                    1234',
].join('\n');

test('parseNetstat 用 tasklist 补出真实进程名（旧版永远是 unknown）', () => {
  const rows = parseNetstat(NETSTAT, parseTasklist(TASKLIST));
  const p3000 = rows.find((r) => r.port === 3000);
  assert.strictEqual(p3000.process, 'node.exe');
  assert.notStrictEqual(p3000.process, 'unknown');
});

test('parseNetstat 正确处理 UDP 行少一列的情况', () => {
  const rows = parseNetstat(NETSTAT, parseTasklist(TASKLIST));
  const udp = rows.find((r) => r.protocol === 'UDP');
  assert.ok(udp);
  assert.strictEqual(udp.port, 500);
  assert.strictEqual(udp.pid, 1234, 'UDP 的 PID 在第 4 列而不是第 5 列');
});

test('parseNetstat 排除 ESTABLISHED', () => {
  const rows = parseNetstat(NETSTAT, parseTasklist(TASKLIST));
  assert.ok(!rows.some((r) => r.port === 52000));
});

/* ------------------------------------------------------------ 数据契约 */

test('合并后的每一行都带有前端需要的全部字段', () => {
  for (const row of mergeRows(parseLsof(LSOF))) {
    for (const key of ['id', 'port', 'protocol', 'state', 'process', 'pid', 'families', 'addresses', 'exposure']) {
      assert.ok(key in row, `缺少字段 ${key}`);
    }
    assert.ok(Array.isArray(row.families));
    assert.ok(Array.isArray(row.addresses));
  }
});
