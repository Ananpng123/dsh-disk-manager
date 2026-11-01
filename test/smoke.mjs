// 冒烟自检：不启动 DSH，直接调宿主侧 handlers。
//   node test/smoke.mjs
// 覆盖：卷枚举 / 目录列举 / 目录大小 / 新建与重名文案 / 文件信息 / 空路径拦截。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handlers } from '../index.js';

const results = [];
const t0 = Date.now();

async function step(label, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ label, ok: true, ms: Date.now() - started });
  } catch (error) {
    results.push({ label, ok: false, ms: Date.now() - started, error: String(error?.message || error) });
  }
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disk-smoke-'));
const sandbox = path.join(scratch, 'sandbox');
fs.mkdirSync(sandbox);
fs.writeFileSync(path.join(sandbox, 'note.txt'), 'hello', 'utf8');
fs.mkdirSync(path.join(sandbox, 'folder'));
fs.writeFileSync(path.join(sandbox, 'folder', 'inner.txt'), 'x'.repeat(2048), 'utf8');

await step('volumes 至少返回一个卷', async () => {
  const { volumes } = await handlers.volumes();
  assert.ok(Array.isArray(volumes) && volumes.length > 0, '没有拿到任何卷');
  for (const item of volumes) {
    assert.match(item.mount ?? item.root ?? '', /^[A-Za-z]:\\$/, `卷挂载点格式异常: ${item.root}`);
    assert.ok(item.total > 0, `卷 ${item.root} 总量为 0`);
  }
});

await step('ls 能列出沙箱目录', async () => {
  const listing = await handlers.ls({ path: sandbox });
  assert.equal(listing.entries.length, 2);
  assert.deepEqual(listing.entries.map((e) => e.name).sort(), ['folder', 'note.txt']);
  assert.equal(listing.entries.find((e) => e.name === 'folder').isDir, true);
  assert.equal(listing.entries.find((e) => e.name === 'note.txt').size, 5);
  assert.equal(listing.truncated, false);
});

await step('size 统计目录字节数', async () => {
  const size = await handlers.size({ path: path.join(sandbox, 'folder'), deadlineMs: 5000 });
  assert.equal(size.files, 1);
  assert.equal(size.bytes, 2048);
  assert.equal(size.done, true);
});

await step('mkdir 正常创建', async () => {
  const created = await handlers.mkdir({ parent: sandbox, name: '新文件夹' });
  assert.ok(fs.existsSync(created.path));
});

await step('mkdir 重名给出人话而不是 ENOENT', async () => {
  let message = '';
  try {
    await handlers.mkdir({ parent: sandbox, name: '新文件夹' });
  } catch (error) {
    message = String(error?.message || error);
  }
  assert.match(message, /已经有同名文件夹/, `错误文案没翻译: ${message || '(没有报错)'}`);
  assert.doesNotMatch(message, /ENOENT/);
});

await step('info 读取文件属性', async () => {
  const info = await handlers.info({ path: path.join(sandbox, 'note.txt') });
  assert.equal(info.size, 5);
  assert.equal(info.isDir, false);
  assert.ok(info.mtime > 0);
});

await step('空路径被 requirePath 拦住', async () => {
  let message = '';
  try {
    handlers.open({ path: '   ' });
  } catch (error) {
    message = String(error?.message || error);
  }
  assert.match(message, /path is required/, `空路径没拦住: ${message || '(没有报错)'}`);
});

fs.rmSync(scratch, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
const total = Date.now() - t0;
const pad = Math.max(...results.map((r) => r.label.length));
for (const item of results) {
  const mark = item.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${item.label.padEnd(pad)}  ${String(item.ms).padStart(5)}ms${item.ok ? '' : `  ← ${item.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 通过，总计 ${total}ms`);

if (failed.length > 0) process.exitCode = 1;
