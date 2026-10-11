/* ============================================================
   MCCT — core/highlighter.js
   语法高亮渲染器。把 tokenizer 输出的 token 数组渲染成 HTML 片段，
   写入高亮层（<pre><code id="highlight-code">）

   设计约束（对齐 editor.css 与 MCC 第二章 token 分类）：
     1. 绝不操作 DOM 之外的任何东西。只返回 HTML 字符串，
        由 ui/editor.js 决定往哪里放。
     2. 输出必须与 textarea 逐字符对齐。
        - 空格、换行、Tab 一律原样保留（不合并、不折叠）
        - 不能有多余的尾部空格（会撑出滚动条）
     3. 所有 token 都被包一层 <span class="tok-*">，
        纯文本段落用 ESC（HTML 转义）避免注入。
     4. 空行必须保留：连续 \n 之间插入一个不可见占位（\u200B 不用，
        直接用空内容 span 也行），避免 <pre> 折叠空行。
        这里用最稳妥的方式：把 \n 输出为字面 \n，空行不额外处理，
        <pre> 本身就会保留空行。

   Token → CSS class 映射（对应 editor.css 的 --tok-*）：
     slash        → tok-slash
     command      → tok-command
     keyword      → tok-keyword
     selector     → tok-selector
     coordinate   → tok-coordinate
     number       → tok-number
     string       → tok-string
     quoted       → tok-string
     json         → tok-json
     comment      → tok-comment
     formatcode   → tok-formatcode
     emoji        → tok-emoji
     id           → tok-id
     word         → 由 parser 决定（见下文"二次着色"）
     unknown      → tok-value
     whitespace   → 不着色
     newline      → 不着色
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- HTML 转义 ---------- */

  const ESC_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  };

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  /* ---------- 直接映射表 ---------- */

  const CLASS_MAP = {
    'slash':       'tok-slash',
    'command':     'tok-command',
    'keyword':     'tok-keyword',
    'selector':    'tok-selector',
    'coordinate':  'tok-coordinate',
    'number':      'tok-number',
    'string':      'tok-string',
    'quoted':      'tok-string',
    'json':        'tok-json',
    'comment':     'tok-comment',
    'formatcode':  'tok-formatcode',
    'emoji':       'tok-emoji',
    'id':          'tok-id',
    'unknown':     'tok-value'
    /* 'word' / 'whitespace' / 'newline' 不在此表，单独处理 */
  };

  /* ============================================================
     一、主渲染：token 数组 → HTML 字符串
     ============================================================ */

  /**
   * @param {Array} tokens  tokenizer.tokenize() 的输出
   * @param {Object} [opts]
   *   - refineWord: (token, index, all) => 'command'|'keyword'|'string'|'value'
   *     由 parser 层提供的回调，决定 type: 'word' 的具体着色。
   *     不传则 word 一律按 tok-value 处理。
   * @returns {string} HTML 片段
   */
  function render(tokens, opts) {
    if (!Array.isArray(tokens) || tokens.length === 0) return '';

    const refineWord = (opts && typeof opts.refineWord === 'function')
      ? opts.refineWord
      : null;

    let html = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const raw = t.value;
      if (!raw) continue;

      // 空白 / 换行：原样输出，不加 span（避免样式污染）
      if (t.type === 'whitespace' || t.type === 'newline') {
        html += escapeHTML(raw);
        continue;
      }

      let cls;
      if (t.type === 'word') {
        // 由外部回调决定
        if (refineWord) {
          const refined = refineWord(t, i, tokens);
          cls = wordClass(refined);
        } else {
          cls = 'tok-value';
        }
      } else {
        cls = CLASS_MAP[t.type] || 'tok-value';
      }

      html += '<span class="' + cls + '">' + escapeHTML(raw) + '</span>';
    }

    return html;
  }

  /**
   * 把 refineWord 的返回值（短标识）映射到 CSS 类。
   * 允许的返回值：
   *   'command' / 'keyword' / 'string' / 'number' / 'value' / 'error'
   * 之外的任何值都退化为 tok-value。
   */
  function wordClass(kind) {
    switch (kind) {
      case 'command': return 'tok-command';
      case 'keyword': return 'tok-keyword';
      case 'string':  return 'tok-string';
      case 'number':  return 'tok-number';
      case 'error':   return 'tok-error';
      case 'value':
      default:
        return 'tok-value';
    }
  }

  /* ============================================================
     二、二次着色：给 parser 用的默认 word 分类器
     ============================================================ */

  /**
   * 一个轻量的默认 refineWord 实现：
   * 在没有 parser 的时候（或 parser 未就绪时）也能给出
   * 大致合理的着色，避免所有 word 都灰不溜秋。
   *
   * 规则（从宽到严）：
   *   1. 若位于行首（忽略前导空白），且是 commands.js 中已知命令名 → command
   *   2. 若是 execute 链中的关键词（as/at/run/if/unless/...）→ keyword
   *   3. 其余 → value
   *
   * @param {Object} token
   * @param {number} index
   * @param {Array} all
   * @returns {string}
   */
  function defaultRefineWord(token, index, all) {
    const value = token.value;

    // 找该 token 所在行的第一个非空白 token
    let lineStart = index;
    while (lineStart > 0) {
      const prev = all[lineStart - 1];
      if (prev.type === 'newline') break;
      if (prev.type !== 'whitespace') {
        // 继续往前，直到行的开头或另一个非空白
        lineStart--;
        // 用"最近一个换行"来判定
        continue;
      }
      lineStart--;
    }
    // 换成更稳的写法：向前扫，直到遇到 newline
    let firstNonWS = index;
    for (let k = index; k >= 0; k--) {
      const tk = all[k];
      if (tk.type === 'newline') break;
      if (tk.type !== 'whitespace') firstNonWS = k;
    }

    const isFirstInLine = (firstNonWS === index);

    // 已知命令名？
    const cmds = global.MCCT && global.MCCT.commands;
    if (isFirstInLine && cmds) {
      const entry = cmds.get(value);
      if (entry && entry.name === value) return 'command';
    }

    // execute 链关键词
    if (EXECUTE_KEYWORDS.has(value)) return 'keyword';

    return 'value';
  }

  const EXECUTE_KEYWORDS = new Set([
    'as', 'at', 'positioned', 'rotated', 'facing', 'align', 'anchored', 'in',
    'if', 'unless', 'run',
    'block', 'blocks', 'entity', 'score', 'data', 'matches',
    'entity',
    'then', 'else'
  ]);

  /* ============================================================
     三、便捷入口：直接给定一行/多行文本，一步渲染
     ============================================================ */

  /**
   * @param {string} text
   * @param {Object} [opts] 同 render 的 opts
   * @returns {string}
   */
  function renderText(text, opts) {
    const tk = global.MCCT && global.MCCT.tokenizer;
    if (!tk || typeof tk.tokenize !== 'function') return escapeHTML(text || '');
    const tokens = tk.tokenize(text || '');
    // 若外部没传 refineWord，用默认的
    const merged = Object.assign({}, opts || {});
    if (typeof merged.refineWord !== 'function') {
      merged.refineWord = defaultRefineWord;
    }
    return render(tokens, merged);
  }

  /* ============================================================
     四、对外
     ============================================================ */

  global.MCCT = global.MCCT || {};
  global.MCCT.highlighter = {
    render: render,
    renderText: renderText,
    escapeHTML: escapeHTML,
    defaultRefineWord: defaultRefineWord,
    _CLASS_MAP: CLASS_MAP,
    _EXECUTE_KEYWORDS: EXECUTE_KEYWORDS
  };
})(window);
