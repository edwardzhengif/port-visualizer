'use strict';

/**
 * 端口扫描与解析。
 *
 * 设计要点（相对旧版的关键修正）：
 * 1. 用 execFile 而非 exec —— 不经过 shell，杜绝命令注入面，也不再依赖 `| grep`
 *    （旧版无匹配时 grep 返回 1，导致 exec reject，端口列表静默变空）。
 * 2. macOS 用 lsof 的 -F 机器可读输出，而非按空格切列 —— 旧版 parts[8] 取地址，
 *    lsof 的列宽随进程名长度浮动，长进程名会整体错位。
 * 3. 协议不再硬编码。旧版 macOS 分支写死 protocol:'TCP' 且用 grep LISTEN 过滤，
 *    UDP 永远为 0，前端的 UDP 筛选是个死功能。
 * 4. IPv4/IPv6 双栈监听会产生两条 lsof 记录，旧版不去重，列表里同一个端口出现两次。
 * 5. Windows 现在补查 tasklist 拿真实进程名，旧版永远显示 'unknown'。
 */

const { execFile } = require('child_process');
const os = require('os');

const EXEC_OPTS = {
  timeout: 8000,
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
};

/**
 * lsof / ss / netstat 在「没有任何匹配项」时都会以非 0 退出。
 * 只有在既报错又没有 stdout 时才算真失败。
 */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, EXEC_OPTS, (err, stdout) => {
      if (err && !stdout) {
        err.message = `${cmd} 执行失败: ${err.message}`;
        return reject(err);
      }
      resolve(stdout || '');
    });
  });
}

/** 从 `*:8080` / `127.0.0.1:8080` / `[::1]:8080` 中取出端口号与主机部分。 */
function splitAddress(addr) {
  if (!addr) return null;
  const idx = addr.lastIndexOf(':');
  if (idx === -1) return null;
  const port = Number.parseInt(addr.slice(idx + 1), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  let host = addr.slice(0, idx);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return { host, port };
}

/**
 * 这个端口对外暴露到什么程度 —— 开发者真正关心的问题
 * （「我这个服务是只有本机能访问，还是整个局域网都能连？」）。
 */
function classifyExposure(host) {
  if (!host) return 'unknown';
  if (host === '127.0.0.1' || host === '::1' || host === 'localhost') return 'loopback';
  if (host.startsWith('127.')) return 'loopback';
  if (host === '*' || host === '0.0.0.0' || host === '::' || host === '') return 'all';
  return 'specific';
}

function normalizeFamily(t) {
  if (!t) return null;
  if (t.includes('6')) return 'IPv6';
  if (t.includes('4')) return 'IPv4';
  return null;
}

/* ------------------------------------------------------------------ macOS */

/**
 * `lsof -nP -i -FpcntPTL`
 * -F 输出每行一个字段，首字符是字段名，彻底避开列对齐问题：
 *   p<pid>  c<command>  f<fd>  t<IPv4|IPv6>  P<TCP|UDP>  n<addr>  TST=<state>
 * 'p' 开启一个新进程块，'f' 开启一个新文件块，字段一直累积到下一个 f/p。
 */
function parseLsof(stdout) {
  const rows = [];
  let pid = 0;
  let command = 'unknown';
  let file = null;

  const flush = () => {
    if (!file || !file.n) return;
    // 带 '->' 的是已建立的连接，不是监听端口。
    if (file.n.includes('->')) return;

    const protocol = (file.P || 'TCP').toUpperCase();
    const state = file.T || (protocol === 'UDP' ? 'UNCONN' : '');
    // TCP 只保留 LISTEN；UDP 无状态机，全部保留。
    if (protocol === 'TCP' && state !== 'LISTEN') return;

    const parsed = splitAddress(file.n);
    if (!parsed) return;

    rows.push({
      pid,
      process: command,
      protocol,
      port: parsed.port,
      host: parsed.host,
      state: protocol === 'UDP' ? 'UNCONN' : 'LISTEN',
      family: normalizeFamily(file.t),
      exposure: classifyExposure(parsed.host),
    });
  };

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);

    switch (tag) {
      case 'p':
        flush();
        file = null;
        pid = Number.parseInt(value, 10) || 0;
        command = 'unknown';
        break;
      case 'c':
        command = value || 'unknown';
        break;
      case 'f':
        flush();
        file = {};
        break;
      case 't':
      case 'P':
      case 'n':
        if (file) file[tag] = value;
        break;
      case 'T':
        // 形如 TST=LISTEN / TQR=0；只取状态。
        if (file && value.startsWith('ST=')) file.T = value.slice(3);
        break;
      default:
        break;
    }
  }
  flush();
  return rows;
}

async function scanDarwin() {
  const stdout = await run('lsof', ['-nP', '-i', '-FpcntPT']);
  return parseLsof(stdout);
}

/* ------------------------------------------------------------------ Linux */

