/* ============================================================
   MCCT — core/parser.js  （修订版 · 支持嵌套选择器参数）

   本次修订：
     1. findSelectorContext 增加 nestedPath 返回
        —— 识别 @a[hasitem={...}] 里的嵌套大括号
     2. 新增 analyzeNestedPosition
        —— 判断光标在嵌套大括号内的位置（key / value）
     3. 输出结构新增字段：
          nestedPath   ['hasitem']  或 ['scores']  或 null
          nestedPhase  'key' | 'value' | null
          nestedKeys   已输入的嵌套键列表
          nestedKey    当前正在填的嵌套键名
     4. 保留原有所有行为（不破坏 completer 之前的调用）

   输出结构（完整）：
     {
       kind,           // 'command' | 'keyword' | 'arg'
                       // | 'selectorKey' | 'selectorValue'
                       // | 'selectorNestedKey' | 'selectorNestedValue'
                       // | 'none'
       expecting,      // null 或 { types, source, ... }
       commandName,    // 'setblock' | ...
       paramIndex,     // 参数下标（0-based，从命令名后开始）
       chainIndex,     // execute 链下标，-1 表示不在 execute
       partial,        // 光标前紧邻的词前缀
       tokens,         // tokenizer 完整输出
       cursor,
       wordStart,
       wordEnd,
       inSelector,     // 是否位于 @x[...] 内
       selectorKeys,   // 选择器内已输入的 key 列表

       // —— 新增 ——
       nestedPath,     // ['hasitem'] 或 ['scores'] 或 null
       nestedPhase,    // 'key' | 'value' | null
       nestedKeys,     // 嵌套内已输入的键列表
       nestedKey,      // 当前正在填值的嵌套键名（nestedPhase='value' 时有效）

       errors          // 预留
     }
   ============================================================ */
