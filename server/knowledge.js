'use strict';

/**
 * Local process/port knowledge base — 本地进程/端口知识库。
 *
 * 存在的理由：光看「node PID 42817」，用户无法判断该不该杀它 ——
 * 那可能是自己的 dev server，也可能是 VSCode 起的 TypeScript 语言服务，
 * 还可能是某个 Electron 应用的后台进程。杀错的代价是丢数据或应用崩溃。
 *
 * 三个信息源合成一个判断：
 *   1. 进程名匹配（launchd / postgres / nginx …）
 *   2. 端口号匹配（5432 → PostgreSQL，22 → SSH）
 *   3. 运行时上下文（用户是不是 root、跑了多久、完整命令行里有什么）
 *
 * 全部离线：这个模块不发出任何网络请求，知识也不来自远程。
 *
 * 唯一的例外在界面上，且不由这里发起 —— 详情里的「在网上搜索」按钮会**新开一个标签页**，
 * 是你的浏览器在你明确点击后去搜索引擎，进程名会随查询词一起发出去。
 * 「不联网」是本工具的属性，不是那个按钮的属性，这一点必须说清楚而不是含糊过去。
 */

/**
 * 双语字面量。
 *
 * 每条文案就地写两种语言，而不是抽成 en.json / zh.json 两份索引表。
 * 理由很实际：这些句子是**判断的一部分**，不是装饰性 UI 文案。
 * 改 PostgreSQL 的「杀了会怎样」时，两种语言必须一起改 ——
 * 分成两个文件，迟早会出现中文说「SIGTERM 是安全的」而英文还停在旧说法的情况，
 * 而这种分叉在一个能杀进程的工具里是要出事的。
 */
const L = (en, zh) => ({ en, zh });

/** 取语言。字符串直接返回 —— 用户写的 knowledge.local.json 不必也不该是双语的。 */
function pick(value, lang) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return value[lang] || value.en || value.zh || null;
}

const LANGS = ['en', 'zh'];
const normalizeLang = (v) => (LANGS.includes(String(v || '').slice(0, 2)) ? String(v).slice(0, 2) : 'en');

/* ------------------------------------------------------------ 风险等级 */

const RISK = {
  critical: { level: 'critical', order: 4, label: L('Do not kill', '禁止终止'), blocked: true },
  high:     { level: 'high',     order: 3, label: L('High risk', '高风险'),     blocked: false },
  medium:   { level: 'medium',   order: 2, label: L('Medium risk', '中等风险'), blocked: false },
  low:      { level: 'low',      order: 1, label: L('Low risk', '低风险'),      blocked: false },
};

const CATEGORY = {
  system:    L('System service', '系统服务'),
  database:  L('Database', '数据库'),
  dev:       L('Dev server', '开发服务'),
  container: L('Containers & VMs', '容器与虚拟化'),
  network:   L('Network & proxy', '网络与代理'),
  editor:    L('Editor & toolchain', '编辑器与工具链'),
  app:       L('Desktop app', '桌面应用'),
  unknown:   L('Unidentified', '未识别'),
};

/* -------------------------------------------------------- 进程知识条目 */

/**
 * key 为小写进程名。命中方式：先精确匹配，再前缀匹配。
 * what      —— 这是什么（大白话，不用术语）
 * ifKilled  —— 杀掉会发生什么（用户最需要知道的一句）
 */
