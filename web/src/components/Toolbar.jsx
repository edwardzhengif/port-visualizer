import { Button, ListBox, SearchField, Select } from '@heroui/react';
import { Segment } from './ui.jsx';

/**
 * 工具栏。吸顶固定 —— 列表可能很长，搜索和筛选必须一直够得着。
 *
 * 协议 / 暴露范围 / 风险三个下拉已经撤掉，由下方的分面筛选条接手：
 * 下拉要点两次才能选中，收起后又看不出命中多少条；分面一次点击就筛，
 * 还顺带把数量摆在脸上 —— 同一件事，没有理由留两个入口。
 *
 * 「我的进程 / 全部进程」留在这里：它切换的是整个数据集的范围，
 * 不是在既有结果里再切一刀，和下面那排是两个层级的东西。
 */

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 16 16',
  className: 'size-4', 'aria-hidden': true };

const SunIcon = () => (
  <svg {...ICON}><circle cx="8" cy="8" r="3" /><path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" strokeLinecap="round" /></svg>
);
const MoonIcon = () => (
  <svg {...ICON}><path d="M13.5 9.4A5.8 5.8 0 0 1 6.6 2.5a5.8 5.8 0 1 0 6.9 6.9z" strokeLinejoin="round" /></svg>
);
const SystemIcon = () => (
  <svg {...ICON}><rect x="1.8" y="2.6" width="12.4" height="8.2" rx="1.2" /><path d="M5.5 13.4h5" strokeLinecap="round" /></svg>
);

/**
 * 主题切换。默认深色 —— 这是个长时间盯着看的开发者工具。
 * 「跟随系统」是独立一档而不是靠猜：显式选了才跟随，否则你手动选的会被系统悄悄改掉。
 */
function ThemeSwitch({ theme, setTheme, t }) {
  return (
    <Segment selectedKey={theme} onSelectionChange={(k) => setTheme(String(k))} size="sm" variant="ghost" aria-label={t('theme')}>
      <Segment.Item id="light" aria-label={t('themeLight')}><SunIcon /></Segment.Item>
      <Segment.Item id="dark" aria-label={t('themeDark')}><MoonIcon /></Segment.Item>
      <Segment.Item id="system" aria-label={t('themeSystem')}><SystemIcon /></Segment.Item>
    </Segment>
  );
}

/**
 * 语言切换用两个语言的**自称**（English / 中文），不用 EN / ZH。
 * 看不懂当前界面语言的人，恰恰是最需要找到这个开关的人 ——
 * 「中文」两个字他一定认得，「ZH」未必。
 */
function LangSwitch({ lang, setLang, t }) {
  return (
    <Segment selectedKey={lang} onSelectionChange={(k) => setLang(String(k))} size="sm" variant="ghost" aria-label={t('language')}>
      <Segment.Item id="en" aria-label="English">EN</Segment.Item>
      <Segment.Item id="zh" aria-label="中文">中文</Segment.Item>
    </Segment>
  );
}

function Filter({ label, value, onChange, options, width = 'min-w-[112px]' }) {
  return (
    <Select selectedKey={value} onSelectionChange={(k) => onChange(String(k))} aria-label={label}>
      <Select.Trigger className={width}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {/* 选项必须包在 ListBox 里 —— Select 本身没有 .Item 子组件 */}
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id}>{o.label}</ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export default function Toolbar({
  filters, setFilters, view, setView, auto, setAuto, theme, setTheme,
  lang, setLang, sort, setSort, onRefresh, onTips, loading, t,
}) {
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    /*
     * 宽度必须和下方卡片完全一致。
     * 之前用 -mx-5 把自己撑出容器的 px-5，结果比卡片每边宽 20px ——
     * 看起来像「没对齐」，实际是差了 40px 的实宽。
     *
     * 圆角与背景也跟卡片取同一套：都是 rounded-xl + surface-secondary。
     */
    <div className="bg-surface-secondary/85 border-border sticky top-3 z-30 mb-2 rounded-xl border px-4 py-3 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          aria-label={t('searchLabel')}
          value={filters.query}
          onChange={(v) => set({ query: v })}
          className="min-w-[180px] flex-1"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            {/* 16px 下限，否则 iOS 聚焦时会放大整页 */}
            <SearchField.Input placeholder={t('search')} className="text-base" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Filter
          label={t('ownershipFilter')}
          value={filters.onlyMine ? 'mine' : 'all'}
          onChange={(v) => set({ onlyMine: v === 'mine' })}
          options={[{ id: 'mine', label: t('mine') }, { id: 'all', label: t('all') }]}
          width="min-w-[128px]"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Segment selectedKey={view} onSelectionChange={(k) => setView(String(k))} size="sm" aria-label={t('viewSwitch')}>
          <Segment.Item id="cards">{t('cards')}</Segment.Item>
          <Segment.Item id="table">{t('table')}</Segment.Item>
        </Segment>

        {/* 卡片视图之前没有任何排序入口 —— 表格靠表头，卡片只能干看着。
            「最近出现」放第一个：它直接回答「我刚起的服务在哪」，是最高频的用法。 */}
        {view === 'cards' && (
          <Filter
            label={t('sortBy')}
            value={sort.key}
            onChange={(k) => setSort({ key: k, dir: k === 'recent' || k === 'risk' ? 'desc' : 'asc' })}
            options={[
              { id: 'recent', label: t('sortRecent') },
              { id: 'port', label: t('sortPort') },
              { id: 'risk', label: t('sortRisk') },
              { id: 'process', label: t('sortProcess') },
            ]}
            width="min-w-[132px]"
          />
        )}

        <span className="flex-1" />

        {/* 语言和主题同属「怎么显示」，放同一行；用 ghost 变体压低存在感 —— 设一次就不动了 */}
        <LangSwitch lang={lang} setLang={setLang} t={t} />
        <ThemeSwitch theme={theme} setTheme={setTheme} t={t} />

        <Button size="sm" variant="ghost" onPress={onTips}>{t('fieldTips')}</Button>
        <Button size="sm" variant="outline" isPending={loading} onPress={onRefresh}>{t('refresh')}</Button>
        {/* 「回到页面时刷新」而不是定时轮询。
            端口的变化节奏是「你敲了一条命令」，不是「过了 5 秒」——
            用你切回窗口这个动作当信号，既贴合真实节奏，也不用每 5 秒 fork 一次 lsof。 */}
        <Button
          size="sm"
          variant={auto ? 'primary' : 'outline'}
          onPress={() => setAuto(!auto)}
          aria-pressed={auto}
        >
          {auto ? t('refreshOnFocusOn') : t('refreshOnFocus')}
        </Button>
      </div>
    </div>
  );
}
