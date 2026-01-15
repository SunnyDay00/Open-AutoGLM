import { useEffect, useState, useRef } from 'react'
import { Terminal, Download, Eraser, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

import { useDeviceContext } from '../App'

export default function LogView() {
    const { urlDeviceId } = useDeviceContext()
    const [logs, setLogs] = useState<string[]>([])
    const [currentDate, setCurrentDate] = useState<string>('')
    const [prevDate, setPrevDate] = useState<string | null>(null)
    const [nextDate, setNextDate] = useState<string | null>(null)
    const [isToday, setIsToday] = useState(true)
    const [availableDates, setAvailableDates] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const endRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)

    // Fetch logs from API
    const fetchLogs = async (date?: string) => {
        if (!urlDeviceId) return

        setLoading(true)
        try {
            const dateParam = date ? `?date=${date}` : ''
            const res = await fetch(`/api/logs/${encodeURIComponent(urlDeviceId)}${dateParam}`)
            const data = await res.json()

            if (data.status === 'success') {
                // Split log content into lines
                const logLines = data.logs ? data.logs.split('\n').filter((l: string) => l.trim()) : []
                setLogs(logLines)
                setCurrentDate(data.current_date)
                setPrevDate(data.prev_date)
                setNextDate(data.next_date)
                setIsToday(data.is_today)
                setAvailableDates(data.available_dates)
            }
        } catch (e) {
            console.error('Failed to fetch logs:', e)
        }
        setLoading(false)
    }

    // Initial load and WebSocket connection
    useEffect(() => {
        if (!urlDeviceId) {
            setLogs([])
            return
        }

        // Fetch today's logs
        fetchLogs()

        // Connect to WebSocket for real-time updates (only for today)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/ws/logs?device_id=${encodeURIComponent(urlDeviceId)}`

        console.log("Connecting to WebSocket at:", wsUrl)
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onmessage = (event: MessageEvent) => {
            // Only append real-time logs if viewing today
            setLogs(prev => {
                // Prevent duplicates from WebSocket replay
                if (prev[prev.length - 1] === event.data) return prev
                return [...prev.slice(-1000), event.data]
            })
        }

        ws.onopen = () => console.log("WebSocket connected")
        ws.onerror = (e) => console.error("WebSocket error:", e)

        return () => {
            ws.close()
            wsRef.current = null
        }
    }, [urlDeviceId])

    // Auto-scroll for today's real-time logs
    useEffect(() => {
        if (isToday) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [logs, isToday])

    // Navigate to previous day
    const goToPrevDay = () => {
        if (prevDate) {
            fetchLogs(prevDate)
        }
    }

    // Navigate to next day
    const goToNextDay = () => {
        if (nextDate) {
            fetchLogs(nextDate)
        }
    }

    // Go back to today
    const goToToday = () => {
        fetchLogs()
    }

    // Show prompt if no device selected
    if (!urlDeviceId) {
        return (
            <div className="flex flex-col h-full bg-slate-950 font-mono text-sm items-center justify-center">
                <Terminal className="text-slate-600 mb-4" size={48} />
                <p className="text-slate-400 text-lg font-sans">请先在设备页面选择一个设备</p>
                <p className="text-slate-600 text-sm font-sans mt-2">日志按设备独立存储</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-slate-950 font-mono text-sm">
            <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 font-sans">
                    <Terminal className="text-green-500" size={20} />
                    设备日志
                </h2>

                {/* Date Navigation */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={goToPrevDay}
                        disabled={loading}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                        title="前一天"
                    >
                        <ChevronLeft size={18} />
                    </button>

                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
                        <Calendar size={14} className="text-slate-400" />
                        <span className="text-slate-200 text-sm font-sans">{currentDate || '加载中...'}</span>
                        {isToday && (
                            <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">今天</span>
                        )}
                    </div>

                    <button
                        onClick={goToNextDay}
                        disabled={loading || isToday}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                        title="下一天"
                    >
                        <ChevronRight size={18} />
                    </button>

                    {!isToday && (
                        <button
                            onClick={goToToday}
                            className="px-3 py-1.5 text-sm text-blue-400 hover:text-blue-300 hover:bg-slate-800 rounded transition-colors font-sans"
                        >
                            回到今天
                        </button>
                    )}
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setLogs([])}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                        title="清空显示"
                    >
                        <Eraser size={18} />
                    </button>
                    <button
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                        title="导出"
                        onClick={() => {
                            const content = logs.join('\n')
                            const blob = new Blob([content], { type: 'text/plain' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${urlDeviceId}_${currentDate}.log`
                            a.click()
                            URL.revokeObjectURL(url)
                        }}
                    >
                        <Download size={18} />
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-auto p-4 space-y-1">
                {loading && (
                    <div className="text-slate-500 text-center mt-10 font-sans">加载中...</div>
                )}
                {!loading && logs.length === 0 && (
                    <div className="text-slate-600 text-center mt-20 italic font-sans">
                        {isToday ? '等待日志...' : '当天无日志记录'}
                    </div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="text-slate-300 break-words whitespace-pre-wrap border-l-2 border-transparent hover:border-slate-700 hover:bg-slate-900/50 pl-2 py-0.5">
                        <span className="text-slate-600 select-none mr-3 text-xs">{(i + 1).toString().padStart(4, '0')}</span>
                        {log}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
        </div>
    )
}
