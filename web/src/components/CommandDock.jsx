import { useEffect, useRef, useState } from 'react';
import { Capsule } from './ui.jsx';
import { useDockVisibility } from '../lib/usePorts.js';

/**
 * 悬浮命令胶囊。
 *
 * 高度、三栏对齐这些形状问题现在由 .capsule 那几条 CSS 直接定死（见 styles.css），
 * 不再依赖某个组件库选对布局变体 —— 之前用 Pro 的 PromptInput 时，
 * 默认变体是 280px 高的多行 composer，得显式传 layout="compact" 才对，
 * 而且给内部槽位加任何 display 类都会把它悄悄打回原形。这类坑现在不存在了。
 */
export default function CommandDock({ lines, onSubmit, onClear, t }) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const outRef = useRef(null);
  const rootRef = useRef(null);
  const [entering, setEntering] = useState(false);

  const hasOutput = lines.length > 0;
  const hidden = useDockVisibility(focused || hasOutput);

  // 输出出现时播一次入场：先落初态，隔一帧再摘掉，
  // 中间必须隔一帧浏览器才会当成过渡而不是直接跳到终态
  const prevCount = useRef(0);
  useEffect(() => {
    if (lines.length > 0 && prevCount.current === 0) {
      setEntering(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntering(false)));
      return () => cancelAnimationFrame(id);
    }
    prevCount.current = lines.length;
    return undefined;
  }, [lines.length]);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [lines]);

  function submit() {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    setValue('');
  }

  return (
    <div
      ref={rootRef}
      className="dock"
      data-hidden={hidden}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      {hasOutput && (
        <div
          ref={outRef}
          className="dock__out bg-surface-secondary/85 border-border mb-2 rounded-xl border px-4 py-3 text-xs leading-relaxed shadow-2xl backdrop-blur-xl"
          data-enter={entering ? '' : undefined}
          role="log"
          aria-live="polite"
          tabIndex={0}
        >
          {lines.map((l, i) => (
            <div
              // 输出是只增不改的日志，索引即稳定身份
              key={`${i}-${l.text.slice(0, 24)}`}
              className={l.tone === 'err' ? 'text-danger' : l.tone === 'ok' ? 'text-risk-low' : l.tone === 'echo' ? 'text-muted opacity-60' : 'text-muted'}
            >
              {l.text}
            </div>
          ))}
        </div>
      )}

      <Capsule
        value={value}
        onChange={setValue}
        onSubmit={submit}
        placeholder={t('dockPlaceholder')}
        start={<span className="text-accent font-semibold select-none" aria-hidden="true">$</span>}
        end={(
          <>
            {hasOutput && (
              <button
                type="button"
                className="capsule__btn text-muted hover:bg-surface hover:text-foreground"
                onClick={onClear}
                aria-label={t('clearOutput')}
                title={t('clearOutput')}
              >
                ✕
              </button>
            )}
            {/* 空输入时不该出现一个可点的发送键。
                只动 scale/opacity，不动尺寸 —— 尺寸固定成 28×28，
                上下内边距才会和左侧的 $ 完全对齐。 */}
            <button
              type="button"
              onClick={submit}
              aria-label={t('runCommand')}
              className={`capsule__btn bg-accent text-background transition-all duration-200 hover:brightness-110 ${
                value.trim() ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0'}`}
            >
              ↵
            </button>
          </>
        )}
      />
    </div>
  );
}
