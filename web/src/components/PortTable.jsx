import { Button, Chip, Table } from '@heroui/react';
import RiskBadge from './RiskBadge.jsx';

/**
 * 表格视图 —— 用于快速扫视全局。
 * 表头是可排序的真实按钮语义，键盘可达，并带 aria-sort。
 *
 * 结构上有个必须踩过才知道的坑：
 *
 *   <Table>          只是个带 context 的 <div>，**不创建 collection**
 *   <Table.Content>  才是 react-aria 真正的 <Table>，collection 在这一层
 *
 * 把 Header / Body 直接挂在 <Table> 下，它们就真的「在 collection 之外」，
 * react-aria 会抛 "cannot be rendered outside a collection" —— 整个应用白屏。
 * 表格相关的 props（aria-label / sortDescriptor / onSortChange）也都要给 Content。
 */
export default function PortTable({ ports, sort, onSort, readonly, unlocked, onOpen, onKill, t }) {
  const columns = [
    { id: 'port', label: t('colPort'), sortable: true },
    { id: 'recent', label: t('colSeen'), sortable: true },
    { id: 'protocol', label: t('colProtocol'), sortable: true },
    { id: 'risk', label: t('colRisk'), sortable: true },
    { id: 'process', label: t('colProcess'), sortable: true },
    { id: 'pid', label: t('colPid'), sortable: true },
    { id: 'user', label: t('colUser'), sortable: true },
    { id: 'address', label: t('colAddress'), sortable: false },
    { id: 'actions', label: '', sortable: false },
  ];

  return (
    <Table>
      <Table.Content
        aria-label={t('tableLabel')}
        sortDescriptor={{ column: sort.key, direction: sort.dir === 'asc' ? 'ascending' : 'descending' }}
        onSortChange={(d) => onSort(String(d.column), d.direction === 'ascending' ? 'asc' : 'desc')}
      >
        <Table.Header>
          {columns.map((c) => (
            <Table.Column key={c.id} id={c.id} isRowHeader={c.id === 'port'} allowsSorting={c.sortable}>
              {c.label}
            </Table.Column>
          ))}
        </Table.Header>
        <Table.Body>
          {ports.map((p) => {
            const locked = p.analysis.blocked && !unlocked.has(p.id);
            // blocked 强于 needsSudo：系统关键进程即使有 sudo 也不该杀
            const needsSudo = p.analysis.needsSudo && !readonly && !locked;
            const canKill = !readonly && p.pid && !locked && !needsSudo;
            return (
              <Table.Row key={p.id}>
                <Table.Cell>
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="tabular text-risk-medium font-semibold underline-offset-4 hover:underline"
                    aria-label={t('viewPortAria', p.port)}
                  >
                    {p.port}
                  </button>
                </Table.Cell>
                <Table.Cell className="text-muted text-xs">
                  {p.isNew ? <span className="text-risk-low">{t('justAppeared')}</span> : (p.analysis.uptime || '—')}
                </Table.Cell>
                <Table.Cell><Chip size="sm" variant="secondary">{p.protocol}</Chip></Table.Cell>
                <Table.Cell><RiskBadge analysis={p.analysis} /></Table.Cell>
                <Table.Cell>
                  <span className="block max-w-[200px] truncate" title={`${p.process} — ${p.analysis.title}`}>
                    {p.analysis.title}
                  </span>
                </Table.Cell>
                <Table.Cell className="tabular text-muted">{p.pid || '—'}</Table.Cell>
                <Table.Cell className="text-muted">{p.analysis.isMine ? t('you') : (p.user || '—')}</Table.Cell>
                <Table.Cell className="text-muted text-xs">{p.addresses.join('  ')}</Table.Cell>
                <Table.Cell className="text-right">
                  <Button
                    size="sm"
                    variant={canKill || needsSudo ? 'outline' : 'ghost'}
                    isDisabled={!canKill && !needsSudo}
                    onPress={() => onKill(p)}
                    title={locked ? t('lockedTitle', p.process) : undefined}
                    aria-label={needsSudo ? t('sudoAria', p.process) : t('killAria', p.process, p.port)}
                  >
                    {needsSudo ? t('needsSudo') : t('kill')}
                  </Button>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Content>
    </Table>
  );
}
