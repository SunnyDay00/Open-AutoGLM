=====================================
官方说明：

二次开发
配置开发环境
二次开发需要使用开发依赖：

pip install -e ".[dev]"
运行测试
pytest tests/
完整项目结构
phone_agent/
├── __init__.py          # 包导出
├── agent.py             # PhoneAgent 主类
├── adb/                 # ADB 工具
│   ├── connection.py    # 远程/本地连接管理
│   ├── screenshot.py    # 屏幕截图
│   ├── input.py         # 文本输入 (ADB Keyboard)
│   └── device.py        # 设备控制 (点击、滑动等)
├── actions/             # 操作处理
│   └── handler.py       # 操作执行器
├── config/              # 配置
│   ├── apps.py          # 支持的应用映射
│   ├── prompts_zh.py    # 中文系统提示词
│   └── prompts_en.py    # 英文系统提示词
└── model/               # AI 模型客户端
    └── client.py        # OpenAI 兼容客户端


以下内容是第三方的，供参考：
核心模块（与 README 中描述一致）：
phone_agent/agent.py
PhoneAgent：主循环 orchestrator（抓屏 → 请求模型 → 解析动作 → 执行动作 → 继续）
AgentConfig：最大步数、语言、device_id、system_prompt、verbose
StepResult：单步执行结果

phone_agent/model/client.py
ModelClient：OpenAI-compatible Chat Completions 客户端
MessageBuilder：构建 system/user/assistant messages，并做“剔除历史图片”

phone_agent/actions/handler.py
ActionHandler：将模型输出动作映射到具体 ADB 操作
parse_action：把模型输出字符串解析为 dict（目前通过 eval 解析 do(...)）

phone_agent/adb/*
screenshot.py：截图抓取、base64 编码
device.py：点击/滑动/返回/主页/启动应用
input.py：基于 ADB Keyboard 的文本输入（base64 广播）
connection.py：ADB 设备连接/枚举（可用于远程/多设备）

phone_agent/config/*
prompts_zh.py, prompts_en.py：系统提示词
apps.py：应用名到包名映射（用于 Launch）
i18n.py：UI 输出文案