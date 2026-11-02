/**
 * dsh-disk-manager — host half.
 *
 * 只读：列卷、列目录、按需统计目录大小。不删除、不改分区、不挂载。
 *
 * 为什么要有：右侧栏现在只有文件树/终端/预览三个 tab，没有一个地方能一眼看到
 * 「哪个盘还剩多少」。这个插件把 Windows「磁盘管理」的上半段（卷与容量）搬到右栏，
 * 下半段（分区操作）故意不做 —— 那需要管理员权限，且一次误操作就是丢盘。
 *
 * 路由：`connection.fetch.register({ path: '/api/dsh-disk' })`，与 dsh-im-ui 同款。
 * 请求体 `{ endpoint, args }`，返回 `{ ok, value | error }`。
 *
 *   volumes  {}                  → { volumes: [{ letter, root, label, fs, total, free, used }], at }
 *   ls       { path }            → { path, parent, entries: [{ name, path, isDir, size, mtime }], truncated }
 *   size     { path, deadlineMs } → { path, bytes, files, dirs, done }
 *
 * 容量用 `fs.statfsSync`：Windows 上可用（Node 18.15+），单卷毫秒级，不走子进程。
 * 卷标/文件系统只能走 WMI，一次 PowerShell 约 300–500ms，缓存 60 秒，失败就降级成空串。
 */

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statfsSync, statSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { zstdDecompressSync } from 'node:zlib'

export const name = 'dsh-disk-manager'
export const inject = []

const ROUTE = '/api/dsh-disk'
const LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'
const LIST_LIMIT = 800
const LABEL_TTL_MS = 60_000
const SIZE_MAX_MS = 20_000

const execFileAsync = promisify(execFile)

let labelCache = { at: 0, data: new Map() }

async function readLabels() {
  const now = Date.now()
  if (now - labelCache.at < LABEL_TTL_MS) return labelCache.data

  const map = new Map()
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // 必须先钉住输出编码：PowerShell 默认按 OEM 代码页输出，中文卷标会被
        // execFile 的 utf8 解码啃成乱码（实测卷标 "软件" → "D\uFFFD\uFFFD"）。
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,DriveType,Size,FreeSpace | ConvertTo-Json -Compress',
      ],
      { timeout: 6000, windowsHide: true, maxBuffer: 1 << 20 },
    )
    const text = String(stdout || '').trim()
    const parsed = text === '' ? [] : JSON.parse(text)
    for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!row || typeof row.DeviceID !== 'string') continue
      map.set(row.DeviceID.toUpperCase(), {
        label: typeof row.VolumeName === 'string' ? row.VolumeName : '',
        fs: typeof row.FileSystem === 'string' ? row.FileSystem : '',
        driveType: typeof row.DriveType === 'number' ? row.DriveType : 0,
      })
    }
  } catch {
    // 降级：拿不到卷标也照常显示容量，不让一个 PowerShell 抖动把整块面板拖黑。
  }

  labelCache = { at: now, data: map }
  return map
}

async function listVolumes() {
  const labels = await readLabels()
  const volumes = []

  for (const letter of LETTERS) {
    const root = `${letter}:\\`
    let st
    try {
      st = statfsSync(root)
    } catch {
      continue
    }
    const total = Number(st.blocks) * Number(st.bsize)
    const free = Number(st.bfree) * Number(st.bsize)
    if (!Number.isFinite(total) || total <= 0) continue

    const meta = labels.get(`${letter}:`) || {}
    // DriveType 3 = 本地固定盘，2 = 可移动，5 = 光驱（空盘 total 会是 0，上面已被挡掉）
    volumes.push({
      letter,
      root,
      label: meta.label || '',
      fs: meta.fs || '',
      driveType: meta.driveType || 0,
      total,
      free,
      used: total - free,
    })
  }

  return { volumes, at: Date.now() }
}

function parentOf(path) {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  // 'D:\' 去掉尾部分隔符后是 'D:'，没有上一级
  if (cut < 0) return null
  const parent = trimmed.slice(0, cut)
  if (parent === '') return null
  // 'D:' 补回根分隔符，否则前端拿到 'D:' 会当成非法路径
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent
}

