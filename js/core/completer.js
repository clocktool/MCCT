/* ============================================================
   MCCT — core/completer.js
   补全引擎。给定 parser 的上下文，返回候选列表。

   输出格式（统一）：
     {
       items: [
         {
           value:      插入到编辑器的文本（不含光标前缀）
           label:      显示文本（默认等于 value，可指定）
           kind:       'command' | 'block' | 'item' | ... 用于图标
           desc:       副标题（中文名、说明）
           match:      用于排序/高亮的匹配文本
         }, ...
       ],
       replaceRange: { start, end }  建议替换的字符范围
     }

   去前缀规则（用户实测结论）：
     block / item / entity / effect / enchant / sound
       → 展示短名（去 minecraft:），匹配时短名和长名都试
     animation
       → 保留完整键名（animation.xxx）
     其它
       → 原样
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

  /** 去 minecraft: 前缀 */
  function stripNS(s) {
    if (!s) return s;
    const idx = s.indexOf(':');
    if (idx < 0) return s;
    // 只剥一次，且只剥已知的命名空间前缀
    return s.slice(idx + 1);
  }

  /** 统一小写比较（ID 本身区分大小写，但补全不区分） */
  function lower(s) { return s ? s.toLowerCase() : ''; }

  /** 前缀匹配：pos 是 s 中 needle 首次出现的下标，或 -1 */
  function indexOf(haystack, needle) {
    return lower(haystack).indexOf(lower(needle));
  }

  function startsWith(haystack, needle) {
    return lower(haystack).indexOf(lower(needle)) === 0;
  }

  /* ============================================================
     去前缀策略表
     ============================================================ */

  /** category -> 'strip' | 'keep' */
  const NS_STRIP_POLICY = {
    block:     'strip',
    item:      'strip',
    entity:    'strip',
    effect:    'strip',
    enchant:   'strip',
    sound:     'keep',   // 声音 key 本身就不是 minecraft:xxx，policy 无所谓
    animation: 'keep',
    fog:       'strip',
    biome:     'strip'
  };

  /** 该 category 是否应该剥前缀后再展示 */
  function shouldStrip(category) {
    return NS_STRIP_POLICY[category] === 'strip';
  }

  /* ============================================================
     数据源适配：把 loader 的 {id, label} 转成统一 item
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
     过滤器：把候选按前缀过滤 + 排序
     ============================================================ */

  function filterAndRank(items, partial) {
    if (!partial) {
      return items.slice(0, MAX_ITEMS);
    }
    const p = lower(partial);
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const field = lower(it.match || it.value || '');
      const idx = field.indexOf(p);
      if (idx < 0) continue;
      // 评分：前缀命中 > 中间命中；value 命中 > desc 命中
      let score = 1000 - idx;
      if (startsWith(it.value, p)) score += 500;
      if (it._raw && startsWith(it._raw, p)) score += 300;
      if (lower(it.value) === p) score += 1000;
      scored.push({ it: it, score: score, idx: idx });
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      // 短名优先
      return a.it.value.length - b.it.value.length;
    });
    return scored.slice(0, MAX_ITEMS).map(function (s) { return s.it; });
  }

  /* ============================================================
     各类数据源的补全
     ============================================================ */

  /**
   * 补全命令名。
   */
  function completeCommand(partial, tiers) {
    const cmds = getCommands();
    if (!cmds) return [];

    const list = cmds.list;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
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

  /**
   * 补全 execute 链关键词。
   * @param {Object} ctx  parser 的输出
   */
  function completeExecuteKeyword(ctx, partial) {
    const cmds = getCommands();
    if (!cmds) return [];
    const exec = cmds.get('execute');
    if (!exec || !exec.chain) return [];

    const out = [];
    const links = exec.chain.links;
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      // 若 link 已有展开，展开名也作为候选
      out.push({
        value: l.keyword,
        label: l.keyword,
        kind: 'keyword',
        desc: l.description || '',
        match: l.keyword + ' ' + (l.description || '')
      });
      // 复合关键字 "positioned as"，同时暴露 "positioned"
      if (l.keyword.indexOf(' ') > 0) {
        const first = l.keyword.split(' ')[0];
        if (!out.some(function (o) { return o.value === first; })) {
          out.push({
            value: first,
            label: first,
            kind: 'keyword',
            desc: l.description || '',
            match: first
          });
        }
      }
      // expand 分支里的 condition 关键字（if / unless 下的 block/blocks/...）
      if (l.expand && l.expand.options) {
        for (let k = 0; k < l.expand.options.length; k++) {
          const opt = l.expand.options[k];
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

  /**
   * 补全条件类型（if/unless 之后的 block/blocks/entity/score/data）。
   */
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

  /**
   * 补全枚举。
   */
  function completeEnum(ctx, partial) {
    const exp = ctx.expecting;
    const out = [];
    const options = (exp && exp.options) || [];
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const it = makeItemFromEnum(o);
      it.kind = 'enum';
      out.push(it);
      // aliases（如 gamemode 的 s/c/a/d/0/1/2）
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

  /**
   * 补全布尔值。
   */
  function completeBool(partial) {
    return filterAndRank([
      { value: 'true',  label: 'true',  kind: 'enum', desc: '真',  match: 'true 真' },
      { value: 'false', label: 'false', kind: 'enum', desc: '假', match: 'false 假' }
    ], partial);
  }

  /**
   * 补全维度。
   */
  function completeDimension(partial) {
    return filterAndRank([
      { value: 'overworld', label: 'overworld', kind: 'enum', desc: '主世界', match: 'overworld 主世界' },
      { value: 'nether',    label: 'nether',    kind: 'enum', desc: '下界',   match: 'nether 下界' },
      { value: 'the_end',   label: 'the_end',   kind: 'enum', desc: '末地',   match: 'the_end 末地' }
    ], partial);
  }

  /**
   * 补全时间字面量。
   */
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

  /**
   * 补全游戏模式。
   */
  function completeGamemode(partial) {
    return filterAndRank([
      { value: 'survival',  label: 'survival',  kind: 'enum', desc: '生存（s/0）',  match: 'survival s 0 生存' },
      { value: 'creative',  label: 'creative',  kind: 'enum', desc: '创造（c/1）',  match: 'creative c 1 创造' },
      { value: 'adventure', label: 'adventure', kind: 'enum', desc: '冒险（a/2）',  match: 'adventure a 2 冒险' },
      { value: 'spectator', label: 'spectator', kind: 'enum', desc: '旁观（sp）',   match: 'spectator sp 旁观' },
      { value: 'default',   label: 'default',   kind: 'enum', desc: '默认（d）',    match: 'default d 默认' }
    ], partial);
  }

  /**
   * 从 loader 加载的 ID 表补全（block/item/entity/...）。
   * @param {string} category
   * @param {string} partial
   * @returns {Array}
   */
  function completeFromIDTable(category, partial) {
    const loader = getLoader();
    if (!loader) return [];
    const list = loader.get(category);
    if (!list) return [];

    // 预过滤：若 partial 可能带 minecraft: 前缀，去掉它后再匹配
    const p = partial || '';
    const pStripped = stripNS(p);

    const out = [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const short = stripNS(entry.id);
      // 构造可用于匹配的多字段
      // 短名始终展示；完整名存入 _raw
      const item = {
        value: shouldStrip(category) ? short : entry.id,
        label: shouldStrip(category) ? short : entry.id,
        kind: category,
        desc: entry.label || '',
        match: short + ' ' + entry.id + ' ' + (entry.label || ''),
        _raw: entry.id
      };
      out.push(item);
    }
    return filterAndRank(out, pStripped || p);
  }

  /**
   * 补全选择器本体（@a @e ...）。
   */
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

  /**
   * 补全选择器内部的 key。
   */
  function completeSelectorKey(ctx, partial) {
    const sel = getSelector();
    if (!sel) return [];
    const out = [];
    const used = ctx.selectorKeys || [];
    const usedSet = new Set(used.map(function (k) { return k.key; }));
    for (let i = 0; i < sel.keys.length; i++) {
      const k = sel.keys[i];
      const isUsed = usedSet.has(k.key);
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

  /**
   * 补全选择器内部 key 的值。
   */
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
        // ← 新增：从 loader 读 entityFamily 表
        return completeFromIDTable('entityFamily', partial);

      case 'bool':
        return completeBool(partial);

      case 'enum':
        // location= 之类
        if (Array.isArray(kDef.options)) {
          return filterAndRank(kDef.options.map(makeItemFromEnum), partial);
        }
        return [];

      case 'coordinate':
      case 'number':
      case 'int':
      case 'string':
      case 'scores':
      case 'hasitem':
      case 'haspermission':
      case 'has_property':
      default:
        // 自由输入 / 嵌套结构，交给下拉列表内的"段内补全"处理
        return [];
    }
  }

  /* ============================================================
     调度：根据 parser 输出决定补什么
     ============================================================ */

  /**
   * @param {Object} ctx  parser.parseAt 的输出
   * @param {Object} [options]
   *   - tiers: ['core','advanced']  允许的命令 tier
   * @returns {{ items: Array, replaceRange: {start,end} }}
   */
  function complete(ctx, options) {
    const opts = options || {};
    const tiers = opts.tiers;

    if (!ctx || !ctx.expecting) {
      return { items: [], replaceRange: { start: ctx.wordStart, end: ctx.wordEnd } };
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
        // 计分项目前无法枚举（需读世界状态），留空
        items = [];
        break;

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
    _filterAndRank: filterAndRank
  };
})(window);
