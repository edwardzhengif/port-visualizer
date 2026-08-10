import { Children, useRef } from 'react';

/**
 * 三个自绘组件，用来顶替原先从 @heroui-pro/react 引入的 Segment / EmptyState / PromptInput。
 *
 * 为什么自己写：Pro 是商业授权包，禁止再分发其源码，别人 clone 仓库后没有
 * HEROUI_AUTH_TOKEN 就装不上 —— 开源一个装不上的仓库等于没开源。
 * 而实际用到的只有这三个，加起来不到 150 行。为它们让整个项目无法开源，不划算。
 *
 * 其余组件（Button/Card/Modal/Table/Select…）继续用 MIT 的 @heroui/react，不受影响。
 */

/* ------------------------------------------------------------------ Segment */

/**
 * 分段控件：一组互斥选项。
 *
 * 用 radiogroup 而不是一排普通按钮 —— 语义上这就是单选，
 * 屏幕阅读器会播报「3 项中的第 2 项」，而一排 button 只会被念成三个孤立按钮。
 *
 * 键盘行为按 WAI-ARIA 的单选组来：整组只占一个 Tab 位，
 * 组内用左右方向键移动并即时选中。这也是 macOS 上原生分段控件的行为。
 */
export function Segment({
  selectedKey, onSelectionChange, size = 'sm', variant = 'solid',
  'aria-label': label, children,
}) {
  const items = Children.toArray(children).filter(Boolean).map((c) => c.props);
  const refs = useRef([]);

  const move = (from, step) => {
    // 环形移动：末尾再按右键回到开头，比走到头就卡住更符合预期
    const to = (from + step + items.length) % items.length;
    onSelectionChange(items[to].id);
    refs.current[to]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-size={size}
      className={`seg border-border ${variant === 'ghost' ? '' : 'bg-surface-secondary/60'}`}
    >
      {items.map((it, i) => {
        const selected = it.id === selectedKey;
        return (
          <button
            key={it.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={it['aria-label']}
            // 只有选中项进 Tab 序列 —— 否则一个三档切换器要按三次 Tab 才能跨过去
            tabIndex={selected ? 0 : -1}
            /* 选中态同时改底色和文字色：深色主题下只靠底色的话，差异低到一眼看不出来 */
            className={`seg__item ${selected
              ? 'bg-surface text-foreground font-medium shadow-sm'
              : 'text-muted hover:text-foreground'}`}
            onClick={() => onSelectionChange(it.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            }}
          >
            {it.children}
          </button>
        );
      })}
    </div>
  );
}

/** 纯声明用：属性由 Segment 读取，自身不渲染。 */
Segment.Item = function SegmentItem() { return null; };

/* --------------------------------------------------------------- EmptyState */

/**
 * 空态。尺寸刻意接近有数据时的高度，从「有结果」切到「无结果」时页面不塌陷。
 * 复合写法保持和原来一致，调用处不用改。
 */
export function EmptyState({ children }) {
  return (
    <div className="border-border bg-surface-secondary/40 flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
      {children}
    </div>
  );
}
EmptyState.Header = function Header({ children }) {
  return <div className="flex max-w-[46ch] flex-col items-center gap-2">{children}</div>;
};
EmptyState.Media = function Media({ children }) {
  return (
    <div className="text-muted bg-surface-secondary border-border mb-1 flex size-11 items-center justify-center rounded-full border text-lg" aria-hidden="true">
      {children}
    </div>
  );
};
EmptyState.Title = function Title({ children }) {
  return <p className="text-base font-medium">{children}</p>;
};
EmptyState.Description = function Description({ children }) {
  return <p className="text-muted text-sm leading-relaxed text-pretty">{children}</p>;
};
EmptyState.Content = function Content({ children }) {
  return <div className="flex flex-wrap justify-center gap-2">{children}</div>;
};

/* ------------------------------------------------------------------ Capsule */

/**
 * 命令胶囊：单行输入框，内容多了才往上长。
 *
 * 布局是一行 grid：`$` | 输入框 | 操作键，三栏都垂直居中。
 * 高度由 CSS 的 min-height 定死在 48px —— 上一版用 Pro 的 PromptInput 时，
 * 默认的 stacked 布局给了 280px 高的多行 composer，形状完全不对，
 * 这次直接把「单行」写进布局本身，没有再选错的余地。
 *
 * textarea 而不是 input：需要 Shift+Enter 换行，也需要按内容自动长高。
 */
export function Capsule({
  value, onChange, onSubmit, placeholder, textareaRef, start, end,
}) {
  const inner = useRef(null);
  const el = textareaRef || inner;

  /*
   * 自动高度：必须先归零再读 scrollHeight。
   * 不归零的话 scrollHeight 永远不小于当前高度，删字时框就再也缩不回去了。
   */
  const resize = (node) => {
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  };

  return (
    <div className="capsule bg-surface-secondary/90 border-border shadow-2xl backdrop-blur-xl">
      <div className="capsule__start">{start}</div>

      <textarea
        ref={(node) => { el.current = node; resize(node); }}
        className="capsule__input placeholder:text-muted placeholder:opacity-60"
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck="false"
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); resize(e.target); }}
        onKeyDown={(e) => {
          // Enter 直接执行，Shift+Enter 换行 —— 命令行的肌肉记忆就是这样
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />

      <div className="capsule__end">{end}</div>
    </div>
  );
}
