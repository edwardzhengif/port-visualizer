/**
 * 分面筛选条 —— 由原来那行只能看的统计文字改造而来。
 *
 * 「28 个端口 · TCP 23 · 15 个对外暴露」这行字看着挺像回事，但它只是把数字念了一遍：
 * 你知道有 15 个对外暴露，然后呢？想看是哪 15 个，还得回到工具栏、找到下拉、点开、选中 ——
 * 三步操作，而答案本来就在你眼皮底下。
 *
 * 数字本身就是最好的入口。点一下就筛，再点一下就取消。
 */

/**
 * 每格的数字是「点下去会剩几条」，不是「当前显示了几条」。
 * 计数逻辑见 useFacets —— 它会先把该维度自身摘掉再算。
 */
function Facet({ label, count, active, onPress, hint, name }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      title={hint}
      /*
       * 稳定的定位钩子。靠文本找这些按钮太脆 ——
       * 'All' 会先命中工具栏的「全部进程」下拉，'仅本机' 会撞上卡片里的暴露范围标签。
       * 一个属性换来测试不再假阳性，值。
       */
      data-facet={name}
      /*
       * 选中态同时用底色和文字色两个通道 —— 只靠底色的话，
       * 深色主题下选中与未选中的差异会低到一眼看不出来。
       * 计数为 0 时压暗但不禁用：点它能得到明确的空态，比一个点不动的按钮更好懂。
       */
      className={[
        'tabular rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-accent/40 bg-accent/12 text-accent font-medium'
          : 'border-border text-muted hover:text-foreground hover:border-foreground/25',
        !active && count === 0 ? 'opacity-45' : '',
      ].join(' ')}
    >
      {label}
      <span className={active ? 'ml-1.5' : 'ml-1.5 opacity-65'}>{count}</span>
    </button>
  );
}

export default function FacetBar({ facets, filters, setFilters, t }) {
  // 再点一次同一个分面 = 取消它。少一个「清除」按钮，也少一次找按钮的眼动。
  const toggle = (key, value) => setFilters((f) => ({ ...f, [key]: f[key] === value ? 'all' : value }));
  const clean = filters.protocol === 'all' && filters.exposure === 'all' && filters.risk === 'all';

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
      <Facet
        label={t('facetAll')} name="all"
        count={facets.all}
        active={clean}
        hint={t('facetAllHint')}
        onPress={() => setFilters((f) => ({ ...f, protocol: 'all', exposure: 'all', risk: 'all' }))}
      />

      <span className="bg-border mx-1 h-3.5 w-px" aria-hidden="true" />

      <Facet label="TCP" name="tcp" count={facets.tcp} active={filters.protocol === 'TCP'}
        hint={t('facetTcpHint')} onPress={() => toggle('protocol', 'TCP')} />
      <Facet label="UDP" name="udp" count={facets.udp} active={filters.protocol === 'UDP'}
        hint={t('facetUdpHint')} onPress={() => toggle('protocol', 'UDP')} />

      <span className="bg-border mx-1 h-3.5 w-px" aria-hidden="true" />

      {/*
        对外暴露是这个工具唯一能告诉你、而你几乎不可能自己注意到的事：
        同一个 Wi-Fi 下的任何人都能连上这些端口。
        所以它排在风险前面，也是最值得点开看一眼的一格。
      */}
      <Facet label={t('facetExposed')} name="exposed" count={facets.exposed} active={filters.exposure === 'exposed'}
        hint={t('facetExposedHint')} onPress={() => toggle('exposure', 'exposed')} />
      <Facet label={t('facetLoopback')} name="loopback" count={facets.loopback} active={filters.exposure === 'loopback'}
        hint={t('facetLoopbackHint')} onPress={() => toggle('exposure', 'loopback')} />

      <span className="bg-border mx-1 h-3.5 w-px" aria-hidden="true" />

      <Facet label={t('facetRisky')} name="risky" count={facets.risky} active={filters.risk === 'risky'}
        hint={t('facetRiskyHint')} onPress={() => toggle('risk', 'risky')} />
      <Facet label={t('facetSafe')} name="safe" count={facets.low} active={filters.risk === 'low'}
        hint={t('facetSafeHint')} onPress={() => toggle('risk', 'low')} />
    </div>
  );
}
