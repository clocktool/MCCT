/* ============================================================
   MCCT — main.js（第一批占位版）
   仅处理主题切换与侧边栏折叠，后续批次替换为完整编排
   ============================================================ */
(function () {
  'use strict';

  const html = document.documentElement;
  const btnTheme = document.getElementById('btn-theme');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');
  const sidebar = document.getElementById('sidebar');
  const statusCaret = document.getElementById('status-caret');
  const editorInput = document.getElementById('editor-input');

  /* ---------- 主题切换 ---------- */
  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    try { localStorage.setItem('mcct-theme', theme); } catch (_) {}
  }

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('mcct-theme'); } catch (_) {}
    if (saved === 'light' || saved === 'dark') applyTheme(saved);
  })();

  btnTheme.addEventListener('click', function () {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  /* ---------- 侧边栏折叠 ---------- */
  function toggleSidebar() {
    sidebar.classList.toggle('is-collapsed');
  }
  btnToggleSidebar.addEventListener('click', toggleSidebar);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', toggleSidebar);

  /* ---------- 光标位置显示（最小版） ---------- */
  function updateCaretStatus() {
    const pos = editorInput.selectionStart;
    const before = editorInput.value.slice(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    statusCaret.textContent = '行 ' + line + ', 列 ' + col;
  }
  editorInput.addEventListener('input', updateCaretStatus);
  editorInput.addEventListener('keyup', updateCaretStatus);
  editorInput.addEventListener('click', updateCaretStatus);
  updateCaretStatus();

  /* ---------- 侧边栏拖拽调整宽度 ---------- */
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

})();
