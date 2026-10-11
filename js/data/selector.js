/* ============================================================
   MCCT — data/selector.js
   目标选择器（target selector）与参数键定义。
   供 completer / tokenizer / parser 引用。

   数据来源：
     - MCC 第五章「目标选择器」5.2 / 5.3 全部参数表
     - MCC 第十一章 execute 中涉及的选择器用法

   注意：本文件只描述「有哪些键、键的类型、是否可否定」，
   不描述具体的补全逻辑（那是 completer 的事）。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 七种基础选择器 ---------- */

  const SELECTORS = [
    { value: '@a',         label: '所有玩家',       desc: '选择所有在线玩家' },
    { value: '@e',         label: '所有实体',       desc: '选择所有实体（含玩家、掉落物、箭等）' },
    { value: '@p',         label: '最近玩家',       desc: '选择距执行原点最近的玩家' },
    { value: '@r',         label: '随机玩家',       desc: '随机选择一个在线玩家（可配合 type 选实体）' },
    { value: '@s',         label: '执行者',         desc: '选择命令的执行者本身' },
    { value: '@n',         label: '最近实体',       desc: '选择距执行原点最近的一个实体（基岩版特有）' },
    { value: '@initiator', label: 'NPC交互玩家',   desc: '与 NPC 交互的玩家（基岩版特有）' }
  ];

  /* ---------- 选择器参数键 ---------- */

  /**
   * allowNegate: 该参数是否支持前置 "!" 取反（如 tag=!banned）
   * type:        值的类型，供 completer 决定提示什么
   * desc:        简短说明，供下拉框第二行显示
   */
  const KEYS = [
    // —— 坐标与距离 ——
    { key: 'x',     type: 'coordinate', desc: '坐标原点 X（用于距离计算）' },
    { key: 'y',     type: 'coordinate', desc: '坐标原点 Y' },
    { key: 'z',     type: 'coordinate', desc: '坐标原点 Z' },
    { key: 'r',     type: 'number',     desc: '最大半径（≤该值）' },
    { key: 'rm',    type: 'number',     desc: '最小半径（≥该值）' },
    { key: 'dx',    type: 'number',     desc: '体积尺寸 X' },
    { key: 'dy',    type: 'number',     desc: '体积尺寸 Y' },
    { key: 'dz',    type: 'number',     desc: '体积尺寸 Z' },

    // —— 计分板与标签 ——
    { key: 'scores', type: 'json',  desc: '计分板分数，如 {obj=1..10}' },
    { key: 'tag',    type: 'string', allowNegate: true, desc: '实体标签' },

    // —— 实体类型 ——
    { key: 'name',   type: 'string', allowNegate: true, desc: '实体名称' },
    { key: 'type',   type: 'entityType', allowNegate: true, desc: '实体类型 ID' },
    { key: 'family', type: 'string', desc: '实体族（基岩版特有）' },

    // —— 朝向 ——
    { key: 'rx',  type: 'number', desc: '最大垂直旋转角' },
    { key: 'rxm', type: 'number', desc: '最小垂直旋转角' },
    { key: 'ry',  type: 'number', desc: '最大水平旋转角' },
    { key: 'rym', type: 'number', desc: '最小水平旋转角' },

    // —— 物品与属性（基岩版特有） ——
    { key: 'hasitem',       type: 'json', desc: '物品栏检测，如 {item=apple,quantity=1..}' },
    { key: 'has_property',  type: 'json', desc: '实体属性检测（行为包自定义）' },

    // —— 经验与权限 ——
    { key: 'l',           type: 'int',  desc: '最大经验等级' },
    { key: 'lm',          type: 'int',  desc: '最小经验等级' },
    { key: 'haspermission', type: 'json', desc: '玩家权限检测（如 {build=true}' },

    // —— 数量 ——
    { key: 'c', type: 'int', desc: '选择数量（正值从头取，负值从尾取）' }
  ];

  /* ---------- 反面选择（字符串前缀） ---------- */

  /** 支持作为前缀写在选择器首字符的反向标记 */
  const NEGATION_PREFIX = '!';

  /* ---------- 对外 ---------- */

  global.MCCT = global.MCCT || {};
  global.MCCT.selector = {
    selectors: SELECTORS,
    keys: KEYS,
    keyMap: (function () {
      const m = Object.create(null);
      KEYS.forEach(function (k) { m[k.key] = k; });
      return m;
    })(),
    negationPrefix: NEGATION_PREFIX
  };
})(window);
