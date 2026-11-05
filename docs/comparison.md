# 与社区方案的对比

**先说结论：本方案不是新方法，也不是改进。社区早有原生 DSH 插件解决了同一问题，而且解决得更好、更早、更彻底。**

本文修正了此前版本中的若干错误判断，并如实记录差异。

---

## 一、社区早有 DSH 插件（此前的文档写错了）

此前本文档称"社区方案主要是 Python 网关形态"。**这是错误的**，源于搜索方式不对（只搜了 `workbuddy2api` 这个网关名，没搜 `dsh-plugin`）。

实际情况：

| 项目 | Star | 形态 | 关键信息 |
|---|---|---|---|
| **[dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)** | **1180** | **原生 DSH 插件**（npm 发布、有 CI、有 issue 跟踪） | 5.13.1 起按句改写固定指纹，5.14.0 补齐 Web GUI 段落 |
| **[XDTrees/dsh-xdpool](https://github.com/XDTrees/dsh-xdpool)** | **432** | 原生 DSH 插件，六页面板 | 多账号池、扫码登录十三家、76 家聚合 |
| [shatyuka/dsh-llm-codebuddy](https://github.com/shatyuka/dsh-llm-codebuddy) | 20 | DSH 插件 | CodeBuddy 接入 |
| [tearslee/dsh-workbuddy2api](https://github.com/tearslee/dsh-workbuddy2api) | 9 | DSH 插件 | 已停维护，转 magpie |
| 本方案 | — | 插件内补丁 | — |

**本方案与这些插件做的是同一件事，但晚、且覆盖不全。**

---

## 二、上游的真实校验机制（社区已摸清）

本方案的二分实验只得出"内容有问题"这一层。社区给出了精确机制，出自 [issue #163](https://github.com/dingminhua/dsh-connect-workbuddy/issues/163) 里上游返回的原始诊断：

> 网关匹配的是**每一条 system 与 assistant 消息的开头**，与账号、积分、额度、网络都无关，换账号或换区域也不会改变结果。

三个关键点：

1. **匹配位置是消息开头**，不是任意位置
2. **assistant 消息的开头也查**（本方案完全漏了）
3. **换账号无效**（与本方案实测一致）

同一 issue 贴出的被扫描内容：

```
system：You are an AI agent powered by DeepSeek Harness.
首尾为「Context management for this conversation is provided by billion-context...」
共 17043 字
```

**17,043 字。** 本方案的诊断只截取前 2000 字符，因此从未看到全貌。

### 本方案在此处的判断偏差

| 项目 | 本方案的判断 | 实际 |
|---|---|---|
| 触发点 | `Tokens prefixed with @` 那段（二分到 109/112 边界） | **只对一半**：开头句与中段模板**同时**被检查 |
| 校验范围 | 只查 system | **assistant 开头也查** |
| 截取长度 | 2000 字符 | 实际 17043 字 |

事后做 2×2 对照才搞清两者关系：

| 组合 | 结果 |
|---|---|
| 开头句 + 原第 0 段 | ❌ BLOCK |
| 开头句 + 改后第 0 段 | ❌ BLOCK |
| 删开头句 + 原第 0 段 | ❌ BLOCK |
| 删开头句 + 改后第 0 段 | ✅ PASS |

**PATCH1 与 PATCH6 缺一不可。** 两个都是必要条件，不存在"哪个是核心"。

---

## 三、零宽空格路线已失效（社区已有结论）

本方案实测"插零宽空格仍被拦"，但没查出原因。社区给出了：

> **2026-10-29 的 #163 复测更新**：零宽这条路已经被网关堵死——CN 网关在匹配前会**规范化 U+200B**

同 README 另一处：

> 5.12.x 及更早只有「中性头 + 零宽扰动」三级救援，在同一份 body 上实测**全部 400**

**所以零宽失效不是"方法选错"，是上游主动堵死了这条路。**

`workbuddy-switch-plus` 的 `desensitize.py`（本方案 PATCH1 词表的来源）用的正是零宽方案，在 2026-10-29 后已无法通过校验。

---

## 四、社区的演进时间线（本方案落后约两周）

| 时间 | 社区 | 本方案 |
|---|---|---|
| 2026-10-21 | workbuddy2api-panel 停维护 | — |
| 2026-10-23 | 上游开始系统性收紧 | — |
| 2026-10-28 | issue #163 定位到"消息开头" | — |
| 2026-10-29 | 确认零宽被规范化，失效 | — |
| 5.13.1 | **改为按句改写**已知固定指纹 | — |
| 5.14.0 | 补上 Web GUI 段落第二句（#167） | — |
| 2026-11-05 | — | 本方案独立走了一遍，结论部分重合但落后 |

**本方案等于把社区两周前已经走过的路重走了一遍，且没走完。**

---

## 五、社区方案还有本方案完全没有的机制

### 1. 精确的三道门认知

README 原文：

> `11128` 的三道门读的是**消息开头**、**会话 id 有没有**、**首条是不是 system**

本方案只有 PATCH5 补了 `X-Conversation-*`，对应第二道门；第一道门（消息开头）靠 PATCH1 碰巧覆盖；第三道门（首条是否 system）插件原生已处理。

### 2. 被拦后的最后兜底「继续」

> 被网关渠道校验拦截后的最后兜底「继续」（默认关闭，默认只发 1 次）

本方案无此机制，被拦即失败。

### 3. 明确的自我认知：这不是修复

README 里很克制地写着：

> **它不是 11128 的修复**：固定 system 指纹……

以及：

> 伪装成 CodeBuddy 客户端过渠道校验是**一条军备竞赛的路**，而且已经出现账号级限制（issue #98 的 code 11140）。

### 4. CLI 路线（主动退出对抗）

> 另有一条路不做这层伪装：让**本机已登录的 CodeBuddy CLI 自己跑任务**，由它去读文件、跑 git、改代码。打开 `cliBridge.enabled` 后插件多出 `codebuddy_ask` 工具和 `/codebuddy` 指令。

**这是釜底抽薪的方案**——不再伪装客户端，直接让官方 CLI 干活。本方案没有这个思路。

---

## 六、本方案还剩什么

只剩一条，且很薄：**改动面积极小（约 60 行补丁），不需要安装任何插件或依赖。**

但这条优势的实际意义有限，因为社区插件本身就是 `npm install` 一行的事：

```bash
# 社区方案
npm i dsh-connect-workbuddy

# 本方案
powershell -ExecutionPolicy Bypass -File patch-buddy-desense.ps1
```

**两者部署成本差不多。**

---

## 七、结论

> 本方案没有技术上的独到之处。社区 1180 star 的 `dsh-connect-workbuddy` 早已解决了同一问题，而且在机制理解（消息开头 / assistant 也查 / 零宽被规范化）、覆盖范围（Web GUI 段落）、工程完备度（CI / issue / npm / 版本演进）上全面领先。
>
> 本方案的价值仅在于：**记录了在一个特定插件（dsh-our-free-model）内部就地打补丁的具体位置**，以及一份独立复现的排查过程。对于使用 `dsh-our-free-model` 而不愿换插件的用户，这套补丁仍有实用价值。

### 建议

| 你的情况 | 建议 |
|---|---|
| 刚装 DSH，还没选插件 | **用 [dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)** |
| 已经在用 dsh-our-free-model，不想换 | 本补丁（临时方案） |
| 想要多账号池 + 面板 | [dsh-xdpool](https://github.com/XDTrees/dsh-xdpool) |
| 想彻底不做对抗 | 社区插件的 CLI 路线（`cliBridge.enabled`） |

---

## 八、致谢

本方案的排查思路与词表来源：

- [dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy) — 上游校验机制的权威描述（issue #163 / #167）、零宽失效结论、三道门认知
- [XDTrees/dsh-xdpool](https://github.com/XDTrees/dsh-xdpool) — 多账号池参考
- [ardeyouxipianyi/workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) — `TROUBLESHOOTING-11-128.md` 的排查顺序、提示词三模式、设备指纹派生
- [Hyact/workbuddy-switch-plus](https://github.com/Hyact/workbuddy-switch-plus) — 本方案 PATCH1 的词表来源（现已失效的零宽方案）

---

## 附：本方案的修正记录

本文档初版存在以下错误，已修正：

| 错误表述 | 修正 |
|---|---|
| "社区方案主要走 Python 网关形态" | 社区早有原生 DSH 插件，1180 star |
| "本方案主要贡献是证明词级脱敏无效" | 社区 2026-10-29 已确认零宽被规范化，本方案是重复发现 |
| "PATCH6 是核心修复" | **错。2×2 实测证明 PATCH1 与 PATCH6 缺一不可** |
| "PATCH1 才是真正起作用的"（中途修正） | **也不对。只删开头句仍然 BLOCK** |
| "触发点在 Tokens prefixed 段" | 只对一半：开头句与中段模板同时被检查 |
| "本方案是社区方案的子集" | 更准确说是"子集，且落后两周、覆盖不全" |
