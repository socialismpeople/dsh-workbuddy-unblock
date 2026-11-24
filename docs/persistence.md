# 补丁丢失的根因与持久化方案

## 现象

给 `dsh-our-free-model` 的 `pack.js` 手工打完补丁后，用几天突然失效。检查发现 `pack.js` 恢复到原始版本，所有 `DSH PATCH` 标记消失。

这种事发生了两次：

| 时间 | 触发事件 | 证据 |
|---|---|---|
| 2026-11-22 20:07 | 安装 `ds-harness-remote` 插件 | `client.js` / `pack.js` mtime 与插件安装时间一致 |
| 2026-11-24 11:11 | 安装 `dsh-guizang-design` 插件 | 安装开始 11:11:41，pack.js mtime 11:11:47（相差 6 秒） |

## 根本原因

**在 DSH 的插件市场安装任何插件时，pnpm 会重新执行 install，重新物化（relink）整个 `node_modules`。** 手工修改的 `pack.js` 不在 pnpm 的依赖清单里，被当作脏文件覆盖成原始 tarball 内容。

关键点：

- 我们改的是 `profiles/desktop/node_modules/dsh-our-free-model/vendor/channel-pack/pack.js`
- 这个文件不是 DSH 直接读取的用户配置，而是 **pnpm 管理的依赖内容**
- pnpm install 不认识"手工改过"这件事，每次都从 store 重新链接
- 所以**任何一次插件安装/更新都会清掉我们的补丁**

这不是 DSH 的 bug，也不是插件自动更新——是 pnpm 的正常行为。

## 持久化方案：pnpm patchedDependencies

pnpm 原生支持把依赖补丁持久化：补丁存成 patch 文件，配置到 workspace，install 时自动应用。

### 一次性设置（做完以后都不用管）

**1) 先按常规方法打好补丁**

```powershell
powershell -ExecutionPolicy Bypass -File .\patch-buddy-desense.ps1 -PackPath "<pack.js 路径>"
```

**2) 创建 pnpm patch 工作目录**

在 DSH profile 目录下执行：

```powershell
$node  = "E:\DSH-HOME\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe"
$pnpm  = "E:\DSH-HOME\dsh-runtimes\dsh-next-primary-runtime\dependencies\pnpm\dist\pnpm.mjs"
Push-Location "C:\Users\<你>\.dsh\profiles\desktop"
node $pnpm patch dsh-our-free-model
Pop-Location
```

输出会给出一个临时目录，通常是：

```
node_modules\.pnpm_patches\dsh-our-free-model
```

**3) 把打过补丁的 pack.js 复制到 patch 工作目录**

```powershell
Copy-Item `
  "node_modules\dsh-our-free-model\vendor\channel-pack\pack.js" `
  "node_modules\.pnpm_patches\dsh-our-free-model\vendor\channel-pack\pack.js" -Force
```

**4) 生成 patch 文件并提交**

```powershell
Push-Location "C:\Users\<你>\.dsh\profiles\desktop"
node $pnpm patch-commit "node_modules\.pnpm_patches\dsh-our-free-model"
Pop-Location
```

会在 `patches/` 下生成 `dsh-our-free-model@2.5.6.patch`。

> 如果 `patch-commit` 报 `EPERM`（DSH 正在运行锁着配置文件），不用紧张——**patch 文件已经生成**，只是写配置失败。手动做第 5 步即可。

**5) 手动写入配置（重要）**

pnpm 11 **不再读 `package.json` 的 `pnpm.patchedDependencies`**，必须写 `pnpm-workspace.yaml`：

```yaml
patchedDependencies:
  dsh-our-free-model@2.5.6: patches/dsh-our-free-model@2.5.6.patch
```

为了兼容旧版 pnpm，也可以同时在 `package.json` 里保留：

```json
"pnpm": {
  "patchedDependencies": {
    "dsh-our-free-model@2.5.6": "patches/dsh-our-free-model@2.5.6.patch"
  }
}
```

**6) 重启 DSH**

ESM 模块在进程启动时加载，补丁必须重启才生效。

## 验证持久化是否生效

```powershell
# 查看 patch 文件是否含全部 8 个补丁
$c = Get-Content "patches\dsh-our-free-model@2.5.6.patch" -Raw
for($i=1;$i -le 8;$i++){
  $k = if($i -eq 1){'DSH PATCH: Buddy'}else{"DSH PATCH $i"}
  Write-Output "PATCH$i : $($c.Contains($k))"
}
```

然后正常在插件市场安装/卸载任意插件。`pnpm install` 会自动把 patch 应用到 `node_modules` 里的 `dsh-our-free-model`。

## 当前机器上已完成的持久化

| 项 | 路径 |
|---|---|
| patch 文件 | `C:\Users\lenovo\.dsh\profiles\desktop\patches\dsh-our-free-model@2.5.6.patch` |
| pnpm 11 配置 | `C:\Users\lenovo\.dsh\profiles\desktop\pnpm-workspace.yaml` |
| 兼容配置 | `C:\Users\lenovo\.dsh\profiles\desktop\package.json` |
| 当前 pack.js | 8 个补丁全部在位（2026-11-24 11:51 重新打上） |

## 注意事项

1. **插件升级后 patch 需要重做**。如果 `dsh-our-free-model` 版本从 2.5.6 升到 2.9.0，patch key 也要换成 `dsh-our-free-model@2.9.0`，并重新生成 patch 文件。
2. **NEXT 版（`E:\DSH-HOME`）目前只有直接文件补丁，没有做 pnpm patch 持久化**。如果那个版本也经常装插件，需要同样做一遍。
3. 这不是最理想的方案——最理想的是直接换成社区原生插件（如 `dsh-connect-workbuddy`），它们通过 npm 正常发布，不存在"改 node_modules 被覆盖"的问题。

## 附：为什么不用监控脚本

也考虑过写一个后台脚本，检测 pack.js 被还原就重新打补丁。但这样需要常驻进程、处理 DSH 安装时的竞态、还要防止重复打补丁，复杂度和不确定性都比 pnpm 原生 patch 高。pnpm 的 `patchedDependencies` 就是为这种场景设计的，用它最稳。
