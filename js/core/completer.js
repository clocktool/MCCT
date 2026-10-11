/* ============================================================
   MCCT — core/completer.js  （修订版 · 支持嵌套选择器参数）

   本次修订：
     1. 新增 source = 'selectorNested' 的处理分支
     2. 支持 hasitem / scores / haspermission / has_property
        四类嵌套键的补全
     3. 嵌套内部的 phase = 'key' / 'value' 分别处理：
          key   → 补嵌套键（item= / quantity= / location= ...）
          value → 按嵌套键的 type 补值（item→物品ID, location→槽位枚举, bool→true/false）
     4. 保留原有全部行为

   补全输出（统一）：
     { items: [...], replaceRange: { start, end } }
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_ITEMS = 60;

  /* ============================================================
     工具
     ============================================================ */

  function getParser()    { return global.MCCT && global.MCCT.parser; }
  function getCommands()  { return global.MCCT && global.MCCT.commands; }
  function getLoader()    { return global.MCCT && global.MCCT.loader; }
  function getSelector()  { return global.MCCT && global.MCCT.selector; }
  function getTokenizer() { return global.MCCT && global.MCCT.tokenizer; }

  function stripNS(s) {
    if (!s) return s;
    const idx = s.indexOf(':');
    if (idx < 0) return s;
    return s.slice(idx + 1);
  }

  function lower(s) { return s ? s.toLowerCase() : ''; }
  function startsWith(h, n) { return lower(h).indexOf(lower(n)) === 0; }

  /* ============================================================
     去前缀策略
     ============================================================ */

  const NS_STRIP_POLICY = {
    block:     'strip',
    item:      'strip',
    entity:    'strip',
    effect:    'strip',
    enchant:   'strip',
    sound:     'keep',
    animation: 'keep',
    fog:       'strip',
    biome:     'strip',
    entityFamily: 'keep'   // 实体族本身不是命名空间 ID
  };

  function shouldStrip(category) {
    return NS_STRIP_POLICY[category] === 'strip';
  }

  /* ============================================================
     Item 构造
     ============================================================ */

  function makeItemFromId(entry, kind, category) {
    const rawId = entry.id;
    const display = shouldStrip(category) ? stripNS(rawId) : rawId;
    return {
      value: display,
      label: display,
      kind: kind,
      desc: entry.label || '',
      match: display + ' ' + rawId + ' ' + (entry.label || ''),
      _raw: rawId
    };
  }

  function makeItemFromEnum(opt) {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : (opt.label || opt.value);
    return {
      value: value,
      label: value,
      kind: 'enum',
      desc: label,
      match: value + ' ' + label,
      _raw: value
    };
  }

  /* ============================================================
     过滤 + 排序
     ============================================================ */

  function filterAndRank(items, partial) {
    if (!partial) return items.slice(0, MAX_ITEMS);
    const p = lower(partial);
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const field = lower(it.match || it.value || '');
      const idx = field.indexOf(p);
      if (idx < 0) continue;
      let score = 1000 - idx;
      if (startsWith(it.value, p)) score += 500;
      if (it._raw && startsWith(it._raw, p)) score += 300;
      if (lower(it.value) === p) score += 1000;
      scored.push({ it: it, score: score });
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.it.value.length - b.it.value.length;
    });
    return scored.slice(0, MAX_ITEMS).map(function (s) { return s.it; });
  }

  /* ============================================================
     各类补全
     ============================================================ */

  function completeCommand(partial, tiers) {
    const cmds = getCommands();
    if (!cmds) return [];
    const out = [];
    for (let i = 0; i < cmds.list.length; i++) {
      const c = cmds.list[i];
      if (tiers && tiers.length && tiers.indexOf(c.tier) < 0) continue;
      out.push({
        value: c.name,
        label: c.name,
        kind: 'command',
        desc: c.description || '',
        match: c.name + ' ' + (c.aliases || []).join(' ') + ' ' + (c.description || '')
      });
    }
    return filterAndRank(out, partial);
  }

  function completeExecuteKeyword(ctx, partial) {
    const cmds = getCommands();
    if (!cmds) return [];
    const exec = cmds.get('execute');
    if (!exec || !exec.chain) return [];

    const out = [];
    const links = exec.chain.links;
    const seen = Object.create(null);

    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      if (!seen[l.keyword]) {
        seen[l.keyword] = true;
        out.push({
          value: l.keyword,
          label: l.keyword,
          kind: 'keyword',
          desc: l.description || '',
          match: l.keyword + ' ' + (l.description || '')
        });
      }
      if (l.keyword.indexOf(' ') > 0) {
        const first = l.keyword.split(' ')[0];
        if (!seen[first]) {
          seen[first] = true;
          out.push({
            value: first,
            label: first,
            kind: 'keyword',
            desc: l.description || '',
            match: first
          });
        }
      }
      if (l.expand && l.expand.options) {
        for (let k = 0; k < l.expand.options.length; k++) {
          const opt = l.expand.options[k];
          if (seen[opt.value]) continue;
          seen[opt.value] = true;
          out.push({
            value: opt.value,
            label: opt.value,
            kind: 'keyword',
            desc: opt.label || '',
            match: opt.value + ' ' + (opt.label || '')
          });
        }
      }
    }
    return filterAndRank(out, partial);
  }

  function completeConditionType(ctx, partial) {
    const exp = ctx.expecting;
    const out = [];
    const options = (exp && exp.options) || [];
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      out.push({
        value: o.value,
        label: o.value,
        kind: 'keyword',
        desc: o.label || '',
        match: o.value + ' ' + (o.label || '')
      });
    }
    return filterAndRank(out, partial);
  }

  function completeEnum(ctx, partial) {
    const exp = ctx.expecting;
    const out = [];
    const options = (exp && exp.options) || [];
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      out.push(makeItemFromEnum(o));
      if (typeof o === 'object' && Array.isArray(o.aliases)) {
        for (let k = 0; k < o.aliases.length; k++) {
          out.push({
            value: o.aliases[k],
            label: o.aliases[k],
            kind: 'enum',
            desc: (o.label || o.value) + '（别名）',
            match: o.aliases[k] + ' ' + o.value + ' ' + (o.label || '')
          });
        }
      }
    }
    return filterAndRank(out, partial);
  }

  function completeBool(partial) {
    return filterAndRank([
      { value: 'true',  label: 'true',  kind: 'enum', desc: '真', match: 'true 真' },
      { value: 'false', label: 'false', kind: 'enum', desc: '假', match: 'false 假' }
    ], partial);
  }

  function completeDimension(partial) {
    return filterAndRank([
      { value: 'overworld', label: 'overworld', kind: 'enum', desc: '主世界', match: 'overworld 主世界' },
      { value: 'nether',    label: 'nether',    kind: 'enum', desc: '下界',   match: 'nether 下界' },
      { value: 'the_end',   label: 'the_end',   kind: 'enum', desc: '末地',   match: 'the_end 末地' }
    ], partial);
  }

  function completeTime(partial) {
    return filterAndRank([
      { value: 'day',      label: 'day',      kind: 'enum', desc: '白天',  match: 'day 白天' },
      { value: 'noon',     label: 'noon',     kind: 'enum', desc: '正午',  match: 'noon 正午' },
      { value: 'night',    label: 'night',    kind: 'enum', desc: '夜晚',  match: 'night 夜晚' },
      { value: 'midnight', label: 'midnight', kind: 'enum', desc: '午夜',  match: 'midnight 午夜' },
      { value: 'sunrise',  label: 'sunrise',  kind: 'enum', desc: '日出',  match: 'sunrise 日出' },
      { value: 'sunset',   label: 'sunset',   kind: 'enum', desc: '日落',  match: 'sunset 日落' }
    ], partial);
  }

  function completeGamemode(partial) {
    return filterAndRank([
      { value: 'survival',  label: 'survival',  kind: 'enum', desc: '生存（s/0）',  match: 'survival s 0 生存' },
      { value: 'creative',  label: 'creative',  kind: 'enum', desc: '创造（c/1）',  match: 'creative c 1 创造' },
      { value: 'adventure', label: 'adventure', kind: 'enum', desc: '冒险（a/2）',  match: 'adventure a 2 冒险' },
      { value: 'spectator', label: 'spectator', kind: 'enum', desc: '旁观（sp）',   match: 'spectator sp 旁观' },
      { value: 'default',   label: 'default',   kind: 'enum', desc: '默认（d）',    match: 'default d 默认' }
    ], partial);
  }

  function completeFromIDTable(category, partial) {
    const loader = getLoader();
    if (!loader) return [];
    const list = loader.get(category);
    if (!list) return [];

    const p = partial || '';
    const pStripped = stripNS(p);

    const out = [];
    for (let i = 0; i < list.length; i++) {
      out.push(makeItemFromId(list[i], category, category));
    }
    return filterAndRank(out, pStripped || p);
  }

  function completeSelectorBody(partial) {
    const sel = getSelector();
    if (!sel) return [];
    const out = [];
    for (let i = 0; i < sel.selectors.length; i++) {
      const s = sel.selectors[i];
      out.push({
        value: s.value,
        label: s.value,
        kind: 'selector',
        desc: s.label + ' — ' + s.desc,
        match: s.value + ' ' + s.label + ' ' + s.desc
      });
    }
    return filterAndRank(out, partial);
  }

  function completeSelectorKey(ctx, partial) {
    const sel = getSelector();
    if (!sel) return [];
    const out = [];
    const used = ctx.selectorKeys || [];
    const usedSet = new Set(used.map(function (k) { return k.key; }));

    for (let i = 0; i < sel.keys.length; i++) {
      const k = sel.keys[i];
      const isUsed = usedSet.has(k.key);
      // 注意：value 里已经带了 '='，用户点选后直接在等号后继续输
      out.push({
        value: k.key + '=',
        label: k.key,
        kind: 'selectorKey',
        desc: (isUsed ? '（已用）' : '') + (k.desc || ''),
        match: k.key + ' ' + (k.desc || '')
      });
    }
    return filterAndRank(out, partial);
  }

  function completeSelectorValue(ctx, partial) {
    const key = ctx.expecting && ctx.expecting.key;
    if (!key) return [];
    const sel = getSelector();
    const kDef = sel && sel.keyMap ? sel.keyMap[key] : null;
    if (!kDef) return [];

    switch (kDef.type) {
      case 'entityType':
        return completeFromIDTable('entity', partial);

      case 'entityFamily':
        return completeFromIDTable('entityFamily', partial);

      case 'bool':
        return completeBool(partial);

      case 'enum':
        if (Array.isArray(kDef.options)) {
          return filterAndRank(kDef.options.map(makeItemFromEnum), partial);
        }
        return [];

      // 以下类型不在此处补全（由嵌套分支处理，或用户手输）
      case 'scores':
      case 'hasitem':
      case 'haspermission':
      case 'has_property':
      case 'coordinate':
      case 'number':
      case 'int':
      case 'string':
      default:
        return [];
    }
  }

  /* ============================================================
     ★ 本次新增：嵌套选择器参数的补全
     ============================================================ */

  /**
   * 处理 @a[hasitem={|}]、@a[hasitem={item=|}]、@a[scores={|}] 等。
   *
   * 通过 ctx.nestedPhase 判断：
   *   'key'   → 补嵌套键（item= / data= / quantity= / location= / slot=）
   *   'value' → 按 nestedKey 的类型补值
   *
   * @param {Object} ctx  parser 输出
   * @param {string} partial  当前词前缀
   * @returns {Array}
   */
  function completeSelectorNested(ctx, partial) {
    const sel = getSelector();
    if (!sel || !sel.nested) return [];

    const owner = ctx.nestedPath && ctx.nestedPath[0];
    if (!owner) return [];

    const keyDefs = sel.nested[owner];
    if (!Array.isArray(keyDefs)) return [];

    /* ---------- 1. 在补嵌套键 ---------- */
    if (ctx.nestedPhase === 'key') {
      const used = ctx.nestedKeys || [];
      const usedSet = new Set(used.map(function (k) { return k.key; }));

      const out = [];
      for (let i = 0; i < keyDefs.length; i++) {
        const k = keyDefs[i];
        const isUsed = usedSet.has(k.key);
        // 已用过的跳过（scores 例外：可以重复用；但本项目暂不区分）
        if (isUsed && owner !== 'scores' && owner !== 'has_property') continue;

        out.push({
          value: k.key + '=',
          label: k.key,
          kind: 'selectorNestedKey',
          desc: (k.required ? '（必填）' : '') + (k.desc || ''),
          match: k.key + ' ' + (k.desc || '')
        });
      }
      return filterAndRank(out, partial);
    }

    /* ---------- 2. 在补嵌套键的值 ---------- */
    if (ctx.nestedPhase === 'value') {
      const keyName = ctx.nestedKey;
      if (!keyName) return [];

      const kDef = keyDefs.find(function (k) { return k.key === keyName; });
      if (!kDef) return [];

      // 用户当前输入的前缀可能带 '!'（反选），先剥掉再匹配
      const p = partial || '';
      const stripped = p.charAt(0) === '!' ? p.slice(1) : p;

      let candidates = [];

      switch (kDef.type) {
        case 'item':
          candidates = completeFromIDTableRaw('item');
          break;

        case 'bool':
          candidates = [
            { value: 'true',  label: 'true',  kind: 'enum', desc: '真', match: 'true 真' },
            { value: 'false', label: 'false', kind: 'enum', desc: '假', match: 'false 假' }
          ];
          break;

        case 'enum':
          candidates = (kDef.options || []).map(makeItemFromEnum);
          break;

        case 'int':
        case 'number':
        case 'coordinate':
        case 'string':
        default:
          // 数字/自由字符串，不给候选项
          candidates = [];
      }

      const ranked = filterAndRank(candidates, stripped);
      // 若用户已经输了 '!'，把 '!' 加回 value
      if (p.charAt(0) === '!') {
        for (let i = 0; i < ranked.length; i++) {
          ranked[i].value = '!' + ranked[i].value;
          ranked[i].label = '!' + ranked[i].label;
        }
      }
      return ranked;
    }

    return [];
  }

  /**
   * 不带 partial 过滤的直接取列表（用于补全前剥离前缀）。
   */
  function completeFromIDTableRaw(category) {
    const loader = getLoader();
    if (!loader) return [];
    const list = loader.get(category);
    if (!list) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      out.push(makeItemFromId(list[i], category, category));
    }
    return out;
  }

  /* ============================================================
     调度
     ============================================================ */

  function complete(ctx, options) {
    const opts = options || {};
    const tiers = opts.tiers;

    if (!ctx || !ctx.expecting) {
      return {
        items: [],
        replaceRange: { start: ctx ? ctx.wordStart : 0, end: ctx ? ctx.wordEnd : 0 }
      };
    }

    const exp = ctx.expecting;
    const partial = ctx.partial || '';
    let items = [];

    switch (exp.source) {
      case 'command':
        items = completeCommand(partial, tiers);
        break;

      case 'executeKeyword':
        items = completeExecuteKeyword(ctx, partial);
        break;

      case 'conditionType':
        items = completeConditionType(ctx, partial);
        break;

      case 'selector':
        items = completeSelectorBody(partial);
        break;

      case 'selectorKey':
        items = completeSelectorKey(ctx, partial);
        break;

      case 'selectorValue':
        items = completeSelectorValue(ctx, partial);
        break;

      case 'selectorNested':        // ★ 新增
        items = completeSelectorNested(ctx, partial);
        break;

      case 'block':
      case 'item':
      case 'entity':
      case 'effect':
      case 'enchant':
      case 'fog':
      case 'biome':
      case 'animation':
        items = completeFromIDTable(exp.source, partial);
        break;

      case 'gamemode':
        items = completeGamemode(partial);
        break;

      case 'time':
        items = completeTime(partial);
        break;

      case 'dimension':
        items = completeDimension(partial);
        break;

      case 'bool':
        items = completeBool(partial);
        break;

      case 'enum':
        items = completeEnum(ctx, partial);
        break;

      case 'objective':
      default:
        items = [];
    }

    return {
      items: items,
      replaceRange: { start: ctx.wordStart, end: ctx.wordEnd }
    };
  }

  /* ============================================================
     对外
     ============================================================ */

  global.MCCT = global.MCCT || {};
  global.MCCT.completer = {
    complete: complete,
    stripNS: stripNS,
    _completeCommand: completeCommand,
    _completeFromIDTable: completeFromIDTable,
    _completeSelectorNested: completeSelectorNested,
    _filterAndRank: filterAndRank
  };
})(window);
