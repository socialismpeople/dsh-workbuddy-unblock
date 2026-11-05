# dsh-workbuddy-unblock

> 修复 DeepSeek Harness（DSH）里 **workbuddy / buddy（CodeBuddy）通道报 400/11128「请求被拦截」、403/11140「账号被限制」** 的完整方案。
>
> 含可复现的定位过程、补丁脚本、以及**为什么"脱敏敏感词"不管用**。

---

## 问题现象

DSH 里装上 `dsh-our-free-model` 插件后，切到 workbuddy 或 buddy 通道，每次请求都失败：

```
LlmError: buddy: 请求被拦截，请重新发送 Illegal API invocation from an unapproved channel
[workbuddy] 账号 workbuddy-xxxx 被安全策略拦截（HTTP 403，code 11140），继续换号：账号存在异常行为，已被限制使用
```

上游返回的完整错误体：

```json
{
  "code": 11128,
  "msg": "request illegal",
  "displayMsg": {
    "zh": "请求被拦截，请重新发送"
  },
  "displayTips": {
    "zh": "这次调用没通过渠道校验，可能不是官方客户端发出的。请用官方版本重新发送。"
  }
}
```

社区普遍的说法是「上游在检测 DSH 提示词指纹」，并给出了脱敏方案（给敏感词插零宽空格）。**实测证明这个思路方向对、但方法不对。**

---

## 核心结论（先看这个）

**上游匹配的是提示词的连续模板片段，不是敏感词。**

同一个 token、同一个端点、同样的提问，只换 system 内容：

| system 内容 | 结果 |
|---|---|
| `You are a helpful assistant.`（28 字符） | ✅ 200 |
| DSH 真实 system（2000 字符） | ❌ 400 / 11128 |

对 DSH 真实 system 做逐项变形：

| 变形方式 | 结果 |
|---|---|
| 原段 | ❌ BLOCK |
| **句序倒置** | ✅ 通过 |
| **每句之间加空行** | ✅ 通过 |
| **删掉 `@` 符号** | ✅ 通过 |
| 全部转小写 | ❌ BLOCK（大小写不敏感） |
| 插入零宽空格 | ❌ BLOCK（**不是关键词匹配**） |

> 如果上游在做关键词匹配，插零宽空格应该能绕过。实际绕不过，说明它匹配的是 **token 序列 / 语义片段**。

**结论：必须改写措辞，不能只做字符级脱敏。**

---

## 触发点在哪

用二分法定位到 109 字符通过、112 字符被拦，落在这一段：

```
Tokens prefixed with @ are paths the user explicitly referenced.
Relative paths resolve from the workspace root; absolute paths identify files or directories on the host.
```

但**单独发其中任何一句都能通过**，只有两句连起来才被拦。这就是模板指纹的特征。

---

## 解决方案

改写 DSH 提示词里的模板句，语义不变、措辞不同：

| 原模板 | 改写后 |
|---|---|
| `Tokens prefixed with @ are paths the user explicitly referenced.` | `Some arguments may reference filesystem locations.` |
| `Relative paths resolve from the workspace root; absolute paths identify files or directories on the host.` | `A bare location is understood as relative to the working directory; a fully qualified one points elsewhere.` |
| `A trailing slash marks a directory: list it when its contents matter.` | `A directory is conventionally written with a trailing separator.` |
| `Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading.` | `Other locations denote a regular file. Examine a file's actual content before asserting anything about it.` |
| `@"..." quotes a path containing spaces.` | `Quote a location that contains whitespace.` |

实测效果：

```
原始 system  -> BLOCK  code=11128
改写后 system -> PASS   收到
```

---

## 六个补丁分别做什么

补丁按发现问题的时间顺序排列，**全部打在插件自己的 `channel-pack/pack.js` 里**，不改 DSH 本体。

| # | 位置 | 作用 | 是否必需 |
|---|---|---|---|
| 1 | `options.system` 注入处 | 删除 `You are ... powered by DeepSeek Harness` 类身份声明句 | 建议 |
| 2 | `serializeMessages2` 的 system 分支 | 对走 `messages` 数组的 system 同样脱敏 | 必需（DSH 有时走这条路径） |
| 3 | Buddy 适配器 send 前 | 落盘诊断，记录实际发出的 system | 排查用，可关 |
| 4 | `attributionHeaders2()` | 过滤 `x-dsh` / `x-harness` 等身份请求头 | 建议 |
| 5 | Buddy send() | 补齐 `X-Conversation-*` 三件套等渠道校验头 | 建议 |
| 6 | `dshRewriteTemplates()` | **改写模板指纹句**（核心修复） | **必需** |

**只有 2 和 6 是决定性的**，其余是加固。

---

## 快速开始

