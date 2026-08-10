import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@heroui/react';

import Toolbar from './components/Toolbar.jsx';
import FacetBar from './components/FacetBar.jsx';
import PortCard from './components/PortCard.jsx';
import PortTable from './components/PortTable.jsx';
import CommandDock from './components/CommandDock.jsx';
import { KillConfirm, FieldTips, PortDetailDialog, SudoHint } from './components/Dialogs.jsx';
import { PortsEmpty, LoadError, PortsSkeleton } from './components/States.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

import { fetchTips, killPort } from './lib/api.js';
import {
  PLATFORM_LABEL, fmtTime, store,
  useAutoRefresh, useFacets, useFilteredPorts, usePortData, useTheme,
} from './lib/usePorts.js';
import { makeT, useLang } from './lib/i18n.js';

/**
 * 命令控制台的说明文字。
 *
 * 命令名本身**不翻译** —— `help`、`kill`、`refresh` 是要敲进去的字面量，
 * 翻译它们等于造出一套只有中文用户能用的方言，而且和满世界的终端习惯脱节。
 * 只翻译右边那句解释。
 */
const COMMAND_HELP = {
  en: {
    help: 'List all commands', refresh: 'Rescan (same as r)', clear: 'Clear output',
    cards: 'Switch to card view', table: 'Switch to table view',
    mine: 'Toggle "my processes only"', tcp: 'TCP only', udp: 'UDP only',
    risky: 'Medium risk and above only', exposed: 'Externally exposed ports only',
    all: 'Clear every filter', stats: 'Print statistics',
    unknown: 'List processes the knowledge base does not recognise',
    'port <n>': 'Open details for a port', 'kill <n>': 'Terminate the process on that port (asks first)',
    'search <text>': 'Search (matches the full command line too)',
  },
  zh: {
    help: '列出所有命令', refresh: '重新扫描（同 r）', clear: '清空输出',
    cards: '切换到卡片视图', table: '切换到表格视图',
    mine: '切换「只看我的进程」', tcp: '只看 TCP', udp: '只看 UDP',
    risky: '只看中等及以上风险', exposed: '只看对外暴露的端口',
    all: '清除全部筛选', stats: '打印统计',
    unknown: '列出知识库还不认识的进程',
    'port <号>': '展开某个端口的详情', 'kill <号>': '终止占用该端口的进程（会二次确认）',
    'search <词>': '搜索（也会匹配完整命令行）',
  },
};

const CONSOLE = {
  en: {
    switchedTo: (v) => `Switched to ${v === 'cards' ? 'card' : 'table'} view`,
    showAll: 'Showing all processes', onlyMine: 'Showing only your processes',
    filtered: (p) => `Filtered to ${p}`, riskyOnly: 'Showing medium risk and above',
    exposedOnly: 'Showing externally exposed ports only', cleared: 'Filters cleared',
    rescanning: 'Rescanning…',
    stats: (total, mine) => `${total} ports total, ${mine} of them yours`,
    kbKnowsAll: 'The knowledge base recognises every process currently seen.',
    unknownCount: (n) => `${n} processes have no description yet, most frequent first:`,
    unknownRow: (name, ports, count) => `  ${name.padEnd(24)}ports ${ports}  seen ${count}x`,
    writeTo: (f) => `Add entries to ${f}, then reload the page.`,
    readFailed: 'Read failed',
    searching: (q) => `Searching "${q}"`,
    notListening: (n) => `Port ${n} is not being listened on`,
    readonlyKill: 'Cannot terminate processes in read-only mode',
    unknownCmd: (c) => `Unknown command: ${c}. Type help to see what is available.`,
  },
  zh: {
    switchedTo: (v) => `已切换到${v === 'cards' ? '卡片' : '表格'}视图`,
    showAll: '显示全部进程', onlyMine: '只看我的进程',
    filtered: (p) => `已筛选 ${p}`, riskyOnly: '只看中等及以上风险',
    exposedOnly: '只看对外暴露的端口', cleared: '已清除筛选',
    rescanning: '正在重新扫描…',
    stats: (total, mine) => `总计 ${total} 个端口，你的进程 ${mine} 个`,
    kbKnowsAll: '知识库认识当前遇到的所有进程。',
    unknownCount: (n) => `${n} 个进程还没有说明，按出现次数排序：`,
    unknownRow: (name, ports, count) => `  ${name.padEnd(24)}端口 ${ports}  见过 ${count} 次`,
    writeTo: (f) => `补充条目写进 ${f}，刷新页面即生效。`,
    readFailed: '读取失败',
    searching: (q) => `搜索「${q}」`,
    notListening: (n) => `端口 ${n} 没有在监听`,
    readonlyKill: '只读模式下无法终止进程',
    unknownCmd: (c) => `未知命令: ${c}。输入 help 查看可用命令。`,
  },
};

