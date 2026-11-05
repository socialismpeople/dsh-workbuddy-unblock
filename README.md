# dsh-workbuddy-unblock

> 在 `dsh-our-free-model` 插件内部就地修复 **workbuddy / buddy（CodeBuddy）通道 400/11128「请求被拦截」** 的补丁集。
>
> ⚠️ **先读这个**：本方案没有技术独到之处。社区已有的原生 DSH 插件 [dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)（1180★）早在 2026-10 就解决了同一问题，且覆盖更全。本补丁只适合**已经在用 `dsh-our-free-model`、不想换插件**的场景。详见 [docs/comparison.md](docs/comparison.md)。

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

---

## 核心结论

**上游匹配的是每条 system 与 assistant 消息的开头**，与账号、额度、网络无关，换账号不会改变结果。

这个具体机制来自社区 [issue #163](https://github.com/dingminhua/dsh-connect-workbuddy/issues/163) 里上游返回的原始诊断：

> 网关匹配的是每一条 system 与 assistant 消息的开头，与账号、积分、额度、网络都无关，换账号或换区域也不会改变结果。

已知被拦的开头示例：

```
You are an AI agent powered by DeepSeek Harness.
```

因此修复方向是**改写这些开头句**，而不是处理敏感词。

> 关于"零宽空格脱敏"：该路线已于 2026-10-29 失效——CN 网关在匹配前会规范化 U+200B。详见 [comparison.md](docs/comparison.md) 第三节。

---

## 本方案的实测数据

以下是本仓库独立复现的实验记录（结论与社区一致，但范围有限——只截取了前 2000 字符，实际请求可达 17000+ 字）：

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
| 插入零宽空格 | ❌ BLOCK |

> **为什么零宽空格无效**（本仓库当时没查出来，社区给了答案）：CN 网关在匹配前会**规范化 U+200B**，所以插零宽这条路从 2026-10-29 起就被堵死了。见 [issue #163](https://github.com/dingminhua/dsh-connect-workbuddy/issues/163) 的复测更新。

**结论：必须改写措辞。**

---

## 本方案当时的定位错误（如实记录）

本仓库最初用二分法把触发点定位在下面这段：

```
Tokens prefixed with @ are paths the user explicitly referenced.
Relative paths resolve from the workspace root; absolute paths identify files or directories on the host.
```

**这个定位只对了一半。** 事后做 2×2 对照才发现：上游**同时**检查**消息开头**的身份声明句和**正文中段**的模板片段，两处都得清。

2×2 对照实测：

| 组合 | 结果 |
|---|---|
| 开头句 + 原第 0 段（修复前） | ❌ BLOCK |
| 开头句 + **改后**第 0 段（只改第 0 段） | ❌ BLOCK |
| **删开头句** + 原第 0 段（只删开头） | ❌ BLOCK |
| 删开头句 + 改后第 0 段（修复后） | ✅ PASS |

**所以 PATCH1 与 PATCH6 缺一不可。** 初版文档说"PATCH6 是核心修复"不准确，中途想改成"PATCH1 才是核心"也不准确。

另外本方案的诊断只截取了 system 前 **2000 字符**，而实际请求可达 **17000+ 字**（见社区 issue #163），且**未覆盖 assistant 消息开头**——这两处是真实缺口。

---

## 解决方案

改写 DSH 提示词里的模板句与身份声明句，语义不变、措辞不同：

| 原模板 | 改写后 |
|---|---|
| `You are an AI agent powered by DeepSeek Harness.` | **整句删除**（PATCH1） |
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

> ⚠️ **本方案未处理 assistant 消息开头**。社区方案（dsh-connect-workbuddy）已覆盖此项。如果你的会话历史里有被拦的 assistant 开头，本补丁可能不够。

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
| 6 | `dshRewriteTemplates()` | 改写中段模板句 | **必需**（与 PATCH1 缺一不可） |

**1、2、6 三项是决定性的**（缺任一项仍会 400/11128），3 是排查工具，4、5 是加固。

---

## 快速开始

> **先想清楚要不要用这个。**
>
> 如果你还没装插件，直接用 [dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)（1180★），一行 `npm i` 搞定，方案更完整。
>
> 只有在**已经在用 `dsh-our-free-model`、不打算换插件**的情况下，才建议用本补丁。

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

上游随时可能换判据。**本次补丁的存活周期可能比社区方案短**：

- 本方案只处理 system 消息，**未处理 assistant 消息开头**（社区已覆盖）
- 本方案无被拦后的降级重试（社区有）
- 本方案无设备指纹派生（社区网关方案有）

**不建议用在重要工作流上**，留好备选模型。真要长期用，换社区插件。

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
├── apply-patch6.mjs               补丁 6：模板句改写（次要，见上文归因修正）
└── docs/
    ├── comparison.md              与社区方案的差异（含本方案的错误修正记录）
    ├── diagnosis.md               完整排查过程与实验数据
    └── reference-desensitize.py   社区脱敏实现（参考，零宽方案已失效）
```

---

## 致谢

**本方案的关键机制理解来自社区，而非本仓库的独立发现：**

- **[dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)** — 最重要。其 [issue #163](https://github.com/dingminhua/dsh-connect-workbuddy/issues/163) 贴出了上游返回的原始诊断，说明"网关匹配的是每一条 system 与 assistant 消息的开头"；README 记录了零宽空格已被网关规范化（2026-10-29）、三道门的具体内容、以及 5.13.1/5.14.0 的按句改写方案。**如果早点读到这个仓库，本方案的大部分弯路可以省掉。**
- [XDTrees/dsh-xdpool](https://github.com/XDTrees/dsh-xdpool) — 多账号池与面板设计参考
- [ardeyouxipianyi/workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) — `TROUBLESHOOTING-11-128.md` 的排查顺序与提示词三模式
- [Hyact/workbuddy-switch-plus](https://github.com/Hyact/workbuddy-switch-plus) — 本仓库 PATCH1 词表来源（零宽方案，现已失效）
- [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) — 被修补的插件本体

---

## License

MIT