function listDir(input) {
  const target = typeof input === 'string' && input.trim() !== '' ? input : 'C:\\'
  const raw = readdirSync(target, { withFileTypes: true })
  const entries = []
  let truncated = false

  for (const dirent of raw) {
    if (entries.length >= LIST_LIMIT) {
      truncated = true
      break
    }
    const full = join(target, dirent.name)
    const isDir = dirent.isDirectory()
    let size = 0
    let mtime = 0
    if (!isDir) {
      try {
        const st = statSync(full)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        // 权限不足/被占用：条目照样列出来，只是没有大小
      }
    }
    entries.push({ name: dirent.name, path: full, isDir, size, mtime })
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return { path: target, parent: parentOf(target), entries, truncated }
}

/**
 * 宽度优先地累计大小，带硬超时。
 *
 * Windows 没有目录大小索引，只能用遍历。百万文件的盘停下来要按分钟算，
 * 所以这里不追求算完 —— 到点就返回 done:false 和已经算到的部分，
 * 前端把进度条停在那儿并标「未完成」，比卡死等 60 秒强。
 */
function measureSize(input, deadlineMs) {
  const target = typeof input === 'string' && input.trim() !== '' ? input : 'C:\\'
  const budget = Math.min(Math.max(Number(deadlineMs) || 5000, 500), SIZE_MAX_MS)
  const started = Date.now()
  const deadline = started + budget

  let bytes = 0
  let files = 0
  let dirs = 0
  let done = true
  const stack = [target]

  while (stack.length > 0) {
    if (Date.now() > deadline) {
      done = false
      break
    }
    const current = stack.pop()
    let list
    try {
      list = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of list) {
      const full = join(current, dirent.name)
      if (dirent.isDirectory()) {
        dirs += 1
        stack.push(full)
      } else {
        files += 1
        try {
          bytes += statSync(full).size
        } catch {
          // 单个文件读不到就跳过，不中断整次统计
        }
      }
    }
  }

  return { path: target, bytes, files, dirs, done, elapsedMs: Date.now() - started }
}

function requirePath(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  if (value === '') throw new Error('path is required')
  return value
}

// explorer.exe 打开文件就等于「用默认关联程序打开」，比 cmd start 稳：
// 不经过 shell 转义，带空格和中文的路径不会被拆坏。
function openWithDefault(input) {
  const target = requirePath(input)
  execFile('explorer.exe', [target], () => {})
  return { path: target, action: 'open' }
}

function revealInExplorer(input) {
  const target = requirePath(input)
  execFile('explorer.exe', [`/select,${target}`], () => {})
  return { path: target, action: 'reveal' }
}

function openTerminal(input) {
  const target = requirePath(input)
  const dir = statSync(target).isDirectory() ? target : parentOf(target) || target
  // detached + unref：新窗口挂在系统上而不是挂在宿主进程上，关掉 DSH 不会连坐
  const child = spawn(
    'powershell.exe',
    ['-NoExit', '-Command', `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`],
    { detached: true, stdio: 'ignore', windowsHide: false },
  )
  child.unref()
  return { path: dir, action: 'terminal' }
}

function makeDirectory(parent, name) {
  const root = requirePath(parent)
  const leaf = typeof name === 'string' ? name.trim() : ''
  if (leaf === '') throw new Error('name is required')
  if (/[\\/:*?"<>|]/.test(leaf)) throw new Error('名称里不能包含 \\ / : * ? " < > |')
  const full = join(root, leaf)
  // mkdirSync 撞名时抛的是 ENOENT 而不是 EEXIST，直接透出去会显示成「找不到文件」，
  // 与实际原因正好相反。这里先自己判一次，给一句人话。
  if (existsSync(full)) throw new Error('这个位置已经有同名文件夹了，换个名字再试')
  try {
    mkdirSync(full)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOENT') {
      throw new Error('这个位置已经有同名文件夹了，换个名字再试')
    }
    throw error
  }
  return { path: full }
}

// 调系统的「磁盘清理」(cleanmgr)：只弹它自己的界面，选哪一项、删多少由用户和系统决定，
// 插件这边不做任何删除动作。
// 浏览器剪贴板被拒时的兜底：走 PowerShell 的 Set-Clipboard。
// 文本从 stdin 传进去，免得中文和引号在命令行上被转义搞坏。
function setClipboard(input) {
  const value = typeof input === 'string' ? input : ''
  if (value === '') throw new Error('text is required')
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', '[Console]::In.ReadToEnd() | Set-Clipboard'], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ action: 'clipboard', bytes: value.length })
      else reject(new Error(`Set-Clipboard exited with ${code}`))
    })
    child.stdin.end(value, 'utf8')
  })
}

