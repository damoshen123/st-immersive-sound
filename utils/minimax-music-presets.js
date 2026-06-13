// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiniMax 音乐生成 · 风格示例库（中文）
//  每条预设包含：
//    - id        唯一 id
//    - name      中文风格名
//    - emoji     图标
//    - tags      短标签（用于卡片底部展示）
//    - prompt    送给 MiniMax 的 style prompt（可中英混写，
//                官方建议用英文关键词，模型识别更稳；这里
//                关键词用英文 + 中文情绪描述配合）
//    - lyrics    完整中文歌词，已带 [Intro]/[Verse]/[Chorus]
//                等结构标签，用户填入后改写文字即可
//  内容专门拆到独立文件，方便扩展。
// ═══════════════════════════════════════════════════════════

export const MUSIC_PRESETS = [
    // ── 流行类 ─────────────────────────────────
    {
        id: 'pop-bright',
        name: '阳光流行',
        emoji: '☀️',
        tags: ['Pop', '欢快', '夏天'],
        prompt: 'Mandarin pop, bright, upbeat, summer vibe, female vocals, electric guitar, catchy hook, 110 BPM',
        lyrics: `[Intro]

[Verse]
推开窗 阳光洒在脸上
风带着花香 跑进我胸膛
昨天的烦恼像汽水蒸发
今天的天空 蓝得像童话

[Pre Chorus]
我把心情写成一封信
寄给每一个 路过的清晨

[Chorus]
让我们一起 笑着去远方
管它前路有没有方向
脚步轻一点 心跳大声唱
夏天的味道 是你的模样

[Verse]
便利店门口 你说要去看海
我说好啊 这就把行李打包
青春的列车 从来不等人
我们都是 自由的灵魂

[Pre Chorus]
按下快门 留住这瞬间
任时间溜走 也不会褪色

[Chorus]
让我们一起 笑着去远方
管它前路有没有方向
脚步轻一点 心跳大声唱
夏天的味道 是你的模样

[Bridge]
就算未来 风雨突然来
也要笑着 跳进它怀里

[Chorus]
让我们一起 笑着去远方
管它前路有没有方向
脚步轻一点 心跳大声唱
夏天的味道 是你的模样

[Outro]
`,
    },

    // ── 情歌 ──────────────────────────────────
    {
        id: 'love-ballad',
        name: '抒情情歌',
        emoji: '💗',
        tags: ['情歌', '浪漫', '温柔'],
        prompt: 'Mandarin ballad, romantic, slow tempo, warm piano, soft strings, intimate male vocals, 70 BPM',
        lyrics: `[Intro]

[Verse]
你是我深夜里 一盏不熄的灯
照亮我所有 不安的旅程
你是我寒冬里 一杯热的可可
温暖我每一个 失眠的角落

[Pre Chorus]
是不是我们 早就约定好
要在这一站 紧紧地相拥

[Chorus]
我愿意 把整个世界都给你
也愿意 陪你看一辈子日落
就算时间 把皱纹刻在我额头
你笑起来 还是当年那个温柔

[Verse]
你不必完美 也不用太勇敢
软弱的时候 可以靠在我肩膀
你的眼泪我一颗都数得清
每一颗 都是我心疼的星

[Chorus]
我愿意 把整个世界都给你
也愿意 陪你看一辈子日落
就算时间 把皱纹刻在我额头
你笑起来 还是当年那个温柔

[Bridge]
不需要烟花 也不需要钻戒
只要每天醒来 你还在我身边

[Chorus]
我愿意 把整个世界都给你
也愿意 陪你看一辈子日落
就算时间 把皱纹刻在我额头
你笑起来 还是当年那个温柔

[Outro]
`,
    },

    // ── 伤感 ──────────────────────────────────
    {
        id: 'sad-heartbreak',
        name: '伤感失恋',
        emoji: '💔',
        tags: ['伤感', '失恋', '深夜'],
        prompt: 'Mandarin sad ballad, heartbreak, melancholic, rainy night, slow piano, cello, breathy female vocals, 65 BPM',
        lyrics: `[Intro]

[Verse]
凌晨三点 又翻到你的照片
雨打在窗 像我没说完的话
你说过的 那些会陪我到老
现在听来 像很久以前的笑话

[Pre Chorus]
我把回忆 折成纸船
一只一只 漂进河里

[Chorus]
最难过的不是分开
是我还记得 你怎么爱过我
最痛的不是再见
是从此以后 我们再不相干
连一句早安 都不会有人讲

[Verse]
朋友说 时间会带走一切
可我却 越走越想念你的脸
旧外套上 还有你的香水
我把它叠好 放进了衣柜最里面

[Chorus]
最难过的不是分开
是我还记得 你怎么爱过我
最痛的不是再见
是从此以后 我们再不相干
连一句早安 都不会有人讲

[Bridge]
如果可以 让我再回到那天
我会紧紧抱住你 不让你走

[Chorus]
最难过的不是分开
是我还记得 你怎么爱过我
最痛的不是再见
是从此以后 我们再不相干
连一句早安 都不会有人讲

[Outro]
`,
    },

    // ── 摇滚 ──────────────────────────────────
    {
        id: 'rock-anthem',
        name: '热血摇滚',
        emoji: '🤘',
        tags: ['摇滚', '热血', '燃'],
        prompt: 'Mandarin rock anthem, energetic, distorted guitars, powerful drums, male vocals, gang chorus, 140 BPM',
        lyrics: `[Intro]

[Verse]
不要再问我 为什么还在跑
脚下的泥泞 写满了不甘心
他们说我疯 说我做梦做太深
我笑着回答 那就让我疯到天明

[Pre Chorus]
心跳像鼓 在胸口敲
燃烧的血 不会冷掉

[Chorus]
我要把命 押在这一刻
就算输到 一无所有
站起来 拍拍尘土
继续往前 不回头
我就是 我自己的英雄

[Verse]
被看不起又怎样 谁规定我得听话
天塌下来 我也要先把它给打塌
朋友说 别太拼了 留点力气
我说兄弟 这一战 输不起

[Solo]

[Chorus]
我要把命 押在这一刻
就算输到 一无所有
站起来 拍拍尘土
继续往前 不回头
我就是 我自己的英雄

[Bridge]
青春就一次 不燃烧 留给谁

[Chorus]
我要把命 押在这一刻
就算输到 一无所有
站起来 拍拍尘土
继续往前 不回头
我就是 我自己的英雄

[Outro]
`,
    },

    // ── 说唱 ──────────────────────────────────
    {
        id: 'rap-hiphop',
        name: '中文说唱',
        emoji: '🎤',
        tags: ['Rap', '嘻哈', 'Trap'],
        prompt: 'Mandarin hip-hop, trap beat, 808 bass, hi-hats, confident male rap, melodic hook, 90 BPM',
        lyrics: `[Intro]

[Verse]
Yeah 我从底层一路爬上来
背包里装着梦 鞋底磨成白
没人借我钱 没人给我牌
我用这一支笔 杀出一条街
他们看不见 我熬过的夜
他们听不见 我心跳的雷
键盘上的字 是我的子弹
押的每一个韵 是我的勋章

[Hook]
这是我的 game 我自己的 lane
没人能告诉我 该往哪儿迈
这是我的 fame 我自己的 stage
就算全世界 都让我 stay safe

[Verse]
钱不是 everything 但没有它 nothing
看清了人情 就懂了 game 怎么 running
妈妈说 儿子 你要稳着点
我说妈 这一波 我必须 win
朋友变 enemy 没什么 surprise
我把心放冷 把火放心里
这条路很黑 但我有 vision
撑过这一夜 我就是 the king

[Hook]
这是我的 game 我自己的 lane
没人能告诉我 该往哪儿迈
这是我的 fame 我自己的 stage
就算全世界 都让我 stay safe

[Bridge]
从无到有 从弱到强
这不是运气 是我应得的奖

[Hook]
这是我的 game 我自己的 lane
没人能告诉我 该往哪儿迈
这是我的 fame 我自己的 stage
就算全世界 都让我 stay safe

[Outro]
`,
    },

    // ── 喊麦 ──────────────────────────────────
    {
        id: 'shouting-mc',
        name: '社会喊麦',
        emoji: '📢',
        tags: ['喊麦', 'DJ', '燃炸'],
        prompt: 'Chinese MC shouting style, DJ remix, heavy synth bass, four-on-the-floor kick, aggressive male vocals, dramatic strings stab, 128 BPM',
        lyrics: `[Intro]

[Verse]
天涯路远 江湖险恶
兄弟一声 两肋插刀
风里雨里 我从不躲
该出手时 绝不啰嗦

[Pre Chorus]
酒满杯 月当空
今夜的故事 由我来讲

[Chorus]
我命由我 不由天
富贵荣华 全靠肩
摔倒了 就爬起来再战
天大的事 我顶在前面
兄弟二字 重如山
义字当头 命也敢换

[Verse]
有人笑我 太疯太狂
我笑他们 活得太软
这世道啊 容不下软弱
站起来 才有人给你让座

[Build Up]

[Drop]

[Chorus]
我命由我 不由天
富贵荣华 全靠肩
摔倒了 就爬起来再战
天大的事 我顶在前面
兄弟二字 重如山
义字当头 命也敢换

[Outro]
`,
    },

    // ── 古风 ──────────────────────────────────
    {
        id: 'guofeng',
        name: '中国风古风',
        emoji: '🏯',
        tags: ['古风', '国风', '诗意'],
        prompt: 'Chinese traditional style, guzheng, erhu, bamboo flute, pentatonic scale, female ethereal vocals, ancient poetic mood, 80 BPM',
        lyrics: `[Intro]

[Verse]
长安雪 落满了你的衣袂
红梅枝 折一支寄向天涯
墨未干 一封信压在镇尺下
等风来 替我读给你听吧

[Pre Chorus]
青衫薄 江湖远
一壶酒 醉了流年

[Chorus]
若我们前世 是一段诗
今生只愿 共写半阙词
你执我手 走过烟雨长街
回眸时 春深花也未谢
若我们今生 注定要别离
来世我愿 化作你窗前的雨

[Verse]
画船里 你说要看尽繁华
我应允 那便陪你白发
铜镜中 谁的容颜先苍老
不重要 心字底从未潦草

[Bridge]
山有木兮 木有枝
心悦君兮 君不知

[Chorus]
若我们前世 是一段诗
今生只愿 共写半阙词
你执我手 走过烟雨长街
回眸时 春深花也未谢
若我们今生 注定要别离
来世我愿 化作你窗前的雨

[Outro]
`,
    },

    // ── 民谣 ──────────────────────────────────
    {
        id: 'folk-acoustic',
        name: '校园民谣',
        emoji: '🎸',
        tags: ['民谣', '青春', '吉他'],
        prompt: 'Mandarin acoustic folk, fingerstyle guitar, harmonica, soft male vocals, nostalgic, 90 BPM',
        lyrics: `[Intro]

[Verse]
那年的操场 风把云吹得很慢
你抱着吉他 在树下弹了一下午
自行车铃声 摇晃着夕阳的边
我说我喜欢你 你笑着没有回答

[Pre Chorus]
后来我们 都散在了不同的城
偶尔翻到旧照片 还是会笑着哭

[Chorus]
青春是一本 太仓促的书
我们都来不及 好好把它读完
长大以后 才懂得有些人
错过那一次 就是错过了一辈子

[Verse]
食堂的二楼 我们抢过最后一份糖醋
晚自习偷偷 传过的那张小纸条
说要一起去看海 一起去远方流浪
转眼十年了 我们都长成了大人模样

[Chorus]
青春是一本 太仓促的书
我们都来不及 好好把它读完
长大以后 才懂得有些人
错过那一次 就是错过了一辈子

[Bridge]
如果能回到那天 我一定大声告诉你
我喜欢你 喜欢了好多好多年

[Outro]
`,
    },

    // ── R&B ───────────────────────────────────
    {
        id: 'rnb-smooth',
        name: 'R&B 慢摇',
        emoji: '🌃',
        tags: ['R&B', '深夜', '律动'],
        prompt: 'Mandarin R&B, smooth, late night vibe, electric piano, sub bass, finger snaps, breathy male vocals, 80 BPM',
        lyrics: `[Intro]

[Verse]
午夜十二点 你给我发了一句晚安
我盯着屏幕 笑了半个小时没吃饭
你说今天的天气 像极了我们第一次见面
我说要不要 现在就让我去你身边

[Pre Chorus]
心跳的频率 已经乱了节拍
我承认 早就败给你的可爱

[Chorus]
Baby 让我陪你 通宵看一场雨
让我把吉他 弹成你想要的旋律
Baby 让我把你 写进我每首歌里
就算明天天亮 也舍不得放开你

[Verse]
你转身的瞬间 香水味停在空气
我把这一秒 反复听了一万遍
是不是这就是 大家说的命中注定
还是只是我 自作多情的剧情

[Chorus]
Baby 让我陪你 通宵看一场雨
让我把吉他 弹成你想要的旋律
Baby 让我把你 写进我每首歌里
就算明天天亮 也舍不得放开你

[Bridge]
就这样吧 别说话
让这首歌 替我表达

[Outro]
`,
    },

    // ── EDM ───────────────────────────────────
    {
        id: 'edm-festival',
        name: '电子舞曲 EDM',
        emoji: '🎧',
        tags: ['EDM', '舞曲', '燃爆'],
        prompt: 'Festival EDM, big room house, supersaw lead, side-chained pump, female topline vocal, anthemic drop, 128 BPM',
        lyrics: `[Intro]

[Verse]
霓虹灯 把夜染成紫色
人群里 我看见你的眼睛
鼓点像 心跳一样上升
今晚我们 不需要清醒

[Pre Chorus]
举起手 跟着节奏摇
让这一刻 永远不要停

[Build Up]
3 2 1 我们一起跳

[Drop]

[Chorus]
We dance dance dance 直到天亮
We jump jump jump 把烦恼忘光
今晚的星 全部为你点亮
跟我一起 让世界为你疯狂

[Breakdown]
听见自己的呼吸
听见心跳的回音

[Build Up]
准备好了吗

[Drop]

[Chorus]
We dance dance dance 直到天亮
We jump jump jump 把烦恼忘光
今晚的星 全部为你点亮
跟我一起 让世界为你疯狂

[Outro]
`,
    },

    // ── 励志 ──────────────────────────────────
    {
        id: 'inspiring',
        name: '励志燃曲',
        emoji: '🔥',
        tags: ['励志', '正能量', '燃'],
        prompt: 'Mandarin inspirational pop-rock, uplifting, big drums, anthemic strings, powerful male vocals, motivational, 120 BPM',
        lyrics: `[Intro]

[Verse]
昨天的你 在被窝里哭了一夜
今天的你 还要笑着出门见客户
没有人会问 你累不累
但你自己知道 你扛过了多少

[Pre Chorus]
擦干眼泪 整理好衣领
镜子里的人 还要继续前行

[Chorus]
就算这世界 没人为你鼓掌
你也要为自己 用力地活一场
就算所有的路 都布满风霜
你也要走出 自己的光
你不是一个人 在战场
你的每一步 都算数

[Verse]
被拒绝过 被误解过
也曾经怀疑 自己是不是错了
但每次崩溃后 又重新站起来
这才是 真正的勇敢

[Bridge]
不必和谁 比较高低
你已经 是自己的奇迹

[Chorus]
就算这世界 没人为你鼓掌
你也要为自己 用力地活一场
就算所有的路 都布满风霜
你也要走出 自己的光
你不是一个人 在战场
你的每一步 都算数

[Outro]
`,
    },

    // ── Lo-fi ─────────────────────────────────
    {
        id: 'lofi-study',
        name: 'Lo-fi 学习',
        emoji: '☕',
        tags: ['Lo-fi', '学习', '放松'],
        prompt: 'Lo-fi hip hop, chill, study beats, soft piano, vinyl crackle, jazzy chords, no vocal or very soft humming, 75 BPM',
        lyrics: `[Intro]

[Instrumental]

[Verse]
咖啡的热气 在台灯下打转
笔尖沙沙 像窗外细细的雨
不必赶时间 不必想太远
让这一页 慢慢翻

[Interlude]

[Verse]
错的题目 圈起来再看一遍
对的题目 给自己一个微笑
所谓努力 不过是日复一日
不抱怨 也不放弃

[Outro]
`,
    },

    // ── 史诗 ──────────────────────────────────
    {
        id: 'cinematic-epic',
        name: '电影史诗',
        emoji: '🎬',
        tags: ['史诗', '配乐', 'BGM'],
        prompt: 'Cinematic epic orchestral, massive choir, taiko drums, soaring strings, brass fanfare, hero theme, 100 BPM',
        lyrics: `[Intro]

[Build Up]

[Verse]
风暴来临前 群山低下了头
传说中的剑 在石头里沉睡了千年
预言写在 古老的石碑
等待着那个 命中的少年

[Pre Chorus]
钟声响起 旗帜被举高
是时候了 该有人挺身而出

[Chorus]
为了信念 我们出征
为了和平 不惜血染长缨
就算前路 是万丈深渊
也要纵身 一跃而下
我们的名字 会被风记住
被河流传唱 被星辰铭记

[Verse]
战马嘶鸣 我们并肩
没有人会 在最后一刻撤退
盾牌相碰 是兄弟的誓言
火焰映红了 每一张坚毅的脸

[Bridge]
若我倒下 请把我埋在山顶
让我能看见 那升起的黎明

[Chorus]
为了信念 我们出征
为了和平 不惜血染长缨
就算前路 是万丈深渊
也要纵身 一跃而下
我们的名字 会被风记住
被河流传唱 被星辰铭记

[Outro]
`,
    },

    // ── 怀旧 ──────────────────────────────────
    {
        id: 'retro-80s',
        name: '怀旧老歌',
        emoji: '📻',
        tags: ['怀旧', '复古', '80s'],
        prompt: 'Retro Mandarin pop, 80s synthwave, gated reverb drums, analog synth pad, saxophone solo, warm male vocals, 100 BPM',
        lyrics: `[Intro]

[Verse]
卡带还在抽屉的最深处
A 面是你 B 面是青春
那一年的歌 还能哼出几句
那一年的人 都散在了哪里

[Pre Chorus]
老照片 泛黄了边角
笑容却 一点也没变老

[Chorus]
时光啊 你慢一点走
让我多看 那一张张面孔
时光啊 你别带走
那些不会再来 一次的温柔
我们都老了 也都还年轻
在那首歌里 永远十八岁

[Verse]
小卖部门口 你递我半根冰棍
现在的我 还能尝到那个甜
想说的话 当年没说出口
也许这辈子 都没机会再开口

[Saxophone Solo]

[Chorus]
时光啊 你慢一点走
让我多看 那一张张面孔
时光啊 你别带走
那些不会再来 一次的温柔
我们都老了 也都还年轻
在那首歌里 永远十八岁

[Outro]
`,
    },

    // ── 卡通儿歌 ───────────────────────────────
    {
        id: 'children-cute',
        name: '卡通儿歌',
        emoji: '🧸',
        tags: ['儿歌', '可爱', '童趣'],
        prompt: 'Cute children song, ukulele, glockenspiel, hand claps, kids choir, playful, major key, 100 BPM',
        lyrics: `[Intro]

[Verse]
小蜗牛 慢慢爬
背着小房子 去看花
小蝴蝶 轻轻飞
飞到我手上 不害怕

[Chorus]
啦啦啦 啦啦啦
今天的天气 真好呀
啦啦啦 啦啦啦
小朋友们 一起回家
牵着妈妈 牵着爸爸
唱着歌 蹦蹦跶跶

[Verse]
小太阳 笑哈哈
把云朵 染成棉花糖
小星星 眨眼睛
晚上来听我 讲故事

[Chorus]
啦啦啦 啦啦啦
今天的天气 真好呀
啦啦啦 啦啦啦
小朋友们 一起回家
牵着妈妈 牵着爸爸
唱着歌 蹦蹦跶跶

[Outro]
`,
    },

    // ── 摇篮曲 ─────────────────────────────────
    {
        id: 'lullaby',
        name: '温柔摇篮曲',
        emoji: '🌙',
        tags: ['摇篮曲', '温柔', '助眠'],
        prompt: 'Soft Mandarin lullaby, music box, soft piano, breathy female vocals, gentle, sleeping baby, 60 BPM',
        lyrics: `[Intro]

[Verse]
月亮悄悄 爬上了窗
星星眨着 困倦的眼
风把云朵 吹成棉花
盖在你 小小的肩膀上

[Chorus]
睡吧 我的小宝贝
明天还有 太阳等你
睡吧 别怕黑夜
妈妈一直 在你身边

[Verse]
小熊抱着 你的小手
小狗趴在 你的脚边
所有的故事 都已经讲完
只剩这一首 轻轻的歌

[Outro]
`,
    },

    // ── 爵士 ──────────────────────────────────
    {
        id: 'jazz-lounge',
        name: '爵士小调',
        emoji: '🎷',
        tags: ['爵士', '酒吧', '复古'],
        prompt: 'Jazz lounge, smooth, late night bar, walking bass, brushed drums, saxophone, sultry female vocals, swing feel, 95 BPM',
        lyrics: `[Intro]

[Verse]
酒杯里 摇晃着街灯的影子
你坐在对面 慢慢点了一支烟
没人开口 但什么都被说尽
钢琴师 弹着我们都熟悉的那首

[Chorus]
今晚啊 别问明天去哪
就让爵士 替我们说话
今晚啊 别管月亮多瘦
就让我 多看你一会儿就走

[Saxophone Solo]

[Verse]
你笑着说 这世界太吵
只有这里 还能听见心跳
我点点头 把杯子举高
敬过去那些 错过的拥抱

[Chorus]
今晚啊 别问明天去哪
就让爵士 替我们说话
今晚啊 别管月亮多瘦
就让我 多看你一会儿就走

[Outro]
`,
    },

    // ── 圣诞 ──────────────────────────────────
    {
        id: 'christmas',
        name: '圣诞欢歌',
        emoji: '🎄',
        tags: ['圣诞', '节日', '温馨'],
        prompt: 'Christmas pop, sleigh bells, festive piano, warm strings, kids choir, joyful, major key, 110 BPM',
        lyrics: `[Intro]

[Verse]
雪花 落在路灯下
小狗 踩出梅花的脚印
橱窗里 红色的袜子
装满了 一年的小心思

[Pre Chorus]
炉火噼啪 香气慢慢飘
今晚每个人 都不会孤单

[Chorus]
Merry Christmas 我亲爱的你
不管在哪里 都要记得想我
Merry Christmas 平安夜的星
请把祝福 一颗一颗发给所有人
让爱穿越 风雪和距离
让今晚的拥抱 暖到明年春天

[Verse]
妈妈做的姜饼 形状歪歪扭扭
小朋友们 抢着挂彩灯
奶奶讲的故事 重复了很多年
但每年听到 还是会笑出声

[Chorus]
Merry Christmas 我亲爱的你
不管在哪里 都要记得想我
Merry Christmas 平安夜的星
请把祝福 一颗一颗发给所有人
让爱穿越 风雪和距离
让今晚的拥抱 暖到明年春天

[Outro]
`,
    },

    // ── 婚礼 ──────────────────────────────────
    {
        id: 'wedding',
        name: '婚礼誓言',
        emoji: '💍',
        tags: ['婚礼', '誓言', '幸福'],
        prompt: 'Wedding ballad, romantic, grand piano, soaring strings, duet male and female vocals, joyful, 75 BPM',
        lyrics: `[Intro]

[Verse]
还记得我们 第一次见面那天吗
你穿着白衬衫 笑得有点害羞
那时候没想到 这一笑会笑到今天
也会一直 笑到我们白发苍苍

[Pre Chorus]
今天我穿着西装 你穿着婚纱
所有的故事 都要从这里翻篇

[Chorus]
我愿意 牵你的手 走完往后的每一年
不管风雨 不管阴晴
我愿意 把我所有的明天
都画上你的名字
从今天开始 我有了一个家
那个家 就是你

[Verse]
我会记得 你不爱吃香菜
我会记得 你睡觉要抱毛绒玩具
我会记得 你哭的时候要抱紧
我会记得 把所有的好都给你

[Chorus]
我愿意 牵你的手 走完往后的每一年
不管风雨 不管阴晴
我愿意 把我所有的明天
都画上你的名字
从今天开始 我有了一个家
那个家 就是你

[Outro]
`,
    },
];
