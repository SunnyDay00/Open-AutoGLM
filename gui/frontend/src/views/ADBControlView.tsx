import { useState, useEffect } from 'react'
import { Terminal, RotateCw, Package, Camera, Smartphone } from 'lucide-react'

export default function ADBControlView() {
    const [deviceId, setDeviceId] = useState<string>('Unknown')
    const [deviceConnected, setDeviceConnected] = useState<boolean>(false)
    const [loading, setLoading] = useState<{ [key: string]: boolean }>({})

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch('/api/status')
                const data = await res.json()
                if (data.device_id) setDeviceId(data.device_id)
                if (data.device_connected !== undefined) setDeviceConnected(data.device_connected)
            } catch (e) {
                console.error('Failed to fetch status:', e)
            }
        }

        fetchStatus()
        const interval = setInterval(fetchStatus, 5000)
        return () => clearInterval(interval)
    }, [])

    const handleReboot = async () => {
        if (!deviceConnected) {
            alert('设备未连接！')
            return
        }

        if (!confirm('确定要重启设备吗？命令窗口将打开，请手动确认执行。')) return

        setLoading({ ...loading, reboot: true })
        try {
            const res = await fetch('/api/adb/reboot', { method: 'POST' })
            const data = await res.json()

            if (data.status === 'success') {
                alert(`命令已生成：\n${data.command}\n\n请在弹出的CMD窗口中按回车确认执行。`)
            } else {
                alert(`错误: ${data.message}`)
            }
        } catch (error) {
            alert(`请求失败: ${error}`)
        } finally {
            setLoading({ ...loading, reboot: false })
        }
    }

    const handleInstall = async () => {
        if (!deviceConnected) {
            alert('设备未连接！')
            return
        }

        setLoading({ ...loading, install: true })
        try {
            const res = await fetch('/api/adb/install', { method: 'POST' })
            const data = await res.json()

            if (data.status === 'success') {
                alert(`APK路径: ${data.apk_path}\n命令: ${data.command}\n\n请在弹出的CMD窗口中按回车确认执行。`)
            } else if (data.status === 'cancelled') {
                // User cancelled
            } else {
                alert(`错误: ${data.message}`)
            }
        } catch (error) {
            alert(`请求失败: ${error}`)
        } finally {
            setLoading({ ...loading, install: false })
        }
    }

    const handleScreenshot = async () => {
        if (!deviceConnected) {
            alert('设备未连接！')
            return
        }

        setLoading({ ...loading, screenshot: true })
        try {
            const res = await fetch('/api/adb/screenshot', { method: 'POST' })
            const data = await res.json()

            if (data.status === 'success') {
                alert(`截图已保存！\n路径: ${data.path}`)
            } else {
                alert(`截图失败: ${data.message}`)
            }
        } catch (error) {
            alert(`截图失败: ${error}`)
        } finally {
            setLoading({ ...loading, screenshot: false })
        }
    }

    return (
        <div className="h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-800/50">
                <div className="flex items-center gap-3">
                    <Terminal className="text-cyan-500" size={28} />
                    <h1 className="text-2xl font-bold text-slate-100">ADB 控制</h1>
                </div>

                {/* Device Status */}
                <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <Smartphone size={18} className="text-purple-400" />
                    <span className="text-sm text-slate-300 font-mono">{deviceId}</span>
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${deviceConnected
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                        }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${deviceConnected ? 'bg-green-400' : 'bg-orange-400'}`} />
                        {deviceConnected ? '已连接' : '未连接'}
                    </div>
                </div>
            </div>

            {/* Control Cards */}
            <div className="flex-1 p-8 overflow-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                    {/* Reboot Card */}
                    <button
                        onClick={handleReboot}
                        disabled={!deviceConnected || loading.reboot}
                        className="group relative p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700 hover:border-cyan-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                    >
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="p-4 rounded-full bg-cyan-500/10 group-hover:bg-cyan-500/20 transition-colors">
                                <RotateCw size={40} className="text-cyan-500" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-100">重启设备</h3>
                            <p className="text-sm text-slate-400">
                                重新启动连接的设备<br />
                                <span className="text-xs">(需在CMD窗口中手动确认)</span>
                            </p>
                        </div>
                        {loading.reboot && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 rounded-2xl">
                                <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                    </button>

                    {/* Install APK Card */}
                    <button
                        onClick={handleInstall}
                        disabled={!deviceConnected || loading.install}
                        className="group relative p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700 hover:border-purple-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                    >
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="p-4 rounded-full bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
                                <Package size={40} className="text-purple-500" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-100">安装应用</h3>
                            <p className="text-sm text-slate-400">
                                选择APK文件并安装到设备<br />
                                <span className="text-xs">(需在CMD窗口中手动确认)</span>
                            </p>
                        </div>
                        {loading.install && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 rounded-2xl">
                                <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                    </button>

                    {/* Screenshot Card */}
                    <button
                        onClick={handleScreenshot}
                        disabled={!deviceConnected || loading.screenshot}
                        className="group relative p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700 hover:border-green-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                    >
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="p-4 rounded-full bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                                <Camera size={40} className="text-green-500" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-100">设备截图</h3>
                            <p className="text-sm text-slate-400">
                                截取设备屏幕并保存<br />
                                <span className="text-xs">(保存到设置中配置的路径)</span>
                            </p>
                        </div>
                        {loading.screenshot && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 rounded-2xl">
                                <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                    </button>
                </div>

                {/* Help Text */}
                {!deviceConnected && (
                    <div className="mt-8 p-4 rounded-lg bg-orange-500/10 border border-orange-500/20 max-w-2xl mx-auto">
                        <p className="text-sm text-orange-400 text-center">
                            ⚠️ 设备未连接。请先在"设置"中配置设备ID，并确保设备已通过ADB连接。
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
