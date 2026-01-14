import { useState, useEffect } from 'react'
import { Save, Cloud, Server, Settings as SettingsIcon, Plus, Trash2, Edit3, Check, X, FolderOpen, List, Smartphone } from 'lucide-react'

interface Profile {
    name: string
    created_at: string
    mode: 'cloud' | 'local'
    cloud: { base_url: string; model_name: string; api_key: string }
    local: { base_url: string; model_name: string; api_key: string }
    agent: { max_steps: number; screenshot_path: string; verbose: boolean }
    conversation_prefix: string
}

interface GlobalSettings {
    last_selected_device: string
    check_device_on_startup: boolean
    language: string
    manual_screenshot_path: string
}

export default function SettingsView() {
    // Profile list state
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [selectedProfileName, setSelectedProfileName] = useState<string>('')
    const [isCreating, setIsCreating] = useState(false)
    const [newProfileName, setNewProfileName] = useState('')
    const [renamingProfile, setRenamingProfile] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')

    // Current profile editing state
    const [mode, setMode] = useState<'cloud' | 'local'>('cloud')
    const [cloudConfig, setCloudConfig] = useState({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        modelName: 'autoglm-phone',
        apiKey: ''
    })
    const [localConfig, setLocalConfig] = useState({
        baseUrl: 'http://localhost:11434/v1',
        modelName: 'local-model',
        apiKey: ''
    })
    const [agentConfig, setAgentConfig] = useState({
        maxSteps: 100,
        verbose: false,
        screenshotSavePath: ''
    })
    const [conversationPrefix, setConversationPrefix] = useState('')

    // Global settings state
    const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
        last_selected_device: '',
        check_device_on_startup: true,
        language: 'cn',
        manual_screenshot_path: ''
    })

    // UI state
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle')
    const [testResult, setTestResult] = useState('')
    const [showAppsModal, setShowAppsModal] = useState(false)
    const [appsList, setAppsList] = useState<string[]>([])
    const [loadingApps, setLoadingApps] = useState(false)

    // Load profiles and global settings on mount
    useEffect(() => {
        fetchProfiles()
        fetchGlobalSettings()
    }, [])

    const fetchProfiles = async () => {
        try {
            const res = await fetch('/api/profiles')
            const data = await res.json()
            const loadedProfiles = data.profiles || []
            setProfiles(loadedProfiles)

            // Select first profile if none selected
            if (loadedProfiles.length > 0 && !selectedProfileName) {
                // Use the object directly to avoid state closure issues
                loadProfileData(loadedProfiles[0])
            }
        } catch (e) {
            console.error('Failed to load profiles', e)
        }
    }

    const fetchGlobalSettings = async () => {
        try {
            const res = await fetch('/api/global-settings')
            const data = await res.json()
            setGlobalSettings(data)
        } catch (e) {
            console.error('Failed to load global settings', e)
        }
    }

    const saveGlobalSettings = async (newSettings: GlobalSettings) => {
        try {
            await fetch('/api/global-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings)
            })
            setGlobalSettings(newSettings)
        } catch (e) {
            console.error('Failed to save global settings', e)
        }
    }

    const loadProfileData = (profile: Profile) => {
        setSelectedProfileName(profile.name)
        setMode(profile.mode || 'cloud')
        setCloudConfig({
            baseUrl: profile.cloud?.base_url || '',
            modelName: profile.cloud?.model_name || '',
            apiKey: profile.cloud?.api_key || ''
        })
        setLocalConfig({
            baseUrl: profile.local?.base_url || '',
            modelName: profile.local?.model_name || '',
            apiKey: profile.local?.api_key || ''
        })
        setAgentConfig({
            maxSteps: profile.agent?.max_steps || 100,
            verbose: profile.agent?.verbose || false,
            screenshotSavePath: profile.agent?.screenshot_path || ''
        })
        setConversationPrefix(profile.conversation_prefix || '')
    }

    const selectProfile = async (name: string) => {
        const profile = profiles.find(p => p.name === name)
        if (profile) {
            loadProfileData(profile)
        } else {
            // Fetch from API if not in local state
            try {
                const res = await fetch(`/api/profiles/${encodeURIComponent(name)}`)
                if (res.ok) {
                    const p = await res.json()
                    loadProfileData(p)
                }
            } catch (e) {
                console.error('Failed to load profile details', e)
            }
        }
    }

    const createProfile = async () => {
        if (!newProfileName.trim()) return

        try {
            const res = await fetch('/api/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newProfileName.trim() })
            })
            if (res.ok) {
                await fetchProfiles()
                setSelectedProfileName(newProfileName.trim())
                selectProfile(newProfileName.trim())
            } else {
                const err = await res.json()
                alert(err.detail || '创建失败')
            }
        } catch (e) {
            alert('创建配置文件失败')
        }
        setIsCreating(false)
        setNewProfileName('')
    }

    const deleteProfile = async (name: string) => {
        if (!confirm(`确定删除配置文件 "${name}" 吗？`)) return

        try {
            const res = await fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' })
            if (res.ok) {
                await fetchProfiles()
                if (selectedProfileName === name) {
                    setSelectedProfileName('')
                }
            }
        } catch (e) {
            alert('删除失败')
        }
    }

    const renameProfile = async (oldName: string) => {
        if (!renameValue.trim() || renameValue === oldName) {
            setRenamingProfile(null)
            return
        }

        try {
            const res = await fetch(`/api/profiles/${encodeURIComponent(oldName)}/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_name: renameValue.trim() })
            })
            if (res.ok) {
                await fetchProfiles()
                if (selectedProfileName === oldName) {
                    setSelectedProfileName(renameValue.trim())
                }
            } else {
                const err = await res.json()
                alert(err.detail || '重命名失败')
            }
        } catch (e) {
            alert('重命名失败')
        }
        setRenamingProfile(null)
    }

    const saveProfile = async () => {
        if (!selectedProfileName) return

        setSaveStatus('saving')
        try {
            const res = await fetch(`/api/profiles/${encodeURIComponent(selectedProfileName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
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
                    agent: {
                        max_steps: agentConfig.maxSteps,
                        screenshot_path: agentConfig.screenshotSavePath,
                        verbose: agentConfig.verbose
                    },
                    conversation_prefix: conversationPrefix
                })
            })

            if (res.ok) {
                setSaveStatus('success')
                await fetchProfiles()
            } else {
                setSaveStatus('error')
            }
        } catch (e) {
            setSaveStatus('error')
        }
        setTimeout(() => setSaveStatus('idle'), 2000)
    }

    const handleTest = async () => {
        setTestStatus('testing')
        setTestResult('')
        try {
            const res = await fetch('/api/test_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    cloud: { base_url: cloudConfig.baseUrl, model_name: cloudConfig.modelName, api_key: cloudConfig.apiKey },
                    local: { base_url: localConfig.baseUrl, model_name: localConfig.modelName, api_key: localConfig.apiKey }
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

    const handleSelectFolder = async () => {
        try {
            const res = await fetch('/api/tools/select_folder', { method: 'POST' })
            const data = await res.json()
            if (data.status === 'success' && data.path) {
                setAgentConfig(prev => ({ ...prev, screenshotSavePath: data.path }))
            }
        } catch (e) {
            console.error('Failed to select folder', e)
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
            setAppsList(['获取失败'])
        } finally {
            setLoadingApps(false)
        }
    }

    const activeConfig = mode === 'cloud' ? cloudConfig : localConfig
    const setActiveConfig = (c: typeof cloudConfig) => {
        if (mode === 'cloud') setCloudConfig(c)
        else setLocalConfig(c)
    }

    return (
        <div className="flex h-full bg-slate-900">
            {/* Left Sidebar: Profile List */}
            <div className="w-64 border-r border-slate-800 flex flex-col">
                <div className="p-4 border-b border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">配置文件</h3>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {profiles.map(profile => (
                        <div
                            key={profile.name}
                            className={`group flex items-center gap-2 px-4 py-3 cursor-pointer transition-colors ${selectedProfileName === profile.name
                                ? 'bg-blue-600/20 border-l-2 border-blue-500'
                                : 'hover:bg-slate-800 border-l-2 border-transparent'
                                }`}
                            onClick={() => selectProfile(profile.name)}
                        >
                            {renamingProfile === profile.name ? (
                                <div className="flex-1 flex items-center gap-1">
                                    <input
                                        type="text"
                                        value={renameValue}
                                        onChange={e => setRenameValue(e.target.value)}
                                        className="flex-1 bg-slate-700 rounded px-2 py-1 text-sm text-white border border-blue-500"
                                        autoFocus
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') renameProfile(profile.name)
                                            if (e.key === 'Escape') setRenamingProfile(null)
                                        }}
                                        onClick={e => e.stopPropagation()}
                                    />
                                    <button
                                        onClick={e => { e.stopPropagation(); renameProfile(profile.name) }}
                                        className="p-1.5 text-green-400 hover:bg-green-500/20 rounded"
                                    >
                                        <Check size={14} />
                                    </button>
                                    <button
                                        onClick={e => { e.stopPropagation(); setRenamingProfile(null) }}
                                        className="p-1.5 text-slate-400 hover:bg-slate-600 rounded"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <SettingsIcon size={16} className="text-slate-400 flex-shrink-0" />
                                    <span className="flex-1 text-sm text-slate-200 truncate">{profile.name}</span>
                                    <button
                                        onClick={e => {
                                            e.stopPropagation()
                                            setRenamingProfile(profile.name)
                                            setRenameValue(profile.name)
                                        }}
                                        className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-slate-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="重命名"
                                    >
                                        <Edit3 size={14} />
                                    </button>
                                    <button
                                        onClick={e => { e.stopPropagation(); deleteProfile(profile.name) }}
                                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="删除"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                {/* Create new profile */}
                <div className="p-3 border-t border-slate-800">
                    {isCreating ? (
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={newProfileName}
                                onChange={e => setNewProfileName(e.target.value)}
                                placeholder="输入配置文件名称..."
                                className="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-400 border border-blue-500 focus:outline-none"
                                autoFocus
                                onKeyDown={e => {
                                    if (e.key === 'Enter') createProfile()
                                    if (e.key === 'Escape') { setIsCreating(false); setNewProfileName('') }
                                }}
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={createProfile}
                                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    创建
                                </button>
                                <button
                                    onClick={() => { setIsCreating(false); setNewProfileName('') }}
                                    className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsCreating(true)}
                            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors border border-dashed border-blue-500/30 hover:border-blue-500/60"
                        >
                            <Plus size={16} />
                            新建配置文件
                        </button>
                    )}
                </div>
            </div>

            {/* Right Panel: Profile Editor */}
            <div className="flex-1 overflow-y-auto p-6">
                {selectedProfileName ? (
                    <div className="max-w-3xl mx-auto space-y-6">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-100">
                                编辑: {selectedProfileName}
                            </h2>
                            <button
                                onClick={saveProfile}
                                disabled={saveStatus === 'saving'}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${saveStatus === 'success' ? 'bg-green-600 text-white' :
                                    saveStatus === 'error' ? 'bg-red-600 text-white' :
                                        'bg-blue-600 hover:bg-blue-500 text-white'
                                    }`}
                            >
                                <Save size={16} />
                                {saveStatus === 'saving' ? '保存中...' :
                                    saveStatus === 'success' ? '已保存' :
                                        saveStatus === 'error' ? '保存失败' : '保存配置'}
                            </button>
                        </div>

                        {/* Mode Switcher */}
                        <div className="bg-slate-800 p-1 rounded-xl flex">
                            <button
                                onClick={() => setMode('cloud')}
                                className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${mode === 'cloud' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700'
                                    }`}
                            >
                                <Cloud size={18} />
                                云 API
                            </button>
                            <button
                                onClick={() => setMode('local')}
                                className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${mode === 'local' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700'
                                    }`}
                            >
                                <Server size={18} />
                                本地模型
                            </button>
                        </div>

                        {/* Model Config */}
                        <div className="bg-slate-800/50 rounded-xl p-6 space-y-4">
                            <h3 className="text-lg font-semibold text-slate-200">模型配置</h3>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">基本 URL</label>
                                <input
                                    type="text"
                                    value={activeConfig.baseUrl}
                                    onChange={e => setActiveConfig({ ...activeConfig, baseUrl: e.target.value })}
                                    className="w-full bg-slate-700 rounded-lg px-4 py-2 text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">模型名称</label>
                                <input
                                    type="text"
                                    value={activeConfig.modelName}
                                    onChange={e => setActiveConfig({ ...activeConfig, modelName: e.target.value })}
                                    className="w-full bg-slate-700 rounded-lg px-4 py-2 text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">API Key</label>
                                <input
                                    type="password"
                                    value={activeConfig.apiKey}
                                    onChange={e => setActiveConfig({ ...activeConfig, apiKey: e.target.value })}
                                    className="w-full bg-slate-700 rounded-lg px-4 py-2 text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">对话前置内容</label>
                                <textarea
                                    value={conversationPrefix}
                                    onChange={e => setConversationPrefix(e.target.value)}
                                    rows={3}
                                    className="w-full bg-slate-700 rounded-lg px-4 py-2 text-slate-200 resize-none border border-slate-600 focus:border-blue-500 focus:outline-none"
                                    placeholder="每次对话前自动添加的指令..."
                                />
                            </div>

                            <div className="flex gap-3">
                                <button onClick={handleTest} disabled={testStatus === 'testing'}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 transition-colors border border-slate-600">
                                    {testStatus === 'testing' ? '测试中...' : '测试连接'}
                                </button>
                            </div>
                            {testResult && (
                                <div className={`text-sm p-3 rounded-lg ${testResult.includes('成功') ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                                    {testResult}
                                </div>
                            )}
                        </div>

                        {/* Agent Config */}
                        <div className="bg-slate-800/50 rounded-xl p-6 space-y-4">
                            <h3 className="text-lg font-semibold text-slate-200">Agent 配置</h3>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">最大步数</label>
                                    <input
                                        type="number"
                                        value={agentConfig.maxSteps}
                                        onChange={e => setAgentConfig({ ...agentConfig, maxSteps: parseInt(e.target.value) || 100 })}
                                        className="w-full bg-slate-700 rounded-lg px-4 py-2 text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">调试模式</label>
                                    <select
                                        value={agentConfig.verbose ? 'on' : 'off'}
                                        onChange={e => setAgentConfig({ ...agentConfig, verbose: e.target.value === 'on' })}
                                        className="w-full bg-slate-700 rounded-lg px-4 py-2 text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="off">关闭</option>
                                        <option value="on">开启</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">截图保存路径</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={agentConfig.screenshotSavePath}
                                        onChange={e => setAgentConfig({ ...agentConfig, screenshotSavePath: e.target.value })}
                                        className="flex-1 bg-slate-700 rounded-lg px-4 py-2 text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                    />
                                    <button onClick={handleSelectFolder} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg border border-slate-600">
                                        <FolderOpen size={18} className="text-slate-300" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Global Settings */}
                        <div className="bg-slate-800/50 rounded-xl p-6 space-y-4">
                            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                                <SettingsIcon size={20} />
                                全局设置
                            </h3>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                                    <div>
                                        <div className="text-sm text-slate-200 font-medium">启动时检测设备连接</div>
                                        <div className="text-xs text-slate-400 mt-0.5">自动检测最近选中的设备是否在线</div>
                                    </div>
                                    <button
                                        onClick={() => saveGlobalSettings({ ...globalSettings, check_device_on_startup: !globalSettings.check_device_on_startup })}
                                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${globalSettings.check_device_on_startup
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-slate-600 text-slate-300'
                                            }`}
                                    >
                                        {globalSettings.check_device_on_startup ? '已开启' : '已关闭'}
                                    </button>
                                </div>

                                {globalSettings.last_selected_device && (
                                    <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                                        <div>
                                            <div className="text-sm text-slate-200 font-medium">最近选中的设备</div>
                                            <div className="text-xs text-slate-400 font-mono mt-0.5">{globalSettings.last_selected_device}</div>
                                        </div>
                                        <Smartphone size={18} className="text-slate-400" />
                                    </div>
                                )}

                                <div className="p-3 bg-slate-700/50 rounded-lg">
                                    <div className="text-sm text-slate-200 font-medium mb-2">手动截图存储路径</div>
                                    <div className="text-xs text-slate-400 mb-2">设备截图功能的保存位置</div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={globalSettings.manual_screenshot_path}
                                            onChange={e => setGlobalSettings({ ...globalSettings, manual_screenshot_path: e.target.value })}
                                            placeholder="默认: 项目根目录/截图"
                                            className="flex-1 bg-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                        />
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const res = await fetch('/api/tools/select_folder', { method: 'POST' })
                                                    const data = await res.json()
                                                    if (data.status === 'success' && data.path) {
                                                        const newSettings = { ...globalSettings, manual_screenshot_path: data.path }
                                                        saveGlobalSettings(newSettings)
                                                    }
                                                } catch (e) { console.error(e) }
                                            }}
                                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg border border-slate-600"
                                        >
                                            <FolderOpen size={16} className="text-slate-300" />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <button onClick={fetchApps} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 border border-slate-600 transition-colors">
                                        <List size={16} />
                                        查看支持的应用
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <SettingsIcon size={48} className="mb-4 opacity-30" />
                        <p>请选择或创建一个配置文件</p>
                    </div>
                )}
            </div>

            {/* Apps Modal - Improved */}
            {showAppsModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAppsModal(false)}>
                    <div className="bg-slate-800 rounded-2xl w-[500px] max-h-[70vh] flex flex-col shadow-2xl border border-slate-700" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-slate-700">
                            <h3 className="text-lg font-bold text-slate-100">支持的应用列表</h3>
                            <button onClick={() => setShowAppsModal(false)} className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                            {loadingApps ? (
                                <div className="text-slate-400 text-center py-8">加载中...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    {appsList.map((app, i) => (
                                        <div key={i} className="text-sm text-slate-300 py-2 px-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors">
                                            {app}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-700">
                            <div className="text-xs text-slate-500 text-center">共 {appsList.length} 个应用</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
