/* ============================================================
   MCCT — main.js（第一批修正版）
   - 镜像渲染：让输入文字可见（第 3 批会被真正的高亮替换）
   - 滚动同步：textarea / 高亮层 / 行号栏三者对齐
   - 主题切换：临时禁用过渡，保证所有控件同步变色
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

  /* ============================================================
     一、镜像渲染 + 滚动同步（让输入文字可见）
     ============================================================ */

  /**
   * 把 textarea 的内容镜像到高亮层。
   * 第 3 批会替换成 tokenizer + highlighter 的真实渲染。
   */
  function mirrorRender() {
    const value = editorInput.value;
    // 关键：textarea 末尾如果有一个换行，浏览器不会为它渲染新行。
    // 为了让高亮层高度保持一致，末尾追加一个不可见占位字符。
    // 用空格占位，因为零宽字符在某些字体下会导致行高塌陷。
    highlightCode.textContent = value + (value.endsWith('\n') ? ' ' : '');
  }

  /**
   * 重新计算行号栏。
   * 每个行号用一个 <span> 包裹，方便单独高亮当前行。
   */
  function renderGutter() {
    const lineCount = editorInput.value.split('\n').length;

    // 只在行数变化时重建，避免每次输入都重排
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

  /** textarea 滚动时，把滚动位置同步给高亮层和行号栏。 */
  function syncScroll() {
    const top = editorInput.scrollTop;
    const left = editorInput.scrollLeft;
    highlightLayer.scrollTop = top;
    highlightLayer.scrollLeft = left;
    gutter.scrollTop = top;   // 行号栏跟着纵向滚动
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

  let themeSwitchTimer = null;

  function applyTheme(theme, { animate = true } = {}) {
    if (animate) {
      // 先挂上 .theme-switching 抑制所有 transition
      html.classList.add('theme-switching');
    }

    html.setAttribute('data-theme', theme);
    try { localStorage.setItem('mcct-theme', theme); } catch (_) {}

    if (animate) {
      // 强制一次重排，确保上面的属性变更立刻生效
      void html.offsetWidth;

      // 双 rAF：确保移除抑制类的时机在下一帧渲染之后，
      // 从而「切换瞬间同步变色」+「后续 hover 过渡正常」
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          html.classList.remove('theme-switching');
        });
      });
    }
  }

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('mcct-theme'); } catch (_) {}
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved, { animate: false }); // 首次加载不抑制，避免闪一下
    }
  })();

  btnTheme.addEventListener('click', function () {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, { animate: true });
  });

  /* ============================================================
     四、侧边栏折叠
     ============================================================ */

  function toggleSidebar() {
    sidebar.classList.toggle('is-collapsed');
  }
  btnToggleSidebar.addEventListener('click', toggleSidebar);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', toggleSidebar);

  /* ============================================================
     五、侧边栏拖拽调整宽度
     ============================================================ */

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
     六、事件绑定
     ============================================================ */

  editorInput.addEventListener('input', function () {
    mirrorRender();
    renderGutter();
    updateCaretStatus();
  });

  editorInput.addEventListener('keyup', updateCaretStatus);
  editorInput.addEventListener('click', updateCaretStatus);
  editorInput.addEventListener('scroll', syncScroll);

  // 阻止 Tab 键跳出 textarea（后续补全需要 Tab 键）
  editorInput.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      // 第 5 批会在这里接入补全的 Tab 确认逻辑
    }
  });

  /* ============================================================
     七、初始化
     ============================================================ */

  mirrorRender();
  renderGutter();
  updateCaretStatus();

})();
