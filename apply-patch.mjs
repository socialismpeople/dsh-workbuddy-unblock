// 把脱敏补丁写进 dsh-our-free-model 的 channel-pack，只改 Buddy 适配器。
// 用法: node apply-patch.mjs <pack.js> <patch.js>
import fs from 'node:fs';

const [, , packPath, patchPath] = process.argv;
if (!packPath || !patchPath) {
  console.error('usage: node apply-patch.mjs <pack.js> <patch.js>');
  process.exit(1);
}

let src = fs.readFileSync(packPath, 'utf8');
const patch = fs.readFileSync(patchPath, 'utf8');

if (src.includes('DSH PATCH: Buddy')) {
  console.log('ALREADY PATCHED — aborting');
  process.exit(2);
}

// --- 1) 注入函数定义（挂在 BUDDY_POLICY_BLOCK_COOLDOWN_MS 之前，该锚点全文件唯一）
const anchorA = 'var BUDDY_POLICY_BLOCK_COOLDOWN_MS = 30 * 6e4;';
const countA = src.split(anchorA).length - 1;
if (countA !== 1) {
  console.error(`anchor A count = ${countA}, expected 1`);
  process.exit(3);
}
src = src.replace(anchorA, patch + '\n' + anchorA);

// --- 2) 在 Buddy 适配器里调用（serializeMessages2 是 Buddy 专用，全文件唯一）
const anchorB = `const messages = serializeMessages2(options.messages, imageUrls);
    if (options.system !== void 0 && options.system.length > 0) {
      messages.unshift({ role: "system", content: options.system });
    }`;
const countB = src.split(anchorB).length - 1;
if (countB !== 1) {
  console.error(`anchor B count = ${countB}, expected 1`);
  process.exit(4);
}
src = src.replace(
  anchorB,
  `const messages = serializeMessages2(options.messages, imageUrls);
    if (options.system !== void 0 && options.system.length > 0) {
      messages.unshift({ role: "system", content: dshDesensitizeSystem(options.system) });
    }`
);

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCHED ok');
console.log('new size =', src.length);
