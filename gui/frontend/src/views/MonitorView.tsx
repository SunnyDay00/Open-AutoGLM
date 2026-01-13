import { useState, useEffect } from 'react'
import { Monitor, RefreshCw, ImageOff } from 'lucide-react'

interface ScreenshotInfo {
    exists: boolean
    url: string | null
    timestamp: number | null
}

export default function MonitorView() {
    const [screenshot, setScreenshot] = useState<ScreenshotInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
    const [autoRefresh, setAutoRefresh] = useState(true)  // Default to ON

    const fetchScreenshot = async () => {
        try {
            const res = await fetch('/api/screenshot/latest')
            const data = await res.json()
            console.log('[MonitorView] API Response:', data)  // Debug log
            setScreenshot(data)
            if (data.exists) {
                setLastUpdate(new Date(data.timestamp * 1000))
            }
            setLoading(false)
        } catch (e) {
            console.error("Failed to fetch screenshot", e)
            setLoading(false)
        }
    }

    // Auto-refresh every 1.5 seconds
    useEffect(() => {
        fetchScreenshot()

        if (autoRefresh) {
            const interval = setInterval(fetchScreenshot, 1500)
            return () => clearInterval(interval)
        }
    }, [autoRefresh])

    const handleManualRefresh = () => {
        setLoading(true)
        fetchScreenshot()
    }

    return (
        <div className="h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-800/50">
                <div className="flex items-center gap-3">
                    <Monitor className="text-purple-500" size={28} />
                    <h1 className="text-2xl font-bold text-slate-100">实时监控</h1>
                </div>

                <div className="flex items-center gap-4">
                    {/* Auto-refresh toggle */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-400">自动刷新</span>
                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`w-12 h-6 rounded-full transition-colors ${autoRefresh ? 'bg-blue-600' : 'bg-slate-700'
                                }`}
                        >
                            <div
                                className={`w-5 h-5 bg-white rounded-full transition-transform ${autoRefresh ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Manual refresh button */}
                    <button
                        onClick={handleManualRefresh}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        刷新
                    </button>

                    {/* Last update time */}
                    {lastUpdate && (
                        <span className="text-sm text-slate-400">
                            更新于: {lastUpdate.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            {/* Screenshot Display */}
            <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
                {loading ? (
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-400">加载中...</p>
                    </div>
                ) : screenshot?.exists ? (
                    <div className="w-full h-full flex items-center justify-center">
                        <img
                            src={`${screenshot.url}?t=${screenshot.timestamp}`}
                            alt="Latest Screenshot"
                            className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg shadow-2xl border-2 border-slate-700"
                            key={screenshot.timestamp}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4 text-slate-500">
                        <ImageOff size={64} />
                        <p className="text-lg">暂无截图</p>
                        <p className="text-sm text-slate-600">请启动 Agent 任务以查看手机屏幕</p>
                    </div>
                )}
            </div>
        </div>
    )
}
