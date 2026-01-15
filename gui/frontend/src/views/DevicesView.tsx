import { useState, useEffect } from 'react'
import { Smartphone, RefreshCw, Unplug, Check, Settings, AlertCircle, ChevronDown, X, Info } from 'lucide-react'
import { useDeviceContext } from '../App'

interface DeviceInfo {
    device_id: string
    model: string
    brand: string
    android_version: string
    sdk_version: string
    android_id: string
    resolution: string
    density: string
    connected: boolean
    error_message: string
    assigned_profile?: string
}

interface Profile {
    name: string
}



export default function DevicesView() {
    const { setUrlDeviceId } = useDeviceContext()
    const [devices, setDevices] = useState<DeviceInfo[]>([])
    const [loading, setLoading] = useState(false)
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
    const [showDetailModal, setShowDetailModal] = useState<DeviceInfo | null>(null)



    const [openDropdown, setOpenDropdown] = useState<string | null>(null)

    // Fetch detailed device list
    const fetchDevices = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/devices/detailed')
            const data = await res.json()
            setDevices(data.devices || [])
        } catch (e) {
            console.error('Failed to fetch devices', e)
        } finally {
            setLoading(false)
        }
    }

    // Fetch profiles for dropdown
    const fetchProfiles = async () => {
        try {
            const res = await fetch('/api/profiles')
            const data = await res.json()
            setProfiles(data.profiles || [])
        } catch (e) {
            console.error('Failed to fetch profiles', e)
        }
    }

    // Fetch global settings for current device
    const fetchGlobalSettings = async () => {
        try {
            const res = await fetch('/api/global-settings')
            const data = await res.json()
            const deviceId = data.last_selected_device || null
            setCurrentDeviceId(deviceId)
            // Also update URL parameter if device is already selected
            if (deviceId) {
                setUrlDeviceId(deviceId)
            }
        } catch (e) {
            console.error('Failed to fetch global settings', e)
        }
    }

    useEffect(() => {
        fetchDevices()
        fetchProfiles()
        fetchGlobalSettings()
    }, [])



    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setOpenDropdown(null)
        if (openDropdown) {
            document.addEventListener('click', handleClickOutside)
            return () => document.removeEventListener('click', handleClickOutside)
        }
    }, [openDropdown])

    const selectDevice = async (deviceId: string) => {
        try {
            await fetch('/api/global-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    last_selected_device: deviceId,
                    check_device_on_startup: true,
                    language: 'cn'
                })
            })
            setCurrentDeviceId(deviceId)
            // Update URL parameter for multi-device support
            setUrlDeviceId(deviceId)
        } catch (e) {
            console.error('Failed to select device', e)
            alert('选择设备失败')
        }
    }

    const bindProfile = async (deviceId: string, profileName: string) => {
        try {
            const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile_name: profileName })
            })
            if (res.ok) {
                // Refresh list to see update
                fetchDevices()
            }
        } catch (e) {
            console.error('Failed to bind profile', e)
        }
        setOpenDropdown(null)
    }

    return (
        <div className="flex flex-col h-full bg-slate-900 p-8 overflow-y-auto">
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
                            <p className="text-sm mt-2 opacity-70">请通过 USB 或网络连接手机并开启调试模式</p>
                        </div>
                    )}

                    {devices.map(device => {
                        const isSelected = currentDeviceId === device.device_id
                        const boundProfile = device.assigned_profile
                        const hasProfile = !!boundProfile

                        return (
                            <div
                                key={device.device_id}
                                className={`bg-slate-800 border rounded-xl p-5 transition-all ${isSelected
                                    ? 'border-blue-500 ring-1 ring-blue-500'
                                    : device.connected
                                        ? 'border-slate-700 hover:border-slate-600'
                                        : 'border-red-500/30 bg-red-900/10'
                                    }`}
                            >
                                <div className="flex items-start justify-between">
                                    {/* Device Info */}
                                    <div className="flex items-start gap-4">
                                        {/* Clickable Device Icon */}
                                        <button
                                            onClick={() => setShowDetailModal(device)}
                                            className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 cursor-pointer ${isSelected ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' :
                                                device.connected ? 'bg-slate-700/50 text-slate-300 hover:bg-slate-700' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                                }`}
                                            title="点击查看设备详情"
                                        >
                                            <Smartphone size={28} />
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            {/* Model Name */}
                                            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
                                                {device.brand} {device.model}
                                                {isSelected && (
                                                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">
                                                        活跃
                                                    </span>
                                                )}
                                            </h3>

                                            {/* Device ID */}
                                            <div className="text-sm text-slate-400 font-mono mt-0.5">
                                                {device.device_id}
                                            </div>

                                            {/* Details Row */}
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                                                <span>{device.resolution}</span>
                                                <span>Android {device.android_version}</span>
                                                <span className="font-mono">ID: {device.android_id?.substring(0, 12) || 'N/A'}...</span>
                                            </div>

                                            {/* Connection Status */}
                                            <div className={`flex items-center gap-1.5 mt-2 text-sm ${device.connected ? 'text-emerald-400' : 'text-red-400'
                                                }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${device.connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                                                    }`} />
                                                {device.connected ? '在线' : '离线'}
                                                {device.error_message && (
                                                    <span className="text-xs text-red-400 ml-2">({device.error_message})</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex flex-col items-end gap-2">
                                        {/* Profile Dropdown */}
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setOpenDropdown(openDropdown === device.device_id ? null : device.device_id)}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${hasProfile
                                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                    : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                                    }`}
                                            >
                                                <Settings size={14} />
                                                {hasProfile ? boundProfile : '选择配置'}
                                                <ChevronDown size={14} />
                                            </button>

                                            {openDropdown === device.device_id && (
                                                <div className="absolute right-0 top-full mt-1 w-48 bg-slate-700 rounded-lg shadow-xl border border-slate-600 z-10 py-1">
                                                    <button
                                                        onClick={() => bindProfile(device.device_id, '')}
                                                        className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
                                                    >
                                                        <span className="text-slate-500">无配置文件</span>
                                                    </button>
                                                    {profiles.map(p => (
                                                        <button
                                                            key={p.name}
                                                            onClick={() => bindProfile(device.device_id, p.name)}
                                                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-600 ${boundProfile === p.name ? 'text-blue-400 bg-blue-500/10' : 'text-slate-300'
                                                                }`}
                                                        >
                                                            {p.name}
                                                            {boundProfile === p.name && <Check size={14} className="inline ml-2" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Select Button */}
                                        {device.connected && (
                                            isSelected ? (
                                                <div className="flex items-center gap-2 px-4 py-2 text-blue-400 font-medium text-sm">
                                                    <Check size={16} />
                                                    已选择
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => selectDevice(device.device_id)}
                                                    disabled={!hasProfile}
                                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${hasProfile
                                                        ? 'bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-300'
                                                        : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                                                        }`}
                                                    title={!hasProfile ? '请先选择配置文件' : ''}
                                                >
                                                    选择
                                                </button>
                                            )
                                        )}
                                    </div>
                                </div>

                                {/* Warning if no profile */}
                                {device.connected && !hasProfile && (
                                    <div className="mt-3 p-2 bg-orange-500/10 border border-orange-500/20 rounded-lg flex items-center gap-2 text-sm text-orange-400">
                                        <AlertCircle size={14} />
                                        请为此设备选择配置文件后才能使用
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Device Detail Modal */}
            {showDetailModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowDetailModal(null)}>
                    <div className="bg-slate-800 rounded-2xl w-[480px] shadow-2xl border border-slate-700" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-slate-700">
                            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                                <Info size={20} className="text-blue-400" />
                                设备详细信息
                            </h3>
                            <button onClick={() => setShowDetailModal(null)} className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <DetailRow label="设备型号" value={`${showDetailModal.brand} ${showDetailModal.model}`} />
                            <DetailRow label="设备 ID" value={showDetailModal.device_id} mono />
                            <DetailRow label="Android ID" value={showDetailModal.android_id || 'N/A'} mono />
                            <DetailRow label="Android 版本" value={showDetailModal.android_version} />
                            <DetailRow label="SDK 版本" value={showDetailModal.sdk_version} />
                            <DetailRow label="分辨率" value={showDetailModal.resolution} />
                            <DetailRow label="屏幕密度" value={showDetailModal.density} />
                            <DetailRow
                                label="连接状态"
                                value={showDetailModal.connected ? '在线' : '离线'}
                                valueClassName={showDetailModal.connected ? 'text-green-400' : 'text-red-400'}
                            />
                            {showDetailModal.error_message && (
                                <DetailRow label="错误信息" value={showDetailModal.error_message} valueClassName="text-red-400" />
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-700 flex justify-end">
                            <button
                                onClick={() => setShowDetailModal(null)}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 text-sm transition-colors"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function DetailRow({ label, value, mono, valueClassName }: { label: string; value: string; mono?: boolean; valueClassName?: string }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0">
            <span className="text-sm text-slate-400">{label}</span>
            <span className={`text-sm text-slate-200 ${mono ? 'font-mono' : ''} ${valueClassName || ''}`}>{value}</span>
        </div>
    )
}