(function (global) {
  'use strict';

  function getCommands()  { return (global.MCCT && global.MCCT.commands)  || null; }
  function getTokenizer() { return (global.MCCT && global.MCCT.tokenizer) || null; }
  function getSelector()  { return (global.MCCT && global.MCCT.selector)  || null; }

  /* ============================================================
     一、找光标所在的选择器（返回更丰富信息）
     ============================================================ */

  /**
   * 从 cursor 往前找最近未闭合的 '@'，确定光标是否在某个选择器内部。
   *
   * 返回值：
   *   null
   *   {
   *     selStart,    // '@' 的下标
   *     bracketStart,// '[' 的下标
   *     bracketEnd,  // 匹配的 ']' 的下标
   *     inner        // bracketStart+1 到 bracketEnd 之间的文本
   *   }
   *
   * 算法：从 cursor 向前扫描，维护一个 "未闭合括号深度" 栈。
   * 遇到 ']' 深度+1；遇到 '[' 深度-1。
   * 深度归零时若左侧紧邻一个 '@x' 则是选择器起始。
   */
  function findSelectorContext(text, cursor) {
    const n = text.length;
    let i = cursor - 1;
    let depth = 0;
    let inQuote = null;

    while (i >= 0) {
      const c = text.charAt(i);

      // 反向扫描时字符串的引号处理：向前找成对引号不易，简化处理
      // 只在正斜杠前遇到未转义引号时切换状态
      if (c === '"' || c === '\'') {
        // 反向数一下连续的反斜杠
        let bsCount = 0, j = i - 1;
        while (j >= 0 && text.charAt(j) === '\\') { bsCount++; j--; }
        if (bsCount % 2 === 0) {
          if (inQuote === null) inQuote = c;
          else if (inQuote === c) inQuote = null;
        }
        i--;
        continue;
      }

      if (inQuote !== null) { i--; continue; }

      if (c === ']') {
        depth++;
      } else if (c === '[') {
        if (depth === 0) {
          // 找 '@'
          let k = i - 1;
          while (k >= 0 && /[a-z_]/i.test(text.charAt(k))) k--;
          if (k >= 0 && text.charAt(k) === '@') {
            // 找到匹配的 ']'
            const end = matchBracket(text, i);
            if (end >= 0 && cursor > i && cursor <= end) {
              return {
                selStart: k,
                bracketStart: i,
                bracketEnd: end,
                inner: text.slice(i + 1, end)
              };
            }
            return null;
          }
          return null;
        }
        depth--;
      }

      i--;
    }
    return null;
  }

  /**
   * 从 openPos（'[' 位置）找匹配的 ']'。
   * 返回 ']' 的下标，未闭合返回 -1。
   */
  function matchBracket(text, openPos) {
    let depth = 0;
    let inQ = null;
    for (let i = openPos; i < text.length; i++) {
      const c = text.charAt(i);
      if (inQ) {
        if (c === '\\' && i + 1 < text.length) { i++; continue; }
        if (c === inQ) inQ = null;
        continue;
      }
      if (c === '"' || c === '\'') { inQ = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /* ============================================================
     二、选择器内部：已输入的 key 列表
     ============================================================ */

  /**
   * 解析 inner（不含方括号）为 [{key, eqIndex, valueStart, valueEnd}]。
   * 只在 depth=0（顶层）分割逗号。
   */
  function parseSelectorKeys(inner) {
    const out = [];
    let depth = 0;
    let inQ = null;
    let segStart = 0;

    function pushSeg(end) {
      const seg = inner.slice(segStart, end);
      const eq = seg.indexOf('=');
      if (eq >= 0) {
        const key = seg.slice(0, eq).trim();
        out.push({
          key: key,
          eqIndex: segStart + eq,
          valueStart: segStart + eq + 1,
          valueEnd: end
        });
      } else {
        const key = seg.trim();
        if (key) {
          out.push({ key: key, eqIndex: -1, valueStart: -1, valueEnd: -1 });
        }
      }
    }

    for (let i = 0; i < inner.length; i++) {
      const c = inner.charAt(i);
      if (inQ) {
        if (c === '\\' && i + 1 < inner.length) { i++; continue; }
        if (c === inQ) inQ = null;
        continue;
      }
      if (c === '"' || c === '\'') { inQ = c; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 0) {
        pushSeg(i);
        segStart = i + 1;
      }
    }
    pushSeg(inner.length);
    return out;
  }

  /* ============================================================
     三、选择器内部的位置分析（key / value）
     ============================================================ */

  /**
   * @param {string} inner         选择器内部文本（不含方括号）
   * @param {number} cursorLocal   光标相对 inner 起点的偏移
   * @returns {{
   *   phase: 'key' | 'value',
   *   keyPrefix: string,
   *   currentKey: string | null,
   *   currentSegmentStart: number
   * }}
   */
  function analyzeSelectorPosition(inner, cursorLocal) {
    const before = inner.slice(0, cursorLocal);
    let depth = 0, inQ = null, segStart = 0;

    for (let i = 0; i < before.length; i++) {
      const c = before.charAt(i);
      if (inQ) {
        if (c === '\\' && i + 1 < before.length) { i++; continue; }
        if (c === inQ) inQ = null;
        continue;
      }
      if (c === '"' || c === '\'') { inQ = c; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 0) segStart = i + 1;
    }

    const seg = before.slice(segStart);
    const eq = seg.indexOf('=');
    if (eq < 0) {
      return {
        phase: 'key',
        keyPrefix: seg.replace(/^\s+/, ''),
        currentKey: null,
        currentSegmentStart: segStart
      };
    }
    return {
      phase: 'value',
      keyPrefix: '',
      currentKey: seg.slice(0, eq).trim(),
      currentSegmentStart: segStart
    };
  }

  /* ============================================================
     四、嵌套大括号分析（本次新增核心）
     ============================================================ */

  /**
   * 在 inner 里，找光标所在的最内层 { } 大括号。
   *
   * @param {string} inner         选择器内部文本
   * @param {number} cursorLocal   光标相对 inner 起点的偏移
   * @returns {null | {
   *   openBrace,   // '{' 在 inner 中的下标
   *   closeBrace,  // '}' 在 inner 中的下标
   *   ownerKey,    // 大括号归属的键（'hasitem' / 'scores' / ...）
   *   nestText,    // '{' 与 '}' 之间的文本
   *   nestCursor   // 光标相对 nestText 的偏移
   * }}
   */
  function findNestedContext(inner, cursorLocal) {
    // 从 cursorLocal 向前找未闭合的 '{'
    let i = cursorLocal - 1;
    let depth = 0;
    let inQ = null;

    while (i >= 0) {
      const c = inner.charAt(i);

      if (c === '"' || c === '\'') {
        let bs = 0, j = i - 1;
        while (j >= 0 && inner.charAt(j) === '\\') { bs++; j--; }
        if (bs % 2 === 0) {
          if (inQ === null) inQ = c;
          else if (inQ === c) inQ = null;
        }
        i--;
        continue;
      }
      if (inQ !== null) { i--; continue; }

      if (c === '}') depth++;
      else if (c === '{') {
        if (depth === 0) {
          // 找到最内层未闭合 '{'
          const close = matchBrace(inner, i);
          if (close < 0 || cursorLocal > close) return null;

          // 找大括号归属的键：从 '{' 向前跳空白，再跳等号
          let k = i - 1;
          while (k >= 0 && /\s/.test(inner.charAt(k))) k--;
          if (k < 0 || inner.charAt(k) !== '=') return null;
          k--;
          while (k >= 0 && /\s/.test(inner.charAt(k))) k--;
          let keyEnd = k + 1;
          while (k >= 0 && /[a-zA-Z_]/.test(inner.charAt(k))) k--;
          const ownerKey = inner.slice(k + 1, keyEnd);

          return {
            openBrace: i,
            closeBrace: close,
            ownerKey: ownerKey,
            nestText: inner.slice(i + 1, close),
            nestCursor: cursorLocal - (i + 1)
          };
        }
        depth--;
      }
      i--;
    }
    return null;
  }

  /**
   * 从 openPos（'{' 位置）找匹配的 '}'。
   */
  function matchBrace(text, openPos) {
    let depth = 0, inQ = null;
    for (let i = openPos; i < text.length; i++) {
      const c = text.charAt(i);
      if (inQ) {
        if (c === '\\' && i + 1 < text.length) { i++; continue; }
        if (c === inQ) inQ = null;
        continue;
      }
      if (c === '"' || c === '\'') { inQ = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * 分析光标在嵌套大括号内的位置（key / value / separator）。
   * 复用 analyzeSelectorPosition 的算法，但作用域限定在 nestText 上。
   *
   * @returns {{
   *   phase: 'key' | 'value',
   *   keyPrefix: string,
   *   currentKey: string | null,
   *   keys: Array<{key, eqIndex}>
   * }}
   */
  function analyzeNestedPosition(nestText, nestCursor) {
    const pos = analyzeSelectorPosition(nestText, nestCursor);
    const keys = parseSelectorKeys(nestText.slice(0, nestCursor));
    return {
      phase: pos.phase,
      keyPrefix: pos.keyPrefix,
      currentKey: pos.currentKey,
      keys: keys
    };
  }

  /* ============================================================
     五、参数类型 → 补全来源
     ============================================================ */

  function paramTypeToSource(type) {
    switch (type) {
      case 'target':      return { types: ['selector', 'player', 'string'], source: 'selector' };
      case 'block':       return { types: ['block'],   source: 'block' };
      case 'item':        return { types: ['item'],    source: 'item' };
      case 'entity':      return { types: ['entity'],  source: 'entity' };
      case 'effect':      return { types: ['effect'],  source: 'effect' };
      case 'enchant':     return { types: ['enchant'], source: 'enchant' };
      case 'gamemode':    return { types: ['gamemode'],source: 'gamemode' };
      case 'time':        return { types: ['time', 'number'], source: 'time' };
      case 'dimension':   return { types: ['dimension'], source: 'dimension' };
      case 'objective':   return { types: ['string'],  source: 'objective' };
      case 'coordinate':  return { types: ['coordinate'], source: null };
      case 'vec3':        return { types: ['coordinate'], source: null };
      case 'rotation':    return { types: ['coordinate'], source: null };
      case 'int':         return { types: ['number'],  source: null };
      case 'number':      return { types: ['number'],  source: null };
      case 'string':      return { types: ['string'],  source: null };
      case 'quoted':      return { types: ['string'],  source: null };
      case 'message':     return { types: ['string'],  source: null };
      case 'bool':        return { types: ['bool'],    source: null };
      case 'json':        return { types: ['json'],    source: null };
      case 'command':     return { types: ['command'], source: 'command' };
      case 'commandName': return { types: ['command'], source: 'command' };
      case 'enum':        return { types: ['enum'],    source: 'enum' };
      default:            return { types: ['value'],   source: null };
    }
  }

  /* ============================================================
     六、execute 链
     ============================================================ */

  function parseExecuteChain(args, cursorLocalInArgs, links) {
    let li = 0, pi = 0, i = 0, currentLink = null;

    while (i < args.length) {
      if (li >= links.length) {
        return { linkIndex: li, currentLink: null, paramIndex: pi, expecting: null };
      }
      const link = links[li];
      currentLink = link;

      const kwTokens = link.keyword.split(/\s+/);
      let matched = true;
      for (let k = 0; k < kwTokens.length; k++) {
        if (i + k >= args.length) { matched = false; break; }
        if (args[i + k].value !== kwTokens[k]) { matched = false; break; }
      }
      if (!matched) {
        li++;
        if (li >= links.length) {
          return { linkIndex: li, currentLink: null, paramIndex: 0, expecting: null };
        }
        continue;
      }

      i += kwTokens.length;

      if (link.terminal) {
        return {
          linkIndex: li,
          currentLink: link,
          paramIndex: 0,
          expecting: { types: ['command'], source: 'command' }
        };
      }

      if (link.expand) {
        return parseExpand(link.expand, args, i);
      }

      const params = link.params || [];
      pi = 0;
      while (pi < params.length && i < args.length) { i++; pi++; }

      if (pi < params.length) {
        return {
          linkIndex: li,
          currentLink: link,
          paramIndex: pi,
          expecting: paramTypeToSource(params[pi].type)
        };
      }
      li++;
      pi = 0;
    }

    if (li >= links.length) {
      return { linkIndex: li, currentLink: null, paramIndex: 0, expecting: null };
    }
    const nextLink = links[li];
    if (nextLink.terminal) {
      return {
        linkIndex: li,
        currentLink: nextLink,
        paramIndex: 0,
        expecting: { types: ['command'], source: 'command' }
      };
    }
    return {
      linkIndex: li,
      currentLink: nextLink,
      paramIndex: -1,
      expecting: { types: ['executeKeyword'], source: 'executeKeyword' }
    };
  }

  function parseExpand(expand, args, i) {
    if (i >= args.length) {
      return {
        linkIndex: -1, currentLink: null, paramIndex: 0,
        expecting: {
          types: ['conditionType'],
          source: 'conditionType',
          options: expand.options
        }
      };
    }
    const cond = args[i].value;
    const opt = expand.options.find(function (o) { return o.value === cond; });
    if (!opt) {
      return {
        linkIndex: -1, currentLink: null, paramIndex: 0,
        expecting: {
          types: ['conditionType'],
          source: 'conditionType',
          options: expand.options
        }
      };
    }
    i++;
    const params = opt.params || [];
    let pi = 0;
    while (pi < params.length && i < args.length) { i++; pi++; }
    if (pi < params.length) {
      return {
        linkIndex: -1, currentLink: null, paramIndex: pi,
        expecting: paramTypeToSource(params[pi].type)
      };
    }
    return {
      linkIndex: -1, currentLink: null, paramIndex: 0,
      expecting: { types: ['executeKeyword'], source: 'executeKeyword' }
    };
  }

  /* ============================================================
     七、主入口
     ============================================================ */

  function parseAt(text, cursor) {
    const tk = getTokenizer();
    const cmds = getCommands();
    const sel = getSelector();

    const empty = {
      kind: 'none',
      expecting: null,
      commandName: null,
      paramIndex: -1,
      chainIndex: -1,
      partial: '',
      tokens: [],
      cursor: cursor,
      wordStart: cursor,
      wordEnd: cursor,
      inSelector: false,
      selectorKeys: [],

      nestedPath: null,
      nestedPhase: null,
      nestedKeys: [],
      nestedKey: null,

      errors: []
    };

    if (!tk || !cmds) return empty;

    const tokens = tk.tokenize(text || '');
    const wordInfo = tk.wordAt(text || '', cursor);

    /* ---------- 1. 选择器内部？ ---------- */
    const selCtx = findSelectorContext(text || '', cursor);
    if (selCtx) {
      const inner = selCtx.inner;
      const innerCursor = cursor - (selCtx.bracketStart + 1);

      // 先看是否有嵌套大括号
      const nestCtx = findNestedContext(inner, innerCursor);
      if (nestCtx) {
        const nested = analyzeNestedPosition(nestCtx.nestText, nestCtx.nestCursor);

        // 组合返回
        const nestedPhase = nested.phase; // 'key' | 'value'
        const nestedKeys = nested.keys;
        const nestedKey = nested.currentKey;

        const kind = nestedPhase === 'key'
          ? 'selectorNestedKey'
          : 'selectorNestedValue';

        // expecting 的具体内容由 completer 决定；
        // 这里只提供路径、阶段、当前嵌套键
        const expecting = {
          types: [kind],
          source: 'selectorNested',
          nestedPath: [nestCtx.ownerKey],
          nestedPhase: nestedPhase,
          nestedKey: nestedKey,
          // 供 completer 查找嵌套键定义
          nestedOwner: nestCtx.ownerKey
        };

        return Object.assign({}, empty, {
          kind: kind,
          expecting: expecting,
          partial: nestedPhase === 'key' ? nested.keyPrefix : '',
          tokens: tokens,
          wordStart: wordInfo.start,
          wordEnd: wordInfo.end,
          inSelector: true,
          selectorKeys: parseSelectorKeys(inner),
          nestedPath: [nestCtx.ownerKey],
          nestedPhase: nestedPhase,
          nestedKeys: nestedKeys,
          nestedKey: nestedKey
        });
      }

      // 没嵌套：走原有的 selectorKey / selectorValue
      const pos = analyzeSelectorPosition(inner, innerCursor);
      const keys = parseSelectorKeys(inner.slice(0, innerCursor));

      const kKind = pos.phase === 'key' ? 'selectorKey' : 'selectorValue';
      const kExpecting = pos.phase === 'key'
        ? { types: ['selectorKey'], source: 'selectorKey' }
        : { types: ['selectorValue'], source: 'selectorValue', key: pos.currentKey };

      return Object.assign({}, empty, {
        kind: kKind,
        expecting: kExpecting,
        partial: pos.phase === 'key' ? pos.keyPrefix : '',
        tokens: tokens,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end,
        inSelector: true,
        selectorKeys: keys
      });
    }

    /* ---------- 2. 收集光标前的有效 token ---------- */
    const beforeTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.start >= cursor) break;
      if (t.type === 'whitespace' || t.type === 'newline') continue;
      beforeTokens.push(t);
    }

    const partial = wordInfo.prefix;

    let firstToken = null;
    if (beforeTokens.length > 0 && beforeTokens[0].type === 'slash') {
      firstToken = beforeTokens[1] || null;
    } else {
      firstToken = beforeTokens[0] || null;
    }

    if (!firstToken) {
      return Object.assign({}, empty, {
        kind: 'command',
        expecting: { types: ['command'], source: 'command' },
        partial: partial,
        tokens: tokens,
        cursor: cursor,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end
      });
    }

    const cmdName = firstToken.value;
    const cmdDef = cmds.get(cmdName);

    if (!cmdDef) {
      return Object.assign({}, empty, {
        kind: 'command',
        expecting: { types: ['command'], source: 'command' },
        partial: partial,
        tokens: tokens,
        cursor: cursor,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end
      });
    }

    /* ---------- 3. execute 链 ---------- */
    if (cmdDef.type === 'chain' && cmdDef.chain) {
      const args = [];
      for (let i = 0; i < beforeTokens.length; i++) {
        if (beforeTokens[i] === firstToken) {
          for (let j = i + 1; j < beforeTokens.length; j++) args.push(beforeTokens[j]);
          break;
        }
      }
      const trailingSpace = /[\s]$/.test((text || '').slice(0, cursor));
      const cursorLocalInArgs = trailingSpace ? Number.MAX_SAFE_INTEGER : args.length - 1;

      const chainResult = parseExecuteChain(args, cursorLocalInArgs, cmdDef.chain.links);

      return Object.assign({}, empty, {
        kind: chainResult.expecting && chainResult.expecting.source === 'executeKeyword'
          ? 'keyword'
          : 'arg',
        expecting: chainResult.expecting,
        commandName: 'execute',
        paramIndex: chainResult.paramIndex,
        chainIndex: chainResult.linkIndex,
        partial: partial,
        tokens: tokens,
        cursor: cursor,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end
      });
    }

    /* ---------- 4. 普通命令 ---------- */
    const argTokens = beforeTokens.slice(beforeTokens.indexOf(firstToken) + 1);
    const trailingSpace = /[\s]$/.test((text || '').slice(0, cursor));
    const consumed = trailingSpace ? argTokens.length : Math.max(0, argTokens.length - 1);

    const branch = pickSyntaxBranch(cmdDef, consumed);
    if (!branch) {
      return Object.assign({}, empty, {
        kind: 'arg',
        commandName: cmdName,
        partial: partial,
        tokens: tokens,
        cursor: cursor,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end
      });
    }

    const params = branch.params || [];
    if (consumed >= params.length) {
      return Object.assign({}, empty, {
        kind: 'arg',
        commandName: cmdName,
        paramIndex: consumed,
        expecting: null,
        partial: partial,
        tokens: tokens,
        cursor: cursor,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end
      });
    }

    const p = params[consumed];
    const exp = paramTypeToSource(p.type);
    if (p.type === 'enum' && Array.isArray(p.options)) {
      exp.options = p.options;
    }
    if (p.group) exp.group = p.group;
    if (p.min != null) exp.min = p.min;
    if (p.max != null) exp.max = p.max;

    return Object.assign({}, empty, {
      kind: 'arg',
      commandName: cmdName,
      paramIndex: consumed,
      expecting: exp,
      partial: partial,
      tokens: tokens,
      cursor: cursor,
      wordStart: wordInfo.start,
      wordEnd: wordInfo.end
    });
  }

  function pickSyntaxBranch(cmdDef, consumed) {
    if (!cmdDef.syntax || cmdDef.syntax.length === 0) return null;
    for (let i = 0; i < cmdDef.syntax.length; i++) {
      const b = cmdDef.syntax[i];
      const min = (b.params || []).filter(function (p) { return !p.optional; }).length;
      const max = (b.params || []).length;
      if (consumed >= min && consumed <= max) return b;
    }
    return cmdDef.syntax[0];
  }

  /* ============================================================
     对外
     ============================================================ */

  global.MCCT = global.MCCT || {};
  global.MCCT.parser = {
    parseAt: parseAt,
    findSelectorContext: findSelectorContext,
    findNestedContext: findNestedContext,
    analyzeSelectorPosition: analyzeSelectorPosition,
    analyzeNestedPosition: analyzeNestedPosition,
    parseSelectorKeys: parseSelectorKeys,
    paramTypeToSource: paramTypeToSource,
    matchBracket: matchBracket,
    matchBrace: matchBrace,
    _pickSyntaxBranch: pickSyntaxBranch
  };
})(window);
