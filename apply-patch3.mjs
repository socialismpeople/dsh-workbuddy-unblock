// 补丁 3：诊断落盘 —— 记录实际发出的 system 内容，用于排查。
// 路径自动定位到 DSH_HOME 下的 logs/，找不到就退回系统临时目录。
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

if (src.includes('DSH PATCH 3')) {
  console.log('ALREADY PATCHED (3)');
  process.exit(2);
}

const anchor = `    const messages = serializeMessages2(options.messages, imageUrls);
    if (options.system !== void 0 && options.system.length > 0) {
      messages.unshift({ role: "system", content: dshDesensitizeSystem(options.system) });
    }`;

const count = src.split(anchor).length - 1;
console.log('anchor count =', count);
if (count !== 1) {
  console.error('anchor not unique');
  process.exit(3);
}

const dump = `    // DSH PATCH 3: 诊断——记录实际发出的 system 内容
    try {
      const sysMsgs = messages.filter(m => m.role === "system");
      dshWriteDiag(JSON.stringify({
        at: new Date().toISOString(),
        product: this.product.id,
        model: options.model,
        hadOptionsSystem: typeof options.system === "string" && options.system.length > 0,
        systemCount: sysMsgs.length,
        systems: sysMsgs.map(m => typeof m.content === "string" ? m.content.slice(0, 2000) : JSON.stringify(m.content).slice(0, 2000)),
        totalMessages: messages.length,
        firstRoles: messages.slice(0, 4).map(m => m.role)
      }, null, 2));
    } catch (e) {}
`;

src = src.replace(anchor, anchor + dump);

const helper = `
// DSH PATCH 3: 诊断落盘。路径优先 DSH_HOME/logs，退回系统临时目录。
function dshWriteDiag(text) {
  try {
    var fsm = __require("node:fs");
    var osm = __require("node:os");
    var pm = __require("node:path");
    var home = process.env.DSH_HOME || process.env.DSH_PROFILE_DIR || "";
    var dir = home ? pm.join(home, "logs") : osm.tmpdir();
    try { fsm.mkdirSync(dir, { recursive: true }); } catch (e) {}
    fsm.appendFileSync(pm.join(dir, "buddy-payload-diag.jsonl"), text + "\\n");
  } catch (e) {}
}
`;
src = src.replace('// ==== END DSH PATCH ====', '// ==== END DSH PATCH ====' + helper);

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 3 applied (diagnostic, auto-path)');
