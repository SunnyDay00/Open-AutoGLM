import { useState, useEffect, useCallback } from 'react'
import { Save, Cloud, Server, Cpu, Download, Terminal, Settings as SettingsIcon, Smartphone, List, X, FolderOpen } from 'lucide-react'

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

export default function SettingsView() {
    const [mode, setMode] = useState<'cloud' | 'local'>('cloud')

    // Model Config (Manual Save)
    const [cloudConfig, setCloudConfig] = useState({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        modelName: 'autoglm-phone',
        apiKey: '',
        conversationPrefix: ''
    })
    const [localConfig, setLocalConfig] = useState({
        baseUrl: 'http://localhost:11434/v1',
        modelName: 'qwen2.5:9b',
        apiKey: 'EMPTY',
        conversationPrefix: ''
    })

    // Agent Config (Auto Save)
    const [agentConfig, setAgentConfig] = useState({
        maxSteps: 100,
        verbose: true,
        screenshotSavePath: '',
        deviceId: ''
    })

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
    const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle')
    const [testResult, setTestResult] = useState<string>('')

    // Apps List State
    const [showAppsModal, setShowAppsModal] = useState(false)
    const [appsList, setAppsList] = useState<string[]>([])
    const [loadingApps, setLoadingApps] = useState(false)

    // Load initial settings
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/settings')
                if (res.ok) {
                    const data = await res.json()
                    if (data.cloud && data.local) {
                        setMode(data.mode || 'cloud')
                        setCloudConfig({
                            baseUrl: data.cloud.base_url,
                            modelName: data.cloud.model_name,
                            apiKey: data.cloud.api_key,
                            conversationPrefix: data.conversation_prefix || ''
                        })
                        setLocalConfig({
                            baseUrl: data.local.base_url,
                            modelName: data.local.model_name,
                            apiKey: data.local.api_key,
                            conversationPrefix: data.conversation_prefix || ''
                        })
                        setAgentConfig({
                            maxSteps: data.max_steps || 100,
                            verbose: data.verbose !== undefined ? data.verbose : true,
                            screenshotSavePath: data.screenshot_save_path || '',
                            deviceId: data.device_id || ''
                        })
                    }
                }
            } catch (e) {
                console.error("Failed to load settings", e)
            }
        }
        fetchSettings()
    }, [])

    // Manual Save for Model Config
    const handleManualSave = async () => {
        setSaveStatus('saving')
        try {
            await saveSettings(true)
            setSaveStatus('success')
            setTimeout(() => setSaveStatus('idle'), 2000)
        } catch (e) {
            console.error("Save error:", e)
            setSaveStatus('error')
            setTimeout(() => setSaveStatus('idle'), 2000)
        }
    }

    // Auto Save for Agent Config
    const debouncedAgentConfig = useDebounce(agentConfig, 1000); // Wait 1s after changes

    // Track if it's the initial load to prevent immediate auto-save
    const [isLoaded, setIsLoaded] = useState(false)
    useEffect(() => {
        if (agentConfig.maxSteps !== 100) setIsLoaded(true) // Heuristic
        const timer = setTimeout(() => setIsLoaded(true), 1500)
        return () => clearTimeout(timer)
    }, [])

    useEffect(() => {
        if (!isLoaded) return;

        const autoSave = async () => {
            setAutoSaveStatus('saving')
            try {
                // Determine mode locally or from state, but saveSettings uses state `mode`
                // We mainly want to save agentConfig changes.
                await saveSettings(false)
                setAutoSaveStatus('saved')
                setTimeout(() => setAutoSaveStatus('idle'), 2000)
            } catch (e) {
                console.error("Auto save error:", e)
                setAutoSaveStatus('error')
            }
        }
        autoSave()
    }, [debouncedAgentConfig]) // Trigger when debounced config changes

    // Unified Save Function
    const saveSettings = async (isManual: boolean) => {
        // Construct payload
        const payload = {
            mode: mode,
            cloud: {
                base_url: cloudConfig.baseUrl,
                model_name: cloudConfig.modelName,
                api_key: cloudConfig.apiKey
            },
            local: {
                base_url: localConfig.baseUrl,
                model_name: localConfig.modelName,
                api_key: localConfig.apiKey
            },
            device_id: agentConfig.deviceId || null,
            max_steps: agentConfig.maxSteps,
            verbose: agentConfig.verbose,
            screenshot_save_path: agentConfig.screenshotSavePath || null,
            conversation_prefix: (mode === 'cloud' ? cloudConfig.conversationPrefix : localConfig.conversationPrefix) || null
        }

        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!res.ok) throw new Error('Save failed')
        const data = await res.json()
        if (data.status === 'error') throw new Error(data.message)
    }

    const handleTest = async () => {
        setTestStatus('testing')
        setTestResult('')
        try {
            const payload = {
                mode: mode,
                cloud: {
                    base_url: cloudConfig.baseUrl,
                    model_name: cloudConfig.modelName,
                    api_key: cloudConfig.apiKey
                },
                local: {
                    base_url: localConfig.baseUrl,
                    model_name: localConfig.modelName,
                    api_key: localConfig.apiKey
                }
            }
            const res = await fetch('/api/test_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            const data = await res.json()
            setTestResult(data.result)
        } catch (e) {
            setTestResult(`连接错误: ${e}`)
        } finally {
            setTestStatus('idle')
        }
    }

    const fetchApps = async () => {
        setLoadingApps(true)
        setShowAppsModal(true)
        try {
            const res = await fetch('/api/apps')
            const data = await res.json()
            setAppsList(data.apps || [])
        } catch (e) {
            console.error("Failed to fetch apps", e)
            setAppsList(["获取失败"])
        } finally {
            setLoadingApps(false)
        }
    }

    // Helpers
    const activeConfig = mode === 'cloud' ? cloudConfig : localConfig
    const setActiveConfig = (newConfig: typeof cloudConfig) => {
        if (mode === 'cloud') setCloudConfig(newConfig)
        else setLocalConfig(newConfig)
    }

    const handleSelectFolder = async () => {
        try {
            // Optimistic UI feedback if needed, but blocking call is fine for local tool
            const res = await fetch('/api/tools/select_folder', { method: 'POST' })
            const data = await res.json()
            if (data.status === 'success' && data.path) {
                setAgentConfig(prev => ({ ...prev, screenshotSavePath: data.path }))
            }
        } catch (e) {
            console.error("Failed to select folder", e)
        }
    }

    return (
        <div className="flex flex-col h-full bg-slate-900 p-8 overflow-y-auto relative">
            <div className="max-w-4xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Column 1: Model Settings (Manual Save) */}
                <div className="flex flex-col gap-6">
                    <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
                        <Server className="text-blue-500" />
                        模型配置
                    </h2>

                    {/* Mode Switcher */}
                    <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
                        <button
                            onClick={() => setMode('cloud')}
                            className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all font-medium ${mode === 'cloud'
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                        >
                            <Cloud size={18} />
                            云 API
                        </button>
                        <button
                            onClick={() => setMode('local')}
                            className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all font-medium ${mode === 'local'
                                ? 'bg-emerald-600 text-white shadow-lg'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                        >
                            <Cpu size={18} />
                            本地模型
                        </button>
                    </div>

                    {/* Model Form */}
                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 space-y-5 relative overflow-hidden">
                        <div className={`absolute top-0 left-0 w-1 h-full transition-colors duration-300 ${mode === 'cloud' ? 'bg-blue-500' : 'bg-emerald-500'}`} />

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">基本 URL (Base URL)</label>
                            <input
                                type="text"
                                value={activeConfig.baseUrl}
                                onChange={e => setActiveConfig({ ...activeConfig, baseUrl: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">模型名称 (Model Name)</label>
                            <input
                                type="text"
                                value={activeConfig.modelName}
                                onChange={e => setActiveConfig({ ...activeConfig, modelName: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">API 密钥 (API Key)</label>
                            <input
                                type="password"
                                value={activeConfig.apiKey}
                                onChange={e => setActiveConfig({ ...activeConfig, apiKey: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">对话前置内容 (Conversation Prefix)</label>
                            <textarea
                                value={activeConfig.conversationPrefix}
                                onChange={e => setActiveConfig({ ...activeConfig, conversationPrefix: e.target.value })}
                                placeholder="（可选）设置每次对话自动添加的前置内容，例如角色设定或指令"
                                rows={4}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors resize-none"
                            />
                        </div>

                        <div className="flex gap-4 pt-2">
                            <button
                                onClick={handleTest}
                                disabled={testStatus === 'testing'}
                                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-all shadow-lg active:scale-95 disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                <Terminal size={18} className={testStatus === 'testing' ? 'animate-spin' : ''} />
                                {testStatus === 'testing' ? '测试中...' : '测试连接'}
                            </button>
                            <button
                                onClick={handleManualSave}
                                disabled={saveStatus === 'saving' || saveStatus === 'success'}
                                className={`flex-1 py-3 rounded-xl font-medium transition-all shadow-lg active:scale-95 disabled:opacity-100 flex items-center justify-center gap-2
                                    ${saveStatus === 'success' ? 'bg-emerald-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}
                                `}
                            >
                                <Save size={18} className={saveStatus === 'saving' ? 'animate-spin' : ''} />
                                {saveStatus === 'idle' && '手动保存'}
                                {saveStatus === 'saving' && '保存中...'}
                                {saveStatus === 'success' && '已保存'}
                                {saveStatus === 'error' && '保存失败'}
                            </button>
                        </div>
                    </div>

                    {testResult && (
                        <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 animate-in fade-in slide-in-from-top-4">
                            <h3 className="text-slate-200 font-semibold mb-2 text-sm flex items-center gap-2">
                                <Terminal size={16} className="text-purple-400" />
                                测试结果
                            </h3>
                            <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                                {testResult}
                            </pre>
                        </div>
                    )}
                </div>

                {/* Column 2: Agent Settings (Auto Save) & Toolbox */}
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
                            <SettingsIcon className="text-purple-500" />
                            Agent 配置
                        </h2>
                        {/* Auto-save Indicator */}
                        <div className={`text-xs font-mono transition-colors ${autoSaveStatus === 'saving' ? 'text-blue-400' :
                            autoSaveStatus === 'saved' ? 'text-emerald-400' : 'text-slate-600'
                            }`}>
                            {autoSaveStatus === 'saving' ? '正在同步...' :
                                autoSaveStatus === 'saved' ? '已同步' : '自动保存'}
                        </div>
                    </div>

                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 space-y-6 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-purple-500" />

                        {/* Max Steps */}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2 flex justify-between">
                                <span>最大步数 (Max Steps)</span>
                                <span className="text-xs text-slate-500">每个任务最大执行步数</span>
                            </label>
                            <input
                                type="number"
                                value={agentConfig.maxSteps}
                                onChange={e => setAgentConfig({ ...agentConfig, maxSteps: parseInt(e.target.value) || 100 })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-purple-500 outline-none transition-colors"
                            />
                        </div>

                        {/* Screenshot Path */}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2 flex justify-between">
                                <span>截图保存保存 (Screenshot Path)</span>
                                <span className="text-xs text-slate-500">如果不填则使用默认</span>
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={agentConfig.screenshotSavePath}
                                    onChange={e => setAgentConfig({ ...agentConfig, screenshotSavePath: e.target.value })}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-purple-500 outline-none transition-colors placeholder:text-slate-600"
                                    placeholder="例如: D:/AutoGLM/Screenshots"
                                />
                                <button
                                    onClick={handleSelectFolder}
                                    className="p-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-500 hover:text-emerald-500 hover:border-emerald-500/50 transition-colors"
                                    title="选择文件夹"
                                >
                                    <FolderOpen size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Verbose Switch */}
                        <div className="flex items-center justify-between p-4 bg-slate-900 rounded-xl border border-slate-700">
                            <div>
                                <div className="text-slate-200 font-medium">调试模式 (Verbose)</div>
                                <div className="text-xs text-slate-500 mt-1">打印详细的思考过程和执行动作</div>
                            </div>
                            <button
                                onClick={() => setAgentConfig({ ...agentConfig, verbose: !agentConfig.verbose })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${agentConfig.verbose ? 'bg-purple-600' : 'bg-slate-700'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${agentConfig.verbose ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>
                    </div>

                    {/* Toolbox */}
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-3 mt-4">
                        <Terminal className="text-emerald-500" />
                        常用工具
                    </h2>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={fetchApps}
                            className="p-4 bg-slate-800 border border-slate-700 hover:border-emerald-500/50 rounded-xl text-left transition-all group hover:bg-slate-800/80"
                        >
                            <List className="text-emerald-500 mb-2 group-hover:scale-110 transition-transform" size={24} />
                            <div className="font-medium text-slate-200">列出支持应用</div>
                            <div className="text-xs text-slate-500 mt-1">查看所有可用应用</div>
                        </button>

                        <button className="p-4 bg-slate-800 border border-slate-700 hover:border-blue-500/50 rounded-xl text-left transition-all group hover:bg-slate-800/80 opacity-50 cursor-not-allowed">
                            <Smartphone className="text-blue-500 mb-2" size={24} />
                            <div className="font-medium text-slate-200">设备详情</div>
                            <div className="text-xs text-slate-500 mt-1">即将推出</div>
                        </button>
                    </div>

                    {/* Local Tools Instructions */}
                    {mode === 'local' && (
                        <div className="mt-8 pt-6 border-t border-slate-700/50">
                            <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">本地部署向导</h3>
                            <div className="space-y-3">
                                <a href="#" className="block p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-emerald-500/30 transition-all flex items-center justify-between group">
                                    <span className="text-slate-300">安装 vLLM 引擎</span>
                                    <Download size={16} className="text-slate-500 group-hover:text-emerald-400" />
                                </a>
                                <a href="#" className="block p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-purple-500/30 transition-all flex items-center justify-between group">
                                    <span className="text-slate-300">SGLang 推理加速</span>
                                    <Download size={16} className="text-slate-500 group-hover:text-purple-400" />
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Apps Modal */}
            {showAppsModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-8">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-800/50 rounded-t-2xl">
                            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                                <List className="text-emerald-500" />
                                支持的应用列表
                            </h3>
                            <button onClick={() => setShowAppsModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                            <style>{`
                                .scrollbar-hide::-webkit-scrollbar {
                                    display: none;
                                }
                                .scrollbar-hide {
                                    -ms-overflow-style: none;
                                    scrollbar-width: none;
                                }
                            `}</style>
                            {loadingApps ? (
                                <div className="flex items-center justify-center py-12 text-slate-400 gap-3">
                                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                                    加载中...
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {appsList.map((app, i) => (
                                        <div key={i} className="px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700/50 text-slate-200 text-sm font-medium transition-colors cursor-default select-all">
                                            {app}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-800 bg-slate-800/30 text-center text-xs text-slate-500 rounded-b-2xl">
                            共 {appsList.length} 个应用 • 即时生成的列表
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