const PROCESSES = {
  /* ---- 系统关键：动了就出大事，禁止终止 ---- */
  launchd: { name: L('launchd (PID 1)', 'launchd（1 号进程）'), category: 'system', risk: 'critical',
    what: L('The first process macOS starts. Its PID is always 1 and every other program is a descendant of it.',
      'macOS 的头号进程，编号永远是 1，所有其它程序都是它的后代。'),
    ifKilled: L('Instant kernel panic and reboot. This is the one process the kernel trusts.',
      '系统立刻崩溃重启。这是内核唯一信任的进程。') },
  systemd: { name: L('systemd (PID 1)', 'systemd（1 号进程）'), category: 'system', risk: 'critical',
    what: L('The first process Linux starts; it launches and supervises every system service.',
      'Linux 的头号进程，负责启动和看管所有系统服务。'),
    ifKilled: L('The system crashes or becomes unusable immediately.', '系统立刻崩溃或进入不可用状态。') },
  init: { name: L('init (PID 1)', 'init（1 号进程）'), category: 'system', risk: 'critical',
    what: L('The Unix PID 1 — ancestor of every other process.', 'Unix 系统的 1 号进程，所有进程的祖先。'),
    ifKilled: L('Kernel panic. The machine goes down.', '内核 panic，系统直接挂掉。') },
  kernel_task: { name: L('macOS kernel', 'macOS 内核'), category: 'system', risk: 'critical',
    what: L('The macOS kernel itself — scheduling, memory, thermal management.',
      'macOS 内核本身，负责调度、内存和散热管理。'),
    ifKilled: L('Neither possible nor advisable.', '不可能也不应该终止。') },
  windowserver: { name: L('macOS WindowServer', 'macOS 图形服务'), category: 'system', risk: 'critical',
    what: L('The macOS graphics core — every pixel on your screen is drawn through it.',
      'macOS 的图形显示核心，屏幕上每一个像素都经它渲染。'),
    ifKilled: L('Your entire desktop vanishes, you are logged out, and anything unsaved is gone.',
      '整个桌面消失，你会被强制登出，未保存的东西全丢。') },
  loginwindow: { name: L('macOS login service', 'macOS 登录服务'), category: 'system', risk: 'critical',
    what: L('Manages macOS login and user sessions.', 'macOS 的登录与会话管理进程。'),
    ifKilled: L('Your session is terminated — equivalent to a forced logout.', '当前用户会话被终结，等同于强制注销。') },
  wininit: { category: 'system', risk: 'critical',
    what: L('Windows system initialization process.', 'Windows 系统初始化进程。'),
    ifKilled: L('Blue screen.', '蓝屏。') },
  csrss: { category: 'system', risk: 'critical',
    what: L('Windows Client/Server Runtime Subsystem — manages processes and threads.',
      'Windows 客户端/服务器运行时子系统，管理进程与线程。'),
    ifKilled: L('Blue screen and forced restart.', '蓝屏，系统强制重启。') },
  services: { category: 'system', risk: 'critical',
    what: L('Windows Service Control Manager.', 'Windows 服务控制管理器。'),
    ifKilled: L('The system crashes.', '系统崩溃。') },
  lsass: { name: L('Windows security authority', 'Windows 安全认证'), category: 'system', risk: 'critical',
    what: L('Windows Local Security Authority — handles login credentials.',
      'Windows 本地安全认证进程，管理登录凭据。'),
    ifKilled: L('Windows forces a restart within 60 seconds.', '系统在 60 秒内强制重启。') },

  /* ---- 系统服务：不致命，但杀了功能会缺 ---- */
  mdnsresponder: { name: L('Bonjour / mDNS', 'Bonjour / mDNS'), category: 'system', risk: 'high',
    what: L('The macOS Bonjour service — local network device discovery and .local name resolution.',
      'macOS 的 Bonjour 服务，负责局域网内设备发现和 .local 域名解析。'),
    ifKilled: L('AirDrop, printer discovery and screen mirroring stop working, and DNS may misbehave. macOS usually restarts it on its own.',
      'AirDrop、打印机发现、投屏会失灵，DNS 解析可能出问题。系统通常会自动重启它。') },
  rapportd: { category: 'system', risk: 'high',
    what: L('The macOS Handoff and Universal Clipboard service.', 'macOS 的接力（Handoff）与通用剪贴板服务。'),
    ifKilled: L('Handoff and shared clipboard stop working across your devices.', '跨设备接力和共享剪贴板失效。') },
  sharingd: { category: 'system', risk: 'high',
    what: L('The macOS sharing service: AirDrop, screen sharing and file sharing all run through it.',
      'macOS 的共享服务：AirDrop、屏幕共享、文件共享都归它管。'),
    ifKilled: L('AirDrop and the various sharing features stop working.', 'AirDrop 和各类共享功能失效。') },
  controlcenter: { name: L('macOS Control Center', 'macOS 控制中心'), category: 'system', risk: 'high',
    what: L('macOS Control Center, which also hosts the AirPlay receiver (commonly on ports 5000/7000).',
      'macOS 控制中心，同时承载 AirPlay 接收端（常占 5000/7000 端口）。'),
    ifKilled: L('Control Center disappears from the menu bar. This is also the usual answer to "why is port 5000 taken" on macOS.',
      '菜单栏控制中心消失。这也是「5000 端口被占」在 macOS 上最常见的原因。') },
  sshd: { name: L('SSH server', 'SSH 服务端'), category: 'system', risk: 'high',
    what: L('The SSH server — it lets other machines log into this one remotely.',
      'SSH 服务端，允许从别的机器远程登录这台电脑。'),
    ifKilled: L('Every remote SSH session drops. If you are operating this machine over SSH, you will disconnect yourself.',
      '所有远程 SSH 连接断开。如果你正通过 SSH 操作这台机器，会把自己踢下线。') },
  cupsd: { name: L('Printing service', '打印服务'), category: 'system', risk: 'medium',
    what: L('The printing system — manages printers and the print queue.', '打印服务系统，管理打印机和打印队列。'),
    ifKilled: L('You cannot print, and queued jobs are lost.', '无法打印，队列中的任务丢失。') },
  netbiosd: { category: 'system', risk: 'medium',
    what: L('Windows network neighborhood compatibility service.', 'Windows 网络邻居兼容服务。'),
    ifKilled: L('SMB share discovery on the local network is affected.', '局域网 SMB 共享发现受影响。') },
  apsd: { category: 'system', risk: 'high',
    what: L('The local daemon for Apple Push Notification service.', 'Apple 推送通知服务的本地守护进程。'),
    ifKilled: L('iMessage, FaceTime and app push notifications stop arriving.', 'iMessage、FaceTime、各类 App 推送会中断。') },
  identityservicesd: { category: 'system', risk: 'high',
    what: L('Identity service for Apple ID, iMessage and FaceTime.', 'Apple ID 与 iMessage/FaceTime 的身份服务。'),
    ifKilled: L('iMessage and FaceTime go offline.', 'iMessage 与 FaceTime 掉线。') },
  nsurlsessiond: { category: 'system', risk: 'medium',
    what: L('System background transfer scheduler; iCloud sync depends on it.',
      '系统后台下载/上传调度服务，iCloud 同步依赖它。'),
    ifKilled: L('Background transfers stop and iCloud sync pauses.', '后台传输中断，iCloud 同步暂停。') },
  remoted: { category: 'system', risk: 'high',
    what: L('macOS remote device service; Xcode on-device debugging needs it.',
      'macOS 远程设备服务，Xcode 真机调试依赖它。'),
    ifKilled: L('Connected iOS devices disconnect.', '连接的 iOS 设备会掉线。') },
  spotlight: { category: 'system', risk: 'medium',
    what: L('The macOS search indexing service.', 'macOS 全局搜索索引服务。'),
    ifKilled: L('Search is unavailable for a while and the index may need rebuilding.', '搜索暂时不可用，索引可能需要重建。') },

  /* ---- 数据库：不致命，但会丢事务 ---- */
  postgres: { name: L('PostgreSQL', 'PostgreSQL'), category: 'database', risk: 'medium',
    what: L('PostgreSQL database server. Default port 5432.', 'PostgreSQL 数据库服务。默认端口 5432。'),
    ifKilled: L('All connections drop and in-flight transactions roll back. SIGTERM is safe (equivalent to pg_ctl stop); SIGKILL may force recovery on next startup.',
      '所有连接断开，进行中的事务回滚。SIGTERM 是安全的（等同 pg_ctl stop），SIGKILL 可能导致下次启动时需要恢复。') },
  postgresql: { name: L('PostgreSQL', 'PostgreSQL'), category: 'database', risk: 'medium',
    what: L('PostgreSQL database server.', 'PostgreSQL 数据库服务。'),
    ifKilled: L('Connections drop; uncommitted transactions roll back.', '连接断开，未提交事务回滚。') },
  mysqld: { name: L('MySQL / MariaDB', 'MySQL / MariaDB'), category: 'database', risk: 'medium',
    what: L('MySQL / MariaDB database server. Default port 3306.', 'MySQL / MariaDB 数据库服务。默认端口 3306。'),
    ifKilled: L('Connections drop and uncommitted transactions roll back. A hard kill may trigger crash recovery on next startup.',
      '连接断开，未提交事务回滚。强杀可能触发下次启动的崩溃恢复。') },
  mariadbd: { name: L('MariaDB', 'MariaDB'), category: 'database', risk: 'medium',
    what: L('MariaDB database server.', 'MariaDB 数据库服务。'),
    ifKilled: L('Connections drop; uncommitted transactions roll back.', '连接断开，未提交事务回滚。') },
  mongod: { name: L('MongoDB', 'MongoDB'), category: 'database', risk: 'medium',
    what: L('MongoDB database server. Default port 27017.', 'MongoDB 数据库服务。默认端口 27017。'),
    ifKilled: L('Connections drop. SIGTERM flushes to disk cleanly; SIGKILL may require repair.',
      '连接断开。SIGTERM 会正常落盘，SIGKILL 可能需要修复。') },
  'redis-server': { name: L('Redis', 'Redis'), category: 'database', risk: 'medium',
    what: L('Redis in-memory database. Default port 6379.', 'Redis 内存数据库。默认端口 6379。'),
    ifKilled: L('Anything held only in memory is gone for good unless persistence is configured.',
      '内存中的数据如果没配持久化就永久丢失。') },
  memcached: { name: L('Memcached', 'Memcached'), category: 'database', risk: 'low',
    what: L('Pure in-memory cache. Default port 11211.', '纯内存缓存服务。默认端口 11211。'),
    ifKilled: L('The cache empties and your app rebuilds it from the source. Correctness is normally unaffected.',
      '缓存全部清空，应用会回源重建，一般不影响正确性。') },
  elasticsearch: { name: L('Elasticsearch', 'Elasticsearch'), category: 'database', risk: 'medium',
    what: L('Search and analytics engine. Default port 9200.', '搜索与分析引擎。默认端口 9200。'),
    ifKilled: L('Search goes down and shards may need to recover.', '搜索服务中断，分片可能需要恢复。') },
  clickhouse: { name: L('ClickHouse', 'ClickHouse'), category: 'database', risk: 'medium',
    what: L('Columnar analytics database.', '列式分析数据库。'),
    ifKilled: L('Queries abort and buffered writes may be lost.', '查询中断，写入缓冲可能丢失。') },
  influxd: { name: L('InfluxDB', 'InfluxDB'), category: 'database', risk: 'medium',
    what: L('InfluxDB time-series database.', 'InfluxDB 时序数据库。'),
    ifKilled: L('Writes stop; points not yet flushed may be lost.', '写入中断，未落盘的点可能丢失。') },

  /* ---- 开发服务：基本可以随便杀 ---- */
  node: { category: 'dev', risk: 'low',
    what: L('The Node.js runtime. What it is actually running is in the full command line below — it could be your dev server, or a language server your editor started.',
      'Node.js 运行时。具体在跑什么，要看下面的完整命令行 —— 可能是你的 dev server，也可能是编辑器起的语言服务。'),
    ifKilled: L('If it is a dev server, just run npm run dev again.', '如果是 dev server，重新 npm run dev 即可。') },
  bun: { category: 'dev', risk: 'low',
    what: L('The Bun runtime / package manager.', 'Bun 运行时/包管理器。'),
    ifKilled: L('Just restart it.', '重启即可。') },
  deno: { category: 'dev', risk: 'low',
    what: L('The Deno runtime.', 'Deno 运行时。'), ifKilled: L('Just restart it.', '重启即可。') },
  vite: { category: 'dev', risk: 'low',
    what: L('Vite dev server, used for frontend hot reload. Default port 5173.', 'Vite 开发服务器，前端热更新用。默认端口 5173。'),
    ifKilled: L('Just start it again; your source files are untouched.', '重新启动即可，不影响源码。') },
  webpack: { category: 'dev', risk: 'low',
    what: L('Webpack dev server.', 'Webpack 开发服务器。'), ifKilled: L('Just restart it.', '重启即可。') },
  next: { category: 'dev', risk: 'low',
    what: L('Next.js dev or production server.', 'Next.js 开发/生产服务器。'), ifKilled: L('Just restart it.', '重启即可。') },
  python: { category: 'dev', risk: 'low',
    what: L('A Python interpreter. Check the full command line to tell what it is: Django, Flask, uvicorn, or a throwaway http.server.',
      'Python 解释器。看完整命令行判断具体是什么：Django、Flask、uvicorn 还是简易 http.server。'),
    ifKilled: L('Usually just restart — but check whether a long-running job is in progress.',
      '通常重启即可，注意有没有正在跑的长任务。') },
  python3: { category: 'dev', risk: 'low',
    what: L('A Python interpreter. The full command line tells you what it is running.', 'Python 解释器。具体在跑什么看完整命令行。'),
    ifKilled: L('Usually just restart it.', '通常重启即可。') },
  uvicorn: { name: L('Uvicorn', 'Uvicorn'), category: 'dev', risk: 'low',
    what: L('Python ASGI server, commonly used with FastAPI.', 'Python ASGI 服务器，FastAPI 常用。'),
    ifKilled: L('Just restart it.', '重启即可。') },
  gunicorn: { name: L('Gunicorn', 'Gunicorn'), category: 'dev', risk: 'low',
    what: L('Python WSGI server.', 'Python WSGI 服务器。'),
    ifKilled: L('Just restart it; in-flight requests are dropped.', '重启即可，正在处理的请求会中断。') },
  ruby: { category: 'dev', risk: 'low',
    what: L('A Ruby interpreter — usually Rails or Puma.', 'Ruby 解释器，多为 Rails 或 Puma。'),
    ifKilled: L('Just restart it.', '重启即可。') },
  puma: { name: L('Puma', 'Puma'), category: 'dev', risk: 'low',
    what: L('Ruby web server, the Rails default.', 'Ruby 的 Web 服务器，Rails 默认。'),
    ifKilled: L('Just restart it.', '重启即可。') },
  rails: { name: L('Rails', 'Rails'), category: 'dev', risk: 'low',
    what: L('Rails dev server.', 'Rails 开发服务器。'), ifKilled: L('Just restart it.', '重启即可。') },
  php: { category: 'dev', risk: 'low',
    what: L('PHP interpreter or its built-in server.', 'PHP 解释器或内置服务器。'), ifKilled: L('Just restart it.', '重启即可。') },
  'php-fpm': { name: L('PHP-FPM', 'PHP-FPM'), category: 'dev', risk: 'medium',
    what: L('PHP FastCGI process manager, normally paired with Nginx.', 'PHP FastCGI 进程管理器，通常配合 Nginx。'),
    ifKilled: L('PHP sites start returning 502 immediately.', 'PHP 站点立即 502。') },
  java: { category: 'dev', risk: 'medium',
    what: L('A Java virtual machine. Could be Spring Boot, Tomcat, a Gradle daemon, or an IDE.',
      'Java 虚拟机。可能是 Spring Boot、Tomcat、Gradle 守护进程或某个 IDE。'),
    ifKilled: L('Check the full command line. If it is an app server, in-flight requests are dropped.',
      '看完整命令行判断。若是应用服务器，进行中的请求会中断。') },
  go: { category: 'dev', risk: 'low',
    what: L('A Go program, or a service started with go run.', 'Go 程序或 go run 启动的服务。'),
    ifKilled: L('Just restart it.', '重启即可。') },
  cargo: { category: 'dev', risk: 'low',
    what: L('The Rust build tool, possibly running cargo run.', 'Rust 的构建工具，可能在跑 cargo run。'),
    ifKilled: L('Just restart it.', '重启即可。') },
  dotnet: { category: 'dev', risk: 'low',
    what: L('The .NET runtime, or a service started with dotnet run.', '.NET 运行时或 dotnet run 起的服务。'),
    ifKilled: L('Just restart it.', '重启即可。') },

  /* ---- 容器与虚拟化 ---- */
  dockerd: { name: L('Docker daemon', 'Docker 守护进程'), category: 'container', risk: 'high',
    what: L('The Docker daemon — it manages every container.', 'Docker 守护进程，管理所有容器。'),
    ifKilled: L('Every running container stops, and container data that was not persisted is lost.',
      '所有运行中的容器一起停止，未持久化的容器数据丢失。') },
  'com.docker.backend': { name: L('Docker Desktop', 'Docker Desktop'), category: 'container', risk: 'high',
    what: L('The Docker Desktop backend process.', 'Docker Desktop 的后端进程。'),
    ifKilled: L('Docker Desktop crashes and all containers stop.', 'Docker Desktop 崩溃，全部容器停止。') },
  containerd: { name: L('containerd', 'containerd'), category: 'container', risk: 'high',
    what: L('Container runtime; both Docker and Kubernetes sit on top of it.', '容器运行时，Docker 和 Kubernetes 底层都用它。'),
    ifKilled: L('All containers stop.', '所有容器停止。') },
  'com.docker.vpnkit': { name: L('Docker port forwarding', 'Docker 端口转发'), category: 'container', risk: 'medium',
    what: L('Docker Desktop network forwarder — container port mapping runs through it.',
      'Docker Desktop 的网络转发进程，容器端口映射靠它。'),
    ifKilled: L('Container port mappings stop working.', '容器的端口映射失效。') },
  kubelet: { name: L('Kubernetes kubelet', 'Kubernetes kubelet'), category: 'container', risk: 'high',
    what: L('The Kubernetes node agent.', 'Kubernetes 节点代理。'),
    ifKilled: L('Pods on this node become unmanaged.', '该节点上的 Pod 失去管理。') },
  colima: { name: L('Colima', 'Colima'), category: 'container', risk: 'high',
    what: L('Lightweight container runtime for macOS.', 'macOS 上的轻量容器运行时。'),
    ifKilled: L('All containers stop.', '全部容器停止。') },
  orbstack: { name: L('OrbStack', 'OrbStack'), category: 'container', risk: 'high',
    what: L('Docker/Linux virtualization tool for macOS.', 'macOS 上的 Docker/Linux 虚拟化工具。'),
    ifKilled: L('All containers and VMs stop.', '全部容器与虚拟机停止。') },
  qemu: { name: L('QEMU virtual machine', 'QEMU 虚拟机'), category: 'container', risk: 'high',
    what: L('Virtual machine hypervisor.', '虚拟机管理程序。'),
    ifKilled: L('The VM is force-powered-off; its disk image may be corrupted.', '虚拟机被强制断电，磁盘可能损坏。') },
  vmware: { category: 'container', risk: 'high',
    what: L('VMware virtual machine process.', 'VMware 虚拟机进程。'),
    ifKilled: L('The VM is force-powered-off.', '虚拟机强制断电。') },

  /* ---- 网络与代理 ---- */
  nginx: { name: L('Nginx', 'Nginx'), category: 'network', risk: 'medium',
    what: L('Nginx web server / reverse proxy.', 'Nginx 网页服务器 / 反向代理。'),
    ifKilled: L('Every site it fronts becomes unreachable immediately.', '它代理的所有站点立即不可访问。') },
  httpd: { name: L('Apache', 'Apache'), category: 'network', risk: 'medium',
    what: L('Apache web server.', 'Apache 网页服务器。'),
    ifKilled: L('Sites it hosts become unreachable immediately.', '它托管的站点立即不可访问。') },
  apache2: { name: L('Apache', 'Apache'), category: 'network', risk: 'medium',
    what: L('Apache web server.', 'Apache 网页服务器。'),
    ifKilled: L('Hosted sites become unreachable.', '托管的站点不可访问。') },
  caddy: { name: L('Caddy', 'Caddy'), category: 'network', risk: 'medium',
    what: L('Caddy web server, with automatic HTTPS.', 'Caddy 网页服务器，自动 HTTPS。'),
    ifKilled: L('Hosted sites become unreachable.', '托管的站点不可访问。') },
  traefik: { name: L('Traefik', 'Traefik'), category: 'network', risk: 'medium',
    what: L('Cloud-native reverse proxy, common in container setups.', '云原生反向代理，常用于容器编排。'),
    ifKilled: L('Routing stops and backend services become unreachable.', '路由中断，后端服务无法访问。') },
  haproxy: { name: L('HAProxy', 'HAProxy'), category: 'network', risk: 'medium',
    what: L('Load balancer.', '负载均衡器。'),
    ifKilled: L('Traffic distribution stops.', '流量分发中断。') },
  ngrok: { name: L('ngrok tunnel', 'ngrok 内网穿透'), category: 'network', risk: 'low',
    what: L('Tunneling tool that exposes a local port to the public internet.', '内网穿透工具，把本地端口暴露到公网。'),
    ifKilled: L('The public URL dies immediately, and you get a different one after restarting.',
      '公网地址立即失效，重启后地址会变。') },
  cloudflared: { name: L('Cloudflare Tunnel', 'Cloudflare Tunnel'), category: 'network', risk: 'low',
    what: L('Cloudflare Tunnel client.', 'Cloudflare Tunnel 客户端。'),
    ifKilled: L('The tunnel drops and external access stops.', '隧道断开，外部访问中断。') },
  tailscaled: { name: L('Tailscale', 'Tailscale'), category: 'network', risk: 'high',
    what: L('The Tailscale mesh-networking daemon.', 'Tailscale 组网守护进程。'),
    ifKilled: L('Your virtual private network drops. If you are reaching this machine over Tailscale, you will disconnect yourself.',
      '虚拟内网断开。如果你正通过 Tailscale 远程连这台机器，会把自己踢下线。') },
  privoxy: { name: L('Privoxy', 'Privoxy'), category: 'network', risk: 'low',
    what: L('Privoxy, a filtering HTTP proxy. Often bundled inside VPN or ad-blocking clients, which is why it can appear without you installing it directly.',
      'Privoxy，带过滤功能的 HTTP 代理。常被 VPN 或去广告客户端捆绑启动，所以你可能并没直接装过它。'),
    ifKilled: L('Anything routed through this proxy loses network access until you restart it — usually by restarting the app that launched it.',
      '走这个代理的程序会立刻断网，重启它（通常是重启启动它的那个应用）即可恢复。') },
  'v2ray-core': { name: L('V2Ray', 'V2Ray'), category: 'network', risk: 'low',
    what: L('V2Ray proxy core.', 'V2Ray 代理内核。'),
    ifKilled: L('Traffic routed through it stops until restarted.', '走它的流量会中断，重启即可。') },
  'sing-box': { name: L('sing-box', 'sing-box'), category: 'network', risk: 'low',
    what: L('sing-box proxy platform.', 'sing-box 代理平台。'),
    ifKilled: L('Traffic routed through it stops until restarted.', '走它的流量会中断，重启即可。') },
  'clash': { name: L('Clash', 'Clash'), category: 'network', risk: 'low',
    what: L('Clash proxy client. Usually holds a local HTTP/SOCKS port plus a control API.',
      'Clash 代理客户端，通常同时占一个本地 HTTP/SOCKS 端口和一个控制接口。'),
    ifKilled: L('Traffic routed through it stops until restarted.', '走它的流量会中断，重启即可。') },
  controlce: { name: L('macOS Control Center', 'macOS 控制中心'), category: 'system', risk: 'high',
    what: L('macOS Control Center (shown as ControlCe on some systems); also hosts the AirPlay receiver.',
      'macOS 控制中心（部分系统显示为 ControlCe），同时承载 AirPlay 接收端。'),
    ifKilled: L('Control Center disappears from the menu bar. This is the usual answer to "why is port 5000/7000 taken".',
      '菜单栏控制中心消失。这也是「5000/7000 端口被占」最常见的原因。') },
  socat: { category: 'network', risk: 'low',
    what: L('Small port/socket forwarding utility.', '端口/socket 转发小工具。'),
    ifKilled: L('This forwarding channel closes.', '这条转发通道断开。') },
  ssh: { category: 'network', risk: 'medium',
    what: L('An SSH client — it may be doing port forwarding.', 'SSH 客户端，可能在做端口转发。'),
    ifKilled: L('That SSH session and any forwards on it close together.', '该 SSH 连接与其上的转发一起断开。') },

  /* ---- 编辑器与工具链 ---- */
  'code helper': { name: L('VS Code helper', 'VS Code 辅助进程'), category: 'editor', risk: 'low',
    what: L('A VS Code helper process (extension host, language server, or renderer).',
      'VS Code 的辅助进程（扩展宿主、语言服务或渲染进程）。'),
    ifKilled: L('The matching extension or language feature stops working; VS Code usually restarts it.',
      '对应的扩展或语言功能失效，VS Code 通常会自动重启它。') },
  code: { category: 'editor', risk: 'low',
    what: L('The VS Code main process or one of its children.', 'VS Code 主进程或其子进程。'),
    ifKilled: L('The editor closes; unsaved files may be lost.', '编辑器关闭，未保存的文件可能丢失。') },
  cursor: { category: 'editor', risk: 'low',
    what: L('A Cursor editor process.', 'Cursor 编辑器进程。'),
    ifKilled: L('The editor closes — mind anything unsaved.', '编辑器关闭，注意未保存内容。') },
  'rust-analyzer': { name: L('Rust language server', 'Rust 语言服务'), category: 'editor', risk: 'low',
    what: L('Rust language server, providing completion and diagnostics to your editor.',
      'Rust 语言服务，为编辑器提供补全和诊断。'),
    ifKilled: L('Completion stops working; the editor restarts it.', '补全失效，编辑器会重启它。') },
  gopls: { name: L('Go language server', 'Go 语言服务'), category: 'editor', risk: 'low',
    what: L('Go language server.', 'Go 语言服务。'),
    ifKilled: L('Completion stops working; the editor restarts it.', '补全失效，编辑器会重启它。') },
  tsserver: { name: L('TypeScript language server', 'TypeScript 语言服务'), category: 'editor', risk: 'low',
    what: L('TypeScript language server.', 'TypeScript 语言服务。'),
    ifKilled: L('Type hints stop working; the editor restarts it.', '类型提示失效，编辑器会重启它。') },
  jetbrains: { category: 'editor', risk: 'low',
    what: L('A JetBrains IDE process.', 'JetBrains 系 IDE 进程。'),
    ifKilled: L('The IDE closes — mind anything unsaved.', 'IDE 关闭，注意未保存内容。') },

  /* ---- 桌面应用 ---- */
  spotify: { category: 'app', risk: 'low',
    what: L('The Spotify client; the local port is used for device discovery.', 'Spotify 客户端，本地端口用于设备发现。'),
    ifKilled: L('Music stops playing.', '音乐停止播放。') },
  dropbox: { category: 'app', risk: 'low',
    what: L('The Dropbox sync client.', 'Dropbox 同步客户端。'),
    ifKilled: L('File sync pauses.', '文件同步暂停。') },
  slack: { category: 'app', risk: 'low',
    what: L('The Slack desktop client.', 'Slack 桌面客户端。'),
    ifKilled: L('The app closes; drafts may be lost.', '应用关闭，草稿可能丢失。') },
  'google chrome': { category: 'app', risk: 'low',
    what: L('A Chrome browser process.', 'Chrome 浏览器进程。'),
    ifKilled: L('The browser or a tab closes; unsubmitted forms are lost.', '浏览器或某个标签页关闭，未提交的表单丢失。') },
  firefox: { category: 'app', risk: 'low',
    what: L('Firefox browser.', 'Firefox 浏览器。'),
    ifKilled: L('The browser closes; unsubmitted forms are lost.', '浏览器关闭，未提交表单丢失。') },
  steam: { category: 'app', risk: 'low',
    what: L('The Steam client.', 'Steam 客户端。'),
    ifKilled: L('Games and downloads are interrupted.', '游戏与下载中断。') },
};

