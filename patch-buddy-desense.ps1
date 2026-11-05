# 给 dsh-our-free-model 的 channel-pack 打 Buddy/workbuddy 通道修复补丁
#
# 修复：400/11128「请求被拦截」、403/11140「账号被限制」
# 插件升级会覆盖 pack.js，升级后重跑本脚本即可。
#
# 用法：
#   .\patch-buddy-desense.ps1              # 打补丁
#   .\patch-buddy-desense.ps1 -Status      # 查看状态
#   .\patch-buddy-desense.ps1 -Revert      # 回滚到最近备份
#   .\patch-buddy-desense.ps1 -PackPath "路径\pack.js"   # 手动指定

param(
    [switch]$Revert,
    [switch]$Status,
    [string]$PackPath
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

# ---- 定位 pack.js ----
function Find-Pack {
    param([string]$Hint)

    if ($Hint) {
        if (Test-Path $Hint) { return (Resolve-Path $Hint).Path }
        throw "指定的 pack.js 不存在: $Hint"
    }

    $candidates = @()

    # 1) 环境变量
    foreach ($envName in 'DSH_HOME', 'DSH_PROFILE_DIR') {
        $v = [Environment]::GetEnvironmentVariable($envName)
        if (-not $v) { continue }
        if ($envName -eq 'DSH_HOME') {
            $candidates += Join-Path $v 'profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js'
        } else {
            $candidates += Join-Path $v 'node_modules\dsh-our-free-model\vendor\channel-pack\pack.js'
        }
    }

    # 2) 常见安装位置
    $candidates += "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js"
    $candidates += "$env:APPDATA\dsh\profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js"
    $candidates += "$env:LOCALAPPDATA\dsh\profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js"

    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
    }

    # 3) 全盘搜（限深度，兜底）
    Write-Host "常规位置未找到，正在搜索..." -ForegroundColor Yellow
    $roots = @($env:USERPROFILE, 'C:\', 'D:\', 'E:\') | Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        try {
            $hit = Get-ChildItem -Path $root -Filter 'pack.js' -Recurse -Depth 8 -ErrorAction SilentlyContinue |
                   Where-Object { $_.FullName -match 'dsh-our-free-model.*channel-pack' } |
                   Select-Object -First 1
            if ($hit) { return $hit.FullName }
        } catch { }
    }

    throw @"
找不到 pack.js。请用 -PackPath 手动指定，例如：
  .\patch-buddy-desense.ps1 -PackPath "C:\Users\你\.dsh\profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js"

可以先在 DSH 数据目录里找：
  Get-ChildItem -Path `$env:USERPROFILE -Filter pack.js -Recurse -ErrorAction SilentlyContinue |
    Where-Object { `$_.FullName -match 'dsh-our-free-model' }
"@
}

$pack = Find-Pack -Hint $PackPath
$packDir = Split-Path $pack -Parent
Write-Host "目标: $pack" -ForegroundColor Cyan

# ---- Status ----
if ($Status) {
    $t = [System.IO.File]::ReadAllText($pack)
    $patches = @(
        @{ Name = 'PATCH1 (options.system 脱敏)'; Key = 'DSH PATCH: Buddy' },
        @{ Name = 'PATCH2 (messages 内 system) '; Key = 'DSH PATCH 2' },
        @{ Name = 'PATCH3 (诊断落盘)           '; Key = 'DSH PATCH 3' },
        @{ Name = 'PATCH4 (清身份请求头)       '; Key = 'DSH PATCH 4' },
        @{ Name = 'PATCH5 (渠道校验必需头)     '; Key = 'DSH PATCH 5' },
        @{ Name = 'PATCH6 (模板指纹改写)       '; Key = 'DSH PATCH 6' }
    )
    foreach ($p in $patches) {
        $state = if ($t.Contains($p.Key)) { '已打' } else { '未打' }
        $color = if ($t.Contains($p.Key)) { 'Green' } else { 'DarkGray' }
        Write-Host ("{0} : {1}" -f $p.Name, $state) -ForegroundColor $color
    }
    Write-Host "文件大小: $((Get-Item $pack).Length) bytes"
    exit 0
}

# ---- Revert ----
if ($Revert) {
    $bak = Get-ChildItem $packDir -Filter 'pack.js.bak-*' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $bak) { throw "找不到备份文件（pack.js.bak-*）" }
    Copy-Item $bak.FullName $pack -Force
    node --check $pack
    if ($LASTEXITCODE -ne 0) { throw "回滚后的文件语法有问题，请检查备份" }
    Write-Host "已回滚 <- $($bak.Name)" -ForegroundColor Green
    Write-Host "需要重启 DSH 才会生效"
    exit 0
}

# ---- Apply ----
$bakPath = "$pack.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $pack $bakPath -Force
Write-Host "备份 -> $(Split-Path $bakPath -Leaf)" -ForegroundColor DarkGray

$appliers = @(
    'apply-patch.mjs',
    'apply-patch2.mjs',
    'apply-patch3.mjs',
    'apply-patch4.mjs',
    'apply-patch5.mjs',
    'apply-patch6.mjs'
)

foreach ($a in $appliers) {
    $f = Join-Path $here $a
    if (-not (Test-Path $f)) { Write-Host "跳过缺失的 $a" -ForegroundColor Yellow; continue }
    Write-Host "应用 $a ..." -NoNewline
    $out = & node $f $pack 2>&1
    if ($LASTEXITCODE -eq 2) {
        Write-Host " 已打过，跳过" -ForegroundColor DarkGray
    } elseif ($LASTEXITCODE -ne 0) {
        Write-Host " 失败" -ForegroundColor Red
        Write-Host ($out | Out-String)
        Copy-Item $bakPath $pack -Force
        throw "$a 失败 (exit $LASTEXITCODE)，已回滚"
    } else {
        Write-Host " OK" -ForegroundColor Green
    }
}

Write-Host "语法检查 ..." -NoNewline
node --check $pack
if ($LASTEXITCODE -ne 0) {
    Copy-Item $bakPath $pack -Force
    Write-Host " 失败，已回滚" -ForegroundColor Red
    throw "pack.js 语法检查失败，已回滚"
}
Write-Host " OK" -ForegroundColor Green

Write-Host ""
Write-Host "全部补丁已应用。" -ForegroundColor Green
Write-Host "下一步：重启 DSH（pack.js 是启动时加载的 ESM，热重载不会重新求值）"
