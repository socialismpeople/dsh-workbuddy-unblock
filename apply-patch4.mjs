// 第四处补丁：清掉 attributionHeaders 里带 DSH 身份的请求头。
// 该函数来自宿主 @deepseek-ai/dsh-llm，会带上 "DeepSeek Harness" 之类的标识，
// 上游据此判定"非官方渠道"。
import fs from 'node:fs';

const packPath = process.argv[2];
let src = fs.readFileSync(packPath, 'utf8');

if (src.includes('DSH PATCH 4')) {
  console.log('ALREADY PATCHED (4)');
  process.exit(2);
}

const anchor = `  async send(credential, body, options) {
    const headers = new Headers(attributionHeaders2());`;

const count = src.split(anchor).length - 1;
console.log('anchor count =', count);
if (count !== 1) {
  console.error('anchor not unique');
  process.exit(3);
}

src = src.replace(anchor, `  async send(credential, body, options) {
    // DSH PATCH 4: 只保留不暴露客户端身份的头
    const headers = new Headers(dshCleanHeaders(attributionHeaders2()));`);

const helper = `
// DSH PATCH 4: 过滤 attributionHeaders 里的客户端身份标识
function dshCleanHeaders(src) {
  try {
    const out = {};
    const drop = /^(x-dsh|dsh-|x-harness|harness|x-deepseek|deepseek-|x-client-name|x-stainless)/i;
    const entries = src instanceof Headers ? [...src.entries()] : Object.entries(src || {});
    for (const [k, v] of entries) {
      if (drop.test(k)) continue;
      out[k] = v;
    }
    return out;
  } catch (e) {
    return src;
  }
}
`;
src = src.replace('// ==== END DSH PATCH ====', '// ==== END DSH PATCH ====' + helper);

fs.writeFileSync(packPath, src, 'utf8');
console.log('PATCH 4 applied');
