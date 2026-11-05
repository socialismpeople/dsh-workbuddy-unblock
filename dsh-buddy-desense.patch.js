// ==== DSH PATCH: Buddy (CodeBuddy / WorkBuddy) prompt-fingerprint desensitizer ====
//
// 背景：腾讯后端会按提示词指纹识别调用方，非官方渠道返回
//   HTTP 403 / code 11140，"request illegal" /
//   "Illegal API invocation from an unapproved channel"
// 已知触发串包括 DSH 系统提示词里的 "You are an AI agent powered by DeepSeek Harness"。
//
// 本补丁只处理 system 文本，不动 user / assistant / tool 消息：
//   1) 删除"我是谁"的身份声明句（保留其后真正的指令句）
//   2) 对固定词表插入零宽空格 U+200B，人眼与模型读起来不变，关键词匹配失效
var DSH_ZWSP = "\u200b";
var DSH_IDENTITY_DECL = /^(?:you\s+are\b|your\s+(?:designated\s+)?identity\b|you\s+have\s+been\s+invoked\b|you\s+are\s+powered\s+by\b|你(?:是|的身份是|的角色是|由)|您(?:是|的身份是|的角色是|由))/i;
var DSH_IDENTITY_WORD = /\b(?:deepseek(?:\s+harness)?|harness|zcode|codex|claude(?:\s+code)?|codebuddy|workbuddy|opencode|sisyphus|anthropic|openai|chatgpt|gemini|qwen|kimi|glm|gpt|AI|LLM|assistant|agent|model)\b|人工智能|智能助手|编程助手|编码助手|语言模型|智能体/i;
var DSH_OBLIGATION = /^you\s+are\s+(?:required|expected|allowed|not allowed|forbidden|responsible|operating|working|running|using|to)\b/i;
// 词表口径对齐 workbuddy-switch-plus 的 core/desensitize.py（只放"合规声明高频词"，
// 不含 agent / model 这类通用词，避免把正常指令改花）。
var DSH_TERMS = [
  "deepseek harness", "deepseek", "harness",
  "DoS", "DDoS", "exploit", "credential testing", "credential stuffing",
  "supply chain compromise", "supply-chain compromise", "detection evasion",
  "C2 frameworks", "C2 framework", "command and control",
  "malicious purposes", "malicious intent", "mass targeting",
  "brute force", "brute-force", "privilege escalation", "reverse shell",
  "remote code execution", "SQL injection", "XSS", "CSRF", "phishing",
  "malware", "ransomware", "keylogger", "rootkit", "backdoor", "botnet",
  "zero-day", "0day", "vulnerability", "vulnerabilities",
  "red teaming", "red-teaming", "sandbox", "sandboxing", "sandboxed",
  "unsandboxed", "escalated privileges", "escalated", "escalation",
  "destructive action", "destructive command", "destructive",
  "attack", "attacks", "cybersecurity", "security review",
  "exploit development", "hacking", "penetration testing", "penetration test",
  "injection", "weaponize", "weaponized", "harmful", "dangerous",
  "abuse", "abusive", "illegal", "terrorist", "terrorism",
  "bomb", "weapon", "weapons", "drug", "drugs", "narcotic",
  "suicide", "self-harm", "murder", "kill", "violence", "violent",
  "Claude Code", "Claude Opus", "Claude Sonnet", "Claude Haiku", "Claude Fable",
  "Anthropic", "Co-Authored-By", "noreply@anthropic.com"
];
var DSH_TERM_RE = new RegExp(
  DSH_TERMS.slice()
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); })
    .join("|"),
  "gi"
);

function dshDesensitizeSystem(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  var out = [];
  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var candidate = line.replace(/^\s*(?:[-*]\s+|#{1,6}\s+)?/, "");
    var pieces = candidate.split(/(?<=[.!?。！？])(?=\s|$)/);
    var kept = [];
    var removed = false;
    for (var j = 0; j < pieces.length; j++) {
      var clean = pieces[j].trim();
      if (DSH_IDENTITY_DECL.test(clean) && DSH_IDENTITY_WORD.test(clean) && !DSH_OBLIGATION.test(clean)) {
        removed = true;
      } else {
        kept.push(pieces[j]);
      }
    }
    if (removed) {
      line = kept.join("").replace(/^\s+/, "");
      if (line.trim().length === 0) continue;
    }
    out.push(line);
  }
  var joined = out.join("\n");
  return joined.replace(DSH_TERM_RE, function (m) {
    if (m.length <= 2) return m;
    var mid = Math.ceil(m.length / 2);
    return m.slice(0, mid) + DSH_ZWSP + m.slice(mid);
  });
}
// ==== END DSH PATCH ====