function cleanupDrive(input) {
  const target = requirePath(input)
  const letter = /^([A-Za-z]):/.exec(target)?.[1]
  if (letter === undefined) throw new Error('cleanup needs a drive path like C:\\')
  const child = spawn('cleanmgr.exe', ['/d', `${letter}:`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  return { drive: letter.toUpperCase(), action: 'cleanup' }
}

let desktopCache = { at: 0, path: '' }

// 快捷方式图标：桌面那堆 .lnk 如果都显示成统一文件图标，基本没法认。
// 一次性把一批 .lnk 交给一段 PowerShell：解析 TargetPath → ExtractAssociatedIcon → PNG base64。
// 进程内缓存，图标不会变，没必要重复抽。
const iconCache = new Map()

async function shortcutIcons(input) {
  const paths = Array.isArray(input?.paths) ? input.paths.filter((p) => typeof p === 'string') : []
  const out = {}
  const todo = []
  for (const path of paths) {
    const hit = iconCache.get(path)
    if (hit !== undefined) out[path] = hit
    else todo.push(path)
  }
  if (todo.length === 0) return out

  const script = [
    // 两个编码都要钉：InputEncoding 不管，中文名 lnk 从 stdin 进来就是乱码，
    // WScript.Shell 会报「快捷方式路径名称需以 .lnk 或 .url 结尾」；
    // OutputEncoding 不管，回来的 JSON 里中文键同样会烂掉。
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    // 走 shell 的图标而不是「目标 exe 的图标」：UWP / 商店应用的快捷方式
    // TargetPath 是空的，靠 ExtractAssociatedIcon 永远拿不到；SHGetFileInfo
    // 问的是资源管理器自己画的那个图标，UWP、普通 exe、文件类型图标都能覆盖。
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Drawing;',
    'using System.Runtime.InteropServices;',
    'public class ShellIco {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  public struct SHFILEINFO { public IntPtr hIcon; public int iIcon; public uint dwAttributes; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName; }',
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
    '  public static extern IntPtr SHGetFileInfo(string path, uint attrs, ref SHFILEINFO info, uint size, uint flags);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool DestroyIcon(IntPtr handle);',
    '  public static Icon Load(string path) {',
    '    SHFILEINFO info = new SHFILEINFO();',
    '    IntPtr ok = SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), 0x100);',
    '    if (ok == IntPtr.Zero || info.hIcon == IntPtr.Zero) return null;',
    '    try { return (Icon)Icon.FromHandle(info.hIcon).Clone(); } finally { DestroyIcon(info.hIcon); }',
    '  }',
    '}',
    '"@ -ReferencedAssemblies System.Drawing',
    '$raw = [Console]::In.ReadToEnd()',
    '$paths = $raw | ConvertFrom-Json',
    '$result = @{}',
    'foreach ($p in $paths) {',
    '  try {',
    '    $icon = [ShellIco]::Load($p)',
    '    if ($null -eq $icon) { continue }',
    '    $bmp = $icon.ToBitmap()',
    '    $ms = New-Object System.IO.MemoryStream',
    '    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
    '    $result[$p] = "data:image/png;base64," + [Convert]::ToBase64String($ms.ToArray())',
    '    $ms.Dispose(); $bmp.Dispose(); $icon.Dispose()',
    '  } catch { }',
    '}',
    '$result | ConvertTo-Json -Compress',
  ].join('\n')

  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { stdout } = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let outBuf = ''
      child.stdout.on('data', (chunk) => { outBuf += chunk.toString('utf8') })
      child.on('error', reject)
      child.on('close', () => resolve({ stdout: outBuf }))
      child.stdin.end(JSON.stringify(todo), 'utf8')
    })
    let parsed = {}
    const rawOut = String(stdout || '').trim()
    if (rawOut !== '') {
      try {
        parsed = JSON.parse(rawOut)
      } catch (error) {
        console.warn('[dsh-disk] 图标 JSON 解析失败：', error?.message, rawOut.slice(0, 120))
        parsed = {}
      }
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        iconCache.set(key, value)
        out[key] = value
      }
    }
  } catch {
    // 抽不出来就退回默认文件图标，不影响列表本身
  }
  return out
}

// 桌面可能被 OneDrive 重定向到 %USERPROFILE%\OneDrive\Desktop，拼字符串必错，
// 所以问系统要。结果缓存一分钟，按钮连点不会每次都起 PowerShell。
async function desktopPath() {
  const now = Date.now()
  if (desktopCache.path !== '' && now - desktopCache.at < 60_000) return { path: desktopCache.path }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Desktop')"],
      { timeout: 5000, windowsHide: true },
    )
    const value = String(stdout || '').trim()
    if (value !== '') desktopCache = { at: now, path: value }
    return { path: value }
  } catch {
    return { path: '' }
  }
}

