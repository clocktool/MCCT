/* ============================================================
   MCCT — core/tokenizer.js
   基岩版命令词法分析器。无状态、纯函数、不碰 DOM。

   输入：一行/多行命令字符串（含或不含前导斜杠）
   输出：Token 数组

   Token 结构：
     {
       type:   'slash' | 'command' | 'keyword' | 'selector' | 'selectorArg'
             | 'coordinate' | 'number' | 'string' | 'quoted' | 'json'
             | 'comment' | 'formatcode' | 'emoji' | 'id' | 'whitespace'
             | 'newline' | 'unknown',
       value:  原始文本,
       start:  在原串中的字符偏移（含）,
       end:    在原串中的字符偏移（不含）,
       depth:  嵌套深度（{} [] 内 > 0）,
       meta?:  可选附加信息，如 { kind: 'selectorKey', key: 'type' }
     }

   设计约束（对齐 MCC 第三章 3.1）：
     - 参数之间以空格分隔，空格本身也是 token（便于高亮还原）
     - ~ ^ 坐标允许合并 token，例如 "~1"、"^"、"~ ~1 ~"
     - 选择器内部递归解析：@e[type=fox,scores={k=1..}] 是一个大 token，
       内部子结构用 selectorArg token 表达（不在此文件展开）
     - JSON/NBT 结构用括号配对识别（{...}、[...]）
     - 注释以 # 开头，到行尾
     - 格式码 §x（MCC 第六章 6.3）
     - 表情符 :name:（MCC 第一章提到，MCBE 聊天里支持）

   本模块刻意不做语法判断（那是 parser 的事）。
   它只负责"切得对、切得齐、offset 精确"。
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     字符分类
     ============================================================ */

  function isSpace(c) {
    return c === ' ' || c === '\t' || c === '\u00A0';
  }

  /**
   * 剥离命名空间前缀。
   *   'minecraft:diamond' → 'diamond'
   *   'diamond'           → 'diamond'
   *   'animation.xxx'     → 'animation.xxx'  （不含 ':'，原样返回）
   */
  function stripNamespace(s) {
    const idx = s.indexOf(':');
    if (idx < 0) return s;
    return s.slice(idx + 1);
  }

  function isNewline(c) {
    return c === '\n' || c === '\r';
  }

  function isDigit(c) {
    return c >= '0' && c <= '9';
  }

  /** 数字、符号、点、横线、下划线 —— 作为"裸 token 主体"的字符 */
  function isWordChar(c) {
    return (
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c === '_' || c === '-' || c === '.' || c === ':' || c === '+' ||
      c === '/' || c === '\\' || c === '%' || c === '*' || c === '?' ||
      c === '!' || c === '=' || c === '<' || c === '>' || c === '&' ||
      c === '|' || c === '~' || c === '^' || c === '@' || c === '#'
    );
  }

  /** 是否是数字或数字相关字符（用于识别 3L、1.5、-5） */
  function isNumberChar(c) {
    return isDigit(c) || c === '.' || c === '-' || c === '+' ||
           c === 'e' || c === 'E' || c === 'L' || c === 'f' || c === 'F' ||
           c === 'd' || c === 'D' || c === 'b' || c === 'B';
  }

  /* ============================================================
     核心：单行扫描
     ============================================================ */

  /**
   * 扫描一行文本（不含换行符），返回 token 数组。
   * @param {string} line
   * @param {number} lineOffset 该行第一个字符在原串中的全局 offset
   * @returns {Array}
   */
  function tokenizeLine(line, lineOffset) {
    const tokens = [];
    const n = line.length;
    let i = 0;

    function push(type, start, end, meta) {
      tokens.push({
        type: type,
        value: line.slice(start, end),
        start: lineOffset + start,
        end: lineOffset + end,
        depth: depth,
        meta: meta || null
      });
    }

    // 括号配对深度
    let depth = 0;

    while (i < n) {
      const c = line.charAt(i);

      /* ---------- 空白 ---------- */
      if (isSpace(c)) {
        const start = i;
        while (i < n && isSpace(line.charAt(i))) i++;
        push('whitespace', start, i);
        continue;
      }

      /* ---------- 注释：# 到行尾 ---------- */
      if (c === '#') {
        const start = i;
        i = n;
        push('comment', start, i);
        continue;
      }

      /* ---------- 格式码：§x ---------- */
      if (c === '\u00A7' || c === '&' && i + 1 < n && isHexFormatChar(line.charAt(i + 1))) {
        // 只识别 § 符号；& 视情况，MCBE 主要用 §
        if (c === '\u00A7') {
          const start = i;
          i++;
          if (i < n) i++; // 吃掉格式字符
          push('formatcode', start, i);
          continue;
        }
      }

      /* ---------- 表情符 :name: ---------- */
      if (c === ':') {
        const m = matchEmoji(line, i);
        if (m) {
          push('emoji', i, i + m.length);
          i += m.length;
          continue;
        }
      }

      /* ---------- 引号字符串 "..." 或 '...' ---------- */
      if (c === '"' || c === '\'') {
        const start = i;
        const quote = c;
        i++;
        while (i < n) {
          const cc = line.charAt(i);
          if (cc === '\\' && i + 1 < n) { i += 2; continue; }
          if (cc === quote) { i++; break; }
          i++;
        }
        push('quoted', start, i);
        continue;
      }

      /* ---------- 前导斜杠 ---------- */
      if (c === '/' && i === firstNonSpaceIndex(line)) {
        push('slash', i, i + 1);
        i++;
        continue;
      }

      /* ---------- 花括号 / 方括号（JSON / 选择器内结构） ---------- */
      if (c === '{' || c === '[') {
        const start = i;
        const open = c;
        const close = c === '{' ? '}' : ']';
        let localDepth = 0;
        let inQuote = null;
        while (i < n) {
          const cc = line.charAt(i);
          if (inQuote) {
            if (cc === '\\' && i + 1 < n) { i += 2; continue; }
            if (cc === inQuote) inQuote = null;
            i++;
            continue;
          }
          if (cc === '"' || cc === '\'') { inQuote = cc; i++; continue; }
          if (cc === open) localDepth++;
          else if (cc === close) {
            localDepth--;
            if (localDepth === 0) { i++; break; }
          }
          i++;
        }
        push('json', start, i);
        continue;
      }

      /* ---------- 选择器 @a @e[...] @p @r @s @n @initiator ---------- */
      if (c === '@') {
        const start = i;
        i++;
        // 读取选择器字母
        while (i < n && /[a-z_]/.test(line.charAt(i))) i++;
        // 后续若有 [ ，把整段方括号一起纳入
        if (i < n && line.charAt(i) === '[') {
          let localDepth = 0;
          let inQuote = null;
          while (i < n) {
            const cc = line.charAt(i);
            if (inQuote) {
              if (cc === '\\' && i + 1 < n) { i += 2; continue; }
              if (cc === inQuote) inQuote = null;
              i++;
              continue;
            }
            if (cc === '"' || cc === '\'') { inQuote = cc; i++; continue; }
            if (cc === '[') localDepth++;
            else if (cc === ']') {
              localDepth--;
              if (localDepth === 0) { i++; break; }
            }
            i++;
          }
        }
        push('selector', start, i);
        continue;
      }

      /* ---------- 坐标：~、^、~1、^1.5、~-3 ---------- */
      if (c === '~' || c === '^') {
        const start = i;
        i++;
        // 紧随其后的可选数字
        while (i < n && isNumberChar(line.charAt(i))) i++;
        push('coordinate', start, i);
        continue;
      }

      /* ---------- 数字：3、-5、3.14、1.5f、3L ---------- */
      if (isDigit(c) || (c === '-' && i + 1 < n && isDigit(line.charAt(i + 1)))) {
        const start = i;
        if (c === '-') i++;
        while (i < n && isNumberChar(line.charAt(i))) i++;
        // 后跟字母后缀（L/f/d/b）
        push('number', start, i);
        continue;
      }

      /* ---------- 裸词 / ID / 命令名 / 关键词 ---------- */
      if (isWordChar(c)) {
        const start = i;
        while (i < n && isWordChar(line.charAt(i))) i++;
        const value = line.slice(start, i);
        // 分类
        let type = 'unknown';
        if (value.indexOf(':') >= 0) {
          type = 'id';
        } else if (isPureNumber(value)) {
          type = 'number';
        } else {
          type = 'word'; // 由 parser 决定是命令名/keyword/字符串
        }
        push(type, start, i);
        continue;
      }

      /* ---------- 其他字符 ---------- */
      {
        const start = i;
        i++;
        push('unknown', start, i);
      }
    }

    return tokens;
  }

  /* ============================================================
     辅助
     ============================================================ */

  function firstNonSpaceIndex(line) {
    for (let i = 0; i < line.length; i++) {
      if (!isSpace(line.charAt(i))) return i;
    }
    return -1;
  }

  function isPureNumber(s) {
    return /^-?\d+(\.\d+)?[a-zA-Z]?$/.test(s);
  }

  function isHexFormatChar(c) {
    return /[0-9a-fk-orA-FK-OR]/.test(c);
  }

  /**
   * 匹配 :name: 形式的表情符。
   * 只允许 [a-zA-Z0-9_+-]，长度 1..32。
   * 返回整个 ":name:" 字符串，不匹配返回 null。
   */
  function matchEmoji(line, pos) {
    if (line.charAt(pos) !== ':') return null;
    let j = pos + 1;
    const max = Math.min(line.length, pos + 34);
    while (j < max && /[a-zA-Z0-9_+-]/.test(line.charAt(j))) j++;
    if (j === pos + 1) return null;          // 空名
    if (j >= line.length || line.charAt(j) !== ':') return null;
    return line.slice(pos, j + 1);
  }

  /* ============================================================
     入口：多行文本
     ============================================================ */

  /**
   * @param {string} text 原始文本（可多行）
   * @returns {Array} token 数组（含 newline token）
   */
  function tokenize(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const out = [];
    let offset = 0;
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const rawLine = lines[li];
      // 去掉可能存在的 \r
      const line = rawLine.charAt(rawLine.length - 1) === '\r'
        ? rawLine.slice(0, -1)
        : rawLine;

      const lineTokens = tokenizeLine(line, offset);
      for (let k = 0; k < lineTokens.length; k++) out.push(lineTokens[k]);

      offset += rawLine.length + 1; // +1 是 \n

      // 最后一个换行不补
      if (li < lines.length - 1) {
        out.push({
          type: 'newline',
          value: '\n',
          start: offset - 1,
          end: offset,
          depth: 0,
          meta: null
        });
      }
    }
    return out;
  }

  /* ============================================================
     工具：按逻辑"词"过滤（去掉 whitespace/newline）
     ============================================================ */

  /**
   * 把 token 数组压缩成"有效词"，附带每个词的起止 offset。
   * parser / completer 主要用这个视图。
   * @returns {Array<{token, start, end}>}
   */
  function logicalTokens(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'whitespace' || t.type === 'newline') continue;
      out.push(t);
    }
    return out;
  }

  /**
   * 找到 cursor 所在的"当前词"范围（用于补全前缀）。
   * 返回 { start, end, prefix, insideWord }。
   *   - prefix: 光标前的词片段
   *   - start/end: 该词的字符范围（在原文里的 offset）
   *   - insideWord: 光标是否紧贴一个词（不是空格之后）
   */
  function wordAt(text, cursor) {
    if (cursor < 0) cursor = 0;
    if (cursor > text.length) cursor = text.length;
    let start = cursor;
    while (start > 0) {
      const c = text.charAt(start - 1);
      if (isSpace(c) || isNewline(c)) break;
      start--;
    }
    let end = cursor;
    while (end < text.length) {
      const c = text.charAt(end);
      if (isSpace(c) || isNewline(c)) break;
      end++;
    }
    return {
      start: start,
      end: end,
      prefix: text.slice(start, cursor),
      insideWord: end > start
    };
  }

  /* ============================================================
     对外
     ============================================================ */

  global.MCCT = global.MCCT || {};
  global.MCCT.tokenizer = {
    tokenize: tokenize,
    tokenizeLine: tokenizeLine,
    logicalTokens: logicalTokens,
    wordAt: wordAt,
    /* 暴露给测试用 */
    _isSpace: isSpace,
    _isNewline: isNewline
  };
})(window);
