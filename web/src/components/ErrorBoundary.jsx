import { Component } from 'react';

/**
 * 错误边界。
 *
 * 没有它，任何一个组件抛错都会让 React 卸载整棵树 —— 用户看到的就是一片黑，
 * 而错误只躺在 DevTools 里。这对「不方便开控制台」的场景等于没有任何线索。
 *
 * 这里把错误直接渲染到页面上，并支持局部隔离：
 * 包住某个子树后，那棵子树炸了不影响其余界面，同时也就定位到了是谁炸的。
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // 仍然往控制台打一份完整的，方便复制堆栈
    console.error(`[${this.props.label || '组件'}] 渲染失败`, error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          margin: '12px 0',
          padding: '16px',
          borderRadius: '10px',
          border: '1px solid oklch(0.66 0.185 25)',
          background: 'oklch(0.24 0.06 25)',
          color: 'oklch(0.95 0.01 25)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ display: 'block', marginBottom: 8 }}>
          {this.props.label || '组件'} 渲染失败
        </strong>
        <div style={{ marginBottom: 8, wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </div>
        <details>
          <summary style={{ cursor: 'pointer', opacity: 0.8 }}>展开堆栈</summary>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: '11px', opacity: 0.85 }}>
            {error.stack}
            {info?.componentStack}
          </pre>
        </details>
      </div>
    );
  }
}