// 打开 Windows 设置页（桌面右键菜单里那两个入口）。
// 只放行 ms-settings: 前缀，防止这个端点被当成任意命令执行。
function openSettings(input) {
  const uri = typeof input === 'string' ? input.trim() : ''
  if (!/^ms-settings:[a-z]+$/i.test(uri)) throw new Error('only ms-settings URIs are allowed')
  spawn('cmd.exe', ['/c', 'start', '', uri], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()
  return { uri, action: 'settings' }
}

// 删除只走回收站，永不做永久删除。
// 用 Microsoft.VisualBasic.FileIO 而不是 Remove-Item：后者要么进回收站要靠 COM 折腾，
// 要么就是真删。这个接口一个参数就把「进回收站 + 文件/目录通用」都解决了。
async function trashPath(input) {
  const target = requirePath(input).replace(/[\\/]+$/, '')

  // 桌面本身、用户主目录、盘根这三类绝不能删：VB 的 DeleteDirectory 对它们只会抛
  // 「The system call level is not correct」，而且真删掉了是灾难。
  const desk = (await desktopPath()).path.replace(/[\\/]+$/, '')
  const home = String(process.env.USERPROFILE || '').replace(/[\\/]+$/, '')
  const lower = target.toLowerCase()
  if (desk !== '' && lower === desk.toLowerCase()) {
    throw new Error('桌面文件夹本身不能删，请删里面的具体文件')
  }
  if (home !== '' && lower === home.toLowerCase()) {
    throw new Error('用户主目录不能删')
  }
  if (/^[A-Za-z]:$/.test(target)) {
    throw new Error('整个磁盘不能删')
  }
  const script = [
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    '$raw = [Console]::In.ReadToEnd()',
    '$paths = $raw | ConvertFrom-Json',
    'foreach ($p in $paths) {',
    '  try {',
    '    if (Test-Path -LiteralPath $p -PathType Container) {',
    '      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin")',
    '    } else {',
    '      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin")',
    '    }',
    '    Write-Output ("OK " + $p)',
    '  } catch {',
    '    Write-Output ("ERR " + $p + " :: " + $_.Exception.Message)',
    '  }',
    '}',
  ].join('\n')

  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', () => resolve(out))
    child.stdin.end(JSON.stringify([target]), 'utf8')
  })

  const line = String(stdout || '').trim().split(/\r?\n/).pop() || ''
  if (line.startsWith('OK ')) return { path: target, action: 'trash' }
  throw new Error(line.replace(/^ERR\s*/, '') || '删除失败')
}

function pathInfo(input) {
  const target = requirePath(input)
  const st = statSync(target)
  const isDir = st.isDirectory()
  return {
    path: target,
    name: target.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || target,
    isDir,
    // 目录不在这里递归统计：那是 size 端点的活，硬算会把属性面板卡住
    size: isDir ? null : st.size,
    birthtime: st.birthtimeMs,
    mtime: st.mtimeMs,
    atime: st.atimeMs,
    readonly: (st.mode & 0o200) === 0,
  }
}

// 拖拽进对话：浏览器不允许网页凭空造文件，字节必须由宿主读出来再交给页面。
// 20 MB 是内存红线，超过就别走这条路，改用输入框自带的附件按钮。
const DRAG_MAX_BYTES = 20 * 1024 * 1024

const MIME_BY_EXT = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
  ['webp', 'image/webp'], ['bmp', 'image/bmp'], ['svg', 'image/svg+xml'], ['ico', 'image/x-icon'],
  ['pdf', 'application/pdf'], ['txt', 'text/plain'], ['md', 'text/markdown'],
  ['json', 'application/json'], ['csv', 'text/csv'], ['log', 'text/plain'],
  ['zip', 'application/zip'], ['7z', 'application/x-7z-compressed'], ['rar', 'application/vnd.rar'],
  ['mp4', 'video/mp4'], ['mov', 'video/quicktime'], ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
])

function readFileBytes(input) {
  const target = requirePath(input?.path)
  let st
  try {
    st = statSync(target)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('文件已经不在这个位置了')
    throw error
  }
  if (!st.isFile()) throw new Error('这个不是一个文件，文件夹不能拖进对话')
  if (st.size > DRAG_MAX_BYTES) {
    const mb = (st.size / (1024 * 1024)).toFixed(1)
    throw new Error(`文件有 ${mb} MB，超过 20 MB 拖不进对话，改用输入框的附件按钮`)
  }
  const dot = target.lastIndexOf('.')
  const ext = dot < 0 ? '' : target.slice(dot + 1).toLowerCase()
  let body
  try {
    body = readFileSync(target)
  } catch (error) {
    if (error?.code === 'EACCES') throw new Error('这个文件当前打不开，可能被别的程序占着')
    throw error
  }
  return {
    name: basename(target),
    size: st.size,
    type: MIME_BY_EXT.get(ext) ?? 'application/octet-stream',
    base64: body.toString('base64'),
  }
}

// ── 工作区文件树 ────────────────────────────────────────────────────────────
// 工作区根怎么来：不猜、不问用户。会话记录的第一行事件里就有 `cwd`，也就是
// 这个会话所在的目录。文件在 <DSH_HOME>/sessions/<工作区编码>/<sessionId>/ 下，
// 行首那条事件形如 {"type":"session","version":4,"cwd":"D:\\...","agentPreset":"cordis"}。
// 压缩格式是 zstd，Node 22.15+ 原生可解，不用装依赖。

