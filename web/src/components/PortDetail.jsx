import { useState } from 'react';
import { Button } from '@heroui/react';
import { exposureOf, fmtBytes, shellFor } from '../lib/usePorts.js';

/**
 * 「在网上搜索」而不是由服务端代查。
 *
 * 之前是服务端代理维基百科，两个问题：
 *  1. 服务端连不上维基时直接 fetch failed，而这在很多网络环境下是常态
 *  2. 就算查到了，维基对 nginx 的词条也回答不了「我现在该不该杀它」
 *
 * 交给浏览器开一个搜索页：用的是你自己的网络，永远可用；
 * 搜索结果里的问答和文档，比一段百科摘要更能回答「这是什么、能不能关」。
 *
 * ⚠️ 这是整个工具唯一一个会离开本机的动作 —— 进程名会随查询词发给搜索引擎。
 * 按钮上挂了 title 说明，SECURITY.md 里也单列了一条，不藏着。
 *
 * 用 Bing 而不是 Google / DuckDuckGo：后两者在部分网络环境（含中国大陆）不可达，
 * 而一个「点了没反应」的按钮比没有这个按钮更糟。
 */
function searchUrl(port, lang) {
  const q = lang === 'zh'
    ? `${port.process} 进程 端口 ${port.port} 是什么 可以结束吗`
    : `what is the ${port.process} process on port ${port.port} safe to kill`;
  return `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * 端口详情 —— 「这是什么 / 杀了会怎样 / 凭什么这么判断」。
 *
 * 判断依据要摊开给用户看，而不是只丢一个结论。
 * 用户可以自己复核推理链，不必信任这个工具的判断。
 */
export default function PortDetail({ port, platform, readonly, unlocked, onUnlock, onCopy, t, lang }) {
  const a = port.analysis;
  const [showFullCmd, setShowFullCmd] = useState(false);
  const exposure = exposureOf(port.exposure, t);

  const rows = [
    [t('detailCategory'), a.categoryLabel],
    [t('detailProtoState'), `${port.protocol} · ${port.state}`],
    [t('detailAddresses'), port.addresses.join('  ')],
    [t('detailFamilies'), port.families.join(' / ') || '—'],
    [t('detailUser'), port.user || t('unknownLabel')],
    [t('detailPid'), `${port.pid || '—'}${port.ppid ? ` ← ${port.ppid}` : ''}`],
    [t('detailUptime'), a.uptime || t('unknownLabel')],
    // RSS 把共享库的页在每个映射它的进程里各算一遍，所以它偏大、且跨进程不可比。
    // 与其假装精确，不如把口径写在标签里 —— 这个数字只适合看量级。
    [t('detailMemory'), `${fmtBytes(port.rssBytes)}　${t('detailMemoryNote')}`],
    [t('detailExposure'), `${exposure.label}${exposure.hint ? ` — ${exposure.hint}` : ''}`],
  ];

  return (
    <div className="border-border mt-3 flex flex-col gap-3 border-t pt-3 text-sm">
      <p className="text-muted max-w-[68ch] leading-relaxed text-pretty">{a.what}</p>

      {/* 终止后果单独成块 —— 这是按下按钮前最该看到的一句 */}
      <div className="bg-surface-secondary border-border rounded-lg border px-3 py-2 text-xs leading-relaxed">
        <span className="text-risk-medium font-medium">{t('dlgIfKilled')}</span>
        <span className="text-muted"> {a.ifKilled}</span>
      </div>

      {a.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-muted border-border rounded-full border px-2 py-0.5 text-[11px]">{t('detailReasons')}</span>
          {a.reasons.map((r) => (
            <span key={r} className="text-muted border-border rounded-full border px-2 py-0.5 text-[11px]">{r}</span>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {port.cmdline && (
        <div className="flex flex-col gap-1.5">
          {/* 命令行可能上千字符。截断到 4 行而不是给它内部滚动条 ——
              卡片里再套一根滚动轴会和页面滚动打架。 */}
          <code
            className="clamp-4 bg-surface-secondary border-border text-accent rounded-lg border px-3 py-2 text-xs leading-relaxed break-all whitespace-pre-wrap"
            data-full={showFullCmd}
            title={port.cmdline}
          >
            {port.cmdline}
          </code>
          {port.cmdline.length > 220 && (
            <button
              type="button"
              className="text-muted hover:text-foreground self-start text-xs underline underline-offset-2"
              onClick={() => setShowFullCmd((v) => !v)}
            >
              {showFullCmd ? t('collapseCmd') : t('expandCmd')}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onPress={() => onCopy(shellFor(port, platform), t('inspectLabel'))}>
          {t('copyInspectCmd')}
        </Button>
        {port.cmdline && (
          <Button size="sm" variant="outline" onPress={() => onCopy(port.cmdline, t('cmdlineLabel'))}>
            {t('copyCmdline')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onPress={() => window.open(searchUrl(port, lang), '_blank', 'noopener,noreferrer')}
          // 这是整个工具唯一一个会离开本机的动作，必须让人在点之前就知道
          title={t('searchWebHint')}
        >
          {t('searchWeb')}
        </Button>

        {/* 系统关键进程的解锁入口。前端禁用只是提示，后端还有独立校验。 */}
        {a.blocked && !unlocked && !readonly && (
          <Button size="sm" variant="outline" onPress={onUnlock}>{t('unlock')}</Button>
        )}
      </div>
    </div>
  );
}
