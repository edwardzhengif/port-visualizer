'use strict';

/**
 * 知识库的增量层。
 *
 * 内置库覆盖不了所有进程 —— 每台机器上都有一批只有它自己才有的东西。
 * 这一层让知识库随真实使用增长，而且是**静默**的：不弹任何 UI，不发任何请求。
 *
 * 两个文件，各管一头：
 *
 *   knowledge.local.json   你写的补充条目。本地优先级高于内置。
 *                          文件不存在时完全无影响 —— 这就是「静默」的含义。
 *
 *   .knowledge-unknown.json  自动记录遇到过、但内置库不认识的进程。
 *                          它的作用是回答「我到底该补哪些条目」——
 *                          让补充基于真实观察，而不是凭空想象。
 *
 * 刻意不做的事：
 *  · 不联网同步社区知识库 —— 这个工具能杀进程，让外部数据参与
 *    「什么能杀」的判断，等于把供应链攻击面接进最危险的路径
 *  · 不自动生成条目 —— 编造出来的建议看起来和真的一样确定，比没有更糟
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 数据文件放**用户数据目录**，不是包安装目录。
 *
 * 之前用的是 path.join(__dirname, '..')，也就是包自己所在的目录。
 * 在「clone 下来自己跑」的场景里这没问题，但作为 npm 包发布后就全错了：
 *
 *   全局安装 → 写进 /usr/local/lib/node_modules/port-visualizer/，
 *              npm update 会把整个目录替换掉，你攒的知识全没
 *   npx 运行 → 写进 ~/.npm/_npx/<每个版本不同的哈希>/，
 *              换个版本就换个目录，等于每次都从零开始
 *   受限环境 → 那个目录根本不可写
 *
 * 更要命的是 knowledge.local.json：README 让用户「在项目根目录创建」，
 * 而 npx 用户根本没有项目根目录 —— 这个功能对他们直接是不可用的。
 *
 * 现在按各平台的惯例走，路径会在界面的 unknown 命令里打印出来。
 */
function dataDir() {
  // 显式指定优先。CI、多份并存、临时试验都用得上
  if (process.env.PORTVIS_DATA_DIR) return process.env.PORTVIS_DATA_DIR;

  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'port-visualizer');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'port-visualizer');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'port-visualizer');
}

const ROOT = dataDir();
const LOCAL_FILE = path.join(ROOT, 'knowledge.local.json');
const UNKNOWN_FILE = path.join(ROOT, '.knowledge-unknown.json');

/** 自动刷新 5 秒一次，不能每次扫描都写盘。 */
const FLUSH_MS = 30_000;
const MAX_UNKNOWN = 500;

/* ------------------------------------------------------------ 本地覆盖 */

let localCache = { processes: {}, ports: {}, mtime: 0 };

/**
 * 读取本地补充条目。文件损坏时退回空表并告警 ——
 * 一个手写 JSON 的语法错误不该让整个工具起不来。
 */
function loadLocal() {
  let stat;
  try {
    stat = fs.statSync(LOCAL_FILE);
  } catch {
    return { processes: {}, ports: {} };   // 没有这个文件是正常状态
  }

  if (stat.mtimeMs === localCache.mtime) return localCache;

  try {
    const raw = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    localCache = {
      processes: raw.processes || {},
      ports: raw.ports || {},
      mtime: stat.mtimeMs,
    };
  } catch (err) {
    console.warn(`knowledge.local.json 解析失败，已忽略：${err.message}`);
    localCache = { processes: {}, ports: {}, mtime: stat.mtimeMs };
  }
  return localCache;
}

/* -------------------------------------------------------- 未识别记录 */

let unknown = null;
let dirty = false;
let flushTimer = null;

function loadUnknown() {
  if (unknown) return unknown;
  try {
    unknown = JSON.parse(fs.readFileSync(UNKNOWN_FILE, 'utf8'));
  } catch {
    unknown = {};
  }
  return unknown;
}

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    // 目录可能还不存在 —— 这是首次运行的常态，不是异常
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(UNKNOWN_FILE, JSON.stringify(unknown, null, 2));
  } catch (err) {
    // 写不进去（只读文件系统、沙箱等）不该影响主功能，静默降级即可：
    // 这是个纯粹的锦上添花功能，为它打断用户没有道理
    if (process.env.PORTVIS_DEBUG) console.warn(`未识别记录写入失败：${err.message}`);
  }
}

/**
 * 记录一个内置库不认识的进程。
 *
 * 只留进程名、端口和命令行的**第一个词**。
 * 完整命令行含家目录、项目名、有时还有 token —— 那些不该落到一个会长期留存的文件里，
 * 而且对「这是什么进程」的判断也没有帮助。
 */
function noteUnknown(row) {
  const name = String(row.process || '').trim();
  if (!name || name.length > 64) return;

  const store = loadUnknown();
  const now = new Date().toISOString().slice(0, 10);
  const entry = store[name] || {
    firstSeen: now, count: 0, ports: [], exe: null,
  };

  entry.count += 1;
  entry.lastSeen = now;
  if (!entry.ports.includes(row.port) && entry.ports.length < 12) entry.ports.push(row.port);
  if (!entry.exe && row.cmdline) {
    entry.exe = String(row.cmdline).trim().split(/\s+/)[0].split(/[\\/]/).pop().slice(0, 64);
  }

  store[name] = entry;

  // 条目过多时丢掉最少见的，避免文件无限膨胀
  const keys = Object.keys(store);
  if (keys.length > MAX_UNKNOWN) {
    keys.sort((a, b) => store[a].count - store[b].count)
      .slice(0, keys.length - MAX_UNKNOWN)
      .forEach((k) => delete store[k]);
  }

  dirty = true;
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_MS);
    flushTimer.unref?.();   // 别因为这个定时器拖住进程退出
  }
}

/** 按出现次数排序返回，最常见的排前面 —— 那些是最值得先补的。 */
function listUnknown() {
  const store = loadUnknown();
  return Object.entries(store)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count);
}

/** 生成一份可直接粘进 knowledge.local.json 的骨架，字段留空由人来填。 */
function draftTemplate(limit = 20) {
  const processes = {};
  for (const u of listUnknown().slice(0, limit)) {
    processes[u.name.toLowerCase()] = {
      name: u.name,
      category: 'unknown',
      risk: 'low',
      what: `（待填）在端口 ${u.ports.join('、')} 上出现过 ${u.count} 次`,
      ifKilled: '（待填）',
    };
  }
  return { processes, ports: {} };
}

process.on('exit', flush);

module.exports = { loadLocal, noteUnknown, listUnknown, draftTemplate, LOCAL_FILE, UNKNOWN_FILE };