const TREE_MAX_DEPTH = 6
const TREE_MAX_ENTRIES = 3000
const TREE_IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '__pycache__', '.venv', 'venv', 'env', 'target', '.cache', '.turbo',
  'vendor', '.gradle', '.mvn', 'Pods', 'DerivedData', '.pytest_cache', '.mypy_cache',
  '.idea', '.vs', 'bin', 'obj',
])
const TREE_IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

// 只列产出物，不列代码和配置。别人的会话里 90% 的文件操作都落在 .js/.json/.yml 上，
// 全列出来等于把面板变成 git diff，反而不想看。
const DOC_EXT = new Set([
  'md', 'markdown', 'txt', 'pdf', 'rtf', 'epub',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',
  'odt', 'ods', 'odp',
  'html', 'htm',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp4', 'mov', 'webm', 'mp3', 'wav',
])

// DSH 的会话文件是「每行一帧」的多帧 zstd（实测 6MB / 4000+ 帧）。
// Node 24.22 的 zstdDecompressSync 会一路解到结尾，但 Electron 里那份 24.21
// 只解第一帧就返回，于是整个文件只剩开头那一行 session 事件 —— 面板永远空着。
// 这里自己按帧魔数切开逐帧解，谁家的 Node 都能读全；解不出的帧直接跳过。
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function readSessionText(file) {
  const buf = readFileSync(file)
  if (!file.endsWith('.zstd')) return buf.toString('utf8')
  const starts = []
  let cursor = 0
  while ((cursor = buf.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
    starts.push(cursor)
    cursor += 4
  }
  if (starts.length === 0) return buf.toString('utf8')
  const parts = []
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length
    try {
      parts.push(zstdDecompressSync(buf.subarray(starts[i], end)))
    } catch {
      // 帧内部的伪魔数把这一帧切坏了，丢这一帧即可
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

function sessionsRoot() {
  // DSH_HOME 是命令行/插件注入的，宿主进程里不一定有；homedir() 在任何进程里都成立，
  // 所以兜底用它而不是 USERPROFILE（后者在 Electron 里也可能缺失）。
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'sessions')
}

function findSessionFile(sessionId) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!/^session-[A-Za-z0-9-]+$/.test(id)) return null
  const root = sessionsRoot()
  let buckets = []
  try {
    buckets = readdirSync(root)
  } catch {
    return null
  }
  for (const bucket of buckets) {
    const dir = join(root, bucket, id)
    if (!existsSync(dir)) continue
    for (const file of ['session.v4.jsonl.zstd', 'session.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']) {
      const full = join(dir, file)
      if (existsSync(full)) return full
    }
  }
  return null
}

// 只解压第一行：整份会话可能有几千行，但我们只要开头那条 session 事件。
// zstd 没有流式"只解前几字节"的简单接口，整份解压后立刻切片，几十 KB 的开销可忽略。
// 不传 sessionId 时退到「最近改动的那个会话」。
// 为什么需要这条兜底：右栏 tab 拿到的 sessionId 未必是当前正在聊的那个会话，
// 拿错了就会拿到别的工作区、扫出一片空白。最近改动的一定是正在用的那个。
function latestSessionFile() {
  const root = sessionsRoot()
  let buckets = []
  try {
    buckets = readdirSync(root)
  } catch {
    return null
  }
  let best = null
  for (const bucket of buckets) {
    let dirs = []
    try {
      dirs = readdirSync(join(root, bucket))
    } catch {
      continue
    }
    for (const id of dirs) {
      if (!id.startsWith('session-')) continue
      const dir = join(root, bucket, id)
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      const store = names.find((n) => n.startsWith('session.v4.jsonl'))
      if (store === undefined) continue
      const file = join(dir, store)
      try {
        const st = statSync(file)
        if (best === null || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs }
      } catch {
        continue
      }
    }
  }
  return best === null ? null : best.file
}

function workspaceOf(input) {
  const wanted = typeof input?.sessionId === 'string' ? input.sessionId.trim() : ''
  const file = wanted !== '' ? findSessionFile(wanted) : latestSessionFile()
  if (!file) return { root: '', source: 'none' }
  try {
    const raw = readSessionText(file)
    const cut = raw.indexOf('\n')
    const head = JSON.parse(cut > 0 ? raw.slice(0, cut) : raw)
    const cwd = typeof head?.cwd === 'string' ? head.cwd : ''
    return { root: cwd, source: cwd ? (wanted !== '' ? 'session' : 'latest') : 'none' }
  } catch (error) {
    return { root: '', source: 'none', error: error?.message ?? '' }
  }
}