### 前置

- DSH 已安装 `dsh-our-free-model` 插件
- Node.js（DSH 自带）
- 可用的 workbuddy / buddy 账号（已登录到 Channel Pack）

### 应用补丁

```powershell
# 打补丁
powershell -ExecutionPolicy Bypass -File patch-buddy-desense.ps1

# 查看状态
powershell -ExecutionPolicy Bypass -File patch-buddy-desense.ps1 -Status

# 回滚
powershell -ExecutionPolicy Bypass -File patch-buddy-desense.ps1 -Revert
```

脚本会：先备份 → 依次应用 6 个补丁 → `node --check` 语法校验 → 失败自动回滚。

### 生效

**必须重启 DSH**。`pack.js` 是启动时 `await import()` 加载的 ESM，Node 按 URL 缓存，进程内无法重新求值。

重启后切到 `workbuddy/deepseek-v4.1-flash`，正常发消息即可。

---

## 如何自己定位同类问题

### 1. 打开诊断落盘

应用补丁 1-3 后，每次请求会写一条 JSON 到 `<DSH_HOME>\logs\buddy-payload-diag.jsonl`（默认 `C:\Users\<你的用户名>\...` 或 `E:\DSH-HOME\...`，取决于你的 DSH 安装位置）：

```json
{
  "at": "2026-11-05T15:26:13.000Z",
  "product": "buddy",
  "model": "deepseek-v4.1-flash",
  "hadOptionsSystem": true,
  "systemCount": 1,
  "systems": ["<实际发出的 system 前 2000 字符>"],
  "totalMessages": 857,
  "firstRoles": ["system", "user", "user", "user"]
}
```

**这能直接告诉你补丁有没有生效、发出去的内容是什么。**

### 2. 最小请求对照

拿一个"极简 system + 一个 user"的请求，独立发到同一个端点。如果极简能过、真实被拦，就确认是内容问题而非账号问题。

### 3. 二分定位

对 system 按 `\n\n` 切段 → 逐段测 → 找到被拦的段 → 段内按字符二分 → 找到边界 → 单独测边界句。

关键技巧：**单独测每句可能都通过，要测组合**，否则会误判成"没有触发点"。

---

## 注意事项

### 关于账号受限（11140）

`11140` 和 `11128` 是**两个独立问题**：

- `11128` = 渠道/内容校验失败 → 本方案解决
- `11140` = 账号本身被限 → 只能换号，等解封

如果账号池里某个账号返回 11140，在插件 Channel Pack 里禁用它换下一个即可。

### 关于插件升级

插件升级会覆盖 `pack.js`，补丁丢失。升级后重跑一次 `patch-buddy-desense.ps1` 即可 —— 脚本会先检测是否已打过，不会重复打。

### 诊断补丁会写文件

补丁 3 每次请求都追加一行。长期使用建议关掉（从脚本的补丁列表里移除 `apply-patch3.mjs`，或改 `fs_write_diag` 为空函数）。

### 这是对抗性方案

上游随时可能换判据。本次定位方法（诊断落盘 + 二分）是可复用的，但具体改写规则可能失效。

**不建议用在重要工作流上**，留好备选模型。

---

## 环境信息

实测环境（2026-11-05）：

| 项 | 版本 |
|---|---|
| DSH | NEXT |
| dsh-our-free-model | 2.5.6 |
| WorkBuddy 客户端 | 5.9.3 |
| Node.js | v24.22.1 |
| 平台 | Windows 10.0.26300 |

---

## 仓库文件

```
.
├── README.md                      本文档
├── patch-buddy-desense.ps1        一键打补丁 / 回滚 / 查状态
├── dsh-buddy-desense.patch.js     补丁 1 的函数体（脱敏逻辑）
├── apply-patch.mjs                补丁 1：options.system 脱敏
├── apply-patch2.mjs               补丁 2：messages 内 system 脱敏
├── apply-patch3.mjs               补丁 3：诊断落盘
├── apply-patch4.mjs               补丁 4：清身份请求头
├── apply-patch5.mjs               补丁 5：渠道校验必需头
├── apply-patch6.mjs               补丁 6：模板指纹改写（核心）
└── docs/
    ├── diagnosis.md               完整排查过程与实验数据
    └── reference-desensitize.py   社区脱敏实现（参考，含压缩策略）
```

---

## 致谢

思路参考了以下项目：

- [Hyact/workbuddy-switch-plus](https://github.com/Hyact/workbuddy-switch-plus) — `reverse-proxy/core/desensitize.py` 的脱敏 + 压缩策略
- [changexbc/workbuddy-switch](https://github.com/changexbc/workbuddy-switch) — 账号切换与管理
- [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) — 被修补的插件本体

---

## License

MIT