/**
 * `ss -tulnpH`：Netid State Recv-Q Send-Q LocalAddr PeerAddr [users:(("name",pid=N,fd=M))]
 * 旧版把状态硬编码成 LISTEN，但 UDP 在 ss 里是 UNCONN；也没解析 users:(...) 之外的多进程情况。
 */
function parseSs(stdout) {
  const rows = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('Netid')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;

    const protocol = parts[0].toUpperCase().startsWith('UDP') ? 'UDP' : 'TCP';
    const state = parts[1].toUpperCase();
    if (protocol === 'TCP' && state !== 'LISTEN') continue;

    const parsed = splitAddress(parts[4]);
    if (!parsed) continue;

    const procInfo = line.slice(line.indexOf('users:') === -1 ? line.length : line.indexOf('users:'));
    const owners = [...procInfo.matchAll(/\("([^"]+)",pid=(\d+)/g)];

    const base = {
      protocol,
      port: parsed.port,
      host: parsed.host,
      state: protocol === 'UDP' ? 'UNCONN' : 'LISTEN',
      family: parsed.host.includes(':') || parsed.host === '*' ? 'IPv6' : 'IPv4',
      exposure: classifyExposure(parsed.host),
    };

    if (owners.length === 0) {
      // 非 root 时 ss 看不到别人的进程 —— 如实标注，不要假装知道。
      rows.push({ ...base, pid: 0, process: 'unknown (需 sudo)' });
    } else {
      for (const [, name, pidStr] of owners) {
        rows.push({ ...base, pid: Number.parseInt(pidStr, 10) || 0, process: name });
      }
    }
  }
  return rows;
}

async function scanLinux() {
  try {
    return parseSs(await run('ss', ['-tulnpH']));
  } catch {
    // 老发行版没有 ss
    return parseSs(await run('netstat', ['-tulnp']));
  }
}

/* ---------------------------------------------------------------- Windows */

/** tasklist CSV → Map<pid, imageName>，这是旧版 process 永远为 'unknown' 的补丁。 */
function parseTasklist(stdout) {
  const map = new Map();
  for (const line of stdout.split('\n')) {
    const m = line.match(/^"([^"]*)","(\d+)"/);
    if (m) map.set(Number.parseInt(m[2], 10), m[1]);
  }
  return map;
}

function parseNetstat(stdout, pidNames) {
  const rows = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const proto = (parts[0] || '').toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') continue;

    // TCP: Proto Local Foreign State PID   |   UDP: Proto Local Foreign PID
    const isTcp = proto === 'TCP';
    if (isTcp && parts.length < 5) continue;
    if (!isTcp && parts.length < 4) continue;
    if (isTcp && parts[3].toUpperCase() !== 'LISTENING') continue;

    const pid = Number.parseInt(parts[isTcp ? 4 : 3], 10) || 0;
    const parsed = splitAddress(parts[1]);
    if (!parsed) continue;

    rows.push({
      pid,
      process: pidNames.get(pid) || 'unknown',
      protocol: proto,
      port: parsed.port,
      host: parsed.host,
      state: isTcp ? 'LISTEN' : 'UNCONN',
      family: parsed.host.includes(':') ? 'IPv6' : 'IPv4',
      exposure: classifyExposure(parsed.host),
    });
  }
  return rows;
}

async function scanWindows() {
  const [netstatOut, tasklistOut] = await Promise.all([
    run('netstat', ['-ano']),
    run('tasklist', ['/FO', 'CSV', '/NH']).catch(() => ''),
  ]);
  return parseNetstat(netstatOut, parseTasklist(tasklistOut));
}

/* ------------------------------------------------------- 进程详情富化 */

/**
 * 光有进程名不足以判断该不该杀它。
 * 三个 node 进程可能分别是：你的 dev server、编辑器的 TypeScript 语言服务、
 * 某个 Electron 应用的后台。区分它们的唯一可靠依据是**完整命令行**。
 *
 * 一次 ps 调用（约 2ms）就能拿到全部进程的 PPID / 用户 / 运行时长 / 内存 / 命令行。
 */

/** ps 的 etime 格式跨平台一致：[[DD-]HH:]MM:SS */
function parseEtime(value) {
  if (!value) return null;
  const [dayPart, clockPart] = value.includes('-') ? value.split('-') : [null, value];
  const parts = clockPart.split(':').map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;

  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else return null;

  if (dayPart) seconds += Number.parseInt(dayPart, 10) * 86400;
  return seconds;
}