// 递归扫工作区。跳过依赖/构建目录是必须的：这个工作区光 node_modules 就十几份，
// 不跳过一次能扫出几万个文件，右栏直接卡死。
function listTree(input) {
  const root = requirePath(input?.root)
  const entries = []
  let capped = false // 条目数到顶：整个扫描停止
  let deepened = false // 某条分支超过深度：只跳过那条分支，其余继续
  const walk = (dir, depth, rel) => {
    if (capped) return
    if (depth > TREE_MAX_DEPTH) {
      deepened = true
      return
    }
    let items = []
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (capped) return
      if (entries.length >= TREE_MAX_ENTRIES) {
        capped = true
        return
      }
      const label = item.name
      const full = join(dir, label)
      const relPath = rel === '' ? label : `${rel}/${label}`
      if (item.isDirectory()) {
        if (TREE_IGNORE.has(label)) continue
        let mtime = 0
        try {
          mtime = statSync(full).mtimeMs
        } catch {
          mtime = 0
        }
        entries.push({ path: full, rel: relPath, name: label, isDir: true, size: 0, mtime })
        walk(full, depth + 1, relPath)
      } else if (item.isFile()) {
        if (TREE_IGNORE_FILES.has(label)) continue
        let st = null
        try {
          st = statSync(full)
        } catch {
          continue
        }
        entries.push({ path: full, rel: relPath, name: label, isDir: false, size: st.size, mtime: st.mtimeMs })
      }
    }
  }
  walk(root, 1, '')
  return {
    root,
    entries,
    count: entries.length,
    truncated: capped || deepened,
    capped,
    deepened,
    maxDepth: TREE_MAX_DEPTH,
    maxEntries: TREE_MAX_ENTRIES,
  }
}

// ── 按会话归类工作区文件 ────────────────────────────────────────────────────
// 一个工作区里往往有几十个会话，每个会话只碰了自己那几个文件。平铺一坨看不出
// 「哪个文件是哪次聊出来的」，所以按会话分组。
//
// 会话记录里两样东西直接可用：
//   {"type":"session/title","data":{"title":"...","source":{...}}}  ← 标题，取最后一条
//   {"type":"tool/call","data":{"name":"write","arguments":"{...}"}} ← 参数里带路径
// 参数是 JSON 字符串，递归捞出所有以工作区根开头的字符串，再用文件系统核实存在性，
// 这样既不会把命令里随手写的相对路径当成文件，也不会列进已经被删掉的东西。
// 会话目录被删掉之后这里自然扫不到，所以「已删除的会话不展示」是白送的。

const SESSION_SCAN_MAX = 24
const SESSION_FILE_MAX = 400
// 每次改宿主侧逻辑就换一个，面板诊断里会显示，用来确认真机跑的是哪一版
const BUILD_TAG = 'v9'

