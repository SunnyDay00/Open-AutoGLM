import { useState, useEffect } from 'react'
import { Save, Cloud, Server, Cpu, Download, Terminal } from 'lucide-react'

export default function SettingsView() {
    const [mode, setMode] = useState<'cloud' | 'local'>('cloud')

    const [cloudConfig, setCloudConfig] = useState({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        modelName: 'autoglm-phone',
        apiKey: ''
    })

    const [localConfig, setLocalConfig] = useState({
        baseUrl: 'http://localhost:11434/v1',
        modelName: 'qwen2.5:9b',
        apiKey: 'EMPTY'
    })

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle')
    const [testResult, setTestResult] = useState<string>('')

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/settings')
                if (res.ok) {
                    const data = await res.json()

                    // Handle migration or new structure
                    if (data.cloud && data.local) {
                        setMode(data.mode || 'cloud')
                        setCloudConfig({
                            baseUrl: data.cloud.base_url,
                            modelName: data.cloud.model_name,
                            apiKey: data.cloud.api_key
                        })
                        setLocalConfig({
                            baseUrl: data.local.base_url,
                            modelName: data.local.model_name,
                            apiKey: data.local.api_key
                        })
                    } else {
                        // Fallback/Legacy handling if needed, but backend should migrate
                        setMode('cloud')
                        setCloudConfig({
                            baseUrl: data.base_url || cloudConfig.baseUrl,
                            modelName: data.model_name || cloudConfig.modelName,
                            apiKey: data.api_key || cloudConfig.apiKey
                        })
                    }
                }
            } catch (e) {
                console.error("Failed to load settings", e)
            }
        }
        fetchSettings()
    }, [])

    const handleSave = async () => {
        setSaveStatus('saving')
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
                },
                device_id: null, // Preserve or handle device_id if needed
                device_type: 'adb'
            }

            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (!res.ok) {
                throw new Error('Save failed')
            }

            const data = await res.json()
            if (data.status === 'error') {
                throw new Error(data.message)
            }

            setSaveStatus('success')
            setTimeout(() => setSaveStatus('idle'), 2000)
        } catch (e) {
            console.error("Save error:", e)
            setSaveStatus('error')
            setTimeout(() => setSaveStatus('idle'), 2000)
        }
    }

    const handleTest = async () => {
        setTestStatus('testing')
        setTestResult('')
        try {
            // Send current temporary state for testing, not just saved state
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

    // Helper to get current config object for rendering
    const activeConfig = mode === 'cloud' ? cloudConfig : localConfig
    const setActiveConfig = (newConfig: typeof cloudConfig) => {
        if (mode === 'cloud') setCloudConfig(newConfig)
        else setLocalConfig(newConfig)
    }

    return (
        <div className="flex flex-col h-full bg-slate-900 p-8 overflow-y-auto">
            <div className="max-w-2xl mx-auto w-full">
                <h2 className="text-2xl font-bold text-slate-100 mb-8 flex items-center gap-3">
                    <Server className="text-blue-500" />
                    模型配置
                </h2>

                {/* Mode Switcher */}
                <div className="flex bg-slate-800 p-1 rounded-xl mb-8 border border-slate-700">
                    <button
                        onClick={() => setMode('cloud')}
                        className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all font-medium ${mode === 'cloud'
                            ? 'bg-blue-600 text-white shadow-lg'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                            }`}
                    >
                        <Cloud size={18} />
                        云 API
                    </button>
                    <button
                        onClick={() => setMode('local')}
                        className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all font-medium ${mode === 'local'
                            ? 'bg-emerald-600 text-white shadow-lg'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                            }`}
                    >
                        <Cpu size={18} />
                        本地模型
                    </button>
                </div>

                {/* Form */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 space-y-6 relative overflow-hidden">
                    {/* Background decoration */}
                    <div className={`absolute top-0 left-0 w-1 h-full transition-colors duration-300 ${mode === 'cloud' ? 'bg-blue-500' : 'bg-emerald-500'}`} />

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">基本 URL (Base URL)</label>
                        <input
                            type="text"
                            value={activeConfig.baseUrl}
                            onChange={e => setActiveConfig({ ...activeConfig, baseUrl: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            placeholder={mode === 'cloud' ? "https://api.example.com/v1" : "http://localhost:11434/v1"}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">模型名称 (Model Name)</label>
                        <input
                            type="text"
                            value={activeConfig.modelName}
                            onChange={e => setActiveConfig({ ...activeConfig, modelName: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            placeholder={mode === 'cloud' ? "autoglm-phone-9b" : "qwen2.5:9b"}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">API 密钥 (API Key)</label>
                        <input
                            type="password"
                            value={activeConfig.apiKey}
                            onChange={e => setActiveConfig({ ...activeConfig, apiKey: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            placeholder={mode === 'cloud' ? "sk-..." : "EMPTY (for local models)"}
                        />
                    </div>

                    {mode === 'local' && (
                        <div className="pt-4 border-t border-slate-700/50 mt-6">
                            <h3 className="text-lg font-semibold text-slate-200 mb-4">本地部署工具</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <button className="flex items-center justify-center gap-2 p-4 bg-slate-900 border border-slate-700 hover:border-emerald-500/50 rounded-xl transition-all group">
                                    <Download size={20} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                                    <div className="text-left">
                                        <div className="text-slate-200 font-medium">安装 vLLM</div>
                                        <div className="text-xs text-slate-500">Fast inference engine</div>
                                    </div>
                                </button>
                                <button className="flex items-center justify-center gap-2 p-4 bg-slate-900 border border-slate-700 hover:border-purple-500/50 rounded-xl transition-all group">
                                    <Download size={20} className="text-purple-500 group-hover:scale-110 transition-transform" />
                                    <div className="text-left">
                                        <div className="text-slate-200 font-medium">安装 SGLang</div>
                                        <div className="text-xs text-slate-500">Structured generation</div>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="mt-8 flex flex-col gap-6">
                    <div className="flex justify-end gap-4">
                        <button
                            onClick={handleTest}
                            disabled={testStatus === 'testing'}
                            className={`
                                flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all shadow-lg active:scale-95 disabled:opacity-70 disabled:scale-100
                                bg-slate-700 hover:bg-slate-600 text-white shadow-slate-900/20
                            `}
                        >
                            <Terminal size={20} className={testStatus === 'testing' ? 'animate-spin' : ''} />
                            {testStatus === 'testing' ? '测试中...' : '测试配置'}
                        </button>

                        <button
                            onClick={handleSave}
                            disabled={saveStatus === 'saving' || saveStatus === 'success'}
                            className={`
                                flex items-center gap-2 px-8 py-3 rounded-xl font-medium transition-all shadow-lg active:scale-95 disabled:opacity-100 disabled:scale-100
                                ${saveStatus === 'success' ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25' :
                                    saveStatus === 'error' ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/25' :
                                        'bg-blue-600 hover:bg-blue-500 text-white hover:shadow-blue-500/25'}
                            `}
                        >
                            <Save size={20} className={saveStatus === 'saving' ? 'animate-spin' : ''} />
                            {saveStatus === 'idle' && '保存配置'}
                            {saveStatus === 'saving' && '保存中...'}
                            {saveStatus === 'success' && '保存成功!'}
                            {saveStatus === 'error' && '保存失败'}
                        </button>
                    </div>

                    {testResult && (
                        <div className="bg-slate-950 rounded-xl border border-slate-800 p-6 animate-in fade-in slide-in-from-top-4 duration-300">
                            <h3 className="text-slate-200 font-semibold mb-3 flex items-center gap-2">
                                <Terminal size={18} className="text-purple-400" />
                                测试结果 ({mode === 'cloud' ? '云端' : '本地'})
                            </h3>
                            <pre className="font-mono text-sm text-slate-300 whitespace-pre-wrap bg-slate-900/50 p-4 rounded-lg border border-slate-800/50">
                                {testResult}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
