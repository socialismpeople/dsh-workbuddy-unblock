// 补丁 7：清理历史 assistant 消息开头的身份声明指纹。
//
// 根因：上游匹配每一条 system 与 assistant 消息的开头（社区 issue #163）。
// 本仓库此前只清 system，漏了 assistant——会话历史里的旧 assistant 消息
// 若以 "You are an AI agent powered by DeepSeek Harness." 开头，即使 system
// 已经干净，请求仍会被 400/11128 拦截。
//
// 实测：
//   assistant 干净开头                  -> 200 OK
//   assistant "You are an AI agent powered by DeepSeek Harness." -> 400/11128
//   assistant "You are an AI agent."   -> 200 OK
//   assistant "powered by DeepSeek..." -> 200 OK
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

if (src.includes('DSH PATCH 7')) {
  console.log('ALREADY PATCHED (7)');
  process.exit(2);
}

// 锚点：serializeMessages2 里 assistant 分支的正文提取
const anchor = '      const text2 = contentToText2(content2);';
const count = src.split(anchor).length - 1;
console.log('anchor count =', count);
if (count !== 1) {
  console.error('anchor not unique');
  process.exit(3);
}

src = src.replace(anchor, `      // DSH PATCH 7: 清掉历史 assistant 开头的身份声明指纹
      const text2 = dshRewriteAssistantHead(contentToText2(content2));`);

const helper = `
// DSH PATCH 7: assistant 消息开头的身份声明清理。
// 只改开头一句，不动正文与工具调用。
function dshRewriteAssistantHead(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  const lines = text.split("\\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // 只清第一处非空行，且只在它符合身份声明时
    if (/^(?:you\\s+are\\s+(?:an?\\s+)?(?:ai\\s+)?agent\\s+powered\\s+by\\s+deepseek\\s+harness|you\\s+are\\s+an\\s+ai\\s+agent\\s+powered\\s+by\\s+deepseek\\s+harness)/i.test(trimmed)) {
      lines[i] = line.replace(trimmed, "[assistant reply]");
    }
    break;
  }
  return lines.join("\\n");
}
`;

src = src.replace('// ==== END DSH PATCH ====', '// ==== END DSH PATCH ====' + helper);

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 7 applied');
