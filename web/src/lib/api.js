/**
 * 与后端通信的唯一入口。
 *
 * 服务端要求所有写操作携带 X-CSRF-Token —— 自定义头会强制浏览器预检，
 * 跨站请求根本发不出来，这是防 CSRF 的关键一环，不能省。
 */

const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

export async function api(path, options = {}) {
  const isWrite = options.method && options.method !== 'GET';
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(isWrite ? { 'X-CSRF-Token': CSRF } : {}),
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/*
 * 语言随每个请求带上，而不是在服务端存会话状态。
 * 服务端因此保持无状态：同一个服务同时被两个语言的标签页访问也不会串。
 */
export const fetchPorts = (lang) => api(`/api/ports?lang=${encodeURIComponent(lang)}`);
export const fetchTips = (lang) => api(`/api/tips?lang=${encodeURIComponent(lang)}`);

/**
 * 终止进程。
 *
 * pid 必须由调用方传入 —— 服务端会校验「这个 PID 现在是否仍占着这个端口」。
 * 不这么做就是 TOCTOU：用户看到 3000 是自己的 dev server，点下按钮那一瞬
 * 它恰好退出、别的进程抢占了 3000，被杀的就是那个无辜进程。
 */
export const killPort = (port, pid, { signal = 'SIGTERM', acknowledgeCritical = false } = {}) =>
  api(`/api/ports/${port}/kill`, {
    method: 'POST',
    body: JSON.stringify({ pid, signal, ...(acknowledgeCritical ? { acknowledgeCritical: true } : {}) }),
  });

/** 联网查询进程。只发进程名，服务端还会再压一次，路径与参数不会出网。 */
export const lookupProcess = (name) =>
  api('/api/lookup', { method: 'POST', body: JSON.stringify({ name }) });
