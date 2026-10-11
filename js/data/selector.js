/* ============================================================
   MCCT — data/selector.js  （修订版）

   修订内容：
     1. 补全每个选择器的精确语义（哪些能选玩家、哪些选活着的、哪些选濒死）
     2. family 类型从 'string' 改为 'entityFamily'（有固定族列表）
     3. hasitem 类型从 'json' 细化为 'hasitem'（嵌套结构，需专门补全）
     4. scores 类型从 'json' 细化为 'scores'（嵌套结构，需专门补全）
     5. 增加 haspermission 的细化类型
     6. 补全 c 的语义（正值从头取、负值从尾取、@p/@r 组合）
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 七种基础选择器 ---------- */

  const SELECTORS = [
    {
      value: '@a',
      label: '所有玩家',
      desc: '选择所有在线玩家（含死亡但仍在服务器中的玩家）',
      note: 'type 参数不适用于 @a'
    },
    {
      value: '@e',
      label: '所有实体',
      desc: '选择已加载区块中所有活着的实体（含玩家、掉落物、箭等）',
      note: '无法选中濒死的实体'
    },
    {
      value: '@p',
      label: '最近玩家',
      desc: '选择距执行原点最近的玩家（只选活着的玩家）',
      note: 'type 参数不适用于 @p；若距离相同，选择最晚进入服务器的玩家'
    },
    {
      value: '@r',
      label: '随机玩家',
      desc: '随机选择一个在线玩家（只选活着的实体）',
      note: '配合 type= 可随机选择非玩家实体；反选 type=!xxx 同理'
    },
    {
      value: '@s',
      label: '执行者',
      desc: '选择命令的执行者本身（不论是否濒死）',
      note: '命令方块/控制台执行时，@s 不选中任何目标'
    },
    {
      value: '@n',
      label: '最近实体',
      desc: '选择距执行原点最近的一个实体（基岩版特有，无法选中濒死实体）',
      note: null
    },
    {
      value: '@initiator',
      label: 'NPC交互玩家',
      desc: '当前与 NPC 交互的玩家（基岩版特有，仅 NPC 对话界面内有效）',
      note: '中国版无此选择器'
    }
  ];

  /* ---------- 选择器参数键 ---------- */

  /**
   * type 取值说明：
   *   'coordinate'     单轴坐标（~ ^ 或数字）
   *   'number'         浮点数
   *   'int'            整数
   *   'string'         自由字符串
   *   'entityType'     实体 ID（loader: entity）
   *   'entityFamily'   实体族（loader: entityFamily）  ← 本次新增
   *   'hasitem'        嵌套结构（item/data/quantity/location/slot）  ← 细化
   *   'scores'         嵌套结构（计分项=值）                          ← 细化
   *   'haspermission'  嵌套结构（build/mine/doors/containers/...）
   *   'has_property'   嵌套结构（属性名=值）
   */
  const KEYS = [
    // —— 坐标与距离 ——
    { key: 'x',  type: 'coordinate', desc: '坐标原点 X' },
    { key: 'y',  type: 'coordinate', desc: '坐标原点 Y' },
    { key: 'z',  type: 'coordinate', desc: '坐标原点 Z' },
    { key: 'r',  type: 'number',     desc: '最大半径（≤该值）' },
    { key: 'rm', type: 'number',     desc: '最小半径（≥该值）' },
    { key: 'dx', type: 'number',     desc: '体积尺寸 X' },
    { key: 'dy', type: 'number',     desc: '体积尺寸 Y' },
    { key: 'dz', type: 'number',     desc: '体积尺寸 Z' },

    // —— 计分板与标签 ——
    { key: 'scores', type: 'scores',    desc: '计分板分数' },
    { key: 'tag',    type: 'string',    allowNegate: true, desc: '实体标签' },

    // —— 实体类型 ——
    { key: 'name',   type: 'string',        allowNegate: true, desc: '实体名称' },
    { key: 'type',   type: 'entityType',    allowNegate: true, desc: '实体类型 ID' },
    { key: 'family', type: 'entityFamily',  allowNegate: true, desc: '实体族' },

    // —— 朝向 ——
    { key: 'rx',  type: 'number', desc: '最大垂直旋转角（俯仰，-90..90）' },
    { key: 'rxm', type: 'number', desc: '最小垂直旋转角' },
    { key: 'ry',  type: 'number', desc: '最大水平旋转角（偏航，-180..180）' },
    { key: 'rym', type: 'number', desc: '最小水平旋转角' },

    // —— 物品与属性（基岩版特有） ——
    { key: 'hasitem',      type: 'hasitem',      desc: '物品栏检测，如 {item=apple,quantity=1..}' },
    { key: 'has_property', type: 'has_property', desc: '实体属性检测（行为包自定义）' },

    // —— 经验与权限 ——
    { key: 'l',             type: 'int',           desc: '最大经验等级' },
    { key: 'lm',            type: 'int',           desc: '最小经验等级' },
    { key: 'haspermission', type: 'haspermission', desc: '玩家权限检测（如 {build=true}' },

    // —— 数量 ——
    { key: 'c', type: 'int', desc: '选择数量（正值从头取，负值从尾取）' }
  ];

  /* ---------- 选择器参数键的键内结构（嵌套 type） ---------- */

  /**
   * 对嵌套型选择器 key（hasitem / scores / haspermission / has_property），
   * 描述"大括号内部"的键集合。completer 在处理
   *   @a[hasitem={ | }]
   * 时光标位于大括号内时，会读这张表。
   */
  const NESTED_KEYS = {
    hasitem: [
      { key: 'item',     type: 'item',   desc: '要检测的物品 ID', required: true },
      { key: 'data',     type: 'int',    desc: '数据值 0..32767' },
      { key: 'quantity', type: 'number', desc: '数量（支持区间与不等号）' },
      { key: 'location', type: 'enum',   desc: '物品栏位置',
        options: [
          { value: 'slot.weapon.mainhand', label: '主手' },
          { value: 'slot.weapon.offhand',  label: '副手' },
          { value: 'slot.armor.head',      label: '头盔' },
          { value: 'slot.armor.chest',     label: '胸甲' },
          { value: 'slot.armor.legs',      label: '腿甲' },
          { value: 'slot.armor.feet',      label: '靴子' },
          { value: 'slot.hotbar',          label: '快捷栏' },
          { value: 'slot.inventory',       label: '物品栏' },
          { value: 'slot.enderchest',      label: '末影箱' },
          { value: 'slot.container',       label: '容器' },
          { value: 'slot.saddle',          label: '鞍' },
          { value: 'slot.armor',           label: '马铠' },
          { value: 'slot.chest',           label: '箱子' }
        ]
      },
      { key: 'slot',     type: 'int',    desc: '槽位编号（需与 location 联用）' }
    ],

    haspermission: [
      { key: 'build',      type: 'bool', desc: '建造权限' },
      { key: 'mine',       type: 'bool', desc: '挖掘权限' },
      { key: 'doors_and_switches', type: 'bool', desc: '门与开关权限' },
      { key: 'open_containers',    type: 'bool', desc: '打开容器权限' },
      { key: 'attack_players',     type: 'bool', desc: '攻击玩家权限' },
      { key: 'attack_mobs',        type: 'bool', desc: '攻击生物权限' },
      { key: 'operator_commands',  type: 'bool', desc: '操作员命令权限' },
      { key: 'teleport',           type: 'bool', desc: '传送权限' }
    ],

    has_property: [
      // 属性名由行为包自定义，运行期未知，无法枚举
      // completer 不在此处给候选项，交由用户手输
    ],

    scores: [
      // 计分项名由世界运行时决定，无法静态枚举
      // completer 不在此处给候选项，交由用户手输
    ]
  };

  /* ---------- 反面选择前缀 ---------- */

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
    nested: NESTED_KEYS,
    negationPrefix: NEGATION_PREFIX
  };
})(window);