/* ---------------------------------------------------------- 端口知识 */

const PORTS = {
  20:    { category: 'network', name: L('FTP data', 'FTP 数据'), risk: 'medium',
    what: L('The data channel of the File Transfer Protocol.', '文件传输协议的数据通道。') },
  21:    { category: 'network', name: L('FTP control', 'FTP 控制'), risk: 'medium',
    what: L('The control channel of FTP. Old, and unencrypted.', '文件传输协议的控制通道。老旧且不加密。') },
  22:    { category: 'system', name: L('SSH', 'SSH'), risk: 'high',
    what: L('Remote login. Someone could use it to get a shell on this machine.', '远程登录。别人能通过它登进这台机器。') },
  23:    { category: 'system', name: L('Telnet', 'Telnet'), risk: 'high',
    what: L('Plaintext remote login. Should not be in use at all any more.', '明文远程登录，早已不该使用。') },
  25:    { category: 'network', name: L('SMTP', 'SMTP'), risk: 'medium',
    what: L('Mail sending service.', '邮件发送服务。') },
  53:    { category: 'system', name: L('DNS', 'DNS'), risk: 'high',
    what: L('Domain name resolution.', '域名解析服务。') },
  80:    { category: 'network', name: L('HTTP', 'HTTP'), risk: 'medium',
    what: L('The standard web port (unencrypted).', '标准网页端口（不加密）。') },
  88:    { category: 'system', name: L('Kerberos', 'Kerberos'), risk: 'high',
    what: L('Network authentication protocol.', '网络身份认证协议。') },
  110:   { category: 'network', name: L('POP3', 'POP3'), risk: 'medium',
    what: L('Mail retrieval.', '邮件接收。') },
  143:   { category: 'network', name: L('IMAP', 'IMAP'), risk: 'medium',
    what: L('Mail retrieval.', '邮件接收。') },
  443:   { category: 'network', name: L('HTTPS', 'HTTPS'), risk: 'medium',
    what: L('The standard encrypted web port.', '标准加密网页端口。') },
  445:   { category: 'system', name: L('SMB', 'SMB'), risk: 'high',
    what: L('Windows file sharing. Several severe vulnerabilities have come through here.',
      'Windows 文件共享。历史上多个严重漏洞出自这里。') },
  548:   { category: 'system', name: L('AFP', 'AFP'), risk: 'medium',
    what: L('Apple Filing Protocol.', 'Apple 文件共享协议。') },
  631:   { category: 'system', name: L('CUPS', 'CUPS'), risk: 'low',
    what: L('Printing service admin interface.', '打印服务管理界面。') },
  1433:  { category: 'database', name: L('SQL Server', 'SQL Server'), risk: 'medium',
    what: L('Microsoft SQL Server database.', '微软 SQL Server 数据库。') },
  1521:  { category: 'database', name: L('Oracle DB', 'Oracle DB'), risk: 'medium',
    what: L('Oracle database listener.', 'Oracle 数据库监听端口。') },
  2375:  { category: 'container', name: L('Docker (unencrypted)', 'Docker（未加密）'), risk: 'high',
    what: L('Docker remote API with no encryption and no authentication. Exposing this publicly hands over the machine.',
      'Docker 远程 API，无加密无认证。暴露到公网等于把机器交出去。') },
  2376:  { category: 'container', name: L('Docker (TLS)', 'Docker（TLS）'), risk: 'medium',
    what: L('Docker remote API, encrypted variant.', 'Docker 远程 API，加密版本。') },
  3000:  { category: 'dev', name: L('Dev server', '开发服务器'), risk: 'low',
    what: L('The most common local dev port — Node, Rails, Next and friends.', 'Node/Rails/Next 等最常用的本地开发端口。') },
  3001:  { category: 'dev', name: L('Dev server', '开发服务器'), risk: 'low',
    what: L('The usual fallback when 3000 is taken.', '3000 被占时的常见备选。') },
  3306:  { category: 'database', name: L('MySQL', 'MySQL'), risk: 'medium',
    what: L('MySQL / MariaDB database.', 'MySQL / MariaDB 数据库。') },
  4200:  { category: 'dev', name: L('Angular', 'Angular'), risk: 'low',
    what: L('Angular CLI dev server default port.', 'Angular CLI 开发服务器默认端口。') },
  5000:  { category: 'dev', name: L('Dev server / AirPlay', '开发服务器 / AirPlay'), risk: 'low',
    what: L('Flask\'s default port — but on macOS it is usually taken by the AirPlay receiver.',
      'Flask 默认端口；但在 macOS 上通常被 AirPlay 接收端占用。') },
  5173:  { category: 'dev', name: L('Vite', 'Vite'), risk: 'low',
    what: L('Vite dev server default port.', 'Vite 开发服务器默认端口。') },
  5353:  { category: 'system', name: L('mDNS', 'mDNS'), risk: 'high',
    what: L('Local network device discovery (Bonjour). AirDrop and printer discovery depend on it.',
      '局域网设备发现（Bonjour）。AirDrop、打印机发现靠它。') },
  5432:  { category: 'database', name: L('PostgreSQL', 'PostgreSQL'), risk: 'medium',
    what: L('PostgreSQL default port.', 'PostgreSQL 数据库默认端口。') },
  5900:  { category: 'system', name: L('VNC', 'VNC'), risk: 'high',
    what: L('Remote desktop. Someone could watch and control your screen.', '远程桌面。别人能看到并控制你的屏幕。') },
  6379:  { category: 'database', name: L('Redis', 'Redis'), risk: 'medium',
    what: L('Redis default port. No password by default — never expose it publicly.',
      'Redis 默认端口。默认无密码，绝不能暴露到公网。') },
  6443:  { category: 'container', name: L('Kubernetes API', 'Kubernetes API'), risk: 'high',
    what: L('The K8s cluster control-plane entrypoint.', 'K8s 集群控制面入口。') },
  7000:  { category: 'system', name: L('AirPlay', 'AirPlay'), risk: 'low',
    what: L('macOS AirPlay receiver. Also Cassandra\'s default port.', 'macOS AirPlay 接收端。也是 Cassandra 的默认端口。') },
  8000:  { category: 'dev', name: L('Dev server', '开发服务器'), risk: 'low',
    what: L('Common for Django, Python http.server and similar.', 'Django、Python http.server 等常用。') },
  8080:  { category: 'dev', name: L('HTTP alternate', 'HTTP 备用'), risk: 'low',
    what: L('The most common alternate web port — Tomcat, proxies, all kinds of services.',
      '最常见的备用 Web 端口，Tomcat、代理、各类服务都爱用。') },
  8443:  { category: 'network', name: L('HTTPS alternate', 'HTTPS 备用'), risk: 'medium',
    what: L('Alternate encrypted web port.', '备用加密 Web 端口。') },
  9000:  { category: 'dev', name: L('General service port', '通用服务端口'), risk: 'low',
    what: L('Used by PHP-FPM, SonarQube, MinIO and others.', 'PHP-FPM、SonarQube、MinIO 等都用它。') },
  9200:  { category: 'database', name: L('Elasticsearch', 'Elasticsearch'), risk: 'medium',
    what: L('Elasticsearch HTTP interface.', 'Elasticsearch HTTP 接口。') },
  11211: { category: 'database', name: L('Memcached', 'Memcached'), risk: 'low',
    what: L('In-memory cache service.', '内存缓存服务。') },
  27017: { category: 'database', name: L('MongoDB', 'MongoDB'), risk: 'medium',
    what: L('MongoDB default port.', 'MongoDB 默认端口。') },
};

