// dsh-disk-manager · 界面层
// 右栏 tab：卷总览 → 目录浏览 → 按需统计目录大小。
// 只读，不做删除/分区。数据全部来自 host 半的 /api/dsh-disk。
window.__ModuleLoader__.load({
  id: '@ananyang/dsh-disk-manager',
  factory: (require) => {
    const react = require('react');
    const h = react.createElement;
    const { useState, useEffect, useCallback, useRef } = react;

    // 与 index.js 的 ROUTE 对应
    const API = '/api/dsh-disk';
    // tab 类型的身份：id 是它在 tab 系统里的唯一实现名，kind 是导航用的名字
    const TYPE_ID = 'dsh-disk-manager/volumes';
    const KIND = 'dsh-disk';

    async function call(endpoint, args) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ endpoint, args: args ?? {} }),
      });
      const envelope = await res.json().catch(() => null);
      if (!envelope || envelope.ok !== true) {
        throw new Error(envelope?.error?.message || `${endpoint} 调用失败（${res.status}）`);
      }
      return envelope.value;
    }

    function fmtBytes(n) {
      const v = Number(n) || 0;
      if (v < 1024) return `${v} B`;
      const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
      let value = v / 1024;
      let i = 0;
      while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
      }
      return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
    }

    // 拖到对话：浏览器不允许网页凭空造文件，字节必须由宿主读出来（host 的 read 端点），
    // 页面再包成 File 塞进拖拽数据。鼠标按下就开始预读，等真正拖动时文件通常已经在手里；
    // 读得太慢就退化成拖路径文本，至少不会「拖了个空」。
    const DRAG_MAX_BYTES = 20 * 1024 * 1024;
    let dragCache = { path: '', file: null, pending: null, error: '', timer: 0 };

    function toFile(payload) {
      const bin = atob(payload.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], payload.name, { type: payload.type || 'application/octet-stream' });
    }

    function prefetchDrag(path, size) {
      if (!path) return null;
      if (dragCache.path === path && (dragCache.file || dragCache.pending)) return dragCache.pending;
      if ((Number(size) || 0) > DRAG_MAX_BYTES) return null; // 大文件不预读，白耗内存
      if (dragCache.timer) {
        clearTimeout(dragCache.timer);
        dragCache.timer = 0;
      }
      dragCache = { path, file: null, pending: null, error: '', timer: 0 };
      const pending = call('read', { path })
        .then((payload) => {
          if (dragCache.path !== path) return null;
          dragCache.file = toFile(payload);
          return dragCache.file;
        })
        .catch((error) => {
          dragCache.error = friendlyError(error);
          return null;
        })
        .finally(() => {
          dragCache.pending = null;
        });
      dragCache.pending = pending;
      return pending;
    }

    function startDrag(event, entry) {
      const dt = event.dataTransfer;
      if (!dt) return;
      dt.effectAllowed = 'copy';
      const cached = dragCache.path === entry.path ? dragCache.file : null;
      if (cached) {
        dt.items.add(cached);
        return;
      }
      // 字节还没到手：先拖路径文本，松手也不会丢东西
      dt.setData('text/plain', entry.path);
      if (!dragCache.error) void prefetchDrag(entry.path, entry.size);
    }

    function endDrag() {
      if (!dragCache.path) return;
      if (dragCache.timer) clearTimeout(dragCache.timer);
      dragCache.timer = setTimeout(() => {
        if (!dragCache.pending) dragCache = { path: '', file: null, pending: null, error: '', timer: 0 };
      }, 8000);
    }

    const CSS = `
.dsk-root{display:flex;flex-direction:column;height:100%;min-height:0;font:inherit;color:var(--dsw-alias-label-primary,inherit)}
.dsk-head{display:flex;align-items:center;gap:6px;padding:8px 10px 6px;flex:0 0 auto}
.dsk-title{font-size:12px;font-weight:600;letter-spacing:.02em;opacity:.75;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsk-body{flex:1 1 auto;min-height:0;overflow:auto;padding:0 8px 14px}
.dsk-iconbtn{flex:0 0 auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;opacity:.72}
.dsk-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));opacity:1}
.dsk-iconbtn:disabled{opacity:.25;cursor:default;background:transparent}
.dsk-grouphead{padding:2px 4px 8px;font-size:11.5px;opacity:.6;letter-spacing:.02em}
.dsk-sectsep{height:1px;margin:16px 4px 12px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.24))}
.dsk-vol{display:flex;align-items:flex-start;gap:10px;padding:11px 10px;margin-bottom:8px;max-width:max(280px,50%);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));border-radius:9px;cursor:pointer;background:var(--dsw-alias-bg-layer-2)}
.dsk-vol:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}
.dsk-vol-main{flex:1 1 auto;min-width:0;padding-top:1px}
.dsk-vol-head{display:flex;align-items:baseline;gap:8px}
.dsk-vol-title{flex:1 1 auto;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsk-pct{flex:0 0 52px;font-size:11px;opacity:.5;font-variant-numeric:tabular-nums;text-align:right}
.dsk-diskicon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px}
.dsk-shortcut .dsk-diskicon svg{width:26px;height:26px}
.dsk-inline-list{padding:2px 6px 8px;max-width:max(280px,50%);min-height:28px}
.dsk-inline-list .dsk-row{height:26px}
.dsk-more{padding:5px 6px;font-size:11px;opacity:.55;cursor:pointer;border-radius:6px}
.dsk-more:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}
.dsk-vol:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}
.dsk-vol-top{display:flex;align-items:center;gap:7px}
.dsk-badge{font-weight:700;font-size:13px;letter-spacing:.04em}
.dsk-vol-label{font-size:11px;opacity:.6;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsk-bar{position:relative;height:9px;margin:8px 0 7px;border-radius:2px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.28));overflow:hidden}
.dsk-bar-fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:#0078d4;transition:width .25s ease}
.dsk-vol-meta{font-size:11px;opacity:.55;font-variant-numeric:tabular-nums}
.dsk-row{display:flex;align-items:center;gap:8px;height:28px;padding:0 6px;border-radius:6px;cursor:default}
.dsk-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}
.dsk-row-sel{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.22));box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary,#0078d4)}
.dsk-selbar{display:flex;align-items:center;gap:8px;padding:4px 10px 8px;font-size:12px}
.dsk-check{flex:0 0 auto;width:16px;text-align:center;cursor:pointer;opacity:.28;font-size:11px;line-height:1;user-select:none}
.dsk-check:hover{opacity:.75}
.dsk-check-on{opacity:1;color:var(--dsw-alias-brand-primary,#0078d4)}
.dsk-row-dir{cursor:pointer}
.dsk-ico{flex:0 0 auto;display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center}
.dsk-appicon{width:16px;height:16px;object-fit:contain}
.dsk-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.dsk-gap{flex:1 1 auto;min-width:0}
.dsk-row-vol .dsk-name{flex:0 1 38%;min-width:72px}
.dsk-size{flex:0 0 74px;font-size:11px;opacity:.5;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
/* 体积占比条：P1 唯一新增的视觉元素。空条表示还没算出来，不画成 0 长度实心条误导 */
.dsk-map{width:100%;height:100%;display:block}
.dsk-map .blk{cursor:pointer}
.dsk-map .blk rect{stroke:var(--dsw-alias-bg-layer-1,#fff);stroke-width:1.5}
.dsk-map .blk:hover rect{stroke:var(--dsw-alias-brand-primary,#0078d4);stroke-width:2}
.dsk-map .blk text{fill:#fff;font-size:11px;pointer-events:none}
.dsk-ratio{flex:0 0 76px;height:5px;border-radius:3px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.24));overflow:hidden}
.dsk-pct{flex:0 0 42px;font-size:11px;opacity:.5;font-variant-numeric:tabular-nums;text-align:right}
/* 弹性间隔：横向左边界固定（名称列定宽），大小右边界贴行右边缘，
   中间剩余空间由这三个间隔平分 —— 条/百分比/重算/大小 四列间距必然相等 */
.dsk-sp{flex:1 1 0;min-width:0}
.dsk-ratio i{display:block;height:100%;width:0;border-radius:2px;background:var(--dsw-alias-brand-primary,#0078d4);transition:width .25s ease}
.dsk-calc{flex:0 0 46px;font-size:10.5px;padding:1px 0;border-radius:5px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:transparent;color:var(--label-dim,rgba(128,128,128,.75));text-align:center}
.dsk-calc:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:inherit}
.dsk-path{flex:1 1 auto;font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dsk-tabtitle{display:inline-block;flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.dsk-path-btn{flex:1 1 auto;min-width:0;height:22px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;opacity:.7;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text}
.dsk-path-btn:hover{opacity:1;border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}
.dsk-path-input{flex:1 1 auto;min-width:0;height:22px;box-sizing:border-box;padding:0 7px;border-radius:6px;border:1px solid var(--dsw-alias-brand-primary,#4a86ff);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:11px;outline:none}
.dsk-empty{padding:18px 6px;font-size:12px;opacity:.5;text-align:center}
.dsk-err-host{padding:8px 10px;margin:0 0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e6e6e6);font-size:11.5px;line-height:1.5}
.dsk-err{padding:8px 10px;margin:0 0 8px;border-radius:8px;border:1px solid rgba(209,52,56,.35);background:rgba(209,52,56,.14);color:var(--dsw-alias-state-error-primary,#ff7b72);font-size:11.5px;line-height:1.5;word-break:break-all}
.dsk-group{padding:8px 6px 3px;font-size:10px;letter-spacing:.06em;opacity:.45;text-transform:uppercase}
.dsk-notice{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483003;max-width:min(420px,calc(100vw - 40px));padding:9px 14px;border-radius:9px;background:var(--dsw-alias-tooltip-bg,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));box-shadow:0 10px 26px rgba(0,0,0,.24);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,inherit)}
.dsk-peek{position:fixed;z-index:2147482999;display:flex;flex-direction:column;max-height:min(360px,70vh);border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));box-shadow:0 12px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,inherit);overflow:hidden}
.dsk-peek-head{flex:0 0 auto;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));font-size:11.5px;opacity:.7;display:flex;gap:8px}
.dsk-peek-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsk-peek-back{flex:0 0 auto;width:18px;height:18px;margin-right:2px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;opacity:.7;line-height:1}
.dsk-peek-back:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}
.dsk-peek-count{flex:0 0 auto;font-variant-numeric:tabular-nums}
.dsk-peek-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px}
.dsk-mask{position:fixed;inset:0;z-index:2147483000}
.dsk-menu{position:fixed;z-index:2147483001;padding:5px;border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));box-shadow:0 12px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,inherit)}
.dsk-mitem{display:flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:6px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.dsk-mitem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}
.dsk-mlabel{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.dsk-mhint{flex:0 0 auto;font-size:11px;opacity:.45}
.dsk-mchev{flex:0 0 auto;opacity:.5;font-size:14px;line-height:1}
.dsk-mcheck{flex:0 0 12px;font-size:11px;opacity:.85}
.dsk-mback{opacity:.75;font-size:12px}
.dsk-mitem-danger{color:#e2564d}
.dsk-mitem-danger:hover{background:rgba(209,52,56,.14)}
.dsk-btn-danger{background:#d13438;border-color:transparent;color:#fff}
.dsk-btn-danger:hover{background:#b02a2e}
.dsk-sep{height:1px;margin:5px 6px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.24))}
.dsk-modal{position:fixed;z-index:2147483002;left:50%;top:22%;transform:translateX(-50%);width:min(320px,calc(100vw - 32px));padding:14px;border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));box-shadow:0 18px 40px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary,inherit)}
.dsk-modal-title{font-size:13px;font-weight:600;margin-bottom:10px}
.dsk-modal-row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.dsk-input{width:100%;height:30px;box-sizing:border-box;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;outline:none}
.dsk-input:focus{border-color:var(--dsw-alias-brand-primary,#4a86ff)}
.dsk-btn{height:28px;padding:0 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:transparent;color:inherit;font-size:12px;cursor:pointer}
.dsk-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}
.dsk-btn-primary{background:var(--dsw-alias-brand-primary,#4a86ff);border-color:transparent;color:#fff}
.dsk-hint{font-size:11px;opacity:.5;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsk-kv{display:flex;flex-direction:column;gap:7px}
.dsk-kv-row{display:flex;gap:10px;font-size:12px;line-height:1.4}
.dsk-kv-k{flex:0 0 64px;opacity:.5}
.dsk-kv-v{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

    // ---------- 图标：跟资源管理器一个路子，形状分类型、颜色分类别 ----------
    // 全部 16×16，描边用 currentColor 系色值，深浅主题下都不会糊成一块。
    const DOC_OUTLINE = 'M4.6 2.2h4.1l3.4 3.4v8.2H4.6z';
    const FILE_STYLES = {
      image: { tone: '#5aa9e6', marks: ['M5.9 11.6l1.9-2.4 1.4 1.7.9-1 1.4 1.7z'] },
      video: { tone: '#e0704a', marks: ['M6.9 7.3l2.9 1.9-2.9 1.9z'] },
      audio: { tone: '#c9a227', marks: ['M8.5 7.1l1.9-.5v4.2a1.1 1.1 0 1 1-.9-1.1V8.1l-1 .3z'] },
      archive: { tone: '#9b8ad4', marks: ['M7.3 4.5h1.4v1.1H7.3z', 'M7.3 6.5h1.4v1.1H7.3z', 'M7.3 8.5h1.4v1.1H7.3z'] },
      code: { tone: '#3fa87a', marks: ['M6.7 7.5L5.4 8.9l1.3 1.4', 'M9.3 7.5l1.3 1.4-1.3 1.4'] },
      doc: { tone: '#8fa4bd', marks: ['M6.1 7.9h4.2', 'M6.1 9.9h4.2', 'M6.1 11.9h2.4'] },
      other: { tone: '#7d8899', marks: [] },
    };
    const EXT_KINDS = {
      image: 'jpg jpeg png gif webp bmp svg ico tif tiff heic avif',
      video: 'mp4 mkv avi mov wmv flv webm m4v rmvb ts',
      audio: 'mp3 wav flac aac ogg m4a ape wma',
      archive: 'zip rar 7z gz bz2 xz tar tgz iso cab',
      code: 'js mjs cjs ts tsx jsx json yml yaml md py go rs java c h cpp cs php rb sh ps1 bat html css scss vue',
      doc: 'txt pdf doc docx xls xlsx ppt pptx csv log ini cfg toml epub',
    };
    // 右栏内置渲染器覆盖的范围（文本/Markdown/代码、常见图片、PDF、Office 表格）。
    // 视频、音频、压缩包、可执行文件不在其中——交给右栏只会得到一个打不开的空页，
    // 而且它不会抛错，所以「抛错再回退」这条路根本走不到。
    const PREVIEWABLE = ('md markdown txt log json yml yaml ini cfg toml csv tsv ' +
      'js mjs cjs jsx ts tsx py go rs java c h cpp hpp cs php rb sh ps1 sql xml ' +
      'html htm css scss less vue svelte ' +
      'png jpg jpeg gif webp bmp svg ico avif ' +
      'pdf doc docx xls xlsx ppt pptx').split(' ');

    const PREVIEWABLE_SET = new Set(PREVIEWABLE);

    function isPreviewable(name) {
      const raw = String(name || '');
      const dot = raw.lastIndexOf('.');
      if (dot <= 0) return false;
      return PREVIEWABLE_SET.has(raw.slice(dot + 1).toLowerCase());
    }

    const EXT_LOOKUP = (() => {
      const map = new Map();
      for (const [kind, list] of Object.entries(EXT_KINDS)) {
        for (const ext of list.split(' ')) map.set(ext, kind);
      }
      return map;
    })();

    function fileKindOf(name) {
      const raw = String(name || '');
      const dot = raw.lastIndexOf('.');
      if (dot <= 0 || dot === raw.length - 1) return 'other';
      return EXT_LOOKUP.get(raw.slice(dot + 1).toLowerCase()) || 'other';
    }

    function svgWrap(children, size) {
      return h(
        'svg',
        {
          width: size || 16,
          height: size || 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
        },
        children,
      );
    }

    function FolderIcon() {
      return svgWrap([
        h('path', {
          d: 'M1.8 4.4c0-.55.45-1 1-1h3.05l1.3 1.5h5.65c.55 0 1 .45 1 1v6.7c0 .55-.45 1-1 1H2.8c-.55 0-1-.45-1-1z',
          fill: '#d8a63c',
          opacity: 0.9,
        }),
      ]);
    }

    function FileIcon({ name }) {
      const style = FILE_STYLES[fileKindOf(name)] || FILE_STYLES.other;
      const children = [
        h('path', {
          d: DOC_OUTLINE,
          stroke: style.tone,
          strokeWidth: 1.1,
          strokeLinejoin: 'round',
          opacity: 0.9,
        }),
      ];
      for (const mark of style.marks) {
        children.push(h('path', {
          d: mark,
          stroke: style.tone,
          strokeWidth: 1.1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.95,
        }));
      }
      return svgWrap(children);
    }

    // 卷卡片用的实心盘体（灰箱 + 绿色指示灯），跟资源管理器一个观感；
    // 会话头那个入口按钮仍用线框版 DriveIcon，头部图标要细。
    function DiskIcon({ size }) {
      const s = size || 32;
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 9, width: 26, height: 16, rx: 2, fill: '#9aa0a8' }),
        h('rect', { x: 3, y: 9, width: 26, height: 5, rx: 2, fill: '#b8bec6' }),
        h('rect', { x: 6, y: 16.5, width: 20, height: 5.5, rx: 1, fill: '#7d848d' }),
        h('circle', { cx: 8.4, cy: 19.2, r: 1.7, fill: '#3ecf5a' }),
      );
    }

    function DriveIcon({ tone, size }) {
      return svgWrap([
        h('rect', {
          x: 1.9, y: 3.1, width: 12.2, height: 9.8, rx: 1.6,
          stroke: tone || '#6f8bb0', strokeWidth: 1.2,
        }),
        h('path', { d: 'M1.9 9.1h12.2', stroke: tone || '#6f8bb0', strokeWidth: 1.2 }),
        h('circle', { cx: 4.6, cy: 6.2, r: 0.95, fill: tone || '#6f8bb0' }),
        h('circle', { cx: 4.6, cy: 11.1, r: 0.95, fill: tone || '#6f8bb0' }),
      ], size);
    }

    // ---------- 排序 / 分组 / 时间 ----------
    const SORTS = [['name', '名称'], ['size', '大小'], ['mtime', '修改时间'], ['type', '类型']];
    const GROUPS = [['none', '无'], ['type', '类型'], ['mtime', '日期']];

    function extOf(name) {
      const raw = String(name || '');
      const dot = raw.lastIndexOf('.');
      return dot > 0 ? raw.slice(dot + 1).toLowerCase() : '';
    }

    function sortEntries(entries, layout, sizes) {
      const factor = layout.desc ? -1 : 1;
      // 文件夹在目录列表里 size 恒为 0，按大小排等于没排；
      // 用扫出来的体积（sizes 里的 bytes）代替，没扫出来的排在最后。
      const bytesOf = (entry) => {
        if (!entry.isDir) return entry.size || 0;
        const m = sizes && sizes[entry.path];
        return m && typeof m.bytes === 'number' ? m.bytes : -1;
      };
      return entries.slice().sort((a, b) => {
        // 目录永远在前，跟资源管理器一致：翻目录时不该在一堆文件里找文件夹
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        let delta = 0;
        if (layout.sort === 'size') delta = bytesOf(a) - bytesOf(b);
        else if (layout.sort === 'mtime') delta = (a.mtime || 0) - (b.mtime || 0);
        else if (layout.sort === 'type') delta = extOf(a.name).localeCompare(extOf(b.name), 'zh-CN');
        else delta = a.name.localeCompare(b.name, 'zh-CN');
        return delta * factor;
      });
    }

    function groupOf(entry, mode) {
      if (mode === 'type') return entry.isDir ? '文件夹' : `${(extOf(entry.name) || '无扩展名').toUpperCase()} 文件`;
      if (mode === 'mtime') {
        if (!entry.mtime) return '未知时间';
        const d = new Date(entry.mtime);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      return '';
    }

    function fmtTime(ms) {
      if (!ms) return '—';
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // 打开「在新标签页打开」时先登记目标路径。body 偶尔读不到自己的地址
    // （tab 记录还没提交时 useTabInfo 会抛），这时按登记顺序领一个，别退回首页。
    // 新建会话要靠客户端的 uiWorkspace 服务，注入是异步的，先留个槽
    let uiWorkspace = null;

    // 官方输入框是 Lexical 的 contenteditable。直接改 DOM 会跟它的内部 editor state
    // 脱节，所以走浏览器原生的插入路径：先 focus，再 execCommand('insertText')，
    // 不行才派发 paste 事件 —— 这两条 Lexical 都会当成用户输入来接收。
    function visibleComposers() {
      return Array.from(document.querySelectorAll('div[contenteditable="true"], [data-lexical-editor="true"]'))
        .filter((node) => node.offsetParent !== null && !node.closest('[aria-hidden="true"]'))
        .sort((a, b) => b.clientWidth - a.clientWidth);
    }

    async function fillComposer(target, value) {
      if (!target) return false;
      target.focus();
      const before = target.textContent || '';

      // execCommand 返回 true 不代表真插进去了（Lexical 会自己接管），所以按内容变化判定
      try {
        document.execCommand('insertText', false, value);
      } catch {
        // 某些环境禁了 execCommand，下面走 paste
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      if ((target.textContent || '') !== before) return true;

      try {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        target.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }));
      } catch {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      return (target.textContent || '') !== before;
    }

    /**
     * 等「新会话的输入框」出现再往里写。
     *
     * 之前是直接轮询找可见的编辑器，结果新会话还没渲染完时，抓到的是**当前会话**的
     * 输入框 —— 提示词就同时落进了两个会话。所以先把此刻已存在的编辑器记下来，
     * 只认之后新出现的那个；一直等不到（组件被复用）就放弃，交给剪贴板。
     */
    async function fillNewComposer(value, timeoutMs = 4000) {
      const known = new Set(document.querySelectorAll('div[contenteditable="true"], [data-lexical-editor="true"]'));

      const fresh = () => visibleComposers().find((node) => !known.has(node)) || null;

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const target = fresh();
        if (target && (await fillComposer(target, value))) return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return false;
    }

    const pendingTargets = [];

    function rememberTarget(path) {
      if (typeof path !== 'string' || path === '') return;
      pendingTargets.push(path);
      if (pendingTargets.length > 8) pendingTargets.shift();
    }

    function takeTarget() {
      return pendingTargets.length > 0 ? pendingTargets.shift() : '';
    }

    // 上次停留的位置：keepMounted 管「切走再切回」，这份记录管「刷新/重开」
    const LAST_KEY = 'dsh-disk.last.';

    function readLast(sessionId) {
      try {
        const raw = window.localStorage.getItem(LAST_KEY + (sessionId || 'global'));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.path === 'string' && parsed.path !== '') return parsed;
      } catch {
        // 记录坏了就当没存过，不要让一条脏数据把面板锁死
      }
      return null;
    }

    function saveLast(sessionId, value) {
      try {
        const key = LAST_KEY + (sessionId || 'global');
        if (!value || !value.path) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // 隐私模式/配额满：不记就是了，不影响浏览
      }
    }

    // 右栏认的是 dsh-resource 地址：dsh-resource://file/session/<sessionId>/<path>
    // 段逐个编码、盘符的冒号保留，跟官方文件树用同一条语法
    function fileAddress(sessionId, absolutePath) {
      const normalized = String(absolutePath || '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
      const encoded = normalized
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
        .join('/');
      return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`;
    }

    // ---------- 悬停预览浮层：一层层往里钻，不离开面板 ----------
    // 宿主侧没重启时，所有端点都会回 unknown dsh-disk endpoint。
    // 把这句话翻成人能执行的动作：重启一次 DSH。
    const HOST_HINT = '后端未就绪：插件宿主侧还没加载，重启一次 DSH 即可';

    function friendlyError(error) {
      const raw = String(error?.message || error || '');
      if (/unknown dsh-disk endpoint/i.test(raw)) return HOST_HINT;
      // 路由整个没注册时，请求会被前端兜底页接走：回 HTML 或 404，
      // 表现成「volumes 调用失败（200）」「调用失败（404）」——同一个根因，同一句话。
      if (/调用失败（(?:200|40[045]|501|502)）/.test(raw)) return HOST_HINT;
      if (/ENOENT|no such file/i.test(raw)) return '这个位置已经不存在了';
      return raw || '操作失败';
    }

    function baseName(path) {
      const parts = String(path || '').split(String.fromCharCode(92)).join('/').split('/').filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : String(path || '');
    }

    function HoverPeek({ peek, depth, onEnter, onLeave, onOpenEntry }) {
      const level = depth || 1;
      const [stack, setStack] = useState([]);
      const [child, setChild] = useState(null);
      const [data, setData] = useState({ path: '', entries: [], total: 0, loading: false, error: '' });
      const seq = useRef(0);
      const childTimer = useRef(null);
      // 关子层也要延迟：鼠标从父层移到子层的过程中会先触发父层的 mouseleave，
      // 立刻 setChild(null) 就把用户要点的那个框先干掉了。
      const childCloseTimer = useRef(null);

      const cancelChildClose = () => {
        if (childCloseTimer.current) {
          clearTimeout(childCloseTimer.current);
          childCloseTimer.current = null;
        }
      };

      const scheduleChildClose = () => {
        cancelChildClose();
        childCloseTimer.current = setTimeout(() => setChild(null), 240);
      };

      const load = useCallback(async (target) => {
        if (!target) return;
        const ticket = (seq.current += 1);
        setData({ path: target, entries: [], total: 0, loading: true, error: '' });
        try {
          const listing = await call('ls', { path: target });
          if (ticket !== seq.current) return;
          const entries = listing.entries || [];
          setData({ path: listing.path || target, entries, total: entries.length, loading: false, error: '' });
        } catch (err) {
          if (ticket !== seq.current) return;
          const message = String(err?.message || err);
          // 目录被删/被移走是正常事——桌面上的文件夹说没就没。
          // 这时候安静把浮层收掉，不要拿 ENOENT 吓用户。
          if (/ENOENT|no such file/i.test(message)) {
            onLeave?.();
            return;
          }
          setData({ path: target, entries: [], total: 0, loading: false, error: message });
        }
      }, [onLeave]);

      useEffect(() => {
        if (!peek) {
          setStack([]);
          setChild(null);
          return;
        }
        setStack([]);
        setChild(null);
        void load(peek.path);
      }, [peek, load]);

      useEffect(() => () => {
        if (childTimer.current) clearTimeout(childTimer.current);
        if (childCloseTimer.current) clearTimeout(childCloseTimer.current);
      }, []);

      if (!peek) return null;

      const width = 280;
      const maxLeft = (window.innerWidth || 1200) - width - 12;
      const left = Math.min(peek.x, Math.max(12, maxLeft));
      const top = Math.max(12, Math.min(peek.y, (window.innerHeight || 800) - 240));

      // 点击 = 在这一层换内容（下钻）；悬停 = 在右侧再开一层（级联预览）
      const enter = (entry) => {
        onEnter?.();
        setStack((prev) => [...prev, { path: data.path }]);
        void load(entry.path);
      };

      const back = () => {
        if (stack.length === 0) return;
        const target = stack[stack.length - 1].path;
        setStack((prev) => prev.slice(0, -1));
        void load(target);
      };

      // 最多三级：一级浮层 + 两级级联
      const canCascade = level < 3;

      const openChild = (entry, event) => {
        if (!canCascade) return;
        if (!entry.isDir) {
          setChild(null);
          return;
        }
        const rect = event?.currentTarget?.getBoundingClientRect?.();
        if (childTimer.current) clearTimeout(childTimer.current);
        childTimer.current = setTimeout(() => {
          setChild({
            x: (rect?.right ?? left + width) + 8,
            y: rect?.top ?? top,
            path: entry.path,
            title: entry.name,
          });
        }, 220);
      };

      const body = data.loading
        ? h('div', { className: 'dsk-empty' }, '读取中…')
        : data.error
          ? h('div', { className: 'dsk-err' }, data.error)
          : data.entries.length === 0
            ? h('div', { className: 'dsk-empty' }, '空文件夹')
            : data.entries.map((entry) =>
                h(
                  'div',
                  {
                    key: entry.path,
                    className: `dsk-row${entry.isDir ? ' dsk-row-dir' : ''}`,
                    title: entry.path,
                    onClick: () => (entry.isDir ? enter(entry) : onOpenEntry(entry)),
                    onMouseEnter: (event) => openChild(entry, event),
                  },
                  h(
                    'span',
                    { className: 'dsk-ico' },
                    entry.isDir
              ? h(FolderIcon, null)
              : appIcons[entry.path]
                ? h('img', { className: 'dsk-appicon', src: appIcons[entry.path], alt: '' })
                : h(FileIcon, { name: entry.name }),
                  ),
                  h('span', { className: 'dsk-name' }, entry.name),
                  entry.isDir
                    ? h('span', { className: 'dsk-size' }, canCascade ? '›' : fmtBytes(entry.size))
                    : h('span', { className: 'dsk-size' }, fmtBytes(entry.size)),
                ),
              );

      return h(
        'div',
        null,
        h(
          'div',
          {
            className: 'dsk-peek',
            style: { left, top, width },
            onMouseEnter: onEnter,
            onMouseLeave: () => {
              scheduleChildClose();
              onLeave?.();
            },
          },
          h(
            'div',
            { className: 'dsk-peek-head' },
            stack.length > 0
              ? h('button', { className: 'dsk-peek-back', onClick: back, title: '上一层' }, '‹')
              : null,
            h('span', { className: 'dsk-peek-title', title: data.path }, baseName(data.path) || peek.title),
            h('span', { className: 'dsk-peek-count' }, String(data.total)),
          ),
          h('div', { className: 'dsk-peek-body' }, body),
        ),
        child
          ? h(HoverPeek, {
              key: `child-${child.path}`,
              peek: child,
              depth: level + 1,
              onEnter: () => {
                cancelChildClose();
                onEnter?.();
              },
              onLeave,
              onOpenEntry,
            })
          : null,
      );
    }

    // ---------- 右键菜单 ----------
    // 两级：主菜单只列分类，点进去才展开具体选项。窄栏里悬停子菜单容易点飞，
    // 点进去反而稳，也更接近 Windows 右键菜单的手感。
    const PANE_TITLES = { view: '查看', sort: '排序方式', group: '分组依据', create: '新建' };

    function sortLabel(layout) {
      const found = SORTS.find(([key]) => key === layout.sort);
      return `${found ? found[1] : '名称'} · ${layout.desc ? '降序' : '升序'}`;
    }

    function groupLabel(layout) {
      const found = GROUPS.find(([key]) => key === layout.group);
      return found ? found[1] : '无';
    }

    function ContextMenu({ menu, layout, onLayout, onAction, onClose }) {
      const [pane, setPane] = useState('main');

      // 每次重新打开都回到主菜单，别停在上次点进去的那一级
      useEffect(() => {
        if (menu) setPane('main');
      }, [menu]);

      if (!menu) return null;

      const width = 208;
      const height = menu.volume ? 190 : pane === 'main' ? 370 : 220;
      const left = Math.max(8, Math.min(menu.x, (window.innerWidth || 1200) - width - 8));
      const top = Math.max(8, Math.min(menu.y, (window.innerHeight || 800) - height));

      const close = () => {
        setPane('main');
        onClose();
      };
      const pick = (action) => {
        setPane('main');
        onAction(action);
      };

      const row = (key, label, onClick, hint, chevron) =>
        h(
          'div',
          { key, className: 'dsk-mitem', onClick },
          h('span', { className: 'dsk-mlabel' }, label),
          hint ? h('span', { className: 'dsk-mhint' }, hint) : null,
          chevron ? h('span', { className: 'dsk-mchev' }, '›') : null,
        );

      const check = (key, label, on, onClick) =>
        h(
          'div',
          { key, className: 'dsk-mitem', onClick },
          h('span', { className: 'dsk-mcheck' }, on ? '✓' : ''),
          h('span', { className: 'dsk-mlabel' }, label),
        );

      // 磁盘卡片的菜单只有几件事，跟目录菜单不是一套
      if (menu.volume) {
        return h(
          'div',
          null,
          h('div', {
            className: 'dsk-mask',
            onClick: close,
            onContextMenu: (event) => {
              event.preventDefault();
              close();
            },
          }),
          h(
            'div',
            { className: 'dsk-menu', style: { left, top, width } },
            row('vopen', '打开', () => pick('open')),
            row('vnewtab', '在新标签页打开', () => pick('openTab')),
            h('div', { key: 'vs', className: 'dsk-sep' }),
            row('vcleanup', '磁盘体检（新对话）…', () => pick('cleanup')),
            row('vinfo', '属性', () => pick('info')),
          ),
        );
      }

      let body;
      if (pane === 'view') {
        body = [
          check('detail', '详细', !layout.compact, () => onLayout({ compact: false })),
          check('compact', '紧凑', layout.compact, () => onLayout({ compact: true })),
        ];
      } else if (pane === 'sort') {
        body = [
          check('name', '名称', layout.sort === 'name', () => onLayout({ sort: 'name' })),
          check('size', '大小', layout.sort === 'size', () => onLayout({ sort: 'size' })),
          check('mtime', '修改时间', layout.sort === 'mtime', () => onLayout({ sort: 'mtime' })),
          check('type', '类型', layout.sort === 'type', () => onLayout({ sort: 'type' })),
          h('div', { key: 's', className: 'dsk-sep' }),
          check('asc', '升序', !layout.desc, () => onLayout({ desc: false })),
          check('desc', '降序', layout.desc, () => onLayout({ desc: true })),
        ];
      } else if (pane === 'group') {
        body = [
          check('gnone', '（无）', layout.group === 'none', () => onLayout({ group: 'none' })),
          check('gtype', '类型', layout.group === 'type', () => onLayout({ group: 'type' })),
          check('gmtime', '修改日期', layout.group === 'mtime', () => onLayout({ group: 'mtime' })),
        ];
      } else if (pane === 'create') {
        body = [row('mkdir', '新建文件夹', () => pick('mkdir'))];
      } else {
        body = [
          menu.entry ? row('open', menu.entry.isDir ? '打开文件夹' : '打开', () => pick('open')) : null,
          menu.entry && !menu.entry.isDir
            ? row('openSystem', '用本机程序打开', () => pick('openSystem'))
            : null,
          menu.entry && !menu.entry.isDir && !isPreviewable(menu.entry.name)
            ? row('openPreview', '在右栏预览', () => pick('openPreview'))
            : null,
          menu.entry ? h('div', { key: 's1', className: 'dsk-sep' }) : null,
          menu.entry && menu.entry.isDir
            ? row('newtab', '在新标签页打开', () => pick('openTab'))
            : null,
          menu.entry?.desk ? row('drefresh', '刷新', () => pick('refresh')) : null,
          row('view', '查看', () => setPane('view'), layout.compact ? '紧凑' : '详细', true),
          row('sort', '排序方式', () => setPane('sort'), sortLabel(layout), true),
          row('group', '分组依据', () => setPane('group'), groupLabel(layout), true),
          h('div', { key: 's2', className: 'dsk-sep' }),
          row('create', '新建', () => setPane('create'), '', true),
          row('terminal', '在终端中打开', () => pick('terminal')),
          row('quote', '引用到会话', () => pick('quote')),
          row('reveal', '在资源管理器中显示', () => pick('reveal')),
          menu.entry ? row('info', '属性', () => pick('info')) : null,
          menu.entry && !menu.entry.volume && !menu.entry.desk
            ? h(
                'div',
                { key: 'del', className: 'dsk-mitem dsk-mitem-danger', onClick: () => pick('delete') },
                h('span', { className: 'dsk-mlabel' }, '删除'),
                h('span', { className: 'dsk-mhint' }, '进回收站'),
              )
            : null,
        ];
      }

      return h(
        'div',
        null,
        h('div', {
          className: 'dsk-mask',
          onClick: close,
          onContextMenu: (event) => {
            event.preventDefault();
            close();
          },
        }),
        h(
          'div',
          { className: 'dsk-menu', style: { left, top, width } },
          pane === 'main'
            ? null
            : h(
                'div',
                { className: 'dsk-mitem dsk-mback', onClick: () => setPane('main') },
                h('span', { className: 'dsk-mchev' }, '‹'),
                h('span', { className: 'dsk-mlabel' }, PANE_TITLES[pane]),
              ),
          pane === 'main' ? null : h('div', { className: 'dsk-sep' }),
          body,
        ),
      );
    }

    function Modal({ title, children, onClose }) {
      return h(
        'div',
        null,
        h('div', { className: 'dsk-mask', onClick: onClose }),
        h(
          'div',
          { className: 'dsk-modal' },
          h('div', { className: 'dsk-modal-title' }, title),
          children,
        ),
      );
    }

    function NewFolderModal({ parent, onCancel, onDone }) {
      const [name, setName] = useState('新建文件夹');
      const [busy, setBusy] = useState(false);
      const inputRef = useRef(null);

      useEffect(() => {
        inputRef.current?.focus?.();
        inputRef.current?.select?.();
      }, []);

      const submit = async () => {
        const leaf = name.trim();
        if (leaf === '' || busy) return;
        setBusy(true);
        try {
          await call('mkdir', { parent, name: leaf });
          onDone('');
        } catch (err) {
          onDone(String(err.message || err));
        }
      };

      return h(
        Modal,
        { title: '新建文件夹', onClose: onCancel },
        h('div', { className: 'dsk-hint' }, parent),
        h('input', {
          ref: inputRef,
          className: 'dsk-input',
          value: name,
          spellCheck: false,
          onChange: (event) => setName(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') void submit();
            if (event.key === 'Escape') onCancel();
          },
        }),
        h(
          'div',
          { className: 'dsk-modal-row' },
          h('button', { className: 'dsk-btn', onClick: onCancel }, '取消'),
          h('button', { className: 'dsk-btn dsk-btn-primary', onClick: () => void submit() }, busy ? '创建中…' : '创建'),
        ),
      );
    }

    function DeleteModal({ target, onCancel, onDone }) {
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      const confirm = async () => {
        if (busy) return;
        setBusy(true);
        try {
          await call('trash', { path: target.path });
          onDone();
        } catch (err) {
          const raw = String(err?.message || err);
          // 新端点要宿主重启才注册进来，原始报文对用户没有信息量
          setError(/unknown dsh-disk endpoint/i.test(raw)
            ? '删除功能在插件宿主侧，重启一次 DSH 之后才能用'
            : raw);
          setBusy(false);
        }
      };

      return h(
        Modal,
        { title: target.isDir ? '删除文件夹' : '删除文件', onClose: onCancel },
        h(
          'div',
          { className: 'dsk-hint', style: { whiteSpace: 'normal', lineHeight: 1.6 } },
          target.name,
        ),
        h(
          'div',
          { className: 'dsk-hint', style: { whiteSpace: 'normal', lineHeight: 1.6 } },
          '会移到回收站，需要时可以还原。',
        ),
        error
            ? h('div', { className: error === HOST_HINT ? 'dsk-err-host' : 'dsk-err' }, error)
            : null,
        h(
          'div',
          { className: 'dsk-modal-row' },
          h('button', { className: 'dsk-btn', onClick: onCancel }, '取消'),
          h('button', { className: 'dsk-btn dsk-btn-danger', onClick: () => void confirm() }, busy ? '删除中…' : '移到回收站'),
        ),
      );
    }

    function InfoModal({ info, onClose }) {
      const rows = [
        ['名称', info.name],
        ['类型', info.isDir ? '文件夹' : `${(extOf(info.name) || '文件').toUpperCase()} 文件`],
        ['大小', info.isDir ? '目录（用「算大小」统计）' : fmtBytes(info.size)],
        ['创建时间', fmtTime(info.birthtime)],
        ['修改时间', fmtTime(info.mtime)],
        ['只读', info.readonly ? '是' : '否'],
        ['位置', info.path],
      ];
      return h(
        Modal,
        { title: '属性', onClose },
        h(
          'div',
          { className: 'dsk-kv' },
          rows.map(([key, value]) => h(
            'div',
            { key, className: 'dsk-kv-row' },
            h('span', { className: 'dsk-kv-k' }, key),
            h('span', { className: 'dsk-kv-v', title: value }, value),
          )),
        ),
        h(
          'div',
          { className: 'dsk-modal-row' },
          h('button', { className: 'dsk-btn', onClick: onClose }, '关闭'),
        ),
      );
    }

    // ---------- tab 标题 ----------
    // 官方在没有 title 席位时用「打开瞬间捕获的文本」，那一帧 tab 记录常常还没提交，
    // 结果 chip 上只剩图标、文字是空的。这里改成自己算，并且任何异常都退回「磁盘」，
    // 宁可标题笼统，也不要一片空白。
    function TabTitle({ useTabInfo }) {
      // chip 只有几十像素宽，整条路径塞不下：显示最后一段目录名，全路径挂 title 属性。
      // 反斜杠在源码和正则里都是雷区，这里统一换成正斜杠再切。
      let label = '磁盘';
      let full = '';
      try {
        const info = typeof useTabInfo === 'function' ? useTabInfo() : null;
        const address = String(info?.tab?.contentId || info?.tab?.address || '');
        const tail = address.split('/').pop() || '';
        full = tail === '' ? '' : decodeURIComponent(tail);
        if (full !== '') {
          const parts = full.split(String.fromCharCode(92)).join('/').split('/').filter(Boolean);
          label = parts.length > 0 ? parts[parts.length - 1] : full;
        }
      } catch {
        // tab 记录还没提交：用兜底文字，下一帧会自己更正
      }
      return h('span', { className: 'dsk-tabtitle', title: full || label }, label);
    }

    // ---------- 地址栏：点一下变输入框，回车跳到任意路径 ----------
    function PathBar({ path, onGo, placeholder }) {
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(path || '');
      const inputRef = useRef(null);

      useEffect(() => {
        setDraft(path || '');
      }, [path]);

      useEffect(() => {
        if (editing) {
          inputRef.current?.focus?.();
          inputRef.current?.select?.();
        }
      }, [editing]);

      const commit = () => {
        const next = draft.trim();
        setEditing(false);
        if (next !== '' && next !== path) onGo(next);
      };

      if (editing) {
        return h('input', {
          ref: inputRef,
          className: 'dsk-path-input',
          value: draft,
          spellCheck: false,
          onChange: (event) => setDraft(event.target.value),
          onBlur: commit,
          onKeyDown: (event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(path || '');
              setEditing(false);
            }
          },
        });
      }

      return h(
        'button',
        {
          className: 'dsk-path-btn',
          title: path || placeholder || '',
          onClick: () => setEditing(true),
        },
        path || placeholder || '',
      );
    }

    function injectStyle() {
      // 热更新时旧 <style> 还在，早退会让新加的规则永远进不来（菜单和弹窗曾是裸样式就是这个原因）。
      // 所以存在就对比后重写，标签本身复用。
      let tag = document.getElementById('dsk-style');
      if (!tag) {
        tag = document.createElement('style');
        tag.id = 'dsk-style';
        document.head.appendChild(tag);
      }
      if (tag.textContent !== CSS) tag.textContent = CSS;
    }

    // ---------- 卷总览 ----------
    function VolumesView({
      data, loading, error, onOpen, onRefresh, onGo, onMenu,
      onDesktop, onDesktopMenu, onDesktopEnter, onDesktopLeave,
      desk, onOpenEntry, onPeekItem, onItemMenu,
    }) {
      // 展开全部就地展开，不再跳到目录视图——用户要的是「看到剩下的」，不是「换个地方看」
      const [deskExpanded, setDeskExpanded] = useState(false);
      if (loading && !data) return h('div', { className: 'dsk-empty' }, '读取卷信息…');
      const volumes = data?.volumes ?? [];
      return h(
        'div',
        { className: 'dsk-root' },
        h(
          'div',
          { className: 'dsk-head' },
          h(PathBar, { path: '', onGo, placeholder: '此电脑' }),
          h('button', { className: 'dsk-iconbtn', onClick: onRefresh, title: '刷新' }, '⟳'),
        ),
        h(
          'div',
          { className: 'dsk-body' },
          error
            ? h('div', { className: error === HOST_HINT ? 'dsk-err-host' : 'dsk-err' }, error)
            : null,
          volumes.length === 0 && !error
            ? h('div', { className: 'dsk-empty' }, '没有读到任何卷')
              : [
                  h('div', { key: 'head', className: 'dsk-grouphead' }, '▾ 设备和驱动器'),
                  ...volumes.map((v) => {
                const percent = v.total > 0 ? Math.round((v.used / v.total) * 100) : 0;
                // 资源管理器的进度条是该死的蓝，不跟皮肤变；只在快满时才转红提示
                const tone = percent >= 90 ? '#d13438' : '#0078d4';
                // 「此电脑」的排法：磁盘图标 + 「卷标 (盘符)」+ 进度条 + 「X 可用，共 Y」
                const title = `${v.label || '本地磁盘'} (${v.letter}:)`;
                return h(
                  'div',
                  {
                    key: v.letter,
                    className: 'dsk-vol',
                    title,
                    onClick: () => onOpen(v.root),
                    onContextMenu: (event) => onMenu(event, v),
                  },
                  h('span', { className: 'dsk-diskicon' }, h(DiskIcon, { size: 34 })),
                  h(
                    'div',
                    { className: 'dsk-vol-main' },
                    h(
                      'div',
                      { className: 'dsk-vol-head' },
                      h('span', { className: 'dsk-vol-title' }, title),
                      h('span', { className: 'dsk-pct' }, `${percent}%`),
                    ),
                    h(
                      'div',
                      { className: 'dsk-bar' },
                      h('div', {
                        className: 'dsk-bar-fill',
                        style: { width: `${Math.min(percent, 100)}%`, background: tone },
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsk-vol-meta' },
                      `${fmtBytes(v.free)} 可用，共 ${fmtBytes(v.total)}`,
                    ),
                  ),
                );
              }),
                ]
        ),
      );
    }

    // ---------- 目录浏览 ----------
    function DirView({
      path, data, loading, error, sizes, layout,
      onEnter, onUp, onMeasure, onBack, onRefresh, onOpen, onMenu, onGo,
    }) {
      const entries = data?.entries ?? [];

      // 目录页原来只会画通用文档图标，桌面上的 .lnk / .exe 全是一个样。
      // 这里按当前目录批量问宿主拿真图标（宿主那边有缓存，重复进目录不会再起 PowerShell）。
      const [appIcons, setAppIcons] = useState({});
      useEffect(() => {
        const wanted = entries
          .filter((e) => !e.isDir && /\.(exe|lnk|url|bat|cmd|msc|appref-ms)$/i.test(e.name))
          .map((e) => e.path);
        if (wanted.length === 0) return undefined;
        let alive = true;
        call('icons', { paths: wanted })
          .then((map) => {
            if (alive && map) setAppIcons(map);
          })
          .catch(() => {
            // 图标拿不到就用通用图标兜着，不影响列表
          });
        return () => {
          alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [data]);

      // 树状浏览：目录行点一下就展开子项，不用整页跳走。
      // 子目录内容按需拉（ls 端点），拉过就缓存，折叠再展开不重复请求。
      // 列表 / 方块两种看法的切换，状态放在组件里，切目录不重置
      const [viewMode, setViewMode] = useState('list');
      const [tree, setTree] = useState({});
      const [expanded, setExpanded] = useState(() => new Set());
      const [busy, setBusy] = useState({});

      useEffect(() => {
        // 换目录就清空，否则会拿上一个目录的展开状态去渲染新目录
        setTree({});
        setExpanded(new Set());
        setBusy({});
      }, [path]);

      // 自动扫描时要在循环里读到最新的 sizes，闭包里的 sizes 是渲染时的旧值
      const sizesRef = useRef(sizes);
      useEffect(() => {
        sizesRef.current = sizes;
      }, [sizes]);

      // 进目录后自动算所有子目录的体积：3 个并发，算完一条填一条。
      // 并发放到 3 是因为宿主每算一个目录就是一次完整递归，4 个会把主进程拖住。
      // 复用现有的 size 端点与 onMeasure，不新增端点。
      useEffect(() => {
        const dirs = entries.filter((e) => e.isDir).map((e) => e.path);
        if (dirs.length === 0) return undefined;
        let cancelled = false;
        let cursor = 0;
        const worker = async () => {
          while (!cancelled) {
            const index = cursor;
            cursor += 1;
            if (index >= dirs.length) return;
            const target = dirs[index];
            // undefined = 没算过；null = 正在算；对象 = 有结果
            if (sizesRef.current[target] !== undefined) continue;
            try {
              await onMeasure(target, true);
            } catch {
              // 单个目录失败不影响其它项，错误由 measure 内部报
            }
          }
        };
        for (let i = 0; i < 3; i += 1) void worker();
        return () => {
          cancelled = true;
        };
        // 只在目录内容变化时重跑；sizes 变化不该触发新一轮扫描
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [data]);

      const toggleDir = async (entry) => {
        const target = entry.path;
        if (expanded.has(target)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(target);
            return next;
          });
          return;
        }
        setExpanded((prev) => new Set(prev).add(target));
        if (Object.prototype.hasOwnProperty.call(tree, target)) return;
        setBusy((prev) => ({ ...prev, [target]: true }));
        try {
          const res = await call('ls', { path: target });
          setTree((prev) => ({ ...prev, [target]: res?.entries ?? [] }));
        } catch {
          setTree((prev) => ({ ...prev, [target]: null }));
        } finally {
          setBusy((prev) => ({ ...prev, [target]: false }));
        }
      };

      // 条宽按「本层最大项」归一，百分比按「本层合计」算：两个口径分开给，不混用
      let maxDirBytes = 0;
      let totalDirBytes = 0;
      for (const item of entries) {
        if (!item.isDir) continue;
        const m = sizes[item.path];
        if (!m || typeof m.bytes !== 'number') continue;
        if (m.bytes > maxDirBytes) maxDirBytes = m.bytes;
        totalDirBytes += m.bytes;
      }

      // 方块视图：面积严格等于体积。只画已经算出体积的项，
      // 没算出来的不画（画成 0 面积会被误读成「这目录是空的」）。
      const renderBoxes = () => {
        const list = sortEntries(entries, layout, sizes)
          .map((entry) => {
            const measured = sizes[entry.path];
            const bytes = entry.isDir
              ? measured && typeof measured.bytes === 'number'
                ? measured.bytes
                : 0
              : entry.size || 0;
            return { entry, size: bytes };
          })
          .filter((item) => item.size > 0);

        if (list.length === 0) {
          return h('div', { className: 'dsk-empty' }, '体积还在算，等几秒再切过来');
        }

        const boxes = boxLayout(list, 0, 0, 100, 100);
        return h(
          'div',
          { style: { position: 'relative', width: '100%', height: '100%', minHeight: '240px' } },
          boxes.map((box) => {
            const wide = box.w > 14 && box.h > 10;
            const tall = box.h > 16;
            return h(
              'div',
              {
                key: box.item.entry.path,
                title: `${box.item.entry.name} · ${fmtBytes(box.item.size)}`,
                onClick: () =>
                  box.item.entry.isDir ? onEnter(box.item.entry.path) : onOpen(box.item.entry),
                style: {
                  position: 'absolute',
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.w}%`,
                  height: `${box.h}%`,
                  padding: '1px',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                },
              },
              h(
                'div',
                {
                  style: {
                    width: '100%',
                    height: '100%',
                    borderRadius: '4px',
                    background: boxColor(box.item.entry),
                    color: '#000',
                    border: '1px solid rgba(0,0,0,.18)',
                    fontSize: '11px',
                    lineHeight: '1.35',
                    padding: '5px',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                  },
                },
                wide
                  ? h(
                      'span',
                      { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                      box.item.entry.name,
                    )
                  : null,
                wide && tall ? h('span', { style: { opacity: 0.82 } }, fmtBytes(box.item.size)) : null,
              ),
            );
          }),
        );
      };

      const renderRow = (entry, depth = 0) => {
        const measured = sizes[entry.path];
        const sizeText = layout.compact
          ? ''
          : entry.isDir
            ? measured
              ? `${fmtBytes(measured.bytes)}${measured.done ? '' : '…'}`
              : ''
            : fmtBytes(entry.size);
        return h(
          'div',
          {
            key: entry.path,
            className: `dsk-row dsk-row-vol${entry.isDir ? ' dsk-row-dir' : ''}`,
            title: entry.path,
            style: { paddingLeft: 6 + depth * 16 },
            draggable: !entry.isDir,
            onMouseDown: entry.isDir ? undefined : () => prefetchDrag(entry.path, entry.size),
            onDragStart: entry.isDir ? undefined : (event) => startDrag(event, entry),
            onDragEnd: entry.isDir ? undefined : endDrag,
            // 单击目录就地展开/收起；想整页进入目录用双击
            onClick: () => (entry.isDir ? void toggleDir(entry) : onOpen(entry)),
            onDoubleClick: entry.isDir ? () => onEnter(entry.path) : undefined,
            onContextMenu: (event) => {
              event.preventDefault();
              event.stopPropagation();
              onMenu(event, entry);
            },
          },
          h(
            'span',
            { style: { width: 12, flex: '0 0 auto', fontSize: 10, opacity: 0.7 } },
            entry.isDir ? (expanded.has(entry.path) ? '▾' : '▸') : '',
          ),
          h(
            'span',
            { className: 'dsk-ico' },
            entry.isDir
              ? h(FolderIcon, null)
              : appIcons[entry.path]
                ? h('img', { className: 'dsk-appicon', src: appIcons[entry.path], alt: '' })
                : h(FileIcon, { name: entry.name }),
          ),
          h('span', { className: 'dsk-name' }, entry.name),
          // 占比条：条宽按「本层最大项」归一（最大那个满格），右边常显的百分比按「本层合计」算。
          // 两个口径分开用，不混。还没算出来的目录条是空的，不画成 0 长度实心条假装有数据。
          (() => {
            if (!entry.isDir) return null;
            const m = sizes[entry.path];
            const done = m && typeof m.bytes === 'number';
            const width = done && maxDirBytes > 0 ? Math.max(2, Math.round((m.bytes / maxDirBytes) * 100)) : 0;
            const pct = done && totalDirBytes > 0 ? ((m.bytes / totalDirBytes) * 100).toFixed(1) + '%' : '';
            return [
              h(
                'span',
                { key: 'bar', className: 'dsk-ratio', title: done ? `占本层 ${pct}` : '还没算' },
                h('i', { style: { width: `${width}%` } }),
              ),
              h('span', { key: 'sp1', className: 'dsk-sp' }),
              h('span', { key: 'pct', className: 'dsk-pct' }, done ? pct : ''),
              h('span', { key: 'sp2', className: 'dsk-sp' }),
            ];
          })(),
          entry.isDir && !layout.compact
            ? [
                h('button', {
                  key: 'calc',
                  className: 'dsk-calc',
                  onClick: (event) => {
                    event.stopPropagation();
                    onMeasure(entry.path);
                  },
                  title: '统计这个目录的大小',
                }, measured ? '重算' : '算大小'),
                h('span', { key: 'sp3', className: 'dsk-sp' }),
              ]
            : null,
          h('span', { className: 'dsk-size' }, sizeText),
        );
      };

      // 排序和分组都在前端做：host 只给一层原始条目，换排序不该再打一次盘
      const rows = [];
      let currentGroup = null;
      for (const entry of sortEntries(entries, layout, sizes)) {
        if (layout.group !== 'none') {
          const group = groupOf(entry, layout.group);
          if (group !== currentGroup) {
            currentGroup = group;
            rows.push({ kind: 'group', key: `g:${group}:${entry.path}`, label: group });
          }
        }
        rows.push({ kind: 'row', key: entry.path, entry });
      }

      return h(
        'div',
        { className: 'dsk-root' },
        h(
          'div',
          { className: 'dsk-head' },
          h('button', { className: 'dsk-iconbtn', onClick: onBack, title: '回到卷列表' }, '←'),
          h(PathBar, { path, onGo, placeholder: '输入路径回车跳转' }),
          h('button', {
            className: 'dsk-iconbtn',
            onClick: onUp,
            disabled: !data?.parent,
            title: '上一级',
          }, '↑'),
          h('button', { className: 'dsk-iconbtn', onClick: onRefresh, title: '刷新' }, '⟳'),
          h(
            'button',
            {
              className: 'dsk-iconbtn',
              title: viewMode === 'map' ? '切回列表' : '按体积看方块',
              style: { opacity: viewMode === 'map' ? 1 : 0.6 },
              onClick: () => setViewMode((prev) => (prev === 'map' ? 'list' : 'map')),
            },
            '▦',
          ),
          h('button', {
            className: 'dsk-iconbtn',
            title: '更多操作',
            onClick: (event) => {
              event.preventDefault();
              onMenu(event, null);
            },
          }, '⋯'),
        ),
        h(
          'div',
          { className: 'dsk-body' },
          error
            ? h('div', { className: error === HOST_HINT ? 'dsk-err-host' : 'dsk-err' }, error)
            : null,
          loading && entries.length === 0 ? h('div', { className: 'dsk-empty' }, '读取目录…') : null,
          viewMode === 'map'
            ? renderBoxes()
            : (() => {
            // 把「扁平 rows + 已展开的子树」摊成一张有序的可见行清单
            const out = [];
            const walk = (list, depth) => {
              for (const node of list) {
                if (node.kind === 'group') {
                  out.push({ kind: 'group', key: node.key, label: node.label, depth });
                  continue;
                }
                out.push({ kind: 'row', key: node.key, entry: node.entry, depth });
                const target = node.entry.path;
                if (!node.entry.isDir || !expanded.has(target)) continue;
                if (busy[target]) {
                  out.push({ kind: 'note', key: `${node.key}:busy`, text: '读取中…', depth: depth + 1 });
                  continue;
                }
                const kids = tree[target];
                if (kids === null) {
                  out.push({ kind: 'note', key: `${node.key}:err`, text: '这个目录打不开', depth: depth + 1 });
                  continue;
                }
                if (kids === undefined) continue;
                walk(kids.map((child) => ({ kind: 'row', key: child.path, entry: child })), depth + 1);
              }
            };
            walk(rows, 0);
            return out.map((node) =>
              node.kind === 'group'
                ? h('div', { key: node.key, className: 'dsk-group' }, node.label)
                : node.kind === 'note'
                  ? h(
                      'div',
                      { key: node.key, className: 'dsk-hint', style: { paddingLeft: 6 + node.depth * 16, marginBottom: 0 } },
                      node.text,
                    )
                  : renderRow(node.entry, node.depth),
            );
          })(),
          entries.length === 0 && !loading && !error ? h('div', { className: 'dsk-empty' }, '空目录') : null,
          data?.truncated ? h('div', { className: 'dsk-empty' }, '条目过多，只显示前 800 项') : null,
        ),
      );
    }

    // 方块配色：统一纯白底，方块之间靠 1px 间隙区分；文字纯黑
    function boxColor() {
      return '#ffffff';
    }

    // 二分切分：每次按体积把当前矩形切成两半，交替横竖切。
    // 不是 squarified，但「面积 = 体积」这个性质成立，够用且好懂。
    function boxLayout(items, x, y, w, h) {
      if (items.length === 0) return [];
      if (items.length === 1) return [{ item: items[0], x, y, w, h }];
      const total = items.reduce((sum, i) => sum + i.size, 0) || 1;
      let acc = 0;
      let split = 1;
      for (let i = 0; i < items.length; i += 1) {
        acc += items[i].size;
        if (acc >= total / 2) {
          split = i + 1;
          break;
        }
      }
      if (split >= items.length) split = items.length - 1;
      const head = items.slice(0, split);
      const tail = items.slice(split);
      const headTotal = head.reduce((sum, i) => sum + i.size, 0);
      const ratio = headTotal / total;
      // 宽了就横切、高了就竖切：每块长宽比更接近 1，小项不会挤成面条
      const horizontal = w >= h;
      if (horizontal) {
        const cut = w * ratio;
        return [...boxLayout(head, x, y, cut, h), ...boxLayout(tail, x + cut, y, w - cut, h)];
      }
      const cut = h * ratio;
      return [...boxLayout(head, x, y, w, cut), ...boxLayout(tail, x, y + cut, w, h - cut)];
    }

    // ---------- tab 正文 ----------
    // 渲染兜底：面板里任何一块抛错，只把这一块换成一行报错，不让整个 tab 变成空白。
    // 之前几次「点开一片空白/像没反应」都是异常直接吞掉了整棵组件树，屏幕上一点线索都没有。
    // 用 IIFE 守一道：万一这版宿主的 react 没有 class 组件支持，就退化成透传，绝不因此把插件带崩。
    const Boundary = (() => {
      const Base = react.Component;
      if (typeof Base !== 'function') return (props) => props.children;
      return class Boundary extends Base {
        constructor(props) {
          super(props);
          this.state = { err: null };
        }

        static getDerivedStateFromError(err) {
          return { err };
        }

        componentDidCatch(err) {
          console.error('[dsh-disk] 面板渲染出错', err);
        }

        render() {
          if (this.state.err) {
            const msg = String((this.state.err && this.state.err.message) || this.state.err);
            return h('div', { className: 'dsk-err', style: { margin: '8px' } }, `面板渲染出错：${msg}`);
          }
          return this.props.children;
        }
      };
    })();

    function DiskPane({ sessionId, nav, useTabInfo }) {
      // 资源型 tab 的地址末段就是打开时指定的路径；拿不到就退回「记住上次」。
      // 顺带用它当记忆键：两个磁盘 tab 各记各的，不会互相覆盖。
      const tabInfo = (() => {
        try {
          return typeof useTabInfo === 'function' ? useTabInfo() : null;
        } catch {
          return null;
        }
      })();
      const tabRecord = tabInfo?.tab ?? null;
      const startPath = (() => {
        const address = tabRecord?.contentId ?? tabRecord?.address;
        if (typeof address !== 'string') return '';
        const tail = address.split('/').pop();
        if (!tail) return '';
        try {
          const decoded = decodeURIComponent(tail);
          return decoded === '此电脑' ? '' : decoded;
        } catch {
          return '';
        }
      })();
      const storageKey = tabRecord?.id || sessionId || 'global';
      const [view, setView] = useState('volumes');
      const [path, setPath] = useState('');
      const [volumes, setVolumes] = useState(null);
      const [listing, setListing] = useState(null);
      const [sizes, setSizes] = useState({});
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      // 默认按体积倒序：进目录第一眼想看的是「谁最占地方」
      const [layout, setLayoutState] = useState({ sort: 'size', desc: true, group: 'none', compact: false });
      const [menu, setMenu] = useState(null);
      const [modal, setModal] = useState(null);
      const [notice, setNotice] = useState('');
      const [peek, setPeek] = useState(null);
      const [desk, setDesk] = useState(null);
      const peekTimer = useRef(null);
      const peekShowTimer = useRef(null);
      const peekSeq = useRef(0);
      const alive = useRef(true);

      // 卷视图里直接把桌面内容铺出来，进视图时取一次。
      // 位置故意放在 alive 之后：前面几轮有两次被「首尾锚点整段替换」顺手删掉过。
      const loadDesktop = useCallback(async () => {
        setDesk((prev) => ({
          path: prev?.path || '',
          entries: prev?.entries || [],
          loading: true,
          error: '',
        }));
        try {
          const info = await call('desktop');
          const target = info?.path || '';
          if (target === '') throw new Error('系统没给出桌面路径');
          const listing = await call('ls', { path: target });
          if (!alive.current) return;
          const entries = listing.entries || [];
          setDesk({ path: target, entries, icons: {}, loading: false, error: '' });
          // 快捷方式单独补图标：一次批量问宿主，失败就保持默认图标
          const links = entries
            .filter((item) => /\.lnk$/i.test(item.name))
            .map((item) => item.path);
          if (links.length > 0) {
            void call('icons', { paths: links })
              .then((map) => {
                if (alive.current) setDesk((prev) => (prev ? { ...prev, icons: map || {} } : prev));
              })
              .catch(() => {});
          }
        } catch (err) {
          if (!alive.current) return;
          const message = String(err?.message || err);
          if (/ENOENT|no such file/i.test(message)) {
            setDesk({ path: '', entries: [], icons: {}, loading: false, error: '' });
            return;
          }
          setDesk({ path: '', entries: [], icons: {}, loading: false, error: friendlyError(err) });
        }
      }, []);

      useEffect(() => {
        if (view === 'volumes' && desk === null) void loadDesktop();
      }, [view, desk, loadDesktop]);

      // sessionId 可能晚一步才有值，用 ref 兜住，免得 loadDir 的依赖跟着抖
      const keyRef = useRef(storageKey);
      keyRef.current = storageKey;
      const restoredRef = useRef(false);

      useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      const loadVolumes = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const value = await call('volumes');
          if (alive.current) setVolumes(value);
        } catch (err) {
          if (alive.current) setError(friendlyError(err));
        } finally {
          if (alive.current) setLoading(false);
        }
      }, []);

      const loadDir = useCallback(async (target) => {
        setLoading(true);
        setError('');
        try {
          const value = await call('ls', { path: target });
          if (!alive.current) return;
          setListing(value);
          setPath(value.path);
          setView('dir');
          saveLast(keyRef.current, { view: 'dir', path: value.path });
          return true;
        } catch (err) {
          if (alive.current) setError(friendlyError(err));
          return false;
        } finally {
          if (alive.current) setLoading(false);
        }
      }, []);

      // 打开过文件再点回磁盘时，回到上次停留的目录而不是卷列表。
      // 等 sessionId 到位再跑，且只跑一次（keepMounted 后组件不会重建）。
      const tabReady = tabInfo !== null;

      const restoreTo = (target) => {
        if (!target) return;
        void loadDir(target).then((ok) => {
          if (!ok) saveLast(storageKey, null);
        });
      };

      useEffect(() => {
        if (restoredRef.current) return;

        // tab 记录没就绪（useTabInfo 抛错）时先别锁死：等一帧再试，超时再用记忆兜底，
        // 否则「在新标签页打开」会时不时退回卷列表。
        if (!tabReady) {
          const timer = setTimeout(() => {
            if (restoredRef.current) return;
            restoredRef.current = true;
            restoreTo(readLast(storageKey)?.path);
          }, 900);
          return () => clearTimeout(timer);
        }

        restoredRef.current = true;
        // 地址是唯一真相：tab 记录说去哪儿就去哪儿，「此电脑」就停在卷列表。
        // 只有连 tab 记录都拿不到时，才用 localStorage 兜底 ——
        // 否则点会话头的磁盘入口会被上次的目录（比如桌面）顶掉。
        const fromTab = startPath || takeTarget();
        const fallback = tabRecord ? '' : readLast(storageKey)?.path;
        restoreTo(fromTab || fallback);
        return undefined;
      }, [tabReady, startPath, storageKey, loadDir]);

      useEffect(() => {
        if (view === 'volumes' && volumes === null) void loadVolumes();
      }, [view, volumes, loadVolumes]);

      // 卷列表每 5 秒刷新一次：插拔 U 盘、拷贝大文件时数字要跟得上
      useEffect(() => {
        if (view !== 'volumes') return undefined;
        const timer = setInterval(() => {
          void call('volumes')
            .then((value) => {
              if (alive.current) setVolumes(value);
            })
            .catch(() => {});
        }, 5000);
        return () => clearInterval(timer);
      }, [view]);

      // silent=true 时失败不弹红条：自动扫描碰到的权限拒绝（System Volume Information、
      // Documents and Settings 这类）属于正常情况，不该当故障提示
      const measure = useCallback(async (target, silent) => {
        setSizes((prev) => ({ ...prev, [target]: prev[target] ?? null }));
        try {
          const value = await call('size', { path: target, deadlineMs: 3000 });
          if (!alive.current) return;
          setSizes((prev) => ({ ...prev, [target]: value }));
        } catch (err) {
          if (!alive.current) return;
          // 失败/超时的项要从 sizes 里摘掉（回到 undefined），下次进目录才会重试；
          // 留在 null 会让它永远停在「算中」，而 null 被当成「算过」直接跳过。
          setSizes((prev) => {
            const next = { ...prev };
            delete next[target];
            return next;
          });
          if (!silent) setError(friendlyError(err));
        }
      }, []);

      useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(''), 5000);
        return () => clearTimeout(timer);
      }, [notice]);

      const updateLayout = useCallback((patch) => {
        setLayoutState((prev) => ({ ...prev, ...patch }));
        setMenu(null);
      }, []);

      // mode: 'auto'（默认，按类型判断）/ 'preview'（强制走右栏）/ 'system'（强制本机程序）
      const openEntry = useCallback(async (entry, mode) => {
        if (!entry) return;
        if (entry.isDir) {
          void loadDir(entry.path);
          return;
        }
        const wantPreview = mode === 'preview' || (mode !== 'system' && isPreviewable(entry.name));
        if (wantPreview && sessionId && nav && typeof nav.openResource === 'function') {
          try {
            nav.openResource(fileAddress(sessionId, entry.path));
            return;
          } catch (err) {
            console.warn('[dsh-disk] 右栏没接手，改用系统程序', err);
          }
        }
        try {
          await call('open', { path: entry.path });
        } catch (err) {
          setError(friendlyError(err));
        }
      }, [loadDir, nav, sessionId]);

      const runAction = useCallback(async (action) => {
        const entry = menu?.entry ?? null;
        const target = entry?.path ?? listing?.path ?? path;
        setMenu(null);
        if (action === 'open') {
          void openEntry(entry, 'auto');
          return;
        }
        if (action === 'refresh') {
          if (view === 'volumes') void loadVolumes();
          else void loadDir(path);
          return;
        }
        if (action === 'openPreview') {
          void openEntry(entry, 'preview');
          return;
        }
        if (action === 'openSystem') {
          void openEntry(entry, 'system');
          return;
        }
        // 新标签页：把目标目录编进地址，官方按地址区分内容，于是多开一个
        if (action === 'openTab') {
          const target = entry?.path;
          if (!target) return;
          rememberTarget(target);
          try {
            if (typeof nav?.openResource === 'function') {
              nav.openResource(`dsh-resource://disk/${encodeURIComponent(target)}`);
            } else {
              nav.openTab(KIND);
            }
          } catch (err) {
            console.warn('[dsh-disk] 新标签页打开失败', err);
          }
          return;
        }
        // 引用到会话：按官方认的引用语法 @[名字](资源地址) 写进当前输入框。
        // 会话引用就是这么写的，这里把 uri 换成 dsh-resource 的文件地址，
        // 右栏点得开、模型也拿得到完整路径。
        if (action === 'quote') {
          const quoteTarget = entry?.path ?? listing?.path ?? path;
          if (!quoteTarget) return;
          const label = entry?.name || quoteTarget.split(/[\\/]/).pop() || quoteTarget;
          const text = sessionId
            ? `@[${label}](${fileAddress(sessionId, quoteTarget)})`
            : `@${quoteTarget}`;
          const box = visibleComposers()[0];
          let filled = false;
          if (box) {
            try {
              filled = await fillComposer(box, text);
            } catch {
              filled = false;
            }
          }
          if (!filled) {
            try {
              await navigator.clipboard.writeText(text);
              setNotice(`输入框没接住，已复制：${label}`);
            } catch {
              setNotice('写入输入框和复制都没成功');
            }
            return;
          }
          setNotice(`已引用：${label}`);
          return;
        }
        if (action === 'mkdir') {
          setModal({ kind: 'mkdir', parent: listing?.path || path });
          return;
        }
        // 磁盘体检：把这块盘的真实数据写进提示词，复制到剪贴板，再开一个新对话。
        // 官方没有公开的「往输入框塞文本」接口，所以最后一步是 Ctrl+V，
        // 但不至于让用户自己拼盘符和容量。
        if (action === 'cleanup') {
          const volume = menu?.entry?.volume;
          const letter = volume?.letter || '';
          const percent = volume && volume.total > 0 ? Math.round((volume.used / volume.total) * 100) : 0;
          const prompt =
            `请对我当前选中的磁盘进行体检，并给出优化建议。\n` +
            `目标：${volume?.label || '本地磁盘'}（${letter}:）\n` +
            `容量：共 ${fmtBytes(volume?.total || 0)}，可用 ${fmtBytes(volume?.free || 0)}，已用 ${percent}%\n` +
            `请先自己扫一遍这块盘上的大目录和大文件（可以用 shell 命令），再按「能立刻清掉的 / 需要判断的 / 不建议动的」三档给建议，并标明每一项大概能省多少空间。`;
          let copied = false;
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(prompt);
              copied = true;
            }
          } catch (err) {
            console.warn('[dsh-disk] 浏览器剪贴板被拒，走宿主兜底', err);
          }
          if (!copied) {
            try {
              await call('clipboard', { text: prompt });
              copied = true;
            } catch (err) {
              console.warn('[dsh-disk] 宿主剪贴板也失败', err);
            }
          }
          try {
            uiWorkspace?.startSession?.();
          } catch (err) {
            console.warn('[dsh-disk] 开新会话失败', err);
          }
          // 自动填进输入框；填不进去也已经复制好了，用户按 Ctrl+V 一样能用
          // 开新会话这一步会切视图；等新输入框出现再写，别写进当前会话
          const filled = await fillNewComposer(prompt);
          setNotice(filled
            ? '提示词已写进输入框，确认后回车发送'
            : copied
              ? '提示词已复制，在新对话里按 Ctrl+V 发送'
              : '新对话已开，请在对话里描述要体检的盘');
          return;
        }

        if (action === 'delete') {
          if (!entry?.path) return;
          setModal({ kind: 'delete', path: entry.path, name: entry.name, isDir: entry.isDir });
          return;
        }

        if (action === 'info') {
          try {
            const value = await call('info', { path: target });
            if (alive.current) setModal({ kind: 'info', info: value });
          } catch (err) {
            if (alive.current) setError(friendlyError(err));
          }
          return;
        }
        try {
          await call(action, { path: target });
        } catch (err) {
          setError(friendlyError(err));
        }
      }, [menu, listing, path, openEntry, sessionId]);

      const openMenu = useCallback((event, entry) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX || 120, y: event.clientY || 120, entry: entry ?? null });
      }, []);

      // 磁盘卡片右键：菜单要知道这是一块盘，不是目录
      const goDesktop = useCallback(async () => {
        try {
          const value = await call('desktop');
          if (value?.path) void loadDir(value.path);
          else setError('系统没给出桌面路径（可能是权限或 OneDrive 重定向没解析出来）');
        } catch (err) {
          const raw = String(err?.message || err || '');
          // 新端点要宿主重启才注册进来，这条错误原文对用户没有意义
          setError(/unknown dsh-disk endpoint/i.test(raw)
            ? '桌面入口是插件宿主侧的能力，重启一次 DSH 之后才能用'
            : raw || '打开桌面失败');
        }
      }, [loadDir]);

      // 悬停预览：延迟 260ms 再取数，划过去的不打扰；离开后留 200ms，让鼠标能移进浮层
      const cancelPeekClose = () => {
        if (peekTimer.current) {
          clearTimeout(peekTimer.current);
          peekTimer.current = null;
        }
      };

      const closePeekSoon = useCallback(() => {
        if (peekShowTimer.current) {
          clearTimeout(peekShowTimer.current);
          peekShowTimer.current = null;
        }
        cancelPeekClose();
        peekTimer.current = setTimeout(() => {
          if (alive.current) setPeek(null);
        }, 200);
      }, []);

      // 给任意目录开右侧浮层。delay 给 0 表示点击立刻出，260 表示悬停停顿才出。
      // 只决定「开哪个路径」，层内导航交给 HoverPeek 自己处理。
      const showPeekFor = useCallback((event, targetPath, title, delay) => {
        cancelPeekClose();
        if (peekShowTimer.current) clearTimeout(peekShowTimer.current);
        const label = event?.currentTarget;
        peekShowTimer.current = setTimeout(() => {
          if (!alive.current || targetPath === '') return;
          const rect = label?.isConnected ? label.getBoundingClientRect() : { right: 300, top: 120 };
          peekSeq.current += 1;
          setPeek({ x: rect.right + 10, y: rect.top, path: targetPath, title: title || '目录' });
        }, delay ?? 260);
      }, []);

      // 兜底关闭：浮层是 fixed 定位，鼠标移出窗口、元素被卸载、
      // 或者停在两层之间的缝隙里时，mouseleave 不一定触发，结果就是「一直挂着」。
      // 这里用全局 mousemove 量坐标：不在任何 .dsk-peek 矩形内就收掉。
      useEffect(() => {
        if (!peek) return undefined;
        const onMove = (event) => {
          const nodes = document.querySelectorAll('.dsk-peek');
          for (const node of nodes) {
            const rect = node.getBoundingClientRect();
            if (
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            ) {
              cancelPeekClose();
              return;
            }
          }
          if (peekTimer.current) return;
          peekTimer.current = setTimeout(() => {
            peekTimer.current = null;
            if (alive.current) setPeek(null);
          }, 200);
        };
        document.addEventListener('mousemove', onMove);
        return () => document.removeEventListener('mousemove', onMove);
      }, [peek]);

      const showDesktopPeek = useCallback((event) => {
        cancelPeekClose();
        if (peekShowTimer.current) clearTimeout(peekShowTimer.current);
        const label = event?.currentTarget;
        peekShowTimer.current = setTimeout(() => {
          void (async () => {
            if (!alive.current) return;
            try {
              const info = await call('desktop');
              const target = info?.path || '';
              if (target === '' || !alive.current) return;
              const rect = label?.isConnected ? label.getBoundingClientRect() : { right: 300, top: 120 };
              peekSeq.current += 1;
              setPeek({ x: rect.right + 10, y: rect.top, path: target, title: '桌面' });
            } catch (err) {
              console.warn('[dsh-disk] 桌面预览失败', err);
            }
          })();
        }, 260);
      }, []);

      const openDesktopMenu = useCallback(async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const x = event.clientX || 120;
        const y = event.clientY || 120;
        let target = '';
        try {
          const value = await call('desktop');
          target = value?.path || '';
        } catch {
          target = '';
        }
        setMenu({ x, y, entry: { path: target, isDir: true, name: '桌面', desk: true } });
      }, []);

      const openVolumeMenu = useCallback((event, volume) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({
          x: event.clientX || 120,
          y: event.clientY || 120,
          volume: true,
          entry: { path: volume.root, isDir: true, name: `${volume.letter}:`, volume },
        });
      }, []);

      const overlays = [
        notice ? h('div', { key: 'notice', className: 'dsk-notice' }, notice) : null,
        h(HoverPeek, {
          key: 'peek',
          peek,
          onEnter: cancelPeekClose,
          onLeave: closePeekSoon,
          onOpenEntry: (entry) => void openEntry(entry, 'auto'),
        }),
        h(ContextMenu, {
          key: 'menu',
          menu,
          layout,
          onLayout: updateLayout,
          onAction: (action) => void runAction(action),
          onClose: () => setMenu(null),
        }),
        modal && modal.kind === 'mkdir'
          ? h(NewFolderModal, {
              key: 'mkdir',
              parent: modal.parent,
              onCancel: () => setModal(null),
              onDone: (message) => {
                setModal(null);
                if (message) setError(message);
                else void loadDir(modal.parent);
              },
            })
          : null,
        modal && modal.kind === 'info'
          ? h(InfoModal, { key: 'info', info: modal.info, onClose: () => setModal(null) })
          : null,
        modal && modal.kind === 'delete'
          ? h(DeleteModal, {
              key: 'delete',
              target: modal,
              onCancel: () => setModal(null),
              onDone: () => {
                setModal(null);
                void loadVolumes();
                void loadDesktop();
                if (view === 'dir' && path) void loadDir(path);
              },
            })
          : null,
      ];

      if (view === 'volumes') {
        return h(
          react.Fragment,
          null,
          h(VolumesView, {
            data: volumes,
            loading,
            error,
            onOpen: (root) => void loadDir(root),
            onRefresh: () => {
              void loadVolumes();
              void loadDesktop();
            },
            onGo: (target) => void loadDir(target),
            onMenu: openVolumeMenu,
            onDesktop: () => void goDesktop(),
            onDesktopMenu: (event) => void openDesktopMenu(event),
            onDesktopEnter: (event) => showDesktopPeek(event),
            onDesktopLeave: () => closePeekSoon(),
            desk,
            onOpenEntry: (entry) => void openEntry(entry, 'auto'),
            onPeekItem: (event, entry, delay) => showPeekFor(event, entry.path, entry.name, delay),
            onItemMenu: (event, entry) => openMenu(event, entry),
          }),
          overlays,
        );
      }

      return h(
        react.Fragment,
        null,
        h(DirView, {
          path,
          data: listing,
          loading,
          error,
          sizes,
          layout,
          onEnter: (next) => void loadDir(next),
          onUp: () => {
            if (listing?.parent) void loadDir(listing.parent);
          },
          onMeasure: (target) => void measure(target),
          onOpen: (entry) => void openEntry(entry),
          onMenu: openMenu,
          onGo: (target) => void loadDir(target),
          onBack: () => {
            setView('volumes');
            setListing(null);
            saveLast(keyRef.current, null);
          },
          onRefresh: () => void loadDir(path),
        }),
        overlays,
      );
    }

    // ---------- 会话头入口：桌面 ----------
    // 桌面路径问宿主拿（可能被 OneDrive 重定向），拿到后开一个停在桌面的磁盘标签页。
    // 桌面文件用「显示器」，工作区用「层叠文件夹」——两个入口原来都是文件夹，
    // 摆在一排里根本分不出点哪个。形状差异比颜色差异在 18px 下更好认。
    function MonitorIcon({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 4.5, width: 18, height: 12, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M9 20h6M12 16.5V20', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      );
    }

    function StackFolderIcon({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3 8.5A1.5 1.5 0 0 1 4.5 7H8l1.6 2h4.9A1.5 1.5 0 0 1 16 10.5V15a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 15V8.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M7 18.5h11A1.5 1.5 0 0 0 19.5 17V10', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      );
    }

    function DesktopButton({ nav }) {
      return h(
        'button',
        {
          className: 'dsk-iconbtn',
          title: '桌面文件',
          onClick: () => {
            void (async () => {
              try {
                const value = await call('desktop');
                const target = value?.path || '';
                if (target === '') throw new Error('拿不到桌面路径');
                nav.openResource(`dsh-resource://disk/${encodeURIComponent(target)}`);
              } catch (err) {
                console.warn('[dsh-disk] 打开桌面失败', err);
              }
            })();
          },
        },
        h('span', { className: 'dsk-ico', style: { width: 18, height: 18 } }, h(MonitorIcon, { size: 18 })),
      );
    }

    // ---------- 工作区文件 ----------
    // 按工作区而不是按会话：面板一打开就扫一遍当前工作区根目录，列成树。
    // 根目录不问用户 —— 问宿主「这个会话的 cwd 是多少」，会话记录第一行就写着。
    // 扫描跳过 node_modules / .git / dist 这些，否则一个工作区能扫出几万条把面板卡死。
    const WS_TYPE_ID = 'dsh-disk-manager/workspace';
    const WS_KIND = 'dsh-workspace';

    function WorkspacePane({ sessionId, nav }) {
      const [root, setRoot] = useState('');
      const [groups, setGroups] = useState([]);
      const [open, setOpen] = useState(() => new Set());
      const [query, setQuery] = useState('');
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [meta, setMeta] = useState({ scanned: 0, capped: false });
      const [menu, setMenu] = useState(null);
      // 多选：Ctrl/Cmd + 点行加入或移出，选中后顶部出现批量操作条
      const [selected, setSelected] = useState(() => new Set());
      const alive = useRef(true);

      useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const found = await call('workspace', { sessionId });
          let base = found?.root || '';
          if (base === '') {
            if (!alive.current) return;
            setRoot('');
            setGroups([]);
            setError('没找到这个会话对应的工作区目录。插件靠会话记录里的 cwd 定位，这个会话可能还没落盘。');
            setLoading(false);
            return;
          }
          let data = await call('sessions', { root: base });
          let list = Array.isArray(data?.groups) ? data.groups : [];
          // 兜底：tab 给的 sessionId 未必属于当前工作区，那样会扫出一片空白。
          // 按「最近改动的会话」再定位一次，那通常正是用户在看的那个工作区。
          if (list.length === 0) {
            const fallback = await call('workspace', {});
            const alt = fallback?.root || '';
            if (alt !== '' && alt !== base) {
              const retry = await call('sessions', { root: alt });
              const retryList = Array.isArray(retry?.groups) ? retry.groups : [];
              if (retryList.length > 0) {
                base = alt;
                data = retry;
                list = retryList;
              }
            }
          }
          if (!alive.current) return;
          setRoot(data?.root || base);
          setGroups(list);
          setMeta({
            scanned: data?.scanned || 0,
            capped: Boolean(data?.capped),
            home: data?.home || '',
            buckets: data?.buckets || 0,
            matched: data?.matchedBuckets || 0,
            candidates: data?.candidates || 0,
            build: data?.build || '',
            tally: data?.tally || { read: 0, cwdMismatch: 0, calls: 0, hits: 0, skipped: 0, grouped: 0 },
            sample: data?.sample || null,
          });
          setOpen((prev) => {
            // 刷新（比如删完文件）时保留用户已经展开的分组，只丢掉已经消失的
            const ids = new Set(list.map((g) => g.id));
            const kept = new Set();
            for (const id of prev) if (ids.has(id)) kept.add(id);
            return kept.size > 0 ? kept : new Set(list.length > 0 ? [list[0].id] : []);
          });
          setLoading(false);
        } catch (err) {
          if (!alive.current) return;
          setError(friendlyError(err));
          setLoading(false);
        }
      }, [sessionId]);

      useEffect(() => {
        void load();
      }, [load]);

      useEffect(() => {
        if (menu === null) return undefined;
        const close = () => setMenu(null);
        window.addEventListener('mousedown', close);
        window.addEventListener('resize', close);
        return () => {
          window.removeEventListener('mousedown', close);
          window.removeEventListener('resize', close);
        };
      }, [menu]);

      const toggle = (id) => {
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };

      const toggleSelect = (target) => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(target)) next.delete(target);
          else next.add(target);
          return next;
        });
      };

      const batchDelete = async () => {
        const paths = [...selected];
        if (paths.length === 0) return;
        if (!window.confirm(`把这 ${paths.length} 个文件放进回收站？`)) return;
        try {
          // 一次调用删完：宿主那边一条 PowerShell 处理整批，
          // 之前逐个 await 是每个文件起一次进程，看着就像在「一个一个地掉」。
          const result = await call('trashMany', { paths });
          const failed = (result?.failed || []).length;
          if (failed > 0) setError(`有 ${failed} 个文件没能删掉，可能正被别的程序占用`);
        } catch (err) {
          setError(friendlyError(err));
        }
        setSelected(new Set());
        void load();
      };

      const menuAction = async (kind) => {
        const target = menu?.entry;
        setMenu(null);
        if (!target) return;
        try {
          if (kind === 'preview') {
            if (typeof nav?.openResource === 'function') nav.openResource(fileAddress(sessionId, target.path));
            else await call('open', { path: target.path });
          } else if (kind === 'open') await call('open', { path: target.path });
          else if (kind === 'reveal') await call('reveal', { path: target.path });
          else if (kind === 'copy') await call('clipboard', { text: target.path });
          else if (kind === 'delete') {
            // 右键项在选中集合里、且选了好几个，就按整批删；
            // 只右键单个文件时不牵连其它已选项。
            const batch = selected.size > 1 && selected.has(target.path);
            const paths = batch ? [...selected] : [target.path];
            const ask = batch
              ? `把这 ${paths.length} 个文件放进回收站？`
              : `把这个文件放进回收站？\n${target.name}`;
            if (!window.confirm(ask)) return;
            if (batch) {
              const result = await call('trashMany', { paths });
              const failed = (result?.failed || []).length;
              if (failed > 0) setError(`有 ${failed} 个文件没能删掉，可能正被别的程序占用`);
              setSelected(new Set());
            } else {
              await call('trash', { path: target.path });
              setSelected((prev) => {
                const next = new Set(prev);
                next.delete(target.path);
                return next;
              });
            }
            void load();
          }
        } catch (err) {
          setError(friendlyError(err));
        }
      };

      const q = query.trim().toLowerCase();
      const rows = [];
      for (const group of groups) {
        const files = q === '' ? group.files : group.files.filter((f) => f.rel.toLowerCase().includes(q));
        if (files.length === 0) continue;
        const expanded = q !== '' || open.has(group.id);
        rows.push(
          h(
            'div',
            {
              key: `g:${group.id}`,
              className: 'dsk-grouphead',
              title: group.title,
              onClick: () => toggle(group.id),
            },
            h('span', { style: { width: 14, flex: '0 0 auto', opacity: 0.7 } }, expanded ? '▾' : '▸'),
            h('span', { className: 'dsk-name' }, group.title),
            h('span', { className: 'dsk-size' }, String(files.length)),
          ),
        );
        if (!expanded) continue;
        for (const file of files) {
          rows.push(
            h(
              'div',
              {
                key: `f:${group.id}:${file.rel}`,
                className: `dsk-row${selected.has(file.path) ? ' dsk-row-sel' : ''}`,
                title: file.path,
                style: { paddingLeft: 26 },
                onClick: async (event) => {
                  if (event.metaKey || event.ctrlKey) {
                    toggleSelect(file.path);
                    return;
                  }
                  // 优先用 DSH 内置的资源预览打开，别把用户甩到外部程序去。
                  // 内置预览认 dsh-resource://file/<路径> 这种地址；没有 nav 或它抛错时才退回系统程序。
                  try {
                    if (typeof nav?.openResource === 'function') {
                      nav.openResource(fileAddress(sessionId, file.path));
                      return;
                    }
                  } catch (err) {
                    console.warn('[dsh-disk] 内置预览打开失败，退回系统程序', err);
                  }
                  try {
                    await call('open', { path: file.path });
                  } catch (err) {
                    setError(friendlyError(err));
                  }
                },
                onContextMenu: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: event.clientX, y: event.clientY, entry: file });
                },
              },
              h(
                'span',
                {
                  className: `dsk-check${selected.has(file.path) ? ' dsk-check-on' : ''}`,
                  title: '选中',
                  onClick: (event) => {
                    event.stopPropagation();
                    toggleSelect(file.path);
                  },
                },
                selected.has(file.path) ? '✓' : '○',
              ),
              h('span', { className: 'dsk-ico' }, h(FileIcon, { name: file.name })),
              h('span', { className: 'dsk-name' }, file.name),
              h('span', { className: 'dsk-size', title: '创建时间' }, fmtTime(file.birthtime || file.mtime)),
            ),
          );
        }
      }

      return h(
        'div',
        { className: 'dsk-root' },
        h(
          'div',
          { className: 'dsk-head' },
          h('span', { className: 'dsk-title', title: root === '' ? '工作区文件' : root }, '工作区文件'),
          h('button', { type: 'button', className: 'dsk-btn', title: '重新扫描', onClick: () => void load() }, '⟳'),
        ),
        h(
          'div',
          { style: { padding: '0 10px 6px' } },
          h('input', {
            className: 'dsk-input',
            type: 'text',
            placeholder: '搜索文件名',
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        selected.size > 0
          ? h(
              'div',
              { className: 'dsk-selbar' },
              h('span', { style: { flex: '1 1 auto' } }, `已选 ${selected.size} 个`),
              h('button', { type: 'button', className: 'dsk-btn dsk-btn-danger', onClick: () => void batchDelete() }, '删除'),
              h('button', { type: 'button', className: 'dsk-btn', onClick: () => setSelected(new Set()) }, '取消'),
            )
          : null,
        error !== ''
          ? h('div', { className: 'dsk-err', style: { margin: '0 10px 6px', fontSize: 12 }, title: error }, error)
          : null,
        h(
          'div',
          { className: 'dsk-body', onClick: () => setMenu(null) },
          // 只有首次（还没有任何分组）才铺满 loading；刷新时保留旧列表，数据到了直接替换，避免整屏闪一下
          loading && groups.length === 0
            ? h('div', { className: 'dsk-empty' }, '正在扫描会话记录…')
            : rows.length === 0
              ? h(
                  'div',
                  { className: 'dsk-empty' },
                  q === ''
                    ? `没有可列出的文件。（host ${meta.build || '未知'}）工作区 ${root} ｜ 会话目录 ${meta.home} ｜ 工作区 ${meta.buckets} 个，匹配 ${meta.matched} ｜ 候选 ${meta.candidates}，扫描 ${meta.scanned} ｜ 读到 ${meta.tally.read}，cwd 不符 ${meta.tally.cwdMismatch} ｜ 工具调用 ${meta.tally.calls}，路径命中 ${meta.tally.hits}，成组 ${meta.tally.grouped}，跳过 ${meta.tally.skipped} ｜ 样本事件 ${meta.sample ? Object.entries(meta.sample.types || {}).map(([k, v]) => `${k}×${v}`).join('，') : '无'}`
                    : '没有匹配的文件',
                )
              : rows,
          meta.capped
            ? h('div', { className: 'dsk-more' }, `只扫描了最近 ${meta.scanned} 个会话，更早的没列出来`)
            : null,
        ),
        menu === null
          ? null
          : h(
              'div',
              {
                className: 'dsk-menu',
                style: {
                  position: 'fixed',
                  // 贴着面板底部右键时，菜单原样往下展开会被截掉一半，所以先按视口反算
                  left: Math.max(8, Math.min(menu.x, (window.innerWidth || 1200) - 208 - 8)),
                  top: Math.max(8, Math.min(menu.y, (window.innerHeight || 800) - 190)),
                  zIndex: 60,
                },
                onMouseDown: (event) => event.stopPropagation(),
              },
              h('div', { className: 'dsk-mitem', onMouseDown: () => void menuAction('preview') }, '在面板里预览'),
              h('div', { className: 'dsk-mitem', onMouseDown: () => void menuAction('open') }, '用系统程序打开'),
              h('div', { className: 'dsk-mitem', onMouseDown: () => void menuAction('reveal') }, '在资源管理器中显示'),
              h('div', { className: 'dsk-mitem', onMouseDown: () => void menuAction('copy') }, '复制路径'),
              h(
                'div',
                { className: 'dsk-mitem dsk-mitem-danger', onMouseDown: () => void menuAction('delete') },
                selected.size > 1 && selected.has(menu.entry.path)
                  ? `删除选中的 ${selected.size} 个文件（进回收站）`
                  : '删除（进回收站）',
              ),
            ),
      );
    }

    function WorkspaceIcon({ size = 18 }) {
      // 用 SVG 而不是 emoji：emoji 在不同字体/主题下会变成彩色方块，和标题排在一起很难看
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
      );
    }

    function WorkspaceButton({ nav }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsk-iconbtn',
          title: '工作区文件',
          onClick: () => {
            try {
              if (typeof nav?.openTab === 'function') nav.openTab(WS_KIND);
            } catch (err) {
              console.error('[dsh-disk] 打开工作区面板失败', err);
            }
          },
        },
        h(StackFolderIcon, { size: 18 }),
      );
    }

    // ---------- 会话头入口 ----------
    function EntryButton({ nav }) {
      return h(
        'button',
        {
          className: 'dsk-iconbtn',
          title: '磁盘管理',
          onClick: () => {
            // 固定地址 = 同一种内容，重复点会聚焦已有面板；要多开用文件夹的「在新标签页打开」
            const address = `dsh-resource://disk/${encodeURIComponent('此电脑')}`;
            try {
              if (typeof nav.openResource === 'function') nav.openResource(address);
              else nav.openTab(KIND);
            } catch (err) {
              console.warn('[dsh-disk] 打不开右栏 tab', err);
            }
          },
        },
        h(DriveIcon, { size: 18, tone: 'currentColor' }),
      );
    }

    return {
      name: '@ananyang/dsh-disk-manager',
      inject: [],
      apply(ctx) {
        injectStyle();

        // 可选注入：拿不到就只是「磁盘体检」不开新对话，不影响其它功能
        try {
          ctx.inject?.(['uiWorkspace'], (scope) => {
            uiWorkspace = scope.uiWorkspace ?? ctx.uiWorkspace ?? null;
          });
        } catch (err) {
          console.warn('[dsh-disk] 没有 uiWorkspace，体检不会自动开新对话', err);
        }

        // 服务可能晚于插件本体就绪（右栏那三件事都是别人提供的），
        // 所以整体挂在 inject 回调里，缺谁就不装谁，不抛异常。
        ctx.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], (scope) => {
          const slots = scope.slots ?? ctx.slots;
          const tabs = scope.sidebarRightTabs ?? ctx.sidebarRightTabs;
          const nav = scope.sidebarRight ?? ctx.sidebarRight;

          // 每处注册单独兜底：任一注册抛错都不该让另外两处一起消失，
          // 否则右栏只会显示一片空白，排查时看不出是哪一步挂的
          const guard = (label, fn) => {
            try {
              return fn();
            } catch (err) {
              console.error(`[dsh-disk] ${label} 注册失败`, err);
              return undefined;
            }
          };

          scope.effect(
            () =>
              // 注册成「资源型」而不是「页面型」：页面型在同一拖拽区里会去重，
              // 资源型的 contentId 就是地址本身，换个地址就多开一个。
              guard('tab type', () => tabs.register({
                id: TYPE_ID,
                kind: KIND,
                patterns: ['dsh-resource://disk/**'],
                keepMounted: true,
                title: (address) => {
                  const tail = String(address || '').split('/').pop() || '';
                  if (tail === '') return '磁盘';
                  try {
                    return decodeURIComponent(tail) || '磁盘';
                  } catch {
                    return '磁盘';
                  }
                },
              })),
            'dsh-disk-manager: tab type',
          );

          scope.effect(
            () =>
              guard('tab body', () =>
                slots.register(
                  { name: 'sidebar.right.pane.tab', key: TYPE_ID },
                  (props) =>
                    h(
                      Boundary,
                      null,
                      h(DiskPane, { sessionId: props?.sessionId, nav, useTabInfo: props?.useTabInfo }),
                    ),
                ),
              ),
            'dsh-disk-manager: tab body',
          );

          scope.effect(
            () =>
              guard('tab title', () =>
                slots.register(
                  { name: 'sidebar.right.pane.tab.title', key: TYPE_ID },
                  (props) => h(TabTitle, { useTabInfo: props?.useTabInfo }),
                ),
              ),
            'dsh-disk-manager: tab title',
          );

          scope.effect(
            () =>
              guard('tab title (kind key)', () =>
                slots.register(
                  { name: 'sidebar.right.pane.tab.title', key: KIND },
                  (props) => h(TabTitle, { useTabInfo: props?.useTabInfo }),
                ),
              ),
            'dsh-disk-manager: tab title (kind key)',
          );

          scope.effect(
            () =>
              guard('desktop button', () =>
                slots.register(
                  { name: 'conversation.session.header.utilities', id: 'dsh-desk-entry', order: 84 },
                  () => h(DesktopButton, { nav }),
                ),
              ),
            'dsh-disk-manager: desktop button',
          );

          scope.effect(
            () =>
              guard('entry button', () =>
                slots.register(
                  { name: 'conversation.session.header.utilities', id: 'dsh-disk-entry', order: 85 },
                  () => h(EntryButton, { nav }),
                ),
              ),
            'dsh-disk-manager: entry button',
          );

          // ---------- 工作区文件 tab ----------
          scope.effect(
            () =>
              guard('workspace tab type', () =>
                tabs.register({
                  id: WS_TYPE_ID,
                  kind: WS_KIND,
                  keepMounted: true,
                  title: () => '工作区',
                }),
              ),
            'dsh-disk-manager: workspace tab type',
          );

          scope.effect(
            () =>
              guard('workspace tab body', () =>
                slots.register(
                  { name: 'sidebar.right.pane.tab', key: WS_TYPE_ID },
                  (props) => h(WorkspacePane, { sessionId: props?.sessionId, nav: scope.sidebarRight ?? ctx.sidebarRight }),
                ),
              ),
            'dsh-disk-manager: workspace tab body',
          );

          scope.effect(
            () =>
              guard('workspace tab title', () =>
                slots.register(
                  { name: 'sidebar.right.pane.tab.title', key: WS_TYPE_ID },
                  () => '工作区',
                ),
              ),
            'dsh-disk-manager: workspace tab title',
          );

          scope.effect(
            () =>
              guard('workspace button', () =>
                slots.register(
                  { name: 'conversation.session.header.utilities', id: 'dsh-ws-entry', order: 86 },
                  () => h(WorkspaceButton, { nav }),
                ),
              ),
            'dsh-disk-manager: workspace button',
          );
        });
      },
    };
  },
});
