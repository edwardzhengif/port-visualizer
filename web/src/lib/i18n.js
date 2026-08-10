import { useCallback, useEffect, useState } from 'react';
import { store } from './usePorts.js';

/**
 * 界面文案。
 *
 * 只放**界面自己的**字串；端口/进程的解读文案在 server/knowledge.js 里，
 * 因为那些是判断的一部分，必须和风险分级住在一起。
 *
 * 默认英文：这个包发在 npm 上，绝大多数点进来的人读英文。
 * 但如果浏览器语言是中文，就直接给中文 —— 让人先看懂，再谈切换。
 */

export const LANGS = ['en', 'zh'];

const DICT = {
  en: {
    appSubtitle: 'you are',
    search: 'Search…  (press /)',
    searchLabel: 'Search ports, process names, PIDs or command lines',
    mine: 'My processes',
    all: 'All processes',
    ownershipFilter: 'Process ownership filter',
    cards: 'Cards',
    table: 'Table',
    viewSwitch: 'View',
    sortBy: 'Sort by',
    sortRecent: 'Recently appeared',
    sortPort: 'By port number',
    sortRisk: 'By risk',
    sortProcess: 'By process name',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'Follow system',
    language: 'Language',
    fieldTips: 'What do these mean?',
    refresh: 'Refresh',
    refreshOnFocus: 'Refresh on focus',
    refreshOnFocusOn: 'Refresh on focus · on',

    facetAll: 'All',
    facetAllHint: 'Clear the protocol, exposure and risk filters',
    facetTcpHint: 'Connection-oriented. Web, databases and SSH all use it',
    facetUdpHint: 'Connectionless. Used by DNS, local discovery, audio and video',
    facetExposed: 'Exposed',
    facetExposedHint: 'Bound to something like 0.0.0.0 — other devices on the same network can reach it',
    facetLoopback: 'Local only',
    facetLoopbackHint: 'Bound to 127.0.0.1; only this machine can connect',
    facetRisky: 'Worth a look',
    facetRiskyHint: 'Medium risk and above: killing these has real consequences',
    facetSafe: 'Safe to close',
    facetSafeHint: 'Low risk — usually something you started yourself; restart and it is back',

    showing: (visible, total) => `Showing ${visible} of ${total} ports`,
    scanning: 'Scanning ports…',
    updatedAt: (t) => `Updated ${t}`,
    updateFailed: (t) => `Update failed ${t}`,
    hiddenSystem: (n) => `${n} processes not owned by you are hidden`,
    showAll: 'Show all',
    cannotSeeOthers: 'No processes from other accounts are visible — on macOS and Linux a non-root process can usually only see its own.',
    seeAllHint: 'To see every process without gaining the ability to kill them:',

    justAppeared: 'just appeared',
    details: 'Details',
    kill: 'Kill',
    needsSudo: 'Needs sudo',
    you: 'you',
    unknownUser: 'unknown',
    uptimePrefix: 'up',
    lockedTitle: (p) => `${p} is a critical system process and is locked. Open details to unlock.`,
    killAria: (proc, port) => `Terminate ${proc} holding port ${port}`,
    sudoAria: (proc) => `${proc} belongs to another account; needs sudo`,
    detailAria: (port, title) => `Port ${port}, ${title}, view details`,

    colPort: 'Port',
    colSeen: 'Seen',
    colProtocol: 'Protocol',
    colRisk: 'Risk',
    colProcess: 'Process',
    colPid: 'PID',
    colUser: 'User',
    colAddress: 'Address',
    tableLabel: 'Listening ports',
    viewPortAria: (p) => `View details for port ${p}`,

    exposureLoopback: 'Local only',
    exposureLoopbackHint: 'Only this machine can connect',
    exposureAll: 'All interfaces',
    exposureAllHint: 'Other devices on the same network can connect too',
    exposureSpecific: 'Specific interface',
    exposureSpecificHint: 'Bound to one particular address',
    exposureUnknown: 'Unknown',

    dlgKillTitle: 'Terminate process',
    dlgKillBody: (title, proc, pid, proto, port) =>
      `About to terminate ${title} (${proc}, PID ${pid}), which is listening on ${proto} port ${port}.`,
    dlgIfKilled: 'If killed:',
    dlgRiskLevel: 'Risk level:',
    dlgUptime: (d) => ` · up ${d}`,
    cancel: 'Cancel',
    confirmKill: 'Terminate',
    dlgTipsTitle: 'What these fields mean',
    dlgDetailTitle: (p) => `Port ${p}`,
    dlgSudoTitle: 'This process needs administrator privileges',
    dlgSudoBody: (proc, pid, user) =>
      `${proc} (PID ${pid}) belongs to ${user}, not to your account.`,
    dlgSudoWhy: 'Not every process on your own computer belongs to you: macOS gives each system service its own '
      + 'restricted account (root, _mdnsresponder and the like), so a compromised service only yields that limited '
      + 'account. The price is that Unix only lets you signal processes under your own account — hence sudo.',
    dlgSudoHow: 'Paste it into a terminal; it will ask for your login password. This tool deliberately does not '
      + 'escalate its own privileges — a long-running service that can kill anything as root is a far bigger risk '
      + 'than the inconvenience it saves.',
    copy: 'Copy',
    gotIt: 'Got it',
    unlock: 'I understand the risk, unlock',

    emptyNoPortsTitle: 'No listening ports found',
    emptyNoPortsDesc: 'Nothing on this machine is listening on any port. Start a service and hit refresh.',
    emptyMineTitle: 'Nothing matches among your own processes',
    emptyMineDesc: (n) => `Only processes under your account are shown; ${n} system processes are hidden.`,
    emptyMineAction: 'Include system processes',
    emptyFilterTitle: 'No matching results',
    emptyFilterDesc: 'Try clearing the search box, or setting the filters above back to All.',
    emptyFilterAction: 'Clear all filters',
    loadErrorTitle: 'Could not read port information',
    retry: 'Retry',

    detailCategory: 'Category',
    detailProtoState: 'Protocol / state',
    detailAddresses: 'Bound addresses',
    detailFamilies: 'Address family',
    detailUser: 'Running as',
    detailPid: 'PID / parent',
    detailUptime: 'Uptime',
    detailMemory: 'Memory (RSS)',
    detailMemoryNote: 'includes shared libraries; not comparable across processes',
    detailExposure: 'Exposure',
    detailReasons: 'Because',
    copyInspectCmd: 'Copy inspect command',
    copyCmdline: 'Copy command line',
    searchWeb: 'Search the web',
    searchWebHint: 'Opens a search engine in a new tab and sends the process name. Everything else in this tool stays offline.',
    expandCmd: 'Show full command line',
    collapseCmd: 'Collapse',
    unknownLabel: 'unknown',

    dockPlaceholder: 'Type a command; help lists them all',
    clearOutput: 'Clear output',
    runCommand: 'Run command',

    copied: (label) => `Copied ${label}`,
    copyDenied: 'The browser refused clipboard access',
    tipsLoadFailed: 'Could not load field descriptions',
    unlocked: (p) => `${p} unlocked — please confirm once more that this is what you want.`,
    lockedToast: (p) => `${p} is a critical system process and is locked. Open details to unlock.`,
    portGone: (port, proto) => `The process on port ${port} (${proto}) is gone`,
    cmdLabel: 'command',
    cmdlineLabel: 'command line',
    inspectLabel: 'inspect command',
  },

  zh: {
    appSubtitle: '你是',
    search: '搜索…（按 / 聚焦）',
    searchLabel: '搜索端口、进程名、PID 或命令行',
    mine: '我的进程',
    all: '全部进程',
    ownershipFilter: '进程归属筛选',
    cards: '卡片',
    table: '表格',
    viewSwitch: '视图切换',
    sortBy: '排序方式',
    sortRecent: '最近出现',
    sortPort: '按端口号',
    sortRisk: '按风险',
    sortProcess: '按进程名',
    theme: '主题',
    themeLight: '亮色',
    themeDark: '暗色',
    themeSystem: '跟随系统',
    language: '语言',
    fieldTips: '字段说明',
    refresh: '刷新',
    refreshOnFocus: '回到页面时刷新',
    refreshOnFocusOn: '回到页面时刷新 · 开',

    facetAll: '全部',
    facetAllHint: '清掉协议、暴露范围、风险三个筛选',
    facetTcpHint: '面向连接的协议，网页、数据库、SSH 都走它',
    facetUdpHint: '无连接协议，DNS、局域网发现、音视频常用',
    facetExposed: '对外暴露',
    facetExposedHint: '绑在 0.0.0.0 之类的地址上，同一局域网内的其它设备也能连上',
    facetLoopback: '仅本机',
    facetLoopbackHint: '绑在 127.0.0.1 上，只有这台机器能连',
    facetRisky: '需留意',
    facetRiskyHint: '中等及以上风险：终止它们会有实际后果',
    facetSafe: '可随手关',
    facetSafeHint: '低风险：多半是你自己起的开发服务，关了重启就行',

    showing: (visible, total) => `显示 ${visible} / ${total} 个端口`,
    scanning: '正在扫描端口…',
    updatedAt: (t) => `更新于 ${t}`,
    updateFailed: (t) => `更新失败 ${t}`,
    hiddenSystem: (n) => `已隐藏 ${n} 个不属于你的系统进程`,
    showAll: '全部显示',
    cannotSeeOthers: '没有看到任何其它账号的进程 —— macOS 和 Linux 上，不以 root 运行时通常只能看到自己的。',
    seeAllHint: '想看到全部进程、又不获得终止它们的能力：',

    justAppeared: '刚出现',
    details: '详情',
    kill: '终止',
    needsSudo: '需要 sudo',
    you: '你',
    unknownUser: '未知',
    uptimePrefix: '运行',
    lockedTitle: (p) => `${p} 是系统关键进程，已锁定。打开详情可解锁。`,
    killAria: (proc, port) => `终止占用端口 ${port} 的 ${proc}`,
    sudoAria: (proc) => `${proc} 属于其它账号，需要 sudo`,
    detailAria: (port, title) => `端口 ${port}，${title}，查看详情`,

    colPort: '端口',
    colSeen: '出现',
    colProtocol: '协议',
    colRisk: '风险',
    colProcess: '进程',
    colPid: 'PID',
    colUser: '用户',
    colAddress: '地址',
    tableLabel: '监听端口列表',
    viewPortAria: (p) => `查看端口 ${p} 详情`,

    exposureLoopback: '仅本机',
    exposureLoopbackHint: '只有这台机器能连上',
    exposureAll: '全部网卡',
    exposureAllHint: '同一局域网内的其它设备也能连上',
    exposureSpecific: '指定网卡',
    exposureSpecificHint: '绑定在某个具体地址上',
    exposureUnknown: '未知',

    dlgKillTitle: '终止进程',
    dlgKillBody: (title, proc, pid, proto, port) =>
      `即将终止 ${title}（${proc}，PID ${pid}），它正在监听 ${proto} 端口 ${port}。`,
    dlgIfKilled: '终止后果：',
    dlgRiskLevel: '风险等级：',
    dlgUptime: (d) => ` · 已运行 ${d}`,
    cancel: '取消',
    confirmKill: '终止进程',
    dlgTipsTitle: '这些字段是什么意思',
    dlgDetailTitle: (p) => `端口 ${p}`,
    dlgSudoTitle: '这个进程需要管理员权限',
    dlgSudoBody: (proc, pid, user) => `${proc}（PID ${pid}）属于 ${user}，不是你的账号。`,
    dlgSudoWhy: '自己的电脑上并不是所有进程都属于你：macOS 给每个系统服务单独建了低权限账号'
      + '（root、_mdnsresponder 这类），某个服务被攻破时攻击者拿到的只是那个受限账号。'
      + '代价是 Unix 只允许你对同账号的进程发信号，所以这里必须借助 sudo。',
    dlgSudoHow: '粘到终端执行，会要你输入登录密码。本工具刻意不自己提权 —— '
      + '一个能随时以 root 杀进程的常驻服务，风险远大于它省下的这点麻烦。',
    copy: '复制',
    gotIt: '知道了',
    unlock: '我知道风险，解锁终止',

    emptyNoPortsTitle: '没有检测到监听中的端口',
    emptyNoPortsDesc: '当前系统上没有进程在监听任何端口。启动一个服务后点刷新。',
    emptyMineTitle: '你自己的进程里没有匹配项',
    emptyMineDesc: (n) => `当前只显示你账户下的进程，另有 ${n} 个系统进程被隐藏了。`,
    emptyMineAction: '连系统进程一起显示',
    emptyFilterTitle: '没有匹配的结果',
    emptyFilterDesc: '试试清空搜索框，或者把上方几个筛选条件调回「全部」。',
    emptyFilterAction: '清除所有筛选',
    loadErrorTitle: '无法读取端口信息',
    retry: '重试',

    detailCategory: '分类',
    detailProtoState: '协议 / 状态',
    detailAddresses: '绑定地址',
    detailFamilies: '地址族',
    detailUser: '运行用户',
    detailPid: 'PID / 父进程',
    detailUptime: '运行时长',
    detailMemory: '内存占用（RSS）',
    detailMemoryNote: '含共享库，跨进程不可直接比较',
    detailExposure: '暴露范围',
    detailReasons: '判断依据',
    copyInspectCmd: '复制查看命令',
    copyCmdline: '复制命令行',
    searchWeb: '在网上搜索',
    searchWebHint: '会新开标签页搜索，并把进程名发给搜索引擎。本工具其余部分完全离线。',
    expandCmd: '展开完整命令',
    collapseCmd: '收起',
    unknownLabel: '未知',

    dockPlaceholder: '输入命令，help 查看全部',
    clearOutput: '清空输出',
    runCommand: '执行命令',

    copied: (label) => `已复制${label}`,
    copyDenied: '浏览器拒绝了剪贴板访问',
    tipsLoadFailed: '无法加载字段说明',
    unlocked: (p) => `已解锁 ${p}，请再确认一次这是你要做的事。`,
    lockedToast: (p) => `${p} 是系统关键进程，已锁定。展开详情后可解锁。`,
    portGone: (port, proto) => `端口 ${port} (${proto}) 上的进程已经不在了`,
    cmdLabel: '命令',
    cmdlineLabel: '命令行',
    inspectLabel: '查看命令',
  },
};

