import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPorts } from './api.js';

export const RISK_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

/** 暴露范围的文案。它在卡片、表格、详情三处出现，集中在这里避免各写一份。 */
export function exposureOf(kind, t) {
  const map = {
    loopback: [t('exposureLoopback'), t('exposureLoopbackHint')],
    all: [t('exposureAll'), t('exposureAllHint')],
    specific: [t('exposureSpecific'), t('exposureSpecificHint')],
    unknown: [t('exposureUnknown'), ''],
  };
  const [label, hint] = map[kind] || map.unknown;
  return { label, hint };
}

/*
 * process.platform 返回的是内核代号：darwin / win32 / linux。
 * darwin 是 macOS 的内核名，对写代码的人是常识，对别人是天书 ——
 * 界面上没有理由把实现细节原样吐出来。
 */
export const PLATFORM_LABEL = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  freebsd: 'FreeBSD',
};

/** localStorage 读写包一层：隐私模式下会抛异常，不能让它把整个应用带崩。 */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`pv.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`pv.${key}`, JSON.stringify(value)); } catch { /* 忽略 */ }
  },
};

/** 「刚出现」的判定窗口。超过这个时长就不再高亮，否则满屏都是标记等于没标记。 */
export const FRESH_MS = 90_000;

/**
 * 数据获取。并发调用复用同一个 promise，避免连点刷新打出多个 lsof。
 *
 * 顺带做端口变化检测 —— 这是 Activity Monitor 做不到的事：
 * 它连监听端口都不列，更不会告诉你「上一次扫描之后多了哪个」。
 * 而「我刚 npm run dev，它起在哪个端口」是这个工具最高频的真实问题。
 *
 * @param onGone 端口消失时的回调，用于「我的服务是不是挂了」
 */
export function usePortData(onGone, lang = 'en') {
  const [ports, setPorts] = useState([]);
  const [meta, setMeta] = useState({ platform: '', readonly: false, currentUser: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const inflight = useRef(null);

  // id -> 首次见到的时间戳。用 ref 而不是 state：它只在下一次扫描时被读，
  // 放进 state 会让每次扫描多触发一轮渲染。
  const seen = useRef(new Map());
  const firstScan = useRef(true);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  // 用 ref 而不是把 lang 放进 load 的依赖：否则每次切语言都会重建 reload，
  // 连带 useAutoRefresh 的 effect 全部重挂
  const langRef = useRef(lang);
  langRef.current = lang;

  const load = useCallback(async ({ silent = false } = {}) => {
    if (inflight.current) return inflight.current;
    setLoading(true);

    inflight.current = (async () => {
      try {
        const { data, meta: m } = await fetchPorts(langRef.current);

        const now = Date.now();
        const next = new Map();
        for (const p of data) next.set(p.id, seen.current.get(p.id) ?? now);

        // 首屏不标记 —— 否则一进页面所有端口都是「刚出现」，等于没标
        const disappeared = firstScan.current
          ? []
          : [...seen.current.keys()].filter((id) => !next.has(id));

        const annotated = data.map((p) => ({
          ...p,
          firstSeen: next.get(p.id),
          isNew: !firstScan.current && now - next.get(p.id) < FRESH_MS,
        }));

        if (disappeared.length) goneRef.current?.(disappeared);
        seen.current = next;
        firstScan.current = false;

        setPorts(annotated);
        setMeta(m);
        setError(null);
        setUpdatedAt(new Date());
      } catch (err) {
        // 自动刷新失败不该刷屏报错，只在手动触发时冒泡
        if (!silent) setError(err.message);
        setUpdatedAt(new Date());
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();

    return inflight.current;
  }, []);

  useEffect(() => { load(); }, [load]);
  // 切换语言要重新取一次 —— 端口解读文案是服务端按语言生成的
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    load({ silent: true });
  }, [lang, load]);

  return { ports, meta, loading, error, updatedAt, reload: load };
}

/**
 * 回到页面时刷新，不做定时轮询。
 *
 * 端口的变化节奏由「你敲了一条命令」决定，不是由时钟决定。
 * 定时轮询每 5 秒 fork 一次 lsof + ps，绝大多数次都扫出完全一样的结果 ——
 * 白烧 CPU 和电，还让「刚出现」这类判断被无意义的扫描冲淡。
 *
 * 用「窗口重新获得焦点 / 标签页重新可见」当信号：
 * 你从终端切回浏览器的那一刻，正是最可能有新端口的时刻。
 */
export function useAutoRefresh(enabled, reload) {
  useEffect(() => {
    if (!enabled) return undefined;

    // 60 秒内不重复扫描：来回切窗口不该变成连续扫描
    let last = 0;
    const MIN_GAP = 60_000;

    const maybeReload = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - last < MIN_GAP) return;
      last = now;
      reload({ silent: true });
    };

    document.addEventListener('visibilitychange', maybeReload);
    window.addEventListener('focus', maybeReload);
    return () => {
      document.removeEventListener('visibilitychange', maybeReload);
      window.removeEventListener('focus', maybeReload);
    };
  }, [enabled, reload]);
}

/*
 * 每个筛选维度一个独立谓词。
 *
 * 拆开是为了能「排除某一个维度来计数」—— 分面计数必须这么算，
 * 否则点了 TCP 之后「UDP」那一格会显示 0，你就再也点不回去了。
 */
const PREDICATES = {
  mine: (p, f) => !f.onlyMine || p.analysis.isMine,
  protocol: (p, f) => f.protocol === 'all' || p.protocol === f.protocol,
  exposure: (p, f) => (f.exposure === 'all'
    ? true
    : (f.exposure === 'loopback' ? p.exposure === 'loopback' : p.exposure !== 'loopback')),
  risk: (p, f) => (f.risk === 'all'
    ? true
    : (f.risk === 'low' ? p.analysis.risk === 'low' : p.analysis.risk !== 'low')),
  query: (p, f) => {
    const q = f.query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(p.port).includes(q)
      || String(p.pid).includes(q)
      || p.process.toLowerCase().includes(q)
      || (p.analysis.title || '').toLowerCase().includes(q)
      // 命令行也可搜 —— 这是从一堆同名 node 里找到具体那个的关键
      || (p.cmdline || '').toLowerCase().includes(q)
      || p.addresses.some((a) => a.toLowerCase().includes(q))
    );
  },
};

const passes = (p, filters, except) => Object.entries(PREDICATES)
  .every(([k, fn]) => k === except || fn(p, filters));

/**
 * 分面计数：每一格的数字，是「假设你点了这一格，会剩几条」。
 *
 * 关键在 except —— 算 TCP 的数量时必须先把协议这一维摘掉，
 * 只保留搜索、归属、暴露、风险这几条。否则当前选着 TCP 时，
 * UDP 永远算出 0，界面就把你锁死在一个筛选里出不来了。
 */
export function useFacets(ports, filters) {
  return useMemo(() => {
    const inDim = (dim, test) => ports.filter((p) => passes(p, filters, dim) && test(p)).length;
    // 「全部」这一格代表清掉三个维度，所以只保留归属与搜索
    const base = ports.filter((p) => PREDICATES.mine(p, filters) && PREDICATES.query(p, filters));

    return {
      all: base.length,
      tcp: inDim('protocol', (p) => p.protocol === 'TCP'),
      udp: inDim('protocol', (p) => p.protocol === 'UDP'),
      exposed: inDim('exposure', (p) => p.exposure !== 'loopback'),
      loopback: inDim('exposure', (p) => p.exposure === 'loopback'),
      risky: inDim('risk', (p) => p.analysis.risk !== 'low'),
      // 不能写成 all - risky：那两个数分别在不同的筛选前提下算出来，相减没有意义
      low: inDim('risk', (p) => p.analysis.risk === 'low'),
    };
  }, [ports, filters]);
}

/**
 * 筛选与排序。
 *
 * 单一数据流：原始 → 五个条件同时生效 → 排序。
 * 上一版每个筛选函数各自从原始数组重建，导致搜索会清掉协议筛选、
 * 协议筛选又清掉搜索 —— 条件之间互相覆盖，无法叠加。
 */
export function useFilteredPorts(ports, filters, sort) {
  return useMemo(() => {
    const filtered = ports.filter((p) => passes(p, filters, null));

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let x;
      let y;
      if (sort.key === 'risk') { x = RISK_ORDER[a.analysis.risk]; y = RISK_ORDER[b.analysis.risk]; }
      // 「最近出现」直接服务于「我刚起的服务在哪个端口」——
      // 按首次见到的时间倒序，刚冒出来的排最前
      else if (sort.key === 'recent') { x = a.firstSeen || 0; y = b.firstSeen || 0; }
      else if (sort.key === 'port' || sort.key === 'pid') { x = Number(a[sort.key]); y = Number(b[sort.key]); }
      else if (sort.key === 'user') { x = String(a.user || '').toLowerCase(); y = String(b.user || '').toLowerCase(); }
      else { x = String(a[sort.key]).toLowerCase(); y = String(b[sort.key]).toLowerCase(); }

      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return a.port - b.port;   // 稳定的次级键，避免同值行乱跳
    });
  }, [ports, filters, sort]);
}

/**
 * 悬浮胶囊的显隐。
 *
 * 三条约束：
 *  1. scroll 事件用 rAF 节流 —— 它每秒能触发上百次
 *  2. 8px 死区，避免触控板的细微抖动把胶囊抖来抖去
 *  3. pinned 为真时永不隐藏（聚焦中 / 有输出 / 页面不够长）
 */
export function useDockVisibility(pinned) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const queued = useRef(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  useEffect(() => {
    const onScroll = () => {
      if (queued.current) return;
      queued.current = true;

      requestAnimationFrame(() => {
        queued.current = false;
        const y = window.scrollY;
        const delta = y - lastY.current;
        const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

        // 页面本身不够长时没有「让路」可言。
        // 这一条同时挡住一个边界 bug：内容很短时 innerHeight + y 恒大于 docH，
        // 会被误判成「已到底部」，于是永远不收起。
        if (docH <= window.innerHeight + 120) { setHidden(false); lastY.current = y; return; }
        if (Math.abs(delta) < 8) return;

        const atBottom = window.innerHeight + y >= docH - 24;
        setHidden(delta > 0 && y > 120 && !atBottom && !pinnedRef.current);
        lastY.current = y;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 一旦被钉住（聚焦、有输出），立刻现身
  useEffect(() => { if (pinned) setHidden(false); }, [pinned]);

  return hidden;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const fmtTime = (d) => (d
  ? d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '');

export const shellFor = (p, platform) => (platform === 'win32'
  ? `netstat -ano | findstr :${p.port}`
  : `lsof -nP -i :${p.port}`);


/* ------------------------------------------------------------------ 主题 */

export const THEMES = ['light', 'dark', 'system'];

/**
 * 把主题落到 <html> 上。
 *
 * 抽成独立函数是因为它要在**两个时机**被调用：
 *   1. main.jsx 里、React 挂载之前 —— 否则首帧是浅色，随后跳成深色，闪一下
 *   2. 用户切换时
 * 两处必须用同一份逻辑，分开写迟早会分叉。
 *
 * HeroUI 同时认 .dark 类和 data-theme 属性，两个都设上最稳。
 */
export function applyTheme(theme) {
  const isDark = theme === 'dark'
    || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const el = document.documentElement;
  el.classList.toggle('dark', isDark);
  el.dataset.theme = isDark ? 'dark' : 'light';
  return isDark;
}

/** 默认深色 —— 这是个开发者工具，长时间盯着，深色是更合理的起点。 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => store.get('theme', 'dark'));

  const setTheme = useCallback((next) => {
    setThemeState(next);
    store.set('theme', next);
    applyTheme(next);
  }, []);

  // 跟随系统时要监听系统切换，否则选了 system 却纹丝不动
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return [theme, setTheme];
}
