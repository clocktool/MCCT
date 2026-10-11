/* ============================================================
   MCCT — main.js（第 1 批最终版）
   负责：
   - 镜像渲染（让输入文字可见；第 3 批会被真正的高亮替换）
   - 滚动同步（textarea / 高亮层 / 行号栏三者对齐）
   - 光标位置显示
   - 主题切换（带过渡抑制，保证同步变色）
   - 侧边栏折叠（带平滑过渡）+ 拖拽调整宽度
   - 标签栏滚轮横滑
   - 复制（当前行 / 全部）/ 清空
   ============================================================ */
(function () {
  'use strict';

  /* ---------- DOM 引用 ---------- */
  const html = document.documentElement;
  const btnTheme = document.getElementById('btn-theme');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');
  const sidebar = document.getElementById('sidebar');
  const statusCaret = document.getElementById('status-caret');
  const editorInput = document.getElementById('editor-input');
  const highlightLayer = document.getElementById('highlight-layer');
  const highlightCode = document.getElementById('highlight-code');
  const gutter = document.getElementById('gutter');
  const btnCopy = document.getElementById('btn-copy');
  const btnCopyAll = document.getElementById('btn-copy-all');
  const btnClear = document.getElementById('btn-clear');
  const toolbarHint = document.getElementById('toolbar-hint');

  const HINT_DEFAULT = 'Ctrl+Shift+C 复制当前行';
  let hintTimer = null;

  /* ============================================================
     一、镜像渲染 + 滚动同步
     ============================================================ */

  /**
   * 把 textarea 的内容镜像到高亮层。
   * 第 3 批会替换成 tokenizer + highlighter 的真实渲染。
   */
  function mirrorRender() {
    const value = editorInput.value;
    // textarea 末尾如果有换行，浏览器不会渲染新行。
    // 为了让高亮层高度一致，末尾追加一个空格占位。
    highlightCode.textContent = value + (value.endsWith('\n') ? ' ' : '');
  }

  /**
   * 重新计算行号栏。只在行数变化时重建，避免每次输入都重排。
   */
  function renderGutter() {
    const lineCount = editorInput.value.split('\n').length;
    if (gutter.childElementCount === lineCount) return;

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lineCount; i++) {
      const span = document.createElement('span');
      span.className = 'gutter-line';
      span.textContent = String(i);
      frag.appendChild(span);
    }
    gutter.textContent = '';
    gutter.appendChild(frag);
  }

  /** 高亮当前行对应的行号。 */
  function updateGutterActive() {
    const pos = editorInput.selectionStart;
    const before = editorInput.value.slice(0, pos);
    const lineIndex = before.split('\n').length - 1; // 0-based

    const lines = gutter.children;
    for (let i = 0; i < lines.length; i++) {
      if (i === lineIndex) lines[i].classList.add('is-active');
      else lines[i].classList.remove('is-active');
    }
  }

  /** textarea 滚动时，把滚动位置同步给高亮层和行号栏。 */
  function syncScroll() {
    highlightLayer.scrollTop = editorInput.scrollTop;
    highlightLayer.scrollLeft = editorInput.scrollLeft;
    gutter.scrollTop = editorInput.scrollTop;
  }

  /* ============================================================
     二、光标位置显示
     ============================================================ */

  function updateCaretStatus() {
    const pos = editorInput.selectionStart;
    const before = editorInput.value.slice(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    statusCaret.textContent = '行 ' + line + ', 列 ' + col;
  }

  /* ============================================================
     三、主题切换（带过渡抑制）
     ============================================================ */

  function applyTheme(theme, options) {
    const animate = !options || options.animate !== false;

    if (animate) {
      html.classList.add('theme-switching');
    }

    html.setAttribute('data-theme', theme);
    try { localStorage.setItem('mcct-theme', theme); } catch (_) {}

    if (animate) {
      void html.offsetWidth;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          html.classList.remove('theme-switching');
        });
      });
    }
  }

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('mcct-theme'); } catch (_) {}
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved, { animate: false });
    }
  })();

  btnTheme.addEventListener('click', function () {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, { animate: true });
  });

  /* ============================================================
     四、侧边栏折叠 + 拖拽调整宽度
     ============================================================ */

  function toggleSidebar() {
    const collapsed = sidebar.classList.toggle('is-collapsed');
    if (collapsed) {
      // 清掉拖拽留下的内联宽度，否则会覆盖 .is-collapsed 的 width: 0
      sidebar.style.width = '';
    }
  }
  btnToggleSidebar.addEventListener('click', toggleSidebar);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', toggleSidebar);

  (function initResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    if (!resizer) return;
    let startX = 0, startW = 0, dragging = false;

    resizer.addEventListener('mousedown', function (e) {
      dragging = true;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const delta = startX - e.clientX;
      const next = Math.max(200, Math.min(520, startW + delta));
      sidebar.style.width = next + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();

  /* ============================================================
     五、标签栏滚轮横滑
     ============================================================ */

  (function initTabsHorizontalScroll() {
    const tabs = document.getElementById('sidebar-tabs');
    if (!tabs) return;

    tabs.addEventListener('wheel', function (e) {
      // 触控板横向滑动：浏览器原生支持，放行
      if (e.deltaX !== 0) return;
      if (e.deltaY === 0) return;

      e.preventDefault();
      tabs.scrollLeft += e.deltaY;
    }, { passive: false });
  })();

  /* ============================================================
     六、复制 / 清空
     ============================================================ */

  /**
   * 复制文本到剪贴板。
   * 优先 Clipboard API；file:// 或非 HTTPS 下回退 execCommand。
   */
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('execCommand copy failed'));
      } catch (err) {
        document.body.removeChild(ta);
        reject(err);
      }
    });
  }

  /** 取出光标所在行的文本（不含换行符）。 */
  function getCurrentLineText() {
    const value = editorInput.value;
    const pos = editorInput.selectionStart;
    const start = value.lastIndexOf('\n', pos - 1) + 1;
    let end = value.indexOf('\n', pos);
    if (end === -1) end = value.length;
    return value.slice(start, end);
  }

  /** 按钮短暂显示成功状态。 */
  function flashSuccess(btn) {
    if (!btn) return;
    btn.classList.add('is-success');
    setTimeout(function () {
      btn.classList.remove('is-success');
    }, 1500);
  }

  /** 工具栏提示文字，1.5 秒后恢复默认。 */
  function showHint(text) {
    if (!toolbarHint) return;
    toolbarHint.textContent = text;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      toolbarHint.textContent = HINT_DEFAULT;
    }, 1500);
  }

  /**
   * 复制：
   *   1. 有选中 → 复制选中
   *   2. 无选中 → 复制光标所在行
   */
  function handleCopy() {
    const start = editorInput.selectionStart;
    const end = editorInput.selectionEnd;
    const hasSelection = start !== end;

    const text = hasSelection
      ? editorInput.value.slice(start, end)
      : getCurrentLineText();

    if (!text) {
      showHint('当前行没有内容');
      return;
    }

    copyToClipboard(text).then(function () {
      flashSuccess(btnCopy);
      showHint(hasSelection ? '已复制选中内容' : '已复制当前行');
    }).catch(function () {
      showHint('复制失败，请手动选中后按 Ctrl+C');
    });
  }

  /**
   * 全部复制：复制所有内容，复制后清空编辑器。
   */
  function handleCopyAll() {
    const text = editorInput.value;
    if (!text) {
      showHint('没有内容可复制');
      return;
    }

    copyToClipboard(text).then(function () {
      flashSuccess(btnCopyAll);
      showHint('已复制全部内容，编辑器已清空');
      resetEditor();
    }).catch(function () {
      showHint('复制失败，请手动选中后按 Ctrl+C');
    });
  }

  /** 清空编辑器。 */
  function resetEditor() {
    editorInput.value = '';
    editorInput.selectionStart = 0;
    editorInput.selectionEnd = 0;
    mirrorRender();
    renderGutter();
    updateCaretStatus();
    updateGutterActive();
    editorInput.focus();
  }

  function handleClear() {
    if (!editorInput.value) return;
    resetEditor();
    showHint('已清空');
  }

  btnCopy.addEventListener('click', handleCopy);
  btnCopyAll.addEventListener('click', handleCopyAll);
  btnClear.addEventListener('click', handleClear);

  /* ---------- 全局快捷键 ---------- */

  document.addEventListener('keydown', function (e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    // Ctrl/Cmd + Shift + C：复制当前行
    if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      handleCopy();
      return;
    }

    // Ctrl/Cmd + Shift + X：全部复制（复制后清空）
    if (e.shiftKey && (e.key === 'X' || e.key === 'x')) {
      e.preventDefault();
      handleCopyAll();
      return;
    }

    // Ctrl/Cmd + Shift + Delete：清空
    if (e.shiftKey && e.key === 'Delete') {
      e.preventDefault();
      handleClear();
      return;
    }
  });

  /* ============================================================
     七、编辑器事件
     ============================================================ */

  editorInput.addEventListener('input', function () {
    mirrorRender();
    renderGutter();
    updateCaretStatus();
    updateGutterActive();
  });

  editorInput.addEventListener('keyup', function () {
    updateCaretStatus();
    updateGutterActive();
  });

  editorInput.addEventListener('click', function () {
    updateCaretStatus();
    updateGutterActive();
  });

  editorInput.addEventListener('scroll', syncScroll);

  // 阻止 Tab 键跳出 textarea（后续补全需要 Tab 键）
  editorInput.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      // 第 5 批会在这里接入补全的 Tab 确认逻辑
    }
  });

  /* ============================================================
     八、初始化
     ============================================================ */

  mirrorRender();
  renderGutter();
  updateCaretStatus();
  updateGutterActive();

})();
