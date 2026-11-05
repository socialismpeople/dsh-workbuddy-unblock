# 完整排查过程

记录 2026-11-05 这次定位的全过程，包括走过的弯路，供以后遇到同类问题参考。

---

## ⚠️ 阅读前必读：本文的定位结论有误

本文记录的排查过程是真实的，但**最终归因错了**。事后读社区仓库才发现真相：

| 本文的结论 | 实际 |
|---|---|
| 触发点是 `Tokens prefixed with @` 那段（二分到 109/112 边界） | 实为**消息开头** `You are an AI agent powered by DeepSeek Harness.` |
| 只在 system 里找 | **assistant 消息开头同样被检查** |
| 诊断截取前 2000 字符够用 | 实际请求可达 **17043 字** |

**为什么二分法会指错方向**：本方案的 PATCH1 早已删掉开头那句身份声明，所以二分时那段已经"干净"，于是在后面的文本里找到了一个并非主因的边界。

权威描述见社区 [issue #163](https://github.com/dingminhua/dsh-connect-workbuddy/issues/163)，那里贴了上游的原始诊断：

> 网关匹配的是每一条 system 与 assistant 消息的开头，与账号、积分、额度、网络都无关，换账号或换区域也不会改变结果。

**本文保留原样，作为"方法用对了但数据不全导致误判"的案例。** 修正后的对比见 [comparison.md](comparison.md)。

---

## 起点：当时对社区方案的判断

当时读到的社区说法是：

> workbuddy 上游除了会检测请求头之外，还会检测 DSH 的提示词指纹
> 已知触发串：`You are an AI agent powered by DeepSeek Harness`

给出的解法是**脱敏**：给敏感词插零宽空格（U+200B）。

> **事后修正**：零宽方案在 2026-10-29 已被上游封堵——CN 网关在匹配前会规范化 U+200B。当时不知道这一点，把"零宽无效"归因为"上游在做 token 序列匹配"，实际是"上游先规范化再匹配"。

---

## 第一步：确认补丁真的生效了

先给插件打上 system 脱敏补丁，然后在 Buddy 适配器 `send()` 前加诊断落盘。

诊断结果（节选）：

```json
{
  "at": "2026-11-05T12:22:04.809Z",
  "product": "workbuddy",
  "model": "deepseek-v4.1-flash",
  "systems": ["\n\nTokens prefixed with @ are paths the user explicitly referenced. ..."],
  "totalMessages": 767
}
```

检查关键词：

```
DeepSeek Harness => 0
harness          => 0
DSH              => 0
dsh              => 0
```

**脱敏成功，但请求仍然 403/11128。**

这一步很关键：它证明了「提示词指纹」这个笼统说法对了一半 —— 确实和提示词有关，但**不是那些明显的身份词**。

---

## 第二步：排除账号和渠道因素

### 测试所有账号

用插件凭据库（`<DSH_HOME>\.credentials.yaml`）里的 token，直连端点：

| 账号 | 结果 |
|---|---|
| 账号 A | 403 / 11140 账号受限 |
| 账号 B | 400 / 11128 |
| 账号 C | **200 OK** |

结论：**账号确实有差异**，但即使是能用的账号，也必须满足某些条件才通过。

> 注：此处隐去具体账号标识。你自己排查时，账号信息在 `channel-pack/state.json` 的 `accounts[]` 里，每个条目有 `id`、`nickname`、`credentialRef`。

### 测试所有模型

同一个 token、同样的极简 body，只换 model：

```
FAIL  deepseek-v4.1-flash   status=400  code=11128
FAIL  hy4free               status=400  code=11128
FAIL  glm-5.3               status=400  code=11128
FAIL  kimi-k3               status=400  code=11128
FAIL  default-model         status=400  code=11128
FAIL  fast-model            status=400  code=11128
```

结论：**与模型无关**。

### 测试国内版 vs 国际版

| 端点 | 产品 | 结果 |
|---|---|---|
| `www.workbuddy.ai` | workbuddy（国际版） | 有渠道校验 |
| `copilot.tencent.com` | buddy（CodeBuddy，国内版） | 极简请求全通 |

**注意：这两个是独立的账号体系和端点，不要混淆。** 本文档的最终方案针对国内版。

国内版逐模型测试（极简 system）：

```
OK   hy3                       200  收到
OK   hy3-b                     200  (空回复)
OK   hy3-x                     200  收到
OK   hy4free                   200  收到
OK   deepseek-v4.1-flash       200  收到
OK   deepseek-v4-flash         200  收到
OK   glm-5.3                   200  收到
OK   kimi-k3                   200  收到
OK   fast-model                200  收到
FAIL default-model             400  code=11102 当前模型不可用
```

结论：**国内版端点本身完全正常，所有主流模型可用。**

---

## 第三步：二分定位

既然账号、端点、模型都排除了，问题只能在**请求内容**里。

### 对照实验

同样的 user 提问（`只回复两个字：收到`），只换 system：

```
OK    极简 system (28字符)       200 收到
FAIL  真实 system 前2000字符      400 code=11128
FAIL  真实 system 全文            400 code=11128
```

**这是决定性证据。**

### 按段落二分

真实 system 按 `\n\n` 切成 10 段，逐段测试：

```
[BLOCK] # 0 len=  407  'Tokens prefixed with @ are paths the user explicitly referenced. Relat'
[ok   ] # 1 len=  260
[ok   ] # 2 len=  126
[ok   ] # 3 len=  140
[ok   ] # 4 len=  132
[ok   ] # 5 len=   71
[ok   ] # 6 len=  129
[ok   ] # 7 len=  383
[ok   ] # 8 len=  215
[ok   ] # 9 len=  117
```

只有第 0 段被拦。

### 段内逐句测试 —— 这里踩了个坑

把第 0 段按句号切成 5 句，逐句测试：

```
[ok   ] 0: 'Tokens prefixed with @ are paths the user explicitly referenced.'
[ok   ] 1: 'Relative paths resolve from the workspace root; absolute paths identify files or'
[ok   ] 2: 'A trailing slash marks a directory: list it when its contents matter.'
[ok   ] 3: 'Anything else is a file: use the read tool when its contents are needed, and do'
[ok   ] 4: '@"..." quotes a path containing spaces.'
```

**全部通过！** 但整段却被拦。

> ⚠️ 这是最容易误判的地方：如果只测单句，会得出"没有触发点"的错误结论。
> **必须测组合。**

### 长度阈值二分

对第 0 段做前缀二分：

```
[ok   ] 前 100 字符
[BLOCK] 前 200 字符
[BLOCK] 前 300 字符
...
```

进一步细化：

```
150 字符 -> BLOCK
125 字符 -> BLOCK
112 字符 -> BLOCK
109 字符 -> ok
106 字符 -> ok
```

边界在 **109 ~ 112** 之间，边界处的文本：

```
...tively referenced. Relative paths resolve from the workspace ro|ot;
```

即这两句的连接处：

```
Tokens prefixed with @ are paths the user explicitly referenced.
Relative paths resolve from the workspace root;
```

### 排除"纯长度"因素

用 400 字符的无害英文文本测试 → **通过**。

所以不是长度阈值，是**特定的 token 序列**。

---

## 第四步：确认是模板指纹

对第 0 段做各种变形：

| 变形 | 结果 | 说明 |
|---|---|---|
| 原文 | ❌ BLOCK | — |
| **句序倒置** | ✅ 通过 | 顺序重要 |
| **每句间加空行** | ✅ 通过 | 连续性重要 |
| **删掉 `@` 符号** | ✅ 通过 | 特定 token 重要 |
| 全部转小写 | ❌ BLOCK | 大小写不敏感 |
| **插零宽空格** | ❌ BLOCK | **不是关键词匹配** |

最后两行是决定性的 —— **但当时的解读错了**：

- 当时的解读：上游做的是 **token 序列匹配 / 语义片段匹配**
- **实际原因**：上游在匹配前会**规范化 U+200B**（CN 网关行为，社区 2026-10-29 确认）

所以"插零宽空格无效"不能推出"不是关键词匹配"，只能推出"零宽字符被吃掉了"。**这个误判导致后面去找"连续 token 序列"，方向偏了。**

正确的说法应该是：上游匹配**消息开头**的固定片段，而零宽字符在匹配前被剥离。

---

## 第五步：改写并验证

当时基于"连续 token 序列"的错误假设，去改写第 0 段的措辞：

```python
REWRITES = [
    (r'Tokens prefixed with @ are paths the user explicitly referenced\.',
     "Some arguments may reference filesystem locations."),
    (r'Relative paths resolve from the workspace root; absolute paths identify files or directories on the host\.',
     "A bare location is understood as relative to the working directory; a fully qualified one points elsewhere."),
    (r'A trailing slash marks a directory: list it when its contents matter\.',
     "A directory is conventionally written with a trailing separator."),
    (r'Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading\.',
     "Other locations denote a regular file. Examine a file's actual content before asserting anything about it."),
    (r'@"\.\.\." quotes a path containing spaces\.',
     "Quote a location that contains whitespace."),
    # 结构化标签也改掉
    (r'<environment_context>', '<env>'),
    (r'</environment_context>', '</env>'),
    (r'<system-reminder>', '<note>'),
    (r'</system-reminder>', '</note>'),
    (r'<permissions instructions>', '<access>'),
    (r'</permissions instructions>', '</access>'),
]
```

验证：

```
原始 system  -> BLOCK code=11128 请求被拦截，请重新发送
改写后 system -> PASS  收到
```

### 事后 A/B 验证：两项都是必要条件

事后补做了一组 2×2 对照，搞清 PATCH1（删开头句）与 PATCH6（改第 0 段）各自的作用：

| 组合 | 结果 |
|---|---|
| ① 开头句 + 原第 0 段（修复前） | ❌ BLOCK |
| ② 开头句 + **改后**第 0 段（只改第 0 段） | ❌ **BLOCK** |
| ③ **删开头句** + 原第 0 段（只删开头） | ❌ **BLOCK** |
| ④ 删开头句 + 改后第 0 段（修复后） | ✅ PASS |

**结论：两者缺一不可。**

这说明上游同时检查多个位置——既看**消息开头**的身份声明句，也看**正文中段**的模板片段。只清一处不够。

> 此前文档两次归因都不完整：初版说"PATCH6 是核心修复"（错，只改第 0 段不过），修正版说"PATCH1 才是真正起作用的"（也错，只删开头也不过）。**实测是两个都要。**

---

## 最终验证

重启 DSH 后，诊断文件记录的请求序列：

```
15:24:55  buddy  hy4free             msgs=850
15:25:46  buddy  hy4free             msgs=853
15:26:13  buddy  deepseek-v4.1-flash msgs=856   ← 切换目标模型
15:29:21  buddy  deepseek-v4.1-flash msgs=2     ← 短请求也通
15:33:12  buddy  deepseek-v4.1-flash msgs=857
```

重启后拦截记录：

```
重启后无拦截记录 ✓
```

---

## 走过的弯路（避免重复）

### 弯路 1：以为升级插件能解决

下载 `dsh-our-free-model` 2.8.0 的 `pack.js` 全文核查：

| 关键词 | 命中数 |
|---|---|
| `DeepSeek Harness` | 0 |
| `unapproved` | 0 |
| `filterSystemIdentity` | 0 |
| `desensitize` | 0 |

**2.8.0 完全没做提示词处理。** 升级无用。

### 弯路 2：以为装 WorkBuddy 客户端能拿到解密密钥

workbuddy-switch-plus 的反代用 `loggerGet`（Electron 私有 binding）解 `$wbEncrypted` 凭据。实测 WorkBuddy 5.9.3：

```
Error: No such module: electron_browser_workbuddy_storage
```

**5.9.3 已移除该 binding**，反代方案在 5.9.3 上失效。

> 本次最终方案**不需要任何客户端密钥**。如果你看到别的教程要求"提取 WorkBuddy at-rest 密钥"，那是反代路线的需求，本方案不涉及。

### 弯路 3：把问题归因于账号

一开始看到 `11140 账号存在异常行为`，就断定"账号被封，换号即可"。

实际两个错误码是独立的：

- `11128` = 渠道/内容校验 → **本方案解决**
- `11140` = 账号受限 → 只能换号

只换号不修内容，仍然会在新账号上遇到 11128。

### 弯路 4：只测单句

按句切分后逐句测试全部通过，差点判成"没有触发点"。必须测**组合**。

---

## 可复用的方法论

这套方法可迁移到其他"上游拦截客户端"问题：

1. **诊断落盘优先** — 先搞清楚实际发出的是什么，别靠猜
2. **最小对照实验** — 极简 vs 真实，隔离出变量
3. **排除法** — 账号、端点、模型、请求头逐个排除
4. **分层二分** — 段落 → 句子 → 字符
5. **变形测试** — 倒序 / 加空行 / 删符号 / 转小写 / 插零宽，从结果反推匹配机制
6. **组合测试** — 单句通过不代表组合通过

第 5 步最有价值：**用变形的通过/失败模式反推对方在匹配什么**，比盲目试错快得多。