function collectPaths(raw, root) {
  // 工具调用里的路径写法不统一：ops_glob / ops_bash 那类给的是 `D:/...` 这种正斜杠，
  // 会话 cwd 却是 `D:\...` 这种反斜杠，直接 includes 永远不命中，整个面板就是空的。
  // 统一成正斜杠再比，命中后仍然返回原始字符串。
  const lowerRoot = root.replace(/\\/g, '/').toLowerCase()
  const found = new Set()
  const visit = (value) => {
    if (typeof value === 'string') {
      const flat = value.replace(/\\/g, '/')
      if (flat.length > 3 && flat.length < 600 && flat.toLowerCase().includes(lowerRoot)) {
        found.add(value)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  try {
    visit(JSON.parse(raw))
  } catch {
    // 参数不是 JSON（比如纯文本命令），当没有路径处理
  }
  return found
}

// 把路径归一到工作区根的相对路径；不在根下就返回空串
function relativeUnder(path, root) {
  const clean = String(path).replace(/^["']|["']$/g, '').replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (clean.toLowerCase() === base.toLowerCase()) return ''
  if (!clean.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return ''
  return clean.slice(base.length + 1)
}

function sessionFiles(file, root) {
  let text = ''
  try {
    text = readSessionText(file)
  } catch {
    return null
  }
  const lines = text.split('\n')
  let cwd = ''
  let title = ''
  let skipped = 0
  let calls = 0
  const types = {}
  const hits = new Map() // 相对路径 → 最后一次出现的时间
  for (const line of lines) {
    if (line === '') continue
    let event = null
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof event.type === 'string') types[event.type] = (types[event.type] || 0) + 1
    if (event.type === 'session' && cwd === '') {
      cwd = typeof event.cwd === 'string' ? event.cwd : ''
      continue
    }
    if (event.type === 'session/title' && typeof event.data?.title === 'string') {
      title = event.data.title
      continue
    }
    if (event.type === 'tool/call') {
      calls += 1
      const args = event.data?.arguments
      // 探针里 arguments 是字符串，但真实环境下也可能是已解析的对象。
      // 只认字符串会把整类调用一下跳过，面板就永远空着 —— 所以对象也重新序列化再扫。
      const raw = typeof args === 'string' ? args : args === undefined || args === null ? '' : JSON.stringify(args)
      if (raw === '') continue
      for (const candidate of collectPaths(raw, root)) {
        const rel = relativeUnder(candidate, root)
        if (rel === '') continue
        hits.set(rel, event.time || 0)
      }
    }
  }
  if (cwd === '' || cwd.toLowerCase() !== root.toLowerCase()) {
    return { cwdMismatch: true, cwd, title, calls, hits: hits.size, skipped, files: [], types, head: text.slice(0, 160) }
  }
  const files = []
  for (const [rel, at] of hits) {
    if (files.length >= SESSION_FILE_MAX) break
    const full = join(root, rel)
    let st = null
    try {
      st = statSync(full)
    } catch {
      continue // 已经删掉的文件不列
    }
    if (!st.isFile()) continue
    const segments = rel.split('/')
    if (segments.some((part) => TREE_IGNORE.has(part))) continue
    // 只要产出物：文档、表格、演示、图片、音视频。
    // 代码和配置（js/ts/json/yml/css/py/sh…）不列 —— 那些是干活过程，不是聊出来的东西。
    const ext = (rel.split('.').pop() || '').toLowerCase()
    if (!DOC_EXT.has(ext)) {
      skipped += 1
      continue
    }
    files.push({
      path: full,
      rel,
      name: segments[segments.length - 1],
      size: st.size,
      mtime: st.mtimeMs,
      // birthtimeMs 才是真正的创建时间；有些文件系统给 0，那就退回修改时间
      birthtime: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs,
      at,
    })
  }
  // 面板按创建时间倒序：最近做出来的文件排在最上面
  files.sort((a, b) => (b.birthtime || b.at) - (a.birthtime || a.at))
  return { cwd, title, files, skipped, calls, hits: hits.size, types, head: text.slice(0, 160) }
}

// 会话目录名就是工作区路径的编码，形如 `--C-work-demo--`；
// 规则：字母数字原样，`:` 和 `\` 变 `-`，汉字变 `~UTF16大写四位~`（如 项 U+9879 → ~9879），首尾各补 `--`。
// 这条精确命中率最高，26 个工作区里只挑出对应那一个，不用把别人几十份会话都解压一遍。
function encodeBucket(root) {
  let out = ''
  for (const ch of root) {
    if (/[A-Za-z0-9]/.test(ch)) out += ch
    else if (ch === '\\' || ch === '/') out += '-'
    else if (ch === ':') continue // 盘符后的冒号不单独占位，紧跟的反斜杠已经给了一个 -
    else if (ch >= '\u4e00' && ch <= '\u9fa5') out += '~' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
    else out += '-'
  }
  return `--${out}--`
}

function bucketHint(root) {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean)
  const ascii = []
  for (const part of parts) {
    const clean = part.replace(/[^A-Za-z0-9]/g, '')
    if (clean === '') break
    ascii.push(clean.toLowerCase())
    if (ascii.length >= 2) break
  }
  return ascii.join('-')
}

// 三级退让：精确编码名 → 前两段 ASCII 粗筛 → 全量。宁可慢，也不能因为编码规则
// 哪天变了就一个会话都看不到。
function workspaceBuckets(root, buckets) {
  const exact = buckets.filter((bucket) => bucket === encodeBucket(root))
  if (exact.length > 0) return exact
  const hint = bucketHint(root)
  if (hint === '') return buckets
  const loose = buckets.filter((bucket) => bucket.toLowerCase().includes(hint))
  return loose.length > 0 ? loose : buckets
}

const sessionCache = new Map() // 会话文件 -> { mtime, size, result }，避免每开面板都重解压

function listSessionGroups(input) {
  const root = requirePath(input?.root)
  const sessionsDir = sessionsRoot()
  let buckets = []
  try {
    buckets = readdirSync(sessionsDir)
  } catch {
    return { root, groups: [], scanned: 0, capped: false }
  }

  // 先把候选会话都列出来，按文件修改时间倒序 —— 最近聊过的排在前面，
  // 也正因为倒序，后面「只看前 N 个」砍掉的都是很久没动过的老会话。
  // 先用目录名筛到对应工作区，一般只剩 1 个 bucket
  const bucketsToScan = workspaceBuckets(root, buckets)

  const candidates = []
  for (const bucket of bucketsToScan) {
    let sessionDirs = []
    try {
      sessionDirs = readdirSync(join(sessionsDir, bucket))
    } catch {
      continue
    }
    for (const sessionId of sessionDirs) {
      if (!sessionId.startsWith('session-')) continue
      const dir = join(sessionsDir, bucket, sessionId)
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      const store = names.find((n) => n.startsWith('session.v4.jsonl'))
      if (store === undefined) continue
      const file = join(dir, store)
      try {
        const st = statSync(file)
        candidates.push({ file, mtime: st.mtimeMs, size: st.size, id: sessionId })
      } catch {
        continue
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)

  const limit = Math.min(candidates.length, SESSION_SCAN_MAX)
  const groups = []
  // 分层计数：读了几份会话 → cwd 对上几个 → 工具调用几次 → 路径命中几条 → 过滤后成组几个
  const tally = { read: 0, cwdMismatch: 0, calls: 0, hits: 0, skipped: 0, grouped: 0 }
  let sample = null
  for (let i = 0; i < limit; i += 1) {
    const candidate = candidates[i]
    let parsed = null
    const cached = sessionCache.get(candidate.file)
    if (cached !== undefined && cached.mtime === candidate.mtime && cached.size === candidate.size) {
      parsed = cached.result
    } else {
      parsed = sessionFiles(candidate.file, root)
      sessionCache.set(candidate.file, { mtime: candidate.mtime, size: candidate.size, result: parsed })
    }
    if (parsed === null) continue
    tally.read += 1
    if (parsed.cwdMismatch === true) {
      tally.cwdMismatch += 1
      continue
    }
    if (sample === null) sample = { types: parsed.types || {}, head: parsed.head || "", title: parsed.title || "" }
    tally.calls += parsed.calls || 0
    tally.hits += parsed.hits || 0
    tally.skipped += parsed.skipped || 0
    if (parsed.files.length === 0) continue
    tally.grouped += 1
    groups.push({
      id: candidate.id,
      title: parsed.title !== '' ? parsed.title : candidate.id.replace(/^session-/, '').slice(0, 8),
      files: parsed.files,
      count: parsed.files.length,
      mtime: candidate.mtime,
    })
  }
  groups.sort((a, b) => b.mtime - a.mtime)
  return {
    root,
    groups,
    scanned: limit,
    capped: candidates.length > limit,
    // 诊断字段：面板列不出来时靠这几个数定位是哪一层的锅
    home: sessionsDir,
    buckets: buckets.length,
    matchedBuckets: bucketsToScan.length,
    candidates: candidates.length,
    build: BUILD_TAG,
    tally,
    sample,
  }
}

// 导出给本地验证脚本用（不经 HTTP 直接打这三个函数），运行时不依赖这个导出
export const handlers = {
  volumes: () => listVolumes(),
  ls: (args) => listDir(args?.path),
  size: (args) => measureSize(args?.path, args?.deadlineMs),
  open: (args) => openWithDefault(args?.path),
  reveal: (args) => revealInExplorer(args?.path),
  terminal: (args) => openTerminal(args?.path),
  mkdir: (args) => makeDirectory(args?.parent, args?.name),
  info: (args) => pathInfo(args?.path),
  cleanup: (args) => cleanupDrive(args?.path),
  clipboard: (args) => setClipboard(args?.text),
  desktop: () => desktopPath(),
  icons: (args) => shortcutIcons(args),
  trash: (args) => trashPath(args?.path),
  settings: (args) => openSettings(args?.uri),
  read: (args) => readFileBytes(args),
  workspace: (args) => workspaceOf(args),
  tree: (args) => listTree(args),
  sessions: (args) => listSessionGroups(args),
}

function envelope(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function failure(code, message) {
  return { ok: false, error: { code, message } }
}

async function handleRequest(request) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return envelope(failure('bad-request', 'request body is not JSON'))
  }

  const endpoint = payload?.endpoint
  const handler = typeof endpoint === 'string' && Object.hasOwn(handlers, endpoint) ? handlers[endpoint] : undefined
  if (!handler) return envelope(failure('bad-request', `unknown dsh-disk endpoint: ${String(endpoint)}`))

  const args = payload?.args
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return envelope(failure('bad-request', `dsh-disk endpoint ${endpoint} requires an args object`))
  }

  try {
    request.signal?.throwIfAborted?.()
    return envelope({ ok: true, value: await handler(args ?? {}) })
  } catch (error) {
    return envelope(failure('internal', error?.message ?? String(error)))
  }
}

export function apply(ctx) {
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () =>
        connectionCtx.connection.fetch.register({
          path: ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: (request) => handleRequest(request),
        }),
      'dsh-disk-manager: disk route',
    )
  })
}
