// Copy owns the homepage. Every string the page prints lives here so the font
// subsetter and the template cannot drift apart.

// HEADLINE is listed once; DISPLAY_TEXTS adds the wordmark. The font subsetter
// reads both arrays as literal string lists.
export const HEADLINE = ['粘贴一个 GitHub 地址，', '拿回一个能下载的地址。'];

export const WORDMARK = 'gh-relay 中转站';

export const DISPLAY_TEXTS = [
  '粘贴一个 GitHub 地址，',
  '拿回一个能下载的地址。',
  'gh-relay 中转站',
];

export const LEAD =
  '代理跑在 Cloudflare 的边缘节点上。release、raw、archive、gist、API 和 git clone 都走同一条通道。';

export const EXAMPLES = Object.freeze([
  {
    id: 'release',
    label: 'release 文件',
    source: 'github.com/owner/repo/releases/download/v1.2.0/app-win64.zip',
    note: '跟随签名跳转，一次往返，签名不写进地址栏',
  },
  {
    id: 'raw',
    label: '仓库文件',
    source: 'raw.githubusercontent.com/owner/repo/main/src/index.js',
    note: '分支引用 60 秒重验，提交 SHA 缓存一年',
  },
  {
    id: 'archive',
    label: '源码归档',
    source: 'github.com/owner/repo/archive/refs/tags/v1.2.0.tar.gz',
    note: '按标签分流到 codeload，不可变，缓存一年',
  },
  {
    id: 'gist',
    label: 'gist',
    source: 'gist.githubusercontent.com/owner/abcdef/raw/setup.sh',
    note: '原样透传，保留 Content-Type 与 ETag',
  },
  {
    id: 'api',
    label: 'API',
    source: 'api.github.com/repos/owner/repo/releases/latest',
    note: '不缓存，速率限制原样返回',
  },
  {
    id: 'git',
    label: 'git clone',
    source: 'github.com/owner/repo.git',
    note: '只放行读取，推送请求返回 405',
  },
]);

export const COMMANDS = Object.freeze({
  curl: (prefix, source) => `curl -L -O ${prefix}/${source}`,
  wget: (prefix, source) => `wget ${prefix}/${source}`,
  git: (prefix, target) => {
    const clean = target.replace(/^https:\/\//, '').replace(/\.git$/, '');
    return `git clone ${prefix}/https://${clean}.git`;
  },
});

export const HOST_TABLE = Object.freeze([
  ['github.com/owner/repo/releases/download/…', '跟随签名跳转，一次往返'],
  ['github.com/owner/repo/archive/refs/tags/…', '按标签分流到 codeload'],
  ['raw.githubusercontent.com/owner/repo/<ref>/…', 'SHA 缓存一年，分支 60 秒'],
  ['api.github.com/…', '不缓存，保留速率限制响应头'],
  ['gist.githubusercontent.com/…', '原样透传'],
  ['github.com/owner/repo.git', '仅 git-upload-pack，推送返回 405'],
  ['github.com/owner/repo.git/info/lfs/…', 'LFS 批量接口转发，只下载不上传'],
]);

/** Short forms the routing table accepts; each pins a host. */
export const PREFIX_TABLE = Object.freeze([
  ['/gh/owner/repo/…', '= /https://github.com/owner/repo/…'],
  ['/raw/owner/repo/<ref>/…', '= /https://raw.githubusercontent.com/…'],
  ['/api/repos/owner/repo/releases', '= /https://api.github.com/repos/owner/repo/releases'],
  ['/lfs/owner/repo/<oid>', '= /https://media.githubusercontent.com/…'],
]);

/** Runtime switches, rendered as a short table under the support list. */
export const VARIABLES = Object.freeze([
  ['MASK=nginx', '非代理路径显示 nginx 默认页；填 URL 则反代该页面'],
  ['MASK302=https://…', '非代理路径 302 到指定地址，替代首页'],
  ['BLOCK_UA=netcraft,curl', '匹配 UA 的请求只拿到伪装页，不代理'],
  ['ALLOW_HOSTS=…', '在默认主机表之外追加主机（逗号分隔）'],
  ['RATE_LIMITER', '限流绑定；未绑定时放行全部请求'],
]);

export const ERRORS = Object.freeze({
  empty: ['没有地址可以处理。', 'Paste a GitHub link to get started.'],
  'too-long': ['地址超过 4096 个字符。', 'The address exceeds 4096 characters.'],
  'bad-url': ['这个地址无法解析。检查域名拼写，或补上 https://。', 'The address could not be parsed. Check the hostname or add https://.'],
  'unsupported-host': ['这个主机不在支持范围内。', 'This host is not proxied.'],
  userinfo: ['地址里不能包含用户名或密码。私有仓库请用 git clone 携带凭据。', 'Remove the username and password from the URL. Use git clone for private repositories.'],
  insecure: ['只支持 https 地址。', 'Only https addresses are supported.'],
  'bad-port': ['地址里不能指定端口。', 'Ports are not allowed in the address.'],
});
