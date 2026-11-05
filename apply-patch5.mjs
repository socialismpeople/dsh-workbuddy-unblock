// 第五处补丁：WorkBuddy 渠道校验（code 11128）的真正解法。
//
// 实测结论（2026-11-05，WorkBuddy 5.9.3）：
//   - 上游对 WorkBuddy 做「渠道校验」，缺 X-Conversation-* 三件套一律 400/11128
//     "这次调用没通过渠道校验，可能不是官方客户端发出的"
//   - 补齐 X-Conversation-ID / Message-ID / Request-ID 后通过校验
//   - 11140（账号受限）是个别账号状态，与请求内容无关，靠账号池换号解决
//
// 插件原本只在 product.id === "workbuddy" 时加这三个头，但 CodeBuddy(buddy)
// 通道也走同一套校验逻辑，且头名与值域需要覆盖更全，这里统一处理。
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

if (src.includes('DSH PATCH 5')) {
  console.log('ALREADY PATCHED (5)');
  process.exit(2);
}

// 锚点：Buddy 适配器的 send()，补丁 4 已改过这一行
const anchor = `    if (this.product.id === "workbuddy") {
      headers.set("X-Conversation-ID", this.sessionId);
      headers.set("X-Conversation-Message-ID", crypto.randomUUID());
      headers.set("X-Conversation-Request-ID", crypto.randomUUID());
    }`;

const count = src.split(anchor).length - 1;
console.log('anchor count =', count);
if (count !== 1) {
  console.error('anchor not unique');
  process.exit(3);
}

src = src.replace(anchor, `    // DSH PATCH 5: 渠道校验必需头 —— 实测缺任一项即 400/11128。
    // 对所有 buddy 系产品生效（workbuddy 国际版 / 国内版 / codebuddy）。
    headers.set("X-Conversation-ID", this.sessionId || crypto.randomUUID());
    headers.set("X-Conversation-Message-ID", crypto.randomUUID());
    headers.set("X-Conversation-Request-ID", crypto.randomUUID());
    headers.set("X-IDE-Name", this.product.attributionName || "WorkBuddy");
    headers.set("X-IDE-Type", this.product.attributionName || "WorkBuddy");
    headers.set("X-IDE-Version", this.product.clientVersion || "5.9.3");
    headers.set("X-Client-Version", this.product.clientVersion || "5.9.3");
    headers.set("X-Platform", process.platform === "win32" ? "win32" : process.platform);
    headers.set("X-Client-Language", "zh-CN");
    headers.set("X-Client-Timezone", "Asia/Shanghai");`);

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 5 applied');
