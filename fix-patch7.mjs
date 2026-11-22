// 修正补丁7：只替换 assistant 开头的身份声明句，保留正文。
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

const oldFn = `function dshRewriteAssistantHead(text) {
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
}`;

const newFn = `function dshRewriteAssistantHead(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  // 上游只扫描消息开头：把开头的身份声明句换掉，正文原样保留。
  // 实测 "You are an AI agent powered by DeepSeek Harness." 触发 11128；
  // "You are an AI agent." 与 "powered by DeepSeek" 单独不触发。
  return text.replace(
    /^\\s*(?:you\\s+are\\s+an?\\s+(?:ai\\s+)?agent\\s+powered\\s+by\\s+deepseek\\s+harness\\.?\\s*)/i,
    "[assistant reply] "
  );
}`;

const count = src.split(oldFn).length - 1;
console.log('oldFn count =', count);
if (count !== 1) {
  console.error('oldFn not unique');
  process.exit(3);
}

src = src.replace(oldFn, newFn);
fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 7 fixed');
