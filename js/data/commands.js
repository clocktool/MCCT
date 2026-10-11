/* ============================================================
   MCCT — data/commands.js  （全量 · 第 1/4 部分）
   命令定义树。声明式结构，不含逻辑。

   字段说明：
     name          主命令名（不含斜杠）
     aliases       别名数组（补全时归一显示）
     tier          'core' | 'advanced' | 'admin'  补全范围过滤
     permission    最低权限等级 0..4
     category      分类，用于 UI 分组
     description   一句话描述
     syntax        语法分支数组；每项 {label, params}
     type          'chain' 时为链式子命令（execute）

   参数类型（type）：
     target      目标选择器 / 玩家名
     coordinate  单轴坐标（~ ^ 或数字）
     vec3        三轴坐标（一组三个）
     rotation    yaw pitch 一组
     int         整数
     number      数字（含小数）
     string      裸字符串
     quoted      带引号字符串
     message     消息文本
     enum        固定枚举（options）
     block       方块 ID
     item        物品 ID
     entity      实体 ID
     effect      状态效果 ID
     enchant     魔咒 ID
     gamemode    游戏模式（enum 变体）
     time        时间（数字或 day/noon/night/...）
     dimension   维度
     objective   计分项名
     json        JSON / NBT 结构
     bool        true / false
     command     后续命令
     commandName 命令名（用于 /help 等）
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     一、常用枚举表
     ============================================================ */

  const GAMEMODE_OPTIONS = [
    { value: 'survival',  label: '生存', aliases: ['s', '0'] },
    { value: 'creative',  label: '创造', aliases: ['c', '1'] },
    { value: 'adventure', label: '冒险', aliases: ['a', '2'] },
    { value: 'spectator', label: '旁观', aliases: ['sp'] },
    { value: 'default',   label: '默认', aliases: ['d'] }
  ];

  const FILL_MODES = [
    { value: 'replace', label: '替换' },
    { value: 'destroy', label: '破坏' },
    { value: 'keep',    label: '保留' },
    { value: 'hollow',  label: '中空' },
    { value: 'outline', label: '轮廓' }
  ];

  const CLONE_MODES = [
    { value: 'replace', label: '替换' },
    { value: 'masked',  label: '遮蔽' }
  ];

  const DIFFICULTY_OPTIONS = [
    { value: 'peaceful', label: '和平' },
    { value: 'easy',     label: '简单' },
    { value: 'normal',   label: '普通' },
    { value: 'hard',     label: '困难' }
  ];

  const TIME_LITERALS = [
    { value: 'day',     label: '白天' },
    { value: 'noon',    label: '正午' },
    { value: 'night',   label: '夜晚' },
    { value: 'midnight',label: '午夜' },
    { value: 'sunrise', label: '日出' },
    { value: 'sunset',  label: '日落' }
  ];

  const WEATHER_LITERALS = [
    { value: 'clear',  label: '晴天' },
    { value: 'rain',   label: '下雨' },
    { value: 'thunder',label: '雷暴' }
  ];

  const DIMENSION_OPTIONS = [
    { value: 'overworld', label: '主世界' },
    { value: 'nether',    label: '下界' },
    { value: 'the_end',   label: '末地' }
  ];

  const ANCHOR_OPTIONS = [
    { value: 'eyes', label: '眼睛' },
    { value: 'feet', label: '脚部' }
  ];

  const CLEAR_ITEM_MODE = [
    { value: 'clear',     label: '清空' },
    { value: 'remove_one',label: '移除一个' }
  ];

  const STRUCTURE_MODES = [
    { value: 'save',   label: '保存' },
    { value: 'load',   label: '加载' },
    { value: 'delete', label: '删除' }
  ];

  const STRUCTURE_ANIMATIONS = [
    { value: 'block_animation',      label: '方块动画' },
    { value: 'layer_animation',      label: '层动画' },
    { value: 'none',                 label: '无' }
  ];

  const STRUCTURE_ANIMATION_DIR = [
    { value: 'default', label: '默认' },
    { value: 'up',      label: '向上' },
    { value: 'down',    label: '向下' },
    { value: 'north',   label: '北' },
    { value: 'south',   label: '南' },
    { value: 'east',    label: '东' },
    { value: 'west',    label: '西' }
  ];

  const STRUCTURE_MIRROR = [
    { value: 'x',        label: 'X 轴镜像' },
    { value: 'z',        label: 'Z 轴镜像' },
    { value: 'xz',       label: 'XZ 轴镜像' },
    { value: 'none',     label: '不镜像' },
    { value: 'left_right', label: '左右镜像' },
    { value: 'front_back', label: '前后镜像' }
  ];

  const STRUCTURE_ROTATION = [
    { value: '0',   label: '0°' },
    { value: '90',  label: '顺时针 90°' },
    { value: '180', label: '180°' },
    { value: '270', label: '顺时针 270°' }
  ];

  const STRUCTURE_INTEGRITY = [
    { value: '0',   label: '0%' },
    { value: '100', label: '100%' }
  ];

  const RIDE_RULES = [
    { value: 'start_riding',   label: '开始骑乘' },
    { value: 'stop_riding',    label: '停止骑乘' },
    { value: 'evict_riders',   label: '驱赶乘客' },
    { value: 'summon_rider',   label: '召唤乘客' },
    { value: 'summon_ride',    label: '召唤坐骑' }
  ];

  const RIDE_FILL_MODE = [
    { value: 'if_group_fits',    label: '组必须全部容纳' },
    { value: 'until_full',       label: '直到坐满' }
  ];

  const RIDE_TELEPORT_MODE = [
    { value: 'no_teleport',      label: '不传送' },
    { value: 'teleport_rider',   label: '传送乘客' },
    { value: 'teleport_ride',    label: '传送坐骑' }
  ];

  const SPAWN_EVENT_POS = [
    { value: 'inwater',    label: '水中' },
    { value: 'onland',     label: '陆地' },
    { value: 'onhoney',    label: '蜂蜜块上' },
    { value: 'onstartup',  label: '启动时' },
    { value: 'onstartup',  label: '实体生成时' }
  ];

  const HELP_PAGE_MAX = 3;

  /* ============================================================
     二、参数构造辅助
     ============================================================ */

  function opt(o) { return o || {}; }

  const P = {
    target:     (name, o) => Object.assign({ name, type: 'target' }, opt(o)),
    coord:      (name, o) => Object.assign({ name, type: 'coordinate' }, opt(o)),
    vec3:       (name, o) => Object.assign({ name, type: 'vec3' }, opt(o)),
    rotation:   (name, o) => Object.assign({ name, type: 'rotation' }, opt(o)),
    int:        (name, o) => Object.assign({ name, type: 'int' }, opt(o)),
    number:     (name, o) => Object.assign({ name, type: 'number' }, opt(o)),
    string:     (name, o) => Object.assign({ name, type: 'string' }, opt(o)),
    quoted:     (name, o) => Object.assign({ name, type: 'quoted' }, opt(o)),
    message:    (name, o) => Object.assign({ name, type: 'message' }, opt(o)),
    block:      (name, o) => Object.assign({ name, type: 'block' }, opt(o)),
    item:       (name, o) => Object.assign({ name, type: 'item' }, opt(o)),
    entity:     (name, o) => Object.assign({ name, type: 'entity' }, opt(o)),
    effect:     (name, o) => Object.assign({ name, type: 'effect' }, opt(o)),
    enchant:    (name, o) => Object.assign({ name, type: 'enchant' }, opt(o)),
    gamemode:   (name, o) => Object.assign({ name, type: 'gamemode' }, opt(o)),
    time:       (name, o) => Object.assign({ name, type: 'time' }, opt(o)),
    dimension:  (name, o) => Object.assign({ name, type: 'dimension' }, opt(o)),
    objective:  (name, o) => Object.assign({ name, type: 'objective' }, opt(o)),
    json:       (name, o) => Object.assign({ name, type: 'json' }, opt(o)),
    bool:       (name, o) => Object.assign({ name, type: 'bool' }, opt(o)),
    command:    (name, o) => Object.assign({ name, type: 'command' }, opt(o)),
    commandName:(name, o) => Object.assign({ name, type: 'commandName' }, opt(o)),
    enum:       (name, options, o) =>
      Object.assign({ name, type: 'enum', options }, opt(o))
  };

  /* ============================================================
     三、命令定义：批次 1（帮助/信息 · 玩家管理 · 物品/方块）
     ============================================================ */

  const COMMANDS_HELP = [
    {
      name: 'help',
      aliases: ['?', '2'],
      tier: 'core',
      permission: 0,
      category: 'help',
      description: '显示命令列表或某条命令的详细用法',
      syntax: [
        { label: '列出命令', params: [ P.int('page', { optional: true, default: 1 }) ] },
        { label: '查看某命令', params: [ P.commandName('command') ] }
      ]
    },
    {
      name: 'list',
      tier: 'core',
      permission: 0,
      category: 'help',
      description: '列出服务器中所有在线玩家',
      syntax: [ { params: [] } ]
    },
    {
      name: 'me',
      tier: 'core',
      permission: 0,
      category: 'text',
      description: '显示一条关于命令执行者自己的信息',
      syntax: [
        { params: [ P.message('message') ] }
      ]
    },
    {
      name: 'say',
      tier: 'core',
      permission: 0,
      category: 'text',
      description: '向所有玩家发送消息',
      syntax: [
        { params: [ P.message('message') ] }
      ]
    },
    {
      name: 'msg',
      aliases: ['tell', 'w'],
      tier: 'core',
      permission: 0,
      category: 'text',
      description: '向指定玩家发送私信',
      syntax: [
        { params: [
          P.target('recipient'),
          P.message('message')
        ]}
      ]
    }
  ];

  /* ---------------------------------------------------------- */

  const COMMANDS_PLAYER = [
    {
      name: 'kick',
      tier: 'admin',
      permission: 1,
      category: 'player',
      description: '将指定玩家踢出服务器',
      syntax: [
        { params: [
          P.target('name'),
          P.message('reason', { optional: true })
        ]}
      ]
    },
    {
      name: 'op',
      tier: 'admin',
      permission: 2,
      category: 'player',
      description: '授予玩家管理员权限',
      syntax: [
        { params: [ P.target('player') ] }
      ]
    },
    {
      name: 'deop',
      aliases: ['deep'],
      tier: 'admin',
      permission: 2,
      category: 'player',
      description: '撤销玩家的管理员权限',
      syntax: [
        { params: [ P.target('player') ] }
      ]
    },
    {
      name: 'permission',
      aliases: ['permssion'],
      tier: 'admin',
      permission: 4,
      category: 'player',
      description: '枚举或重新加载权限列表，或设置玩家的权限等级',
      syntax: [
        { label: '列出权限',  params: [ P.enum('action', [{ value: 'list', label: '列出' }]) ] },
        { label: '重载权限',  params: [ P.enum('action', [{ value: 'reload', label: '重载' }]) ] },
        { label: '设置权限',  params: [
          P.enum('action', [{ value: 'set', label: '设置' }]),
          P.target('player'),
          P.int('level', { min: 0, max: 4 })
        ]}
      ]
    },
    {
      name: 'whitelist',
      aliases: ['allowlist'],
      tier: 'admin',
      permission: 4,
      category: 'player',
      description: '管理服务器白名单',
      syntax: [
        { label: '列出',    params: [ P.enum('action', [{ value: 'list', label: '列出' }]) ] },
        { label: '重载',    params: [ P.enum('action', [{ value: 'reload', label: '重载' }]) ] },
        { label: '添加',    params: [ P.enum('action', [{ value: 'add', label: '添加' }]), P.string('name') ] },
        { label: '移除',    params: [ P.enum('action', [{ value: 'remove', label: '移除' }]), P.string('name') ] }
      ]
    },
    {
      name: 'spawnpoint',
      tier: 'core',
      permission: 1,
      category: 'player',
      description: '设置玩家的出生点',
      syntax: [
        { params: [
          P.target('player', { optional: true }),
          P.vec3('spawnPos', { optional: true })
        ]}
      ]
    },
    {
      name: 'setworldspawn',
      tier: 'core',
      permission: 1,
      category: 'player',
      description: '设置世界出生点',
      syntax: [
        { params: [
          P.vec3('spawnPos', { optional: true }),
          P.rotation('rotation', { optional: true })
        ]}
      ]
    },
    {
      name: 'transfer',
      tier: 'admin',
      permission: 4,
      category: 'player',
      description: '将玩家转移到另一个服务器',
      syntax: [
        { params: [
          P.string('hostname'),
          P.int('port', { optional: true })
        ]}
      ]
    },
    {
      name: 'inputpermission',
      tier: 'advanced',
      permission: 2,
      category: 'player',
      description: '对玩家的权限状态进行指定操作',
      syntax: [
        { params: [
          P.enum('action', [{ value: 'query', label: '查询' }, { value: 'set', label: '设置' }]),
          P.target('players'),
          P.enum('permission', [
            { value: 'camera',          label: '摄像机' },
            { value: 'movement',        label: '移动' },
            { value: 'lateral_movement',label: '左右移动' },
            { value: 'sneak',           label: '潜行' },
            { value: 'jump',            label: '跳跃' },
            { value: 'mount',           label: '骑乘' },
            { value: 'dismount',        label: '解除骑乘' },
            { value: 'move_forward',    label: '向前' },
            { value: 'move_backward',   label: '向后' },
            { value: 'move_left',       label: '向左' },
            { value: 'move_right',      label: '向右' }
          ], { optional: true }),
          P.enum('state', [
            { value: 'enabled',  label: '启用' },
            { value: 'disabled', label: '禁用' }
          ], { optional: true })
        ]}
      ]
    }
  ];

  /* ---------------------------------------------------------- */

  const COMMANDS_ITEMBLOCK = [
    {
      name: 'give',
      tier: 'core',
      permission: 1,
      category: 'itemblock',
      description: '给予玩家物品',
      syntax: [
        { params: [
          P.target('player'),
          P.item('itemName'),
          P.int('amount', { optional: true, default: 1 }),
          P.int('data',   { optional: true, default: 0 }),
          P.json('components', { optional: true })
        ]}
      ]
    },
    {
      name: 'clear',
      tier: 'core',
      permission: 1,
      category: 'itemblock',
      description: '从玩家物品栏中删除物品',
      syntax: [
        { params: [
          P.target('player', { optional: true }),
          P.item('itemName', { optional: true }),
          P.int('data',      { optional: true, default: -1 }),
          P.int('maxCount',  { optional: true, default: -1 })
        ]}
      ]
    },
    {
      name: 'replaceitem',
      tier: 'advanced',
      permission: 1,
      category: 'itemblock',
      description: '替换物品栏中的物品',
      syntax: [
        { label: '方块容器',
          params: [
            P.enum('type', [{ value: 'block', label: '方块容器' }]),
            P.vec3('position'),
            P.enum('slotType', [
              { value: 'slot.container', label: '容器' },
              { value: 'slot.hotbar',    label: '快捷栏' },
              { value: 'slot.inventory', label: '物品栏' },
              { value: 'slot.weapon.mainhand', label: '主手' },
              { value: 'slot.weapon.offhand',  label: '副手' },
              { value: 'slot.armor.head',      label: '头盔' },
              { value: 'slot.armor.chest',     label: '胸甲' },
              { value: 'slot.armor.legs',      label: '腿甲' },
              { value: 'slot.armor.feet',      label: '靴子' },
              { value: 'slot.saddle',          label: '鞍' },
              { value: 'slot.armor',           label: '马铠' },
              { value: 'slot.chest',           label: '箱子' },
              { value: 'slot.enderchest',      label: '末影箱' }
            ]),
            P.int('slotId'),
            P.item('itemName'),
            P.int('amount', { optional: true, default: 1 }),
            P.int('data',   { optional: true, default: 0 }),
            P.json('components', { optional: true })
          ]
        },
        { label: '实体容器',
          params: [
            P.enum('type', [{ value: 'entity', label: '实体容器' }]),
            P.target('target'),
            P.enum('slotType', [
              { value: 'slot.container', label: '容器' },
              { value: 'slot.hotbar',    label: '快捷栏' },
              { value: 'slot.inventory', label: '物品栏' },
              { value: 'slot.weapon.mainhand', label: '主手' },
              { value: 'slot.weapon.offhand',  label: '副手' },
              { value: 'slot.armor.head',      label: '头盔' },
              { value: 'slot.armor.chest',     label: '胸甲' },
              { value: 'slot.armor.legs',      label: '腿甲' },
              { value: 'slot.armor.feet',      label: '靴子' },
              { value: 'slot.saddle',          label: '鞍' },
              { value: 'slot.armor',           label: '马铠' },
              { value: 'slot.chest',           label: '箱子' },
              { value: 'slot.enderchest',      label: '末影箱' }
            ]),
            P.int('slotId'),
            P.item('itemName'),
            P.int('amount', { optional: true, default: 1 }),
            P.int('data',   { optional: true, default: 0 }),
            P.json('components', { optional: true })
          ]
        }
      ]
    },
    {
      name: 'setblock',
      tier: 'core',
      permission: 1,
      category: 'itemblock',
      description: '将方块替换为其他方块',
      syntax: [
        { params: [
          P.vec3('position'),
          P.block('blockType'),
          P.int('tileData', { optional: true, default: 0 }),
          P.enum('oldBlockHandling', FILL_MODES, { optional: true })
        ]}
      ]
    },
    {
      name: 'fill',
      tier: 'core',
      permission: 1,
      category: 'itemblock',
      description: '在指定区域填充方块（最大 32768 格）',
      syntax: [
        { label: '基础填充',
          params: [
            P.vec3('from'),
            P.vec3('to'),
            P.block('tileName'),
            P.int('tileData', { optional: true, default: 0 }),
            P.enum('oldBlockHandling', FILL_MODES, { optional: true }),
            P.block('replaceTileName', { optional: true }),
            P.int('replaceDataValue', { optional: true, default: 0 })
          ]
        },
        { label: '带模式替换',
          params: [
            P.vec3('from'),
            P.vec3('to'),
            P.block('tileName'),
            P.enum('oldBlockHandling', FILL_MODES, { optional: true }),
            P.block('replaceTileName', { optional: true })
          ]
        }
      ]
    },
    {
      name: 'clone',
      tier: 'advanced',
      permission: 1,
      category: 'itemblock',
      description: '将特定区域的方块复制到另一处',
      syntax: [
        { params: [
          P.vec3('begin'),
          P.vec3('end'),
          P.vec3('destination'),
          P.enum('maskMode', CLONE_MODES, { optional: true, default: 'replace' }),
          P.enum('cloneMode', CLONE_MODES, { optional: true }),
          P.bool('normalize', { optional: true, default: false })
        ]}
      ]
    },
    {
      name: 'structure',
      tier: 'advanced',
      permission: 1,
      category: 'itemblock',
      description: '无需结构方块即可保存和加载结构',
      syntax: [
        { label: '保存',
          params: [
            P.enum('action', [{ value: 'save', label: '保存' }]),
            P.string('name'),
            P.vec3('from'),
            P.vec3('to'),
            P.bool('saveMode', { optional: true, default: true }),
            P.bool('includeEntities', { optional: true, default: true }),
            P.enum('saveBlockMode', [
              { value: 'block_animation', label: '方块动画' },
              { value: 'layer_animation', label: '层动画' },
              { value: 'none',            label: '无' }
            ], { optional: true })
          ]
        },
        { label: '加载',
          params: [
            P.enum('action', [{ value: 'load', label: '加载' }]),
            P.string('name'),
            P.vec3('position', { optional: true }),
            P.enum('rotation', STRUCTURE_ROTATION, { optional: true }),
            P.enum('mirror', STRUCTURE_MIRROR, { optional: true }),
            P.enum('animationMode', STRUCTURE_ANIMATIONS, { optional: true }),
            P.enum('animationDirection', STRUCTURE_ANIMATION_DIR, { optional: true }),
            P.int('integrity', { optional: true }),
            P.int('seed', { optional: true })
          ]
        },
        { label: '删除',
          params: [
            P.enum('action', [{ value: 'delete', label: '删除' }]),
            P.string('name')
          ]
        }
      ]
    },
    {
      name: 'enchant',
      tier: 'core',
      permission: 1,
      category: 'itemblock',
      description: '给实体的物品添加魔咒',
      syntax: [
        { params: [
          P.target('player'),
          P.enchant('enchantmentId'),
          P.int('level', { optional: true })
        ]}
      ]
    },
    {
      name: 'loot',
      tier: 'advanced',
      permission: 2,
      category: 'itemblock',
      description: '将指定的战利品放入物品栏或生成在世界中',
      syntax: [
        { label: '给予玩家',
          params: [
            P.enum('action', [{ value: 'give', label: '给予' }]),
            P.target('player'),
            P.string('target')
          ]
        },
        { label: '生成在世界',
          params: [
            P.enum('action', [{ value: 'spawn', label: '生成' }]),
            P.vec3('position'),
            P.string('target')
          ]
        },
        { label: '替换方块内容',
          params: [
            P.enum('action', [{ value: 'replace', label: '替换' }]),
            P.enum('type', [{ value: 'block', label: '方块' }, { value: 'entity', label: '实体' }]),
            P.string('position'),
            P.enum('slotType', [
              { value: 'slot.container', label: '容器' },
              { value: 'slot.hotbar',    label: '快捷栏' },
              { value: 'slot.inventory', label: '物品栏' }
            ]),
            P.int('slotId'),
            P.string('target')
          ]
        }
      ]
    }
  ];

  /* ============================================================
     四、聚合 + 索引
     ============================================================ */

  const COMMANDS = [].concat(
    COMMANDS_HELP,
    COMMANDS_PLAYER,
    COMMANDS_ITEMBLOCK
    // 后续批次：实体 / 世界 / 计分板 / 文本 / 音视频 / 服务器 / 调试 / 特殊 / 其他
  );

  const byName = Object.create(null);
  COMMANDS.forEach(function (cmd) {
    byName[cmd.name] = cmd;
    if (Array.isArray(cmd.aliases)) {
      cmd.aliases.forEach(function (a) { byName[a] = cmd; });
    }
  });

  const allNames = Object.keys(byName);

  /* execute 中 unless 复用 if 的 expand（本批次尚无 execute，占位） */
  function resolveChainRefs() {
    const exec = byName.execute;
    if (!exec || !exec.chain) return;
    const ifLink = exec.chain.links.find(function (l) { return l.keyword === 'if'; });
    exec.chain.links.forEach(function (l) {
      if (l.expandRef && ifLink && ifLink.expand) {
        l.expand = ifLink.expand;
        delete l.expandRef;
      }
    });
  }
  resolveChainRefs();

  /* ============================================================
     五、对外接口
     ============================================================ */

  global.MCCT = global.MCCT || {};
  global.MCCT.commands = {
    list: COMMANDS,
    byName: byName,
    allNames: allNames,

    /** 按主名或别名获取命令定义 */
    get: function (name) {
      if (!name) return null;
      if (name.charAt(0) === '/') name = name.slice(1);
      return byName[name] || null;
    },

    /** 按 tier 过滤（供补全范围控制） */
    filterByTier: function (tiers) {
      if (!Array.isArray(tiers) || tiers.length === 0) return COMMANDS;
      const set = new Set(tiers);
      return COMMANDS.filter(function (c) { return set.has(c.tier); });
    },

    /** 按分类过滤 */
    filterByCategory: function (category) {
      return COMMANDS.filter(function (c) { return c.category === category; });
    },

    /* 枚举与常用表也一并导出，供 completer 引用 */
    enums: {
      GAMEMODE_OPTIONS,
      FILL_MODES,
      CLONE_MODES,
      DIFFICULTY_OPTIONS,
      TIME_LITERALS,
      WEATHER_LITERALS,
      DIMENSION_OPTIONS,
      ANCHOR_OPTIONS,
      CLEAR_ITEM_MODE,
      STRUCTURE_MODES,
      STRUCTURE_ANIMATIONS,
      STRUCTURE_ANIMATION_DIR,
      STRUCTURE_MIRROR,
      STRUCTURE_ROTATION,
      STRUCTURE_INTEGRITY,
      RIDE_RULES,
      RIDE_FILL_MODE,
      RIDE_TELEPORT_MODE,
      SPAWN_EVENT_POS
    },

    /* 参数构造器也导出，方便后续批次继续用 */
    P: P
  };
})(window);
