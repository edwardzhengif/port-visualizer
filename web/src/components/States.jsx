import { Button, Skeleton } from '@heroui/react';
import { EmptyState } from './ui.jsx';

/**
 * 空态要解释「为什么空」并给出下一步，而不是干巴巴一句「无结果」。
 * 尺寸也要接近有数据时的样子，切换时布局不塌。
 */
export function PortsEmpty({ total, hiddenBySystem, onShowAll, onResetFilters, t }) {
  if (total === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Media>◍</EmptyState.Media>
          <EmptyState.Title>{t('emptyNoPortsTitle')}</EmptyState.Title>
          <EmptyState.Description>{t('emptyNoPortsDesc')}</EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  if (hiddenBySystem > 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Media>◍</EmptyState.Media>
          <EmptyState.Title>{t('emptyMineTitle')}</EmptyState.Title>
          <EmptyState.Description>{t('emptyMineDesc', hiddenBySystem)}</EmptyState.Description>
        </EmptyState.Header>
        <EmptyState.Content>
          <Button variant="outline" onPress={onShowAll}>{t('emptyMineAction')}</Button>
        </EmptyState.Content>
      </EmptyState>
    );
  }

  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Media>◍</EmptyState.Media>
        <EmptyState.Title>{t('emptyFilterTitle')}</EmptyState.Title>
        <EmptyState.Description>{t('emptyFilterDesc')}</EmptyState.Description>
      </EmptyState.Header>
      <EmptyState.Content>
        <Button variant="outline" onPress={onResetFilters}>{t('emptyFilterAction')}</Button>
      </EmptyState.Content>
    </EmptyState>
  );
}

export function LoadError({ message, onRetry, t }) {
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Media>⚠</EmptyState.Media>
        <EmptyState.Title>{t('loadErrorTitle')}</EmptyState.Title>
        <EmptyState.Description>{message}</EmptyState.Description>
      </EmptyState.Header>
      <EmptyState.Content>
        <Button variant="outline" onPress={onRetry}>{t('retry')}</Button>
      </EmptyState.Content>
    </EmptyState>
  );
}

/**
 * 骨架屏的栅格和高度必须与真实卡片一致，否则加载完成的一瞬间整页会重排。
 * 数量取 9 —— 三列刚好铺满三行，比 5 个更接近真实首屏。
 */
export function PortsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <Skeleton key={i} className="h-[152px] rounded-xl" />
      ))}
    </div>
  );
}
