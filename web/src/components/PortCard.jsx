import { Button, Card, Chip } from '@heroui/react';
import RiskBadge from './RiskBadge.jsx';
import { exposureOf } from '../lib/usePorts.js';

/**
 * 端口卡片 —— 三列网格里的一格。
 *
 * 之前是一行一张的通栏卡片，横向排布（端口号 | 标题 | 徽标 | 按钮）。
 * 那样一屏只放得下六七个，和表格的差异只剩「行高更大」，卡片视图就没有存在理由了。
 * 改成三列后一屏能看二十来个，卡片和表格才真正分工：
 *   卡片 = 一眼扫过全貌，每格自带上下文
 *   表格 = 逐列对齐比对
 *
 * 宽度从 ~1080px 降到 ~350px，横向排布必然挤爆，所以内部改成竖排三段：
 *   端口号 + 风险 → 它是什么 → 操作
 */

export default function PortCard({ port, readonly, unlocked, expanded, onOpen, onKill, t }) {
  const a = port.analysis;
  const exposure = exposureOf(port.exposure, t);
  const locked = a.blocked && !unlocked;
  // 两个约束同时命中时显示更强的那个 —— 系统关键进程即使 sudo 也不该杀，
  // 标成「需要 sudo」会误导用户以为加个 sudo 就行
  const needsSudo = a.needsSudo && !readonly && !locked;
  // 不是你的进程时按钮不该「可点但注定失败」—— 换成通往 sudo 说明的入口
  const canKill = !readonly && port.pid && !locked && !needsSudo;

  /*
   * 不画左侧风险色带。
   * 风险已经由右上角徽标用「颜色 + 文字」两个通道表达清楚了，
   * 再加一条彩色边只是重复，三列铺开后更是变成一片跑马灯。
   */
  return (
    /*
     * h-full + flex-col：网格默认拉伸，卡片必须撑满自己那一格，
     * 否则同一行里标题换行的卡片会比别的高，底边参差不齐。
     */
    <Card className="h-full overflow-hidden rounded-xl transition-colors">
      <Card.Content className="flex h-full flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          {/* 端口号即入口 —— 主对象自己就是可点对象，不额外造一个按钮 */}
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={expanded}
            aria-label={t('detailAria', port.port, a.title)}
            className="hover:text-accent flex min-w-0 items-baseline gap-1.5 text-left transition-colors"
          >
            <span className="tabular text-xl leading-none font-semibold tracking-tight">
              {port.port}
            </span>
            <span className="text-muted text-[10px] tracking-wide">{port.protocol}</span>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* 「刚出现」直接回答最高频的问题：我刚跑的命令起在哪个端口。
                90 秒后自动消失 —— 一直挂着就等于没标 */}
            {port.isNew && (
              <span className="text-risk-low bg-risk-low-bg rounded px-1.5 py-0.5 text-[10px] font-medium">
                {t('justAppeared')}
              </span>
            )}
            <RiskBadge analysis={a} />
          </div>
        </div>

        {/* flex-1 让这段吃掉多余高度，把操作区压到卡片底边对齐 */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm leading-snug font-medium" title={a.title}>
            {a.title}
          </h3>
          {/* 窄卡片放不下一整行元信息，拆两行：先「是谁」，再「跑了多久 / 谁在跑」 */}
          <p className="text-muted tabular mt-1 truncate text-xs" title={port.process}>
            {port.process}
            <span className="opacity-50"> · </span>PID {port.pid || '—'}
          </p>
          <p className="text-muted tabular mt-0.5 truncate text-xs opacity-80">
            {a.isMine ? t('you') : (port.user || t('unknownUser'))}
            {a.uptime && <><span className="opacity-50"> · </span>{t('uptimePrefix')} {a.uptime}</>}
          </p>
        </div>

        <div className="border-border flex items-center gap-1.5 border-t pt-2.5">
          <Chip size="sm" variant="secondary" title={exposure.hint}>{exposure.label}</Chip>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onPress={onOpen}>{t('details')}</Button>
          <Button
            size="sm"
            variant={canKill || needsSudo ? 'outline' : 'ghost'}
            isDisabled={!canKill && !needsSudo}
            onPress={onKill}
            // 禁用原因必须说出来，否则用户只看到一个灰按钮，不知道为什么
            title={locked ? t('lockedTitle', port.process) : undefined}
            aria-label={needsSudo ? t('sudoAria', port.process) : t('killAria', port.process, port.port)}
          >
            {needsSudo ? t('needsSudo') : t('kill')}
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
