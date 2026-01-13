import { useState, useEffect } from 'react'
import { Smartphone, RefreshCw, Unplug, Check, MousePointerClick } from 'lucide-react'

export default function DevicesView() {
    const [devices, setDevices] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)

    // Need to fetch current settings to know which device is selected
    // We can assume there's an API for this now
    const fetchSettings = async () => {
        try {
            const res = await fetch('/api/settings')
            const data = await res.json()
            setCurrentDeviceId(data.device_id)
        } catch (e) {
            console.error(e)
        }
    }

    const fetchDevices = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/devices')
            const data = await res.json()
            setDevices(data.devices || [])
            await fetchSettings()
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const selectDevice = async (deviceId: string) => {
        // First get current settings to preserve other values
        try {
            const res = await fetch('/api/settings')
            const currentSettings = await res.json()

            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...currentSettings,
                    device_id: deviceId
                })
            })
            setCurrentDeviceId(deviceId)
        } catch (e) {
            console.error(e)
            alert("选择设备失败")
        }
    }

    useEffect(() => {
        fetchDevices()
    }, [])

    return (
        <div className="flex flex-col h-full bg-slate-900 p-8">
            <div className="max-w-4xl mx-auto w-full">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
                        <Smartphone className="text-blue-500" />
                        已连接设备
                    </h2>
                    <button
                        onClick={fetchDevices}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        刷新
                    </button>
                </div>

                <div className="grid gap-4">
                    {devices.length === 0 && !loading && (
                        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-12 text-center text-slate-400">
                            <Unplug size={48} className="mx-auto mb-4 opacity-50" />
                            <p className="text-lg">未连接任何设备</p>
                            <p className="text-sm mt-2 opacity-70">请通过 USB 连接手机并开启调试模式</p>
                        </div>
                    )}

                    {devices.map(device => {
                        const isSelected = currentDeviceId === device
                        return (
                            <div
                                key={device}
                                className={`
                        bg-slate-800 border rounded-xl p-6 flex items-center justify-between transition-all
                        ${isSelected ? 'border-blue-500 ring-1 ring-blue-500 bg-slate-800/80' : 'border-slate-700 hover:border-slate-600'}
                    `}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isSelected ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700/50 text-slate-300'}`}>
                                        <Smartphone size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
                                            {device}
                                            {isSelected && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">活跃</span>}
                                        </h3>
                                        <div className="text-sm text-emerald-400 flex items-center gap-1.5 mt-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            在线
                                        </div>
                                    </div>
                                </div>

                                {!isSelected && (
                                    <button
                                        onClick={() => selectDevice(device)}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-blue-600 hover:text-white rounded-lg text-slate-300 transition-colors font-medium text-sm"
                                    >
                                        <MousePointerClick size={16} />
                                        选择
                                    </button>
                                )}

                                {isSelected && (
                                    <div className="flex items-center gap-2 px-4 py-2 text-blue-400 font-medium text-sm">
                                        <Check size={16} />
                                        已选择
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
