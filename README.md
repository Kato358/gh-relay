# gh-relay

GitHub 文件中转。部署在 Cloudflare Workers 上，一个文件、零运行时依赖、内置限流与缓存分级。

粘贴一个 GitHub 地址，拿回一个能下载的地址：

```
https://your-worker.workers.dev/https://github.com/owner/repo/releases/download/v1.2.0/app.zip
```

## 支持范围

| 你粘贴的地址 | 代理怎么做 |
| --- | --- |
| `github.com/owner/repo/releases/download/<tag>/<file>` | 跟随 GitHub 的签名跳转，一次往返；`<tag>` 不可变时缓存一年 |
| `github.com/owner/repo/archive/<ref>.zip`、`/tar.gz` | 按 `<ref>` 决定：标签或 SHA 缓存一年，分支 60 秒重验 |
| `raw.githubusercontent.com/owner/repo/<ref>/…` | 同上：SHA 一年，分支 60 秒 |
| `gist.githubusercontent.com/…`、`gist.github.com/…` | 原样透传，保留 `Content-Type` 与 `ETag` |
| `api.github.com/…` | 不缓存（`no-store`），保留 `X-RateLimit-*`；匿名可访问 |
| `codeload.github.com/…`、`media.githubusercontent.com/…` | 资源直链，按引用类型决定缓存 |
| `github.com/owner/repo.git` | 只放行 `git-upload-pack` 读取；推送返回 405 |
| `…/info/lfs/objects/batch` | LFS 批量接口按原样转发（含凭据与请求体），只下载 |
| `media.githubusercontent.com/…` | LFS 对象字节，流式透传 |

### 短写法

路径前缀指定主机，后面的部分原样拼上：

| 前缀 | 等价于 |
| --- | --- |
| `/gh/owner/repo/…` | `/https://github.com/owner/repo/…` |
| `/raw/owner/repo/<ref>/…` | `/https://raw.githubusercontent.com/owner/repo/…` |
| `/api/repos/owner/repo/…` | `/https://api.github.com/repos/owner/repo/…` |
| `/lfs/owner/repo/<oid>` | `/https://media.githubusercontent.com/…` |

前缀只是省掉 `https://` 和主机名；已经写了完整主机时不会被二次拼接。

`release-assets.githubusercontent.com`、`objects.githubusercontent.com`、`github-releases.githubusercontent.com` 这类签名主机只作为跳转目标被内部跟随，签名不会出现在地址栏。

## 行为约定

- 只代理上面列出的主机。其他路径返回 400 并列出支持的主机，不会去请求 `github.com/favicon.ico` 这种结果。
- 只允许 `GET`、`HEAD`、`OPTIONS`，以及只读的 git 子集。`POST` 到其他任何位置都是 405。
- 请求头白名单转发（`range`、`if-*`、`accept`、`user-agent`）。Cookie、客户端 IP、逐跳头一律丢弃。
- `Authorization` 只发往 `github.com`（`git clone`）和 `api.github.com`。
- 凭据请求、Range 请求、非 200 响应、带 `Set-Cookie` 的响应都不进共享缓存。
- 缓存键是 URL + 编码，不含日期：不可变资源不会因为"今天"过期而重新回源。
- 边缘缓存 `accept-encoding: identity` 单一表示，浏览器与 Cloudflare 之间再协商压缩。

## 部署

### 一键（推荐）

```bash
npm install
npm run deploy        # 先 build，再 wrangler deploy
```

首次部署会要求登录 Cloudflare。`wrangler.toml` 里的 `name` 是 Worker 名，改掉即可。

### 控制台粘贴

```bash
npm run build          # 产出 dist/worker.js（单文件，字体已内联）
```

把 `dist/worker.js` 全文粘贴进 Worker 编辑器。不需要任何绑定。

### 自定义域名

给 Worker 添加路由或自定义域，例如 `gh.example.com/*`。Worker 用路径识别目标，不需要额外的子路径配置——`/gh/…`、`/raw/…` 这类前缀在根路径上就能用。

## 配置

全部可选。没有配置项时也完全可用。

| 绑定 / 变量 | 作用 |
| --- | --- |
| `RATE_LIMITER`（Rate Limiting） | 按 IP 限流。未绑定时放行全部请求，git 与 LFS 流量不计入 |
| `MASK` | `nginx` 显示 nginx 默认页；填 URL 则反代该页面；非代理路径与伪装 UA 都返回它 |
| `MASK302` | 非代理路径 302 到指定地址（优先级高于 `MASK`），首页不再出现 |
| `BLOCK_UA` | 逗号分隔的 UA 片段。命中的请求只拿到伪装页，永不进入代理 |
| `ALLOW_HOSTS` | 在默认主机表之外追加允许的主机（逗号分隔） |

限流绑定在 Dashboard → Workers → 你的 Worker → Settings → Bindings → Rate Limiting 里创建，名称填 `RATE_LIMITER`。

伪装类开关同时接受两种来源：`wrangler.toml` 的 `[vars]` / 控制台 Environment variables（优先），或 `worker.js` 顶部的 `INLINE_CONFIG` 字符串——后者是「把 `dist/worker.js` 粘进编辑器」这条路径唯一能用的配置方式：

```js
const INLINE_CONFIG = `
MASK=nginx
BLOCK_UA=netcraft,AhrefsBot
`;
```

### 运维端点

| 路径 | 返回 |
| --- | --- |
| `/health` | `ok`，`x-proxy-health: ok`，不触上游 |
| `/stats` | 当前 `mode`、是否绑定限流、计入的 UA 数量、本次隔离实例已服务请求数 |

## 响应头

| 响应头 | 含义 |
| --- | --- |
| `X-Proxy-Rule` | 命中的缓存规则：`immutable`、`refresh`、`standard`、`api`、`git`、`lfs`、`redirect` |
| `X-Proxy-Cache` | `HIT`（边缘命中）、`MISS`（回源）、`BYPASS`（不缓存） |
| `Server-Timing` | `edge;dur=N`，本次 Worker 处理耗时 |

## 本地开发

```bash
npm install
npm run dev            # build + wrangler dev
npm test               # node --test，纯函数 + 真实 Worker 集成测试（上游被 stub）
npm run fonts          # 重建首页字体子集
```

## 许可

MIT。