/**
 * 首次访问时猜语言。
 *
 * 只认前两位：浏览器发的是 zh-CN / zh-TW / zh-Hans-CN 各种写法，
 * 全部当中文处理。其余一律英文 —— 与其给一个半懂不懂的语言，不如给通用的那个。
 */
function detect() {
  const saved = store.get('lang', null);
  if (LANGS.includes(saved)) return saved;
  const nav = typeof navigator !== 'undefined'
    ? (navigator.languages?.[0] || navigator.language || '') : '';
  return String(nav).slice(0, 2) === 'zh' ? 'zh' : 'en';
}

export function useLang() {
  const [lang, setLangState] = useState(detect);

  const setLang = useCallback((next) => {
    setLangState(next);
    store.set('lang', next);
  }, []);

  // <html lang> 影响断行、字体回退和屏幕阅读器的发音，必须跟着变
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);

  return [lang, setLang];
}

/**
 * 取文案。带参数的条目就是函数，直接调用。
 *
 * 缺 key 时返回 key 本身而不是空字符串 —— 界面上出现 `facetRisky` 很扎眼，
 * 一眼就能发现漏翻；而空白会被当成「本来就没内容」，静静地混过去。
 */
export function makeT(lang) {
  const table = DICT[lang] || DICT.en;
  return (key, ...args) => {
    const v = table[key] ?? DICT.en[key];
    if (v === undefined) return key;
    return typeof v === 'function' ? v(...args) : v;
  };
}