/* ------------------------------------------------------- 命令行线索 */

/**
 * 从完整命令行里提取「这到底是什么」。
 * 这是区分同名进程的唯一可靠手段：三个 node 进程，
 * 一个是 vite、一个是 VSCode 的 TS 语言服务、一个是 Electron 应用。
 */
const CMDLINE_HINTS = [
  [/\bvite\b/i,                     L('Vite dev server', 'Vite 开发服务器'), 'dev', 'low'],
  [/\bnext(-server)?\b|\.next\//i,  L('Next.js', 'Next.js'), 'dev', 'low'],
  [/\bnuxt\b/i,                     L('Nuxt', 'Nuxt'), 'dev', 'low'],
  [/webpack[-\s]?dev[-\s]?server/i, L('Webpack dev server', 'Webpack 开发服务器'), 'dev', 'low'],
  [/\bstorybook\b/i,                L('Storybook', 'Storybook'), 'dev', 'low'],
  [/\bnodemon\b/i,                  L('nodemon (auto-restarting dev process)', 'nodemon（自动重启的开发进程）'), 'dev', 'low'],
  [/tsserver|typescript.*server/i,  L('TypeScript language server (started by your editor)', 'TypeScript 语言服务（编辑器起的）'), 'editor', 'low'],
  [/language[-_]?server|\blsp\b/i,  L('Language server (started by your editor)', '语言服务（编辑器起的）'), 'editor', 'low'],
  [/extensionHost|extension-host/i, L('VS Code extension host', 'VS Code 扩展宿主'), 'editor', 'low'],
  [/\bjest\b|\bvitest\b/i,          L('Test runner', '测试运行器'), 'dev', 'low'],
  [/\besbuild\b|\bturbopack\b/i,    L('Build tool', '构建工具'), 'dev', 'low'],
  [/manage\.py\s+runserver/i,       L('Django dev server', 'Django 开发服务器'), 'dev', 'low'],
  [/flask\s+run|FLASK_APP/i,        L('Flask dev server', 'Flask 开发服务器'), 'dev', 'low'],
  [/http\.server|SimpleHTTPServer/i, L('Python built-in static file server', 'Python 内置静态文件服务器'), 'dev', 'low'],
  [/jupyter|ipykernel/i,            L('Jupyter Notebook', 'Jupyter Notebook'), 'dev', 'low'],
  [/spring|springboot/i,            L('Spring Boot application', 'Spring Boot 应用'), 'dev', 'medium'],
  [/\btomcat\b/i,                   L('Tomcat application server', 'Tomcat 应用服务器'), 'dev', 'medium'],
  [/gradle.*daemon/i,               L('Gradle daemon', 'Gradle 守护进程'), 'editor', 'low'],
  [/\belectron\b/i,                 L('Electron desktop app', 'Electron 桌面应用'), 'app', 'low'],
  [/docker|containerd/i,            L('Docker-related process', 'Docker 相关进程'), 'container', 'high'],
  [/\bngrok\b/i,                    L('Tunneling to the public internet', '内网穿透隧道'), 'network', 'low'],
];

/* ------------------------------------------------------- 动态文案 */

/**
 * analyze() 里现场拼出来的句子。
 * 和知识库条目分开放，是因为它们带参数，模板必须整句写出来 ——
 * 把句子拆成片段再拼接，换一种语言就会因为语序不同而彻底崩掉。
 */
const T = {
  mismatch: {
    en: (port, portName, proc) => `${port} is usually ${portName}'s port, but ${proc} is holding it`,
    zh: (port, portName, proc) => `${port} 通常是 ${portName} 的端口，但占用它的是 ${proc}`,
  },
  standardPort: {
    en: (port, portName) => `${port} is the standard port for ${portName}`,
    zh: (port, portName) => `${port} 是 ${portName} 的标准端口`,
  },
  runsAsRoot: L('Runs as root — most likely a system service', '以 root 身份运行，多半是系统服务'),
  yoursAccount: L('Started by your own account', '由你自己的账户启动'),
  justStarted: {
    en: (d) => `Started ${d} ago — quite likely the thing you just ran`,
    zh: (d) => `${d}前刚启动，很可能就是你刚跑起来的那个`,
  },
  longRunning: {
    en: (d) => `Has been up ${d} — looks like a resident service`,
    zh: (d) => `已持续运行 ${d}，像是常驻服务`,
  },
  notInKb: L('No record of this process in the knowledge base', '知识库里没有这个进程的记录'),
  fromCmdline: {
    en: (label) => `Judging by the command line, this is ${label}.`,
    zh: (label) => `根据命令行判断，这是 ${label}。`,
  },
  portSays: {
    en: (port, text) => `Port ${port}: ${text}`,
    zh: (port, text) => `端口 ${port}：${text}`,
  },
  noInfo: L('The knowledge base has nothing on this process yet. Expand the full command line, or search the web below.',
    '知识库里暂时没有这个进程的说明。展开看完整命令行，或用下方的联网查询。'),
  safeToKill: L('Looks safe to terminate; normally you just start it again.', '看起来可以安全终止，通常重新启动即可。'),
  unsureToKill: L('Consequences unclear — check the full command line first to confirm what this is.',
    '不确定后果，建议先看完整命令行确认这是什么。'),
  duration: {
    en: (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`,
    zh: (n, unit) => `${n} ${{ second: '秒', minute: '分钟', hour: '小时', day: '天' }[unit]}`,
  },
};

/* -------------------------------------------------------------- 推断 */

/**
 * 进程名匹配。
 *
 * 这里刻意**不用** includes()。曾经用过，结果 'init' 命中了 'zzz-definitely-not-real'
 * —— 'definitely' 里就藏着 i-n-i-t。子串匹配会把普通进程误判成 1 号进程，
 * 而 1 号进程是「禁止终止」级别，误判的方向恰好是最糟的那一侧。
 *
 * 改为：精确 → 去掉路径后精确 → 前缀且后面跟分隔符 → 整词匹配。
 */
function lookupProcess(name, overlay = null) {
  if (!name) return null;
  const key = String(name).toLowerCase().trim();
  // 本地条目优先：内置库是通用知识，本地文件是这台机器上的事实
  if (overlay?.processes?.[key]) return { key, ...overlay.processes[key] };
  if (PROCESSES[key]) return { key, ...PROCESSES[key] };

  // '/usr/sbin/sshd' → 'sshd'
  const base = key.split(/[\\/]/).pop();
  if (PROCESSES[base]) return { key: base, ...PROCESSES[base] };

  const entries = Object.entries(PROCESSES);
  // 长的 key 优先，避免 'code' 抢在 'code helper' 前面
  entries.sort((a, b) => b[0].length - a[0].length);

  for (const [k, v] of entries) {
    // 'postgres: writer'、'Code Helper (Renderer)'、'node (deleted)'
    if (base.startsWith(k) && /[^a-z0-9]/.test(base.charAt(k.length) || ' ')) {
      return { key: k, ...v };
    }
    // 整词出现：'com.apple.WebKit' 里的 token
    if (new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(base)) {
      return { key: k, ...v };
    }
  }
  return null;
}

function lookupCmdline(cmdline) {
  if (!cmdline) return null;
  for (const [re, label, category, risk] of CMDLINE_HINTS) {
    if (re.test(cmdline)) return { label, category, risk };
  }
  return null;
}

function higherRisk(a, b) {
  if (!a) return b;
  if (!b) return a;
  return RISK[a].order >= RISK[b].order ? a : b;
}

/** 把秒数说成人话。 */
function humanDuration(sec, lang = 'en') {
  if (!Number.isFinite(sec) || sec < 0) return null;
  const fmt = T.duration[normalizeLang(lang)];
  if (sec < 60) return fmt(Math.round(sec), 'second');
  if (sec < 3600) return fmt(Math.round(sec / 60), 'minute');
  if (sec < 86400) return fmt(Math.round(sec / 3600), 'hour');
  return fmt(Math.round(sec / 86400), 'day');
}

/**
 * 综合判断一个端口条目：它是什么、属于哪类、杀了会怎样、风险多高。
 *
 * @param {object} row  扫描器产出的端口行（含 process/pid/port/uid/user/elapsed/cmdline）
 * @param {object} me   { uid, username } —— 运行本工具的身份
 * @param {object} overlay { processes, ports } —— knowledge.local.json 的内容，本地优先
 * @param {string} lang 'en' | 'zh'
 */
function analyze(row, me = {}, overlay = null, lang = 'en') {
  const g = normalizeLang(lang);
  const p = (v) => pick(v, g);
  const t = (key, ...args) => {
    const entry = T[key];
    const v = entry[g] || entry.en;
    return typeof v === 'function' ? v(...args) : v;
  };

  const byName = lookupProcess(row.process, overlay);
  const byCmd = lookupCmdline(row.cmdline);
  const byPort = overlay?.ports?.[row.port] || PORTS[row.port] || null;

  let category = byCmd?.category || byName?.category || 'unknown';
  let risk = byName?.risk || 'low';
  const reasons = [];

  const cmdLabel = p(byCmd?.label);
  const nameLabel = p(byName?.name);
  const portName = p(byPort?.name);

  /*
   * 标题的优先级：命令行 > 进程名 > 端口名 > 原始进程名。
   *
   * 端口只是线索，不是身份。曾经把端口排在进程名前面，结果一个监听 5432 的
   * node 进程被标成「PostgreSQL」，可下面的建议又是「重新 npm run dev 即可」——
   * 自相矛盾，而且会让人以为自己真的在跑一个数据库。
   */
  const title = cmdLabel
    || nameLabel
    || (byName ? row.process : null)
    || portName
    || row.process;

  const what = [];
  if (byName?.what) what.push(p(byName.what));
  if (cmdLabel && !byName?.what) what.push(t('fromCmdline', cmdLabel));
  if (byPort?.what) what.push(t('portSays', row.port, p(byPort.what)));

  // 进程与端口对不上时明说，这本身就是值得注意的信号
  // （可能是你随手用了这个端口，也可能是有东西占了不属于它的位置）
  // 只有当端口的惯常用途和进程实际类别真的不同时才提示。
  // 否则「3000 通常是开发服务器的端口，但占用它的是 node」这种废话会刷屏 —— node 本来就是开发服务器。
  const mismatch = Boolean(
    byPort && byName && byPort.category && byName.category !== 'unknown'
    && byPort.category !== byName.category
    && portName && !title.includes(portName)
  );
  if (mismatch) reasons.push(t('mismatch', row.port, portName, row.process));

  // 端口本身的风险也计入（比如 22/SSH、5353/mDNS）
  if (byPort?.risk) {
    const before = risk;
    risk = higherRisk(risk, byPort.risk);
    // mismatch 那条已经把「这个端口通常属于谁」说清楚了，不再重复一遍
    if (risk !== before && !mismatch) reasons.push(t('standardPort', row.port, portName));
  }
  if (byCmd?.risk) risk = higherRisk(risk, byCmd.risk);

  // 上下文修正 ---------------------------------------------------------

  // root 运行的多半是系统服务
  const isRoot = row.uid === 0 || row.user === 'root' || row.user === 'SYSTEM';
  if (isRoot) {
    const before = risk;
    risk = higherRisk(risk, 'high');
    if (risk !== before) reasons.push(t('runsAsRoot'));
    if (category === 'unknown') category = 'system';
  }

  // 「是不是我的进程」必须比 uid：ps 会把长用户名截断，比名字永远不相等
  const isMine = Number.isInteger(row.uid) && Number.isInteger(me.uid)
    ? row.uid === me.uid
    : Boolean(row.user && me.username && row.user === me.username);

  if (isMine && !isRoot) reasons.push(t('yoursAccount'));

  if (Number.isFinite(row.elapsed)) {
    if (row.elapsed < 600 && isMine) {
      reasons.push(t('justStarted', humanDuration(row.elapsed, g)));
    } else if (row.elapsed > 7 * 86400) {
      const before = risk;
      risk = higherRisk(risk, 'medium');
      if (risk !== before) reasons.push(t('longRunning', humanDuration(row.elapsed, g)));
    }
  }

  // 未识别 + 非 root + 是自己的 → 保持低风险，但明确说不认识
  if (!byName && !byCmd && !byPort) reasons.push(t('notInKb'));

  const meta = RISK[risk];

  return {
    title: title || row.process,
    category,
    categoryLabel: p(CATEGORY[category]) || p(CATEGORY.unknown),
    what: what.join(' ') || t('noInfo'),
    ifKilled: p(byName?.ifKilled) || (risk === 'low' ? t('safeToKill') : t('unsureToKill')),
    risk,
    riskLabel: p(meta.label),
    riskOrder: meta.order,
    blocked: meta.blocked,
    reasons,
    uptime: humanDuration(row.elapsed, g),
    known: Boolean(byName || byCmd || byPort),
    isMine,
    isRoot,
    /*
     * Unix 只允许对 uid 与自己相同的进程发信号（root 除外）。
     * 不是自己的进程，kill 一定返回 EPERM —— 与其让用户点一个注定失败的按钮，
     * 不如提前告诉他「这个需要 sudo」，并把命令给他。
     */
    needsSudo: Boolean(row.pid) && !isMine,
  };
}

/* ---------------------------------------------------- 表头字段说明 */

/** 大白话解释每个字段，给不熟悉网络概念的人看。 */
const FIELD_TIPS = {
  port: {
    title: L('Port', '端口'),
    tip: L('Think of it as a street number on a building. At any moment a number can only be assigned to one program — that is where "port already in use" comes from.',
      '可以理解成一栋楼的门牌号。同一时间一个号码只能挂给一个程序 —— 这就是「端口已被占用」的由来。'),
  },
  protocol: {
    title: L('Protocol', '协议'),
    tip: L('TCP is like a phone call: connect first, guaranteed delivery, in order. UDP is like tossing a note: fast, but no guarantee it arrives. Web and databases are almost all TCP.',
      'TCP 像打电话：先接通、保证送达、按顺序。UDP 像扔纸条：快，但不保证对方收到。网页和数据库几乎都用 TCP。'),
  },
  exposure: {
    title: L('Exposure', '暴露范围'),
    tip: L('Loopback = only this machine can connect. That is the safe one. All interfaces = anyone on the same Wi-Fi can reach it — worth noticing when you work from a café.',
      '仅本机 = 只有这台电脑能连上，最安全。全部网卡 = 同一个 WiFi 下的其他人也能连 —— 在咖啡馆办公时要留意。'),
  },
  process: {
    title: L('Process', '进程'),
    tip: L('The name of the program holding this port. The same name does not mean the same thing: three "node" processes could be your dev server, your editor\'s language server, and a desktop app. Only the full command line settles it.',
      '占着这个端口的程序名。同名不代表同一个东西：三个 node 可能分别是你的开发服务器、编辑器的语言服务、和某个桌面应用。展开看完整命令行才能确定。'),
  },
  pid: {
    title: L('PID', 'PID'),
    tip: L('Process ID — a temporary badge number the system hands out to each running program. It changes on every restart, so it only means anything right now.',
      '进程编号，系统给每个运行中的程序发的临时工号。程序一重启号码就变，所以它只在「此刻」有意义。'),
  },
  user: {
    title: L('Running as', '运行用户'),
    tip: L('Whose identity it runs under. The common misconception: on your own computer, not every process belongs to you. macOS gives each system service its own dedicated account (root, _mdnsresponder, _windowserver and the like), so that if one service is compromised the attacker only gets that restricted account and cannot touch your files. The price is that Unix only lets you signal processes running under your own account — so those are view-only here and need sudo.',
      '以谁的身份在跑。这里最容易误会的一点：自己的电脑上，并不是所有进程都属于你。'
      + 'macOS 会给每个系统服务单独建一个专用账号（root、_mdnsresponder、_windowserver 这类），'
      + '这样某个服务被攻破时，攻击者拿到的只是那个受限账号，碰不到你的文件。'
      + '代价是：Unix 规定只能对和自己同一账号的进程发信号，所以那些进程你只能看、不能直接关，需要 sudo。'),
  },
  uptime: {
    title: L('Uptime', '运行时长'),
    tip: L('Something up for a few minutes is probably the command you just typed. Something up for days is probably a system service that started with the machine.',
      '刚起来几分钟的，多半是你自己刚敲下启动命令的那个。已经跑了好几天的，多半是开机就在的系统服务。'),
  },
  memory: {
    title: L('Memory', '内存占用'),
    tip: L('Physical memory this process holds. If the number is unusually large, consider whether it is in the middle of something before killing it.',
      '这个进程实际占用的物理内存。数值特别大的，杀掉前想想它是不是正在处理什么。'),
  },
  risk: {
    title: L('Risk level', '风险等级'),
    tip: L('A judgement combining process identity, what the port is normally for, which user runs it, and how long it has been up. Do not kill = the system goes down. High = system features break. Low = a restart usually fixes it.',
      '综合进程身份、端口用途、运行用户和运行时长给出的判断。禁止终止 = 动了系统会崩；高风险 = 会影响系统功能；低风险 = 一般重启就能恢复。'),
  },
  cmdline: {
    title: L('Full command line', '完整命令行'),
    tip: L('The complete command used to start this program, arguments and paths included. This is the most reliable way to tell what something actually is.',
      '启动这个程序时用的完整命令，包括参数和路径。这是判断「这到底是什么」最可靠的依据。'),
  },
};

/** 把 FIELD_TIPS 摊平成单一语言，前端拿到就能直接渲染。 */
function fieldTips(lang = 'en') {
  const g = normalizeLang(lang);
  const out = {};
  for (const [k, v] of Object.entries(FIELD_TIPS)) {
    out[k] = { title: pick(v.title, g), tip: pick(v.tip, g) };
  }
  return out;
}

function categories(lang = 'en') {
  const g = normalizeLang(lang);
  const out = {};
  for (const [k, v] of Object.entries(CATEGORY)) out[k] = pick(v, g);
  return out;
}

module.exports = {
  analyze,
  lookupProcess,
  lookupCmdline,
  humanDuration,
  fieldTips,
  categories,
  normalizeLang,
  LANGS,
  FIELD_TIPS,
  RISK,
  CATEGORY,
  _internal: { PROCESSES, PORTS, CMDLINE_HINTS, higherRisk, pick, L },
};