async function processDetailsUnix() {
  const map = new Map();
  // 末尾的 '=' 去掉表头；args 必须放最后，因为它含空格。
  // 同时取 uid 和 user：ps 会把超过 8 字符的用户名截断成 'great-y+'，
  // 拿它和当前用户名比对会永远不相等，所以「是不是我的进程」这一判断必须走 uid。
  const stdout = await run('ps', ['-eo', 'pid=,ppid=,uid=,user=,etime=,rss=,args=']);

  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, uid, user, etime, rss, args] = m;
    map.set(Number.parseInt(pid, 10), {
      ppid: Number.parseInt(ppid, 10),
      uid: Number.parseInt(uid, 10),
      user: user.endsWith('+') ? user.slice(0, -1) + '…' : user,
      elapsed: parseEtime(etime),
      rssBytes: Number.parseInt(rss, 10) * 1024,   // ps 的 rss 单位是 KB
      cmdline: args,
    });
  }
  return map;
}

async function processDetailsWindows() {
  const map = new Map();

  // tasklist 拿用户与内存
  const verbose = await run('tasklist', ['/V', '/FO', 'CSV', '/NH']).catch(() => '');
  for (const line of verbose.split('\n')) {
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 7) continue;
    const val = (i) => cols[i].slice(1, -1);
    const pid = Number.parseInt(val(1), 10);
    if (!Number.isInteger(pid)) continue;
    map.set(pid, {
      ppid: 0,
      user: val(6).replace(/^.*\\/, ''),
      elapsed: null,
      rssBytes: (Number.parseInt(val(4).replace(/[^\d]/g, ''), 10) || 0) * 1024,
      cmdline: val(0),
    });
  }

  // PowerShell 补完整命令行与父进程（wmic 在新版 Windows 已被移除）
  const psOut = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
  ]).catch(() => '');

  if (psOut.trim()) {
    try {
      const list = JSON.parse(psOut);
      for (const p of Array.isArray(list) ? list : [list]) {
        const pid = Number(p.ProcessId);
        const entry = map.get(pid) || { user: '', elapsed: null, rssBytes: 0, cmdline: '' };
        entry.ppid = Number(p.ParentProcessId) || 0;
        if (p.CommandLine) entry.cmdline = p.CommandLine;
        map.set(pid, entry);
      }
    } catch { /* PowerShell 不可用时保持 tasklist 的结果 */ }
  }

  return map;
}

/** 拿不到详情不是致命错误 —— 端口列表本身仍然有用，只是少了判断依据。 */
async function getProcessDetails() {
  try {
    return os.platform() === 'win32' ? await processDetailsWindows() : await processDetailsUnix();
  } catch {
    return new Map();
  }
}

/* ------------------------------------------------------------------ 合并 */

/**
 * 同一个进程在 IPv4 和 IPv6 上监听同一端口会产生两条记录。
 * 按 协议|端口|PID 合并成一行，把地址族收进数组 —— 列表长度立刻减少三分之一左右，
 * 而且不再出现「同一个 3000 端口出现两次」这种让人以为冲突了的假象。
 */
function mergeRows(rows) {
  const merged = new Map();

  for (const row of rows) {
    const key = `${row.protocol}|${row.port}|${row.pid}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        id: key,
        port: row.port,
        protocol: row.protocol,
        state: row.state,
        process: row.process,
        pid: row.pid,
        families: row.family ? [row.family] : [],
        addresses: [`${row.host}:${row.port}`],
        exposure: row.exposure,
      });
      continue;
    }

    if (row.family && !existing.families.includes(row.family)) {
      existing.families.push(row.family);
    }
    const addr = `${row.host}:${row.port}`;
    if (!existing.addresses.includes(addr)) existing.addresses.push(addr);
    // 只要有任意一个绑定在全网卡上，整行就按暴露程度更高的算。
    if (row.exposure === 'all') existing.exposure = 'all';
    else if (row.exposure === 'specific' && existing.exposure === 'loopback') {
      existing.exposure = 'specific';
    }
  }

  return [...merged.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

async function scanPorts() {
  const platform = os.platform();

  // 端口扫描与进程详情互不依赖，并行拿
  const [rows, details] = await Promise.all([
    (async () => {
      switch (platform) {
        case 'darwin': return scanDarwin();
        case 'linux': return scanLinux();
        case 'win32': return scanWindows();
        default: throw new Error(`不支持的操作系统: ${platform}`);
      }
    })(),
    getProcessDetails(),
  ]);

  return mergeRows(rows).map((row) => {
    const d = details.get(row.pid);
    return {
      ...row,
      ppid: d?.ppid ?? null,
      uid: d?.uid ?? null,
      user: d?.user ?? null,
      elapsed: d?.elapsed ?? null,
      rssBytes: d?.rssBytes ?? null,
      cmdline: d?.cmdline ?? null,
      parentName: d?.ppid ? (details.get(d.ppid)?.cmdline || '').split(/\s+/)[0] || null : null,
    };
  });
}

module.exports = {
  scanPorts,
  getProcessDetails,
  // 导出内部函数供测试直接喂固定样本，无需真的开端口。
  _internal: {
    parseLsof, parseSs, parseNetstat, parseTasklist, mergeRows,
    splitAddress, classifyExposure, parseEtime,
  },
};
