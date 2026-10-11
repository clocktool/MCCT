/* ============================================================
   MCCT — data/loader.js  （适配版 · Batch 2.5）

   职责：
     把 MCBEID 表的 .txt 解析成统一结构，供 ID 浏览器使用
     不负责命令定义（那在 commands.js 里）

   数据来源优先级：
     1. window.MCCT_DATA_INLINE[category]
        - 可以是原始字符串（运行时解析）
        - 也可以是已解析的数组 [{id,label,group}]
     2. MCCT.loader.register(category, payload)
     3. fetch(MCCT_DATA_BASE + category + '.txt')

   txt 格式（兼容你提供的全部 MCBEID 文件）：

     【分类名】                    ← 段落标题，切换 group
     【目录】                      ← 特殊段落，整段跳过
     id: 中文名                    ← 常规条目
     id:                           ← 冒号+空格，label 为空
     id:                           ← 冒号后无空格，label 为空
     raw_id_without_colon          ← 裸行，id = 整行
     ※ 页脚注释                    ← 跳过
     # 井号注释                    ← 跳过

   返回结构：
     {
       items:  [{ id, label, group }],
       groups: [ '蜜蜂', '猪灵', ... ]   // 去重后的 group 列表
     }
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 配置 ---------- */

  const DEFAULT_BASE =
    (typeof global !== 'undefined' && global.MCCT_DATA_BASE) || 'js/data/';

  /* ---------- 缓存 ---------- */

  /** category -> { items, groups, source, loadedAt } */
  const cache = new Map();

  /** category -> Promise，防止重复请求 */
  const inflight = new Map();

  /* ============================================================
     一、解析
     ============================================================ */

  /**
   * 单行解析。
   * @returns {{ id, label } | null}
   */
  function parseLine(line) {
    // 优先 ": "（冒号+空格）
    let sep = line.indexOf(': ');
    if (sep >= 0) {
      const id = line.slice(0, sep).trim();
      const label = line.slice(sep + 2).trim();
      return id ? { id, label } : null;
    }

    // 退化 1：只有末尾冒号 "key:"
    if (line.charAt(line.length - 1) === ':') {
      const id = line.slice(0, -1).trim();
      return id ? { id, label: '' } : null;
    }

    // 退化 2：中间有冒号但后面没空格 "minecraft:a:b"
    // 这种情况按最后一个冒号切，最后一段当 label；否则整行当 id
    // 实测你的表里几乎没有这种，但保底处理
    const lastColon = line.lastIndexOf(':');
    if (lastColon > 0 && lastColon < line.length - 1) {
      const id = line.slice(0, lastColon).trim();
      const label = line.slice(lastColon + 1).trim();
      // 只有 id 里明显含命名空间（如 minecraft:）才认为是 key:label
      if (id.indexOf(':') >= 0 || label.length > 0) {
        return { id, label };
      }
    }

    // 退化 3：裸行，整行当 id
    return { id: line, label: '' };
  }

  /**
   * 是否应当跳过该行。
   */
  function shouldSkip(line) {
    if (!line) return true;
    const c = line.charCodeAt(0);
    // ※（U+203B） / #（井号注释）
    if (c === 0x203B) return true;
    if (line.charAt(0) === '#') return true;
    // 全角空格 / 空白
    if (/^\s+$/.test(line)) return true;
    return false;
  }

  /**
   * 判断是否为段落标题，是则返回段落名。
   * 【xxx】
   */
  function parseSection(line) {
    if (line.charCodeAt(0) !== 0x3010 /* 【 */) return null;
    const m = line.match(/^【(.+?)】\s*$/);
    return m ? m[1] : null;
  }

  /**
   * 主解析函数。
   *
   * @param {string} text  MCBEID 原始文本
   * @returns {{ items: Array, groups: Array }}
   */
  function parseMCBEID(text) {
    const items = [];
    const groupSet = new Set();
    if (typeof text !== 'string' || text.length === 0) {
      return { items, groups: [] };
    }

    // 统一换行 + 去 BOM
    const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = cleaned.split('\n');

    let currentGroup = null;
    let skipAll = false; // 进入【目录】后置位

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\uFEFF/g, '').trim();
      if (!line) continue;

      // 段落标题
      const section = parseSection(line);
      if (section !== null) {
        if (section === '目录') {
          skipAll = true;
          currentGroup = null;
        } else {
          skipAll = false;
          currentGroup = section;
          groupSet.add(section);
        }
        continue;
      }

      if (skipAll) continue;
      if (shouldSkip(line)) continue;

      const parsed = parseLine(line);
      if (!parsed) continue;

      items.push({
        id: parsed.id,
        label: parsed.label,
        group: currentGroup
      });
    }

    return { items, groups: Array.from(groupSet) };
  }

  /* ============================================================
     二、来源归一
     ============================================================ */

  /**
   * 把任意 payload 归一成 { items, groups }。
   * 支持的 payload：
   *   - string        （原文本）
   *   - {items,groups}（已解析）
   *   - Array         （只给 items，groups 从 item.group 推导）
   */
  function normalizePayload(payload) {
    if (payload == null) return null;

    if (typeof payload === 'string') {
      return parseMCBEID(payload);
    }

    if (Array.isArray(payload)) {
      const groups = new Set();
      const items = payload.map(function (it) {
        if (typeof it === 'string') {
          return { id: it, label: '', group: null };
        }
        const g = it.group != null ? it.group : null;
        if (g) groups.add(g);
        return {
          id: it.id != null ? it.id : String(it),
          label: it.label != null ? it.label : '',
          group: g
        };
      });
      return { items, groups: Array.from(groups) };
    }

    if (typeof payload === 'object' && Array.isArray(payload.items)) {
      return {
        items: payload.items.map(function (it) {
          return {
            id: it.id,
            label: it.label != null ? it.label : '',
            group: it.group != null ? it.group : null
          };
        }),
        groups: Array.isArray(payload.groups)
          ? payload.groups.slice()
          : Array.from(new Set(payload.items.map(function (it) { return it.group; }).filter(Boolean)))
      };
    }

    return null;
  }

  /* ============================================================
     三、来源获取
     ============================================================ */

  function getInline(category) {
    if (typeof global === 'undefined') return null;
    const store = global.MCCT_DATA_INLINE;
    if (!store) return null;
    const raw = store[category];
    if (raw == null) return null;
    return normalizePayload(raw);
  }

  function loadFromFetch(category) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('[loader] fetch is not available'));
    }
    const url = DEFAULT_BASE + category + '.txt';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('[loader] HTTP ' + res.status + ' for ' + url);
      return res.text();
    }).then(function (text) {
      return parseMCBEID(text);
    });
  }

  /* ============================================================
     四、对外 API
     ============================================================ */

  const loader = {

    /** 手动注册。payload 见 normalizePayload 支持的三种形态。 */
    register: function (category, payload) {
      const norm = normalizePayload(payload);
      if (!norm) {
        console.warn('[loader] register: unsupported payload for "' + category + '"');
        return null;
      }
      const entry = {
        items: norm.items,
        groups: norm.groups,
        source: 'register',
        loadedAt: Date.now()
      };
      cache.set(category, entry);
      return entry;
    },

    /** 同步获取，未加载返回 null。 */
    get: function (category) {
      const e = cache.get(category);
      return e ? e.items : null;
    },

    /** 同步获取完整结构（含 groups）。 */
    getEntry: function (category) {
      return cache.get(category) || null;
    },

    /** 同步获取分组列表。 */
    getGroups: function (category) {
      const e = cache.get(category);
      return e ? e.groups : [];
    },

    /** 是否已加载。 */
    has: function (category) {
      return cache.has(category);
    },

    /** 清空缓存。 */
    clear: function () {
      cache.clear();
      inflight.clear();
    },

    /**
     * 异步加载。返回 Promise<Array<{id,label,group}>>。
     * 多次调用同一 category 不会重复请求。
     */
    load: function (category) {
      if (cache.has(category)) {
        return Promise.resolve(cache.get(category).items);
      }

      // 内嵌优先
      const inline = getInline(category);
      if (inline) {
        const entry = {
          items: inline.items,
          groups: inline.groups,
          source: 'inline',
          loadedAt: Date.now()
        };
        cache.set(category, entry);
        return Promise.resolve(entry.items);
      }

      if (inflight.has(category)) {
        return inflight.get(category).then(function (e) { return e.items; });
      }

      const p = loadFromFetch(category).then(function (result) {
        const entry = {
          items: result.items,
          groups: result.groups,
          source: 'fetch',
          loadedAt: Date.now()
        };
        cache.set(category, entry);
        inflight.delete(category);
        return entry;
      }).catch(function (err) {
        inflight.delete(category);
        console.warn('[loader] failed to load "' + category + '":', err.message);
        // 失败也缓存空数组，避免重复请求
        const empty = { items: [], groups: [], source: 'error', loadedAt: Date.now() };
        cache.set(category, empty);
        return empty;
      });

      inflight.set(category, p);
      return p.then(function (e) { return e.items; });
    },

    /** 批量加载。返回 Promise<{category: items}>。 */
    loadMany: function (categories) {
      return Promise.all(categories.map(function (c) {
        return loader.load(c).then(function (items) {
          return { category: c, items: items };
        });
      })).then(function (results) {
        const out = {};
        results.forEach(function (r) { out[r.category] = r.items; });
        return out;
      });
    },

    /** 已缓存的分类名列表。 */
    available: function () {
      return Array.from(cache.keys());
    },

    /** 调试用。 */
    _parse: parseMCBEID,
    _parseLine: parseLine
  };

  global.MCCT = global.MCCT || {};
  global.MCCT.loader = loader;
})(window);
