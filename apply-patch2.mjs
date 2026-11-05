// 第二处补丁：serializeMessages2 里 system 角色的透传路径也要脱敏。
// 第一处补丁只处理了 options.system，但 DSH 可能把系统提示词放在 messages 里。
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

if (src.includes('DSH PATCH 2')) {
  console.log('ALREADY PATCHED (2)');
  process.exit(2);
}

const anchor = `    if (message2.role === "system") {
      flushToolImages();
      wire.push({ role: "system", content: contentToText2(message2.content) });
      continue;
    }`;
const count = src.split(anchor).length - 1;
if (count !== 1) {
  console.error(`anchor count = ${count}, expected 1`);
  process.exit(3);
}

src = src.replace(anchor, `    if (message2.role === "system") {
      // DSH PATCH 2: system 走 messages 时同样脱敏
      flushToolImages();
      wire.push({ role: "system", content: dshDesensitizeSystem(contentToText2(message2.content)) });
      continue;
    }`);

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 2 applied');
