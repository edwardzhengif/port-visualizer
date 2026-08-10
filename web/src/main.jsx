import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@heroui/react';

import App from './App.jsx';
import { applyTheme, store } from './lib/usePorts.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

/**
 * HeroUI v3 不需要 Provider 包裹，组件直接可用。
 *
 * ⚠️ ToastProvider 名字带 Provider，但它**不渲染 children** ——
 * 它是 toast 的渲染区域（类型里 children 被 Omit 掉了），不是 context 包装器。
 *
 * 写成 <ToastProvider><App /></ToastProvider> 会把整个应用静默吞掉，页面一片黑，
 * 而且不报任何错 —— 构建通过、控制台干净、就是什么都不显示。踩过一次。
 * 正确写法是二者并列。
 */

// 主题必须在首帧之前落定，否则会先渲染一次默认色再纠正 —— 肉眼可见的闪烁。
// 默认 dark：这是个开发者工具，长时间盯着，深色是更合理的起点。
applyTheme(store.get('theme', 'dark'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary label="应用">
      <ToastProvider />
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
