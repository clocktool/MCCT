/* ============================================================
   MCCT — core/bus.js
   极简发布-订阅事件总线。零依赖，纯函数式。
   所有跨模块通信都通过它，禁止模块之间直接互调。
   ============================================================ */
(function (global) {
  'use strict';

  /** 事件名常量：集中管理，避免拼写错误 */
  const EVENTS = {
    // 编辑器
    EDITOR_INPUT:      'editor:input',        // { value, caret }
    EDITOR_CARET:      'editor:caret',        // { line, col, offset }
    EDITOR_SCROLL:     'editor:scroll',       // { scrollTop, scrollLeft }
    EDITOR_TOKENS:     'editor:tokens',       // { tokens, ast }
    EDITOR_RESET:      'editor:reset',        // {}

    // 补全
    COMPLETE_REQUEST:  'complete:request',    // { caret, value }
    COMPLETE_RESULT:   'complete:result',     // { items, anchor }
    COMPLETE_ACCEPT:   'complete:accept',     // { insertText, replaceRange }
    COMPLETE_CLOSE:    'complete:close',      // {}

    // ID 表浏览器
    IDB_PICK:          'idbrowser:pick',      // { id, label }
    IDB_CATEGORY:      'idbrowser:category',  // { category }
    IDB_READY:         'idbrowser:ready',     // { category, count }

    // 主题 / 状态栏
    THEME_CHANGED:     'theme:changed',       // { theme }
    ERROR_UPDATE:      'error:update',        // { count, message }
    HINT:              'ui:hint'              // { text, duration }
  };

  /** event -> Set<handler> */
  const listeners = new Map();

  const bus = {
    EVENTS,

    /** 订阅。返回一个取消订阅的函数，方便在组件卸载时调用。 */
    on(event, handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('[bus] handler must be a function');
      }
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return function off() { bus.off(event, handler); };
    },

    /** 取消订阅。 */
    off(event, handler) {
      const set = listeners.get(event);
      if (set) {
        set.delete(handler);
        if (set.size === 0) listeners.delete(event);
      }
    },

    /** 只订阅一次。 */
    once(event, handler) {
      const off = bus.on(event, function (payload) {
        off();
        handler(payload);
      });
      return off;
    },

    /**
     * 发布。任何 handler 抛异常都不会影响其他 handler，
     * 错误会打到 console.error，便于定位但不会中断流程。
     */
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      // 复制一份，允许 handler 内部增删订阅而不影响本轮遍历
      const snapshot = Array.from(set);
      for (let i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i](payload);
        } catch (err) {
          console.error('[bus] handler for "' + event + '" threw:', err);
        }
      }
    },

    /** 清除订阅：传 event 清单个，不传清所有。 */
    clear(event) {
      if (event) listeners.delete(event);
      else listeners.clear();
    },

    /** 调试用：当前订阅统计。 */
    debug() {
      const out = {};
      listeners.forEach(function (set, ev) { out[ev] = set.size; });
      return out;
    }
  };

  global.MCCT = global.MCCT || {};
  global.MCCT.bus = bus;
})(window);
