// 补丁 8：强化诊断 —— 记录每条消息的开头，定位到底是哪一条触发 11128。
// 只写摘要（角色 + 开头 200 字符），不写全文，避免泄露对话内容。
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

if (src.includes('DSH PATCH 8')) {
  console.log('ALREADY PATCHED (8)');
  process.exit(2);
}

// 在诊断 JSON 里增加 messages 摘要
const oldDiag = `        totalMessages: messages.length,
        firstRoles: messages.slice(0, 4).map(m => m.role)`;
const newDiag = `        totalMessages: messages.length,
        firstRoles: messages.slice(0, 4).map(m => m.role),
        // DSH PATCH 8: 每条消息的开头摘要，用于定位被拦的消息
        messageHeads: messages.map((m, idx) => ({
          i: idx,
          role: m.role,
          head: typeof m.content === "string" ? m.content.slice(0, 200) : JSON.stringify(m.content).slice(0, 200)
        })).filter(x => x.i < 5 || x.i >= messages.length - 5)`;

const count = src.split(oldDiag).length - 1;
console.log('diag anchor count =', count);
if (count !== 1) {
  console.error('diag anchor not unique');
  process.exit(3);
}
src = src.replace(oldDiag, newDiag);
src = src.replace('// ==== END DSH PATCH ====', '// ==== END DSH PATCH ====\n// DSH PATCH 8');

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 8 applied');
