#!/usr/bin/env node
/**
 * 发布泄漏扫描：公开产物（整个插件目录）里不允许出现本机的任何身份与路径数据。
 *
 * 检查四类：
 *   1. 本机 Windows 用户名（按词边界匹配，避免把含该子串的公开账号名误判）
 *   2. 本机用户主目录绝对路径
 *   3. 任何「盘符 + 路径段」的绝对路径（URL 协议里的冒号不算）
 *   4. 当前工作区的绝对路径
 *
 * 命中时不打印命中内容本身——打印出来就等于把数据又写了一遍。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const workspace = resolve(root, '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '_local-archive', '.dsh-cache']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.svg', '.txt', '.html', '.css']);

const rules = [];
const username = (() => {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
})();

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

if (username.length >= 3) {
  const namePattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(username)}(?![A-Za-z0-9])`, 'iu');
  rules.push({ id: '本机用户名', test: (line) => namePattern.test(line) });
}

const home = (() => {
  try {
    return os.homedir();
  } catch {
    return '';
  }
})();
if (home.length >= 5) {
  rules.push({ id: '用户主目录路径', test: (line) => line.toLowerCase().includes(home.toLowerCase()) });
}

rules.push({
  id: '盘符绝对路径',
  test: (line) => /(?<![A-Za-z])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_\u4e00-\u9fa5~]/.test(line),
});

if (workspace.length >= 5 && workspace !== root) {
  rules.push({
    id: '工作区绝对路径',
    test: (line) => line.toLowerCase().includes(workspace.toLowerCase()) || line.includes(workspace.split(sep).join('/')),
  });
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      files.push(...walk(full));
      continue;
    }
    if (TEXT_EXT.has(extname(name).toLowerCase())) files.push(full);
  }
  return files;
}

const files = walk(root);
const hits = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  lines.forEach((line, position) => {
    for (const rule of rules) {
      if (!rule.test(line)) continue;
      hits.push({ file: relative(root, file), line: position + 1, rule: rule.id });
      break;
    }
  });
}

console.log(`[leaks] 扫描 ${files.length} 个文件 · ${rules.length} 条规则`);

if (hits.length === 0) {
  console.log('[leaks] 通过：没有本机数据');
  process.exit(0);
}

for (const hit of hits) {
  console.error(`[leaks] ${hit.file}:${hit.line} 命中「${hit.rule}」`);
}
console.error(`[leaks] 共 ${hits.length} 处，逐条人工确认后清理，再重跑`);
process.exit(1);
