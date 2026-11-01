#!/usr/bin/env node
/**
 * 市场索引校验：读 index.json，用 DSH 宿主自带的 parseMarketIndex 跑一遍格式 1 校验，
 * 再跨文件比对 package.json，确认版本、包名、engines 与图标都对得上。
 *
 * 校验器位置按顺序探测，可用环境变量覆盖：
 *   DSH_MARKET_INDEX_MODULE=<lib/index.js 的绝对路径>
 *   DSH_RESOURCES=<DSH 安装目录里的 resources 目录>
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const MODULE_REL = 'app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js';
const INDEX_URL = process.env.DSH_MARKET_INDEX_URL ?? 'https://ananpng123.github.io/dsh-disk-manager/index.json';

function locateValidator() {
  const candidates = [];
  if (process.env.DSH_MARKET_INDEX_MODULE) candidates.push(process.env.DSH_MARKET_INDEX_MODULE);
  if (process.env.DSH_RESOURCES) candidates.push(join(process.env.DSH_RESOURCES, MODULE_REL));
  for (const start of [root, process.cwd(), dirname(process.execPath)]) {
    let dir = start;
    for (let depth = 0; depth < 8; depth += 1) {
      candidates.push(join(dir, 'resources', MODULE_REL));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find((path) => existsSync(path));
}

const found = locateValidator();
if (found === undefined) {
  console.error('[market] 找不到 DSH 的 dsh-plugin-market-index 校验器。');
  console.error('[market] 用环境变量指定其一后重跑：');
  console.error('[market]   DSH_MARKET_INDEX_MODULE=<...>/dsh-plugin-market-index/lib/index.js');
  console.error('[market]   DSH_RESOURCES=<DSH 安装目录>/resources');
  process.exit(2);
}

const { parseMarketIndex, marketInstallTarget } = await import(pathToFileURL(found).href);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const document = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));

const STRICT = process.argv.includes('--strict');
const failures = [];
const warnings = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

let index;
try {
  index = parseMarketIndex(document, INDEX_URL);
} catch (error) {
  console.error(`[market] 格式校验失败：${error.name}: ${error.message}`);
  if (error.path) console.error(`[market] 出错位置：${error.path}`);
  process.exit(1);
}

const entry = index.plugins.find((plugin) => plugin.name === manifest.name);
check(entry !== undefined, `索引里没有 package.json 声明的包名 ${manifest.name}`);
check(index.plugins.length === 1, `索引里有 ${index.plugins.length} 个插件，本项目只应发布 1 个`);

if (entry !== undefined) {
  const newest = entry.versions[0];
  check(
    entry.versions.some((version) => version.version === manifest.version),
    `索引版本里没有 package.json 的版本 ${manifest.version}（索引里有 ${entry.versions.map((v) => v.version).join(', ')}）`,
  );
  check(
    entry.versions[0].version === manifest.version,
    `索引最新版本 ${entry.versions[0].version} 与 package.json 的 ${manifest.version} 不一致`,
  );
  check(newest.engines.dsh === manifest.engines.dsh, `engines.dsh 不一致：索引 ${newest.engines.dsh} / package.json ${manifest.engines.dsh}`);
  check(entry.icon !== undefined, '没有图标');
  if (entry.icon !== undefined && !entry.icon.startsWith('data:') && !entry.icon.startsWith('http')) {
    check(existsSync(join(root, entry.icon)), `图标指向 ${entry.icon}，但仓库里没有这个文件`);
    check(/\.(png|svg|jpe?g|webp)$/iu.test(entry.icon), `图标扩展名不认识：${entry.icon}`);
  }
  check(
    entry.metadata.keywords.length > 0,
    '没有 keywords，市场里按关键词搜不到这个插件',
  );
  check(newest.source.type === 'git', `发布走 git，但 source.type 是 ${newest.source.type}`);
  if (newest.source.type === 'git' && newest.source.commit === '0'.repeat(40)) {
    const message = 'source.commit 还是占位全 0——发布前必须换成真实的 40 位 commit SHA，否则装不上';
    if (STRICT) failures.push(message);
    else warnings.push(message);
  }
  const target = marketInstallTarget(entry.name, newest);
  console.log(`[market] 安装参数：${target.spec}`);
}

console.log(
  `[market] 校验器 ${found}\n` +
    `[market] 索引 ${INDEX_URL}\n` +
    `[market] 插件 ${entry?.name ?? '?'} · ${entry?.versions.length ?? 0} 个版本 · 分类 ${entry?.metadata.category ?? '无'} · 标签 ${entry?.metadata.labels.join('/') || '无'}`,
);

for (const warning of warnings) console.warn(`[market] WARN ${warning}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`[market] FAIL ${failure}`);
  process.exit(1);
}
console.log(`[market] 通过${STRICT ? '（严格模式）' : ''}`);
