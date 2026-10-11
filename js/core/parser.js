/* ============================================================
   MCCT — core/parser.js
   语法解析器。在 tokenizer 输出的 token 流上跑一个状态机，
   推断「光标当前位置期待什么」，供 completer 使用。

   本模块不碰 DOM，不读 textarea，全部输入来自参数。

   输出（统一结构）：
     {
       kind,         // 'command' | 'arg' | 'selector' | 'selectorKey'
                     // | 'selectorValue' | 'json' | 'none'
       expecting,    // null 或 { types: [...], source: 'block' | ... }
                     //   types 是建议的补全类型集合
                     //   source 对应 loader 的 category 或内置枚举名
       commandName,  // 'execute' | 'setblock' | ...  或 null
       paramIndex,   // 当前是第几个参数（0-based，从命令名后开始数）
       chainIndex,   // 若是 execute 链，当前处于第几个子命令（-1 表示不在 execute）
       partial,      // 已输入的前缀（与 cursor 紧邻的词片段）
       tokens,       // tokenizer 的完整输出
       cursor,       // 当前光标 offset
       wordStart,    // 当前词的起始 offset
       wordEnd,      // 当前词的结束 offset
       inSelector,   // 光标是否位于选择器内部（@a[...] 里）
       selectorKeys, // 若 inSelector，已解析出的 key 列表
       errors        // 发现的语法错误（暂未使用，占位）
     }

   设计哲学：
     - 容错优先。用户可能只输入了一半，parser 不能抛异常，
       必须给出「基于现有信息的最合理猜测」。
     - 保守优先。拿不准时，expecting 返回 null 而不是瞎猜。
     - 不做类型校验（值是否合法由 loader 或游戏决定）。
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     工具
     ============================================================ */

  function getCommands() {
    return (global.MCCT && global.MCCT.commands) || null;
  }

  function getTokenizer() {
    return (global.MCCT && global.MCCT.tokenizer) || null;
  }

  /* ============================================================
     上下文分类：判断光标所在位置
     ============================================================ */

  /**
   * 判断光标是否位于一个 `@x[...]` 的方括号内部。
   * @param {string} text
   * @param {number} cursor
   * @returns {null | { start: number, end: number }}
   *   命中则返回选择器内部的字符区间（不含方括号），否则 null。
   */
  function findSelectorContext(text, cursor) {
    // 从 cursor 往前找最近的 '@'
    let i = cursor - 1;
    let depth = 0;
    while (i >= 0) {
      const c = text.charAt(i);
      if (c === ']') depth++;
      else if (c === '[') {
        if (depth === 0) {
          // 检查 '[' 前面是不是 @x
          let j = i - 1;
          while (j >= 0 && /[a-z_]/i.test(text.charAt(j))) j--;
          if (j >= 0 && text.charAt(j) === '@') {
            // 找到选择器起始
            // 找匹配的 ']'
            let k = i + 1, d = 1, inQ = null;
            while (k < text.length) {
              const ck = text.charAt(k);
              if (inQ) {
                if (ck === '\\' && k + 1 < text.length) { k += 2; continue; }
                if (ck === inQ) inQ = null;
                k++;
                continue;
              }
              if (ck === '"' || ck === '\'') { inQ = ck; k++; continue; }
              if (ck === '[') d++;
              else if (ck === ']') { d--; if (d === 0) break; }
              k++;
            }
            // 光标必须在 [i, k] 之内
            if (cursor > i && cursor <= k) {
              return { start: i + 1, end: k };
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
   * 解析选择器内部的 key 列表（已输入的键）。
   * 输入形如 "type=fox,name=Bob,tag=!banned"。
   * @returns {Array<{ key: string, eqIndex: number }>}
   */
  function parseSelectorKeys(inner) {
    const out = [];
    let depth = 0;
    let inQ = null;
    let segStart = 0;
    const push = function (end) {
      const seg = inner.slice(segStart, end);
      const eq = seg.indexOf('=');
      if (eq >= 0) {
        const key = seg.slice(0, eq).trim();
        if (key) out.push({ key: key, eqIndex: segStart + eq });
      } else {
        const key = seg.trim();
        if (key) out.push({ key: key, eqIndex: -1 });
      }
    };
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
        push(i);
        segStart = i + 1;
      }
    }
    push(inner.length);
    return out;
  }

  /**
   * 判断光标前的字符是否是选择器 key 的位置：
   *   形如 "@e[ty" 里的 "ty" 是键的前缀
   *   形如 "@e[type=" 里光标在 '=' 后，是值的位置
   * @returns {{
   *   phase: 'key' | 'value' | 'separator',
   *   keyPrefix: string,
   *   currentKey: string | null
   * }}
   */
  function analyzeSelectorPosition(inner, cursorLocal) {
    // cursorLocal 是相对 inner 的偏移
    const before = inner.slice(0, cursorLocal);
    // 找当前段（从最后一个 depth-0 逗号后开始）
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
      // 还在键的位置
      return {
        phase: 'key',
        keyPrefix: seg.replace(/^\s+/, ''),
        currentKey: null
      };
    }
    return {
      phase: 'value',
      keyPrefix: '',
      currentKey: seg.slice(0, eq).trim()
    };
  }

  /* ============================================================
     参数类型 → 补全来源
     ============================================================ */

  /** 把 commands.js 里的参数 type 映射到 completer 能识别的"来源"。 */
  function paramTypeToSource(type) {
    switch (type) {
      case 'target':     return { types: ['selector', 'player', 'string'], source: 'selector' };
      case 'block':      return { types: ['block'],   source: 'block' };
      case 'item':       return { types: ['item'],    source: 'item' };
      case 'entity':     return { types: ['entity'],  source: 'entity' };
      case 'effect':     return { types: ['effect'],  source: 'effect' };
      case 'enchant':    return { types: ['enchant'], source: 'enchant' };
      case 'gamemode':   return { types: ['gamemode'],source: 'gamemode' };
      case 'time':       return { types: ['time', 'number'], source: 'time' };
      case 'dimension':  return { types: ['dimension'], source: 'dimension' };
      case 'objective':  return { types: ['string'],  source: 'objective' };
      case 'coordinate': return { types: ['coordinate'], source: null };
      case 'vec3':       return { types: ['coordinate'], source: null };
      case 'rotation':   return { types: ['coordinate'], source: null };
      case 'int':        return { types: ['number'],  source: null };
      case 'number':     return { types: ['number'],  source: null };
      case 'string':     return { types: ['string'],  source: null };
      case 'quoted':     return { types: ['string'],  source: null };
      case 'message':    return { types: ['string'],  source: null };
      case 'bool':       return { types: ['bool'],    source: null };
      case 'json':       return { types: ['json'],    source: null };
      case 'command':    return { types: ['command'], source: 'command' };
      case 'commandName':return { types: ['command'], source: 'command' };
      case 'enum':       return { types: ['enum'],    source: 'enum' };
      default:           return { types: ['value'],   source: null };
    }
  }

  /* ============================================================
     execute 链：解析当前处于哪个 link
     ============================================================ */

  /**
   * 给定 execute 后面的参数 token 列表（已去掉 'execute' 本身），
   * 推算当前"已消耗到第几个 link 的第几个 param"。
   *
   * @param {Array} args    有效 token（不含 whitespace/newline）
   * @param {number} cursorLocalInArgs  光标相对 args 起点的位置（用于判断"光标是否在最后一个词之后"）
   * @param {Array} links   commands.js 里 execute.chain.links
   * @returns {{
   *   linkIndex: number,        // 已完成多少个 link
   *   currentLink: Object|null, // 当前正在填的 link
   *   paramIndex: number,       // 在当前 link 内第几个 param
   *   expecting: Object|null
   * }}
   */
  function parseExecuteChain(args, cursorLocalInArgs, links) {
    let li = 0;         // links 下标
    let pi = 0;         // 当前 link 内 param 下标
    let i = 0;          // args 下标
    let currentLink = null;

    while (i < args.length) {
      if (li >= links.length) {
        // 超过已知 link，无法继续
        return {
          linkIndex: li,
          currentLink: null,
          paramIndex: pi,
          expecting: null
        };
      }

      const link = links[li];
      currentLink = link;

      // 第一个 token 应该是 keyword（除非 link.keyword 是复合的，如 "positioned as"）
      const kwTokens = link.keyword.split(/\s+/);
      let matchedKeyword = true;
      for (let k = 0; k < kwTokens.length; k++) {
        if (i + k >= args.length) { matchedKeyword = false; break; }
        if (args[i + k].value !== kwTokens[k]) { matchedKeyword = false; break; }
      }

      if (!matchedKeyword) {
        // 这个 link 不匹配，尝试下一个 link
        // 但如果是当前用户输入到一半的 keyword，也应该能给出候选
        // 简化处理：跳过这个 link，试下一个
        li++;
        // 关键：如果所有 link 都试过仍不匹配，跳出
        if (li >= links.length) {
          return {
            linkIndex: li,
            currentLink: null,
            paramIndex: 0,
            expecting: null
          };
        }
        continue;
      }

      // 消耗 keyword
      i += kwTokens.length;

      // 如果 link 是 terminal（run），把剩下的当命令处理
      if (link.terminal) {
        return {
          linkIndex: li,
          currentLink: link,
          paramIndex: 0,
          expecting: { types: ['command'], source: 'command' }
        };
      }

      // 若 link 有 expand（if / unless），转交给 expand 逻辑
      if (link.expand) {
        return parseExpand(link.expand, args, i, cursorLocalInArgs);
      }

      // 消耗 params
      const params = link.params || [];
      pi = 0;
      while (pi < params.length && i < args.length) {
        const p = params[pi];
        // 粗略判断：这个 token 是否已经被填上
        // 精确判断需要类型校验，这里简化为「只要有 token 就消耗一个」
        i++;
        pi++;
      }

      // 若当前 link 参数未填完，返回
      if (pi < params.length) {
        return {
          linkIndex: li,
          currentLink: link,
          paramIndex: pi,
          expecting: paramTypeToSource(params[pi].type)
        };
      }

      // 填完则进入下一个 link
      li++;
      pi = 0;
    }

    // args 用完了：光标在下一个待填位置
    if (li >= links.length) {
      return {
        linkIndex: li,
        currentLink: null,
        paramIndex: 0,
        expecting: null
      };
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
    // 还没输入 keyword，期待 keyword
    return {
      linkIndex: li,
      currentLink: nextLink,
      paramIndex: -1,     // -1 表示期待 keyword
      expecting: { types: ['executeKeyword'], source: 'executeKeyword' }
    };
  }

  /**
   * 处理 execute 里 if / unless 展开。
   * expand = { name: 'condition', options: [{value, params}, ...] }
   * 已消耗到 args[i]（i 指向 expand 的第一个 token）
   */
  function parseExpand(expand, args, i, cursorLocalInArgs) {
    if (i >= args.length) {
      // 期待条件类型（block/blocks/entity/score/data）
      return {
        linkIndex: -1,
        currentLink: null,
        paramIndex: 0,
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
        linkIndex: -1,
        currentLink: null,
        paramIndex: 0,
        expecting: {
          types: ['conditionType'],
          source: 'conditionType',
          options: expand.options
        }
      };
    }
    i++;
    // 消耗 opt.params
    const params = opt.params || [];
    let pi = 0;
    while (pi < params.length && i < args.length) {
      i++;
      pi++;
    }
    if (pi < params.length) {
      return {
        linkIndex: -1,
        currentLink: null,
        paramIndex: pi,
        expecting: paramTypeToSource(params[pi].type)
      };
    }
    // 条件填完，期待 run
    return {
      linkIndex: -1,
      currentLink: null,
      paramIndex: 0,
      expecting: { types: ['executeKeyword'], source: 'executeKeyword' }
    };
  }

  /* ============================================================
     主入口
     ============================================================ */

  /**
   * @param {string} text    完整文本
   * @param {number} cursor  光标 offset
   * @returns {Object}       上下文对象
   */
  function parseAt(text, cursor) {
    const tk = getTokenizer();
    const cmds = getCommands();

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
      errors: []
    };

    if (!tk || !cmds) return empty;

    const tokens = tk.tokenize(text || '');
    const wordInfo = tk.wordAt(text || '', cursor);

    // 检查是否在选择器内部
    const selCtx = findSelectorContext(text || '', cursor);
    if (selCtx) {
      const inner = (text || '').slice(selCtx.start, selCtx.end);
      const innerCursor = cursor - selCtx.start;
      const pos = analyzeSelectorPosition(inner, innerCursor);
      const keys = parseSelectorKeys(inner.slice(0, innerCursor));
      return Object.assign({}, empty, {
        kind: pos.phase === 'key' ? 'selectorKey' : 'selectorValue',
        expecting: pos.phase === 'key'
          ? { types: ['selectorKey'], source: 'selectorKey' }
          : { types: ['selectorValue'], source: 'selectorValue', key: pos.currentKey },
        partial: pos.phase === 'key' ? pos.keyPrefix : '',
        tokens: tokens,
        wordStart: wordInfo.start,
        wordEnd: wordInfo.end,
        inSelector: true,
        selectorKeys: keys
      });
    }

    // 取当前光标之前的有效 token（不含光标后的）
    const beforeTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.start >= cursor) break;
      if (t.type === 'whitespace' || t.type === 'newline') continue;
      beforeTokens.push(t);
    }

    // 若光标位于某个 token 中间，把它算作 partial 前缀
    // 我们只关心"当前正在输入的词"是否包含光标
    const partial = wordInfo.prefix;

    // 判定第一个有效 token 是否命令名
    // 若用户只输了 "/"，则 beforeTokens 为空，期待命令名
    let firstToken = null;
    if (beforeTokens.length > 0 && beforeTokens[0].type === 'slash') {
      firstToken = beforeTokens[1] || null;
      // 命令名前可能有斜杠 token
    } else {
      firstToken = beforeTokens[0] || null;
    }

    // 若 firstToken 存在且其 start >= cursor - partial.length，
    // 说明光标还在命令名本身（打字中）
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

    // 用户还在打命令名
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

    /* ---------- 特殊：execute 链式命令 ---------- */
    if (cmdDef.type === 'chain' && cmdDef.chain) {
      // args = firstToken 之后的所有有效 token
      const args = [];
      for (let i = 0; i < beforeTokens.length; i++) {
        const t = beforeTokens[i];
        if (t === firstToken) {
          for (let j = i + 1; j < beforeTokens.length; j++) args.push(beforeTokens[j]);
          break;
        }
      }
      // 判断光标是否紧贴最后一个词之后（还没打出空格）
      const trailingSpace = /[\s]$/.test((text || '').slice(0, cursor));
      const cursorLocalInArgs = trailingSpace ? Number.MAX_SAFE_INTEGER : args.length - 1;

      const chainResult = parseExecuteChain(args, cursorLocalInArgs, cmdDef.chain.links);

      // 若期待 keyword，返回 type = 'executeKeyword'
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

    /* ---------- 普通命令：逐参数消耗 ---------- */
    // 找到第一个 syntax 分支能匹配"已消耗参数个数 <= 已输入参数个数"的
    const argTokens = beforeTokens.slice(
      beforeTokens.indexOf(firstToken) + 1
    );
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
      // 参数已填满，无期待
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

    // 若参数是 enum，把 options 也塞进 expecting
    if (p.type === 'enum' && Array.isArray(p.options)) {
      exp.options = p.options;
    }

    // 若参数有 group 或 min/max 等元信息，一并传出
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

  /**
   * 选择最合适的 syntax 分支。
   * 目前策略：找到第一个 consumed <= params.length 的分支。
   * 后续可以基于 token 类型做更精细的选择。
   */
  function pickSyntaxBranch(cmdDef, consumed) {
    if (!cmdDef.syntax || cmdDef.syntax.length === 0) return null;
    for (let i = 0; i < cmdDef.syntax.length; i++) {
      const b = cmdDef.syntax[i];
      const min = (b.params || []).filter(function (p) { return !p.optional; }).length;
      const max = (b.params || []).length;
      if (consumed >= min && consumed <= max) return b;
    }
    // 兜底：返回第一个
    return cmdDef.syntax[0];
  }

  /* ============================================================
     对外
     ============================================================ */

  global.MCCT = global.MCCT || {};
  global.MCCT.parser = {
    parseAt: parseAt,
    findSelectorContext: findSelectorContext,
    analyzeSelectorPosition: analyzeSelectorPosition,
    parseSelectorKeys: parseSelectorKeys,
    paramTypeToSource: paramTypeToSource,
    _pickSyntaxBranch: pickSyntaxBranch
  };
})(window);