export default function App() {
  const [lang, setLang] = useLang();
  const t = useMemo(() => makeT(lang), [lang]);
  const c = useMemo(() => {
    const table = CONSOLE[lang] || CONSOLE.en;
    return (key, ...args) => (typeof table[key] === 'function' ? table[key](...args) : table[key]);
  }, [lang]);
  // 端口消失要说一声 —— 服务悄无声息地挂掉是最难察觉的故障。
  // 用 ref 拿 print 是为了避免 usePortData 依赖一个每帧都变的回调。
  const printRef = useRef(null);
  const onGone = useCallback((ids) => {
    ids.forEach((id) => {
      const [proto, port] = id.split('|');
      printRef.current?.(tRef.current('portGone', port, proto), 'err');
    });
  }, []);

  // onGone 在 usePortData 内部由 ref 持有，拿不到最新的 t，所以这里也用 ref 中转
  const tRef = useRef(t);
  tRef.current = t;

  const { ports, meta, loading, error, updatedAt, reload } = usePortData(onGone, lang);

  const [view, setViewState] = useState(() => store.get('view', 'cards'));
  const [auto, setAuto] = useState(false);
  const [theme, setTheme] = useTheme();
  const [filters, setFilters] = useState(() => ({
    query: '',
    protocol: 'all',
    exposure: 'all',
    risk: 'all',
    // 默认只看自己的进程：macOS 上四十多个系统端口对开发者全是噪音
    onlyMine: store.get('onlyMine', true),
  }));
  const [sort, setSort] = useState({ key: 'port', dir: 'asc' });
  const [unlocked, setUnlocked] = useState(() => new Set());   // 仅本次会话有效
  const [killTarget, setKillTarget] = useState(null);
  const [tips, setTips] = useState(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  // 详情弹窗。卡片和表格共用同一个 —— 卡片改成三列后，就地展开会把整行撑高，
  // 一张卡片展开、旁边两张跟着变高，是网格布局里最难看的一种副作用。
  const [detailTarget, setDetailTarget] = useState(null);
  const [sudoTarget, setSudoTarget] = useState(null);       // 非本账号进程的 sudo 说明
  const [lines, setLines] = useState([]);

  const searchRef = useRef(null);

  useAutoRefresh(auto, reload);

  const visible = useFilteredPorts(ports, filters, sort);
  const facets = useFacets(ports, filters);

  const setView = useCallback((v) => { setViewState(v); store.set('view', v); }, []);

  useEffect(() => { store.set('onlyMine', filters.onlyMine); }, [filters.onlyMine]);

  /*
   * 以 root 运行时，自动切到「全部进程」。
   *
   * 这是上一条建议自带的坑：我们让用户 `sudo port-visualizer --readonly` 去看到更多，
   * 但 root 身份下「我的进程」筛的是 **root 自己的**进程 —— 用户自己那些 node / vite
   * 反而全被藏起来了。想看更多，结果看到更少，而且没有任何提示说明为什么。
   *
   * 只在 root 时切一次（ref 守住），之后用户想切回去随时可以 —— 不跟用户抢方向盘。
   */
  const rootAdjusted = useRef(false);
  useEffect(() => {
    if (!meta.runningAsRoot || rootAdjusted.current) return;
    rootAdjusted.current = true;
    setFilters((f) => (f.onlyMine ? { ...f, onlyMine: false } : f));
  }, [meta.runningAsRoot]);

  const print = useCallback((text, tone = '') => {
    setLines((prev) => [...prev, { text, tone }].slice(-200));
  }, []);
  printRef.current = print;

  /* ------------------------------------------------------------ 操作 */

  const copy = useCallback(async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      // 复制必须有确认，否则用户会反复点三次确认到底成没成
      toast.success(t('copied', label));
    } catch {
      toast.danger(t('copyDenied'));
    }
  }, [t]);

  const confirmKill = useCallback(async () => {
    const p = killTarget;
    setKillTarget(null);
    if (!p) return;
    try {
      const res = await killPort(p.port, p.pid, {
        acknowledgeCritical: unlocked.has(p.id),
        lang,
      });
      toast.success(res.message);
      print(res.message, 'ok');
      // 进程没了，还开着它的详情就是在展示一份过期快照
      setDetailTarget((cur) => (cur?.id === p.id ? null : cur));
      setTimeout(() => reload({ silent: true }), 600);
    } catch (err) {
      // 服务端兜底：中途权限变化时仍可能撞上 EPERM，走同一个解释路径
      if (err.payload?.needsSudo) { setSudoTarget(p); print(err.message, 'err'); return; }
      toast.danger(err.message);
      print(err.message, 'err');
    }
  }, [killTarget, unlocked, reload, print, lang]);

  const requestKill = useCallback((p) => {
    if (p.analysis.blocked && !unlocked.has(p.id)) {
      toast.danger(t('lockedToast', p.process));
      return;
    }
    // 不是你账号下的进程，kill 一定 EPERM。与其发一个注定失败的请求，
    // 不如直接解释原因并把可执行的命令给出来。
    if (p.analysis.needsSudo) { setSudoTarget(p); return; }
    setKillTarget(p);
  }, [unlocked, t]);

  const openTips = useCallback(async () => {
    if (!tips) {
      try {
        const res = await fetchTips(lang);
        setTips(res.data.fields);
      } catch {
        toast.danger(t('tipsLoadFailed'));
        return;
      }
    }
    setTipsOpen(true);
  }, [tips, lang, t]);

  const resetFilters = useCallback(() => {
    setFilters((f) => ({ ...f, query: '', protocol: 'all', exposure: 'all', risk: 'all' }));
  }, []);


  /* ------------------------------------------------------------ 命令 */

  const COMMANDS = useMemo(() => COMMAND_HELP[lang] || COMMAND_HELP.en, [lang]);

  const runCommand = useCallback((raw) => {
    print(`$ ${raw}`, 'echo');
    const [head, ...rest] = raw.trim().split(/\s+/);
    const cmd = head.toLowerCase();
    const arg = rest.join(' ');
    const byPort = (n) => ports.find((p) => p.port === Number.parseInt(n, 10));

    switch (cmd) {
      case 'help': case 'h': case '?':
        Object.entries(COMMANDS).forEach(([n, d]) => print(`  ${n.padEnd(14)}${d}`));
        break;
      case 'refresh': case 'r': reload(); print(c('rescanning')); break;
      case 'clear': case 'cls': setLines([]); break;
      case 'cards': case 'table': setView(cmd); print(c('switchedTo', cmd)); break;
      case 'mine':
        setFilters((f) => { print(f.onlyMine ? c('showAll') : c('onlyMine')); return { ...f, onlyMine: !f.onlyMine }; });
        break;
      case 'tcp': case 'udp': setFilters((f) => ({ ...f, protocol: cmd.toUpperCase() })); print(c('filtered', cmd.toUpperCase())); break;
      case 'risky': setFilters((f) => ({ ...f, risk: 'risky' })); print(c('riskyOnly')); break;
      case 'exposed': setFilters((f) => ({ ...f, exposure: 'exposed' })); print(c('exposedOnly')); break;
      case 'all': resetFilters(); print(c('cleared')); break;
      case 'stats': {
        const mine = ports.filter((p) => p.analysis.isMine).length;
        const byRisk = {};
        ports.forEach((p) => { byRisk[p.analysis.riskLabel] = (byRisk[p.analysis.riskLabel] || 0) + 1; });
        print(c('stats', ports.length, mine));
        Object.entries(byRisk).forEach(([k, n]) => print(`  ${k}: ${n}`));
        break;
      }
      case 'unknown': {
        // 静默记录的结果在这里才露面 —— 平时不打扰，需要时能查
        fetch('/api/unknown').then((r) => r.json()).then((j) => {
          const list = j.data || [];
          if (list.length === 0) { print(c('kbKnowsAll')); return; }
          print(c('unknownCount', list.length));
          list.slice(0, 20).forEach((u) => print(c('unknownRow', u.name, u.ports.join(','), u.count)));
          print(c('writeTo', j.localFile));
        }).catch(() => print(c('readFailed'), 'err'));
        break;
      }
      case 'search': case 's': setFilters((f) => ({ ...f, query: arg })); print(c('searching', arg)); break;
      case 'port': {
        const hit = byPort(arg);
        if (!hit) { print(c('notListening', arg), 'err'); break; }
        // 两个视图都开同一个弹窗，不强行切视图
        setDetailTarget(hit);
        print(`${hit.analysis.title} — ${hit.analysis.what}`);
        break;
      }
      case 'kill': {
        const hit = byPort(arg);
        if (!hit) { print(c('notListening', arg), 'err'); break; }
        if (meta.readonly) { print(c('readonlyKill'), 'err'); break; }
        requestKill(hit);
        break;
      }
      default: print(c('unknownCmd', head), 'err');
    }
  }, [ports, meta.readonly, COMMANDS, c, print, reload, setView, resetFilters, requestKill]);

  /* ------------------------------------------------------- 快捷键 */

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      if (e.key === '/') { e.preventDefault(); searchRef.current?.querySelector('input')?.focus(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reload(); }
      else if (e.key === '?') { e.preventDefault(); openTips(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reload, openTips]);

  /* -------------------------------------------------------- 渲染 */

  const hiddenBySystem = filters.onlyMine ? ports.filter((p) => !p.analysis.isMine).length : 0;
  const showSkeleton = loading && ports.length === 0;

  return (
    <div className="mx-auto max-w-[1120px] px-5 pt-6" style={{ paddingBottom: 'calc(var(--dock-h) + 1.5rem)' }}>
      {/*
        右侧原本是「darwin · localhost:3000」。两个信息都不该在这儿：
        darwin 是内核代号，是实现细节泄漏；地址栏里就写着 localhost:3000，重复一遍没有意义。
        换成系统名 + 当前登录用户 —— 后者是「我的进程 / 全部进程」这整套概念的锚点，
        不写出来，用户根本不知道「我的」是按谁算的。
      */}
      <header className="mb-2.5 flex items-center gap-3 px-1">
        <h1 className="text-sm font-medium tracking-wide">port-visualizer</h1>
        <span className="text-muted ml-auto text-xs">
          {PLATFORM_LABEL[meta.platform] || meta.platform}
          {meta.currentUser && <> · {t('appSubtitle')} <span className="tabular">{meta.currentUser}</span></>}
        </span>
      </header>

      <div ref={searchRef}>
        <ErrorBoundary label="Toolbar">
        <Toolbar
          filters={filters}
          setFilters={setFilters}
          view={view}
          setView={setView}
          auto={auto}
          setAuto={setAuto}
          theme={theme}
          setTheme={setTheme}
          lang={lang}
          setLang={setLang}
          sort={sort}
          setSort={setSort}
          loading={loading}
          onRefresh={() => reload()}
          onTips={openTips}
          t={t}
        />
        </ErrorBoundary>
      </div>

      {!showSkeleton && ports.length > 0 && (
        <FacetBar facets={facets} filters={filters} setFilters={setFilters} t={t} />
      )}

      <div className="mb-2 flex flex-wrap items-baseline gap-3 px-1">
        <p className="text-muted text-xs" role="status" aria-live="polite">
          {showSkeleton ? t('scanning') : t('showing', visible.length, ports.length)}
        </p>
        <p className="text-muted tabular ml-auto text-xs opacity-70">
          {error ? t('updateFailed', fmtTime(updatedAt)) : updatedAt ? t('updatedAt', fmtTime(updatedAt)) : ''}
        </p>
      </div>

      {/*
        看不全的时候必须说出来。
        沉默的失败比报错更糟 —— 用户会以为「我的电脑上真的只有我自己的进程」，
        而那是个错误的世界观，这个工具本该纠正它，不该加固它。

        只在用户主动切到「全部进程」时出现：那正是承诺落空的一刻，
        平时挂着就成了噪音。

        给的命令刻意带 --readonly：以 root 跑一个能杀任意进程的常驻服务，
        正是本项目威胁模型里最不希望出现的东西。只读模式下能看全，
        又不产生那份风险。
      */}
      {!filters.onlyMine && ports.length > 0 && !meta.canSeeOthers && !meta.runningAsRoot && (
        <p className="text-muted bg-surface-secondary border-border mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-4 py-2.5 text-xs">
          {t('cannotSeeOthers')}
          <span>{t('seeAllHint')}</span>
          <code className="text-accent">sudo port-visualizer --readonly</code>
        </p>
      )}

      {/* 明确告知隐藏了多少，避免用户以为端口凭空消失 */}
      {hiddenBySystem > 0 && visible.length > 0 && (
        <p className="text-muted bg-surface-secondary border-border mb-2 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs">
          {t('hiddenSystem', hiddenBySystem)}
          <button
            type="button"
            className="text-accent underline underline-offset-2"
            onClick={() => setFilters((f) => ({ ...f, onlyMine: false }))}
          >
            {t('showAll')}
          </button>
        </p>
      )}

      {showSkeleton && <PortsSkeleton />}

      {!showSkeleton && error && ports.length === 0 && (
        <LoadError message={error} onRetry={() => reload()} t={t} />
      )}

      {!showSkeleton && !error && visible.length === 0 && (
        <ErrorBoundary label="Empty state">
        <PortsEmpty
          total={ports.length}
          hiddenBySystem={hiddenBySystem}
          onShowAll={() => setFilters((f) => ({ ...f, onlyMine: false }))}
          onResetFilters={resetFilters}
          t={t}
        />
        </ErrorBoundary>
      )}

      {/*
        三列网格，而不是一行一张的通栏卡片。
        通栏时一屏只放得下六七张，和表格的差异只剩行高 —— 卡片视图就没有存在理由了。
        三列一屏能看二十来个，两个视图才真正分工：卡片扫全貌，表格逐列比对。
        窄屏往下退成两列、单列 —— 350px 是这套内容排布的下限，再窄就该单列。
      */}
      {!showSkeleton && visible.length > 0 && view === 'cards' && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <PortCard
              key={p.id}
              port={p}
              readonly={meta.readonly}
              unlocked={unlocked.has(p.id)}
              expanded={detailTarget?.id === p.id}
              onOpen={() => setDetailTarget(p)}
              onKill={() => requestKill(p)}
              t={t}
            />
          ))}
        </div>
      )}

      {!showSkeleton && visible.length > 0 && view === 'table' && (
        <ErrorBoundary label="Table view">
        <PortTable
          ports={visible}
          sort={sort}
          onSort={(key, dir) => setSort({ key, dir })}
          readonly={meta.readonly}
          unlocked={unlocked}
          // 原地开弹窗，不切视图 —— 表格是用来横向比对的，把人踢去卡片视图是交互断层
          onOpen={(id) => setDetailTarget(visible.find((p) => p.id === id) || null)}
          onKill={requestKill}
          t={t}
        />
        </ErrorBoundary>
      )}

      <ErrorBoundary label="Command dock">
        <CommandDock lines={lines} onSubmit={runCommand} onClear={() => setLines([])} t={t} />
      </ErrorBoundary>

      <PortDetailDialog
        port={detailTarget}
        platform={meta.platform}
        readonly={meta.readonly}
        unlocked={detailTarget ? unlocked.has(detailTarget.id) : false}
        onUnlock={() => {
          if (!detailTarget) return;
          setUnlocked((prev) => new Set(prev).add(detailTarget.id));
          toast.info(t('unlocked', detailTarget.process));
        }}
        onCopy={copy}
        onClose={() => setDetailTarget(null)}
        t={t}
        lang={lang}
      />

      <SudoHint port={sudoTarget} onCopy={copy} onClose={() => setSudoTarget(null)} t={t} />

      <KillConfirm target={killTarget} onCancel={() => setKillTarget(null)} onConfirm={confirmKill} t={t} />
      {tipsOpen && <FieldTips tips={tips} onClose={() => setTipsOpen(false)} t={t} />}
    </div>
  );
}
