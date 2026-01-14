import { useEffect, useState, useRef } from 'react'
import { Terminal, Download, Eraser } from 'lucide-react'

import { useDeviceContext } from '../App'

export default function LogView() {
    const { urlDeviceId } = useDeviceContext()
    const [logs, setLogs] = useState<string[]>([])
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // Connect to WebSocket dynamically based on current host
        // This works for both direct access and partial proxying if configured correctly
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        // Add device_id to websocket query params if present
        const search = urlDeviceId ? `?device_id=${encodeURIComponent(urlDeviceId)}` : ''
        const wsUrl = `${protocol}//${window.location.host}/ws/logs${search}`

        console.log("Connecting to WebSocket at:", wsUrl)
        const ws = new WebSocket(wsUrl)

        ws.onmessage = (event: MessageEvent) => {
            setLogs(prev => [...prev.slice(-1000), event.data])
        }

        ws.onopen = () => {
            console.log("WebSocket connected")
        }

        ws.onerror = (e) => {
            console.error("WebSocket error:", e)
        }

        return () => {
            ws.close()
        }
    }, [urlDeviceId])

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logs])

    return (
        <div className="flex flex-col h-full bg-slate-950 font-mono text-sm">
            <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 font-sans">
                    <Terminal className="text-green-500" size={20} />
                    系统日志
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={() => setLogs([])}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                        title="清空日志"
                    >
                        <Eraser size={18} />
                    </button>
                    <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors" title="导出">
                        <Download size={18} />
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-auto p-4 space-y-1">
                {logs.length === 0 && (
                    <div className="text-slate-600 text-center mt-20 italic font-sans">等待日志...</div>
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
