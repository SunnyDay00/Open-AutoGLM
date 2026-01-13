import { useState, useEffect } from 'react'
import { Save, Cloud, Server, Cpu, Download, Terminal } from 'lucide-react'

export default function SettingsView() {
    const [mode, setMode] = useState<'cloud' | 'local'>('cloud')
    const [config, setConfig] = useState({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        modelName: 'autoglm-phone',
        apiKey: ''
    })

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/settings')
                if (res.ok) {
                    const data = await res.json()
                    setConfig({
                        baseUrl: data.base_url,
                        modelName: data.model_name,
                        apiKey: data.api_key
                    })
                    // Guess mode based on URL or let user switch naturally
                    if (data.base_url.includes('localhost') || data.base_url.includes('127.0.0.1')) {
                        setMode('local')
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
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    base_url: config.baseUrl,
                    model_name: config.modelName,
                    api_key: config.apiKey
                })
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

    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle')
    const [testResult, setTestResult] = useState<string>('')

    const handleTest = async () => {
        setTestStatus('testing')
        setTestResult('')
        try {
            const res = await fetch('/api/test_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    base_url: config.baseUrl,
                    model_name: config.modelName,
                    api_key: config.apiKey
                })
            })
            const data = await res.json()
            setTestResult(data.result)
        } catch (e) {
            setTestResult(`连接错误: ${e}`)
        } finally {
            setTestStatus('idle')
        }
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
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">基本 URL (Base URL)</label>
                        <input
                            type="text"
                            value={config.baseUrl}
                            onChange={e => setConfig({ ...config, baseUrl: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            placeholder="https://api.example.com/v1"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">模型名称 (Model Name)</label>
                        <input
                            type="text"
                            value={config.modelName}
                            onChange={e => setConfig({ ...config, modelName: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            placeholder="autoglm-phone-9b"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">API 密钥 (API Key)</label>
                        <input
                            type="password"
                            value={config.apiKey}
                            onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                            placeholder="sk-..."
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
                                测试结果
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
