import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Trash2, Square } from 'lucide-react'

interface Message {
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    time?: string
    duration?: string
    image?: string
}

export default function ChatView() {
    const [input, setInput] = useState('')
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(false)
    const [stopping, setStopping] = useState(false)
    const [isInteractive, setIsInteractive] = useState(true)
    const [isLoopMode, setIsLoopMode] = useState(false)
    const [loopCount, setLoopCount] = useState(1)
    const scrollRef = useRef<HTMLDivElement>(null)

    // Load history from backend on mount
    useEffect(() => {
        fetch('/api/history')
            .then(res => res.json())
            .then(data => {
                if (data.history) {
                    setMessages(data.history)
                }
            })
            .catch(err => console.error("Failed to load history:", err))
    }, [])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages])

    // Poll for status
    const isStreaming = useRef(false);
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();

                // Update stopping status
                if (data.stopping !== undefined) {
                    setStopping(data.stopping);
                }

                setLoading(prev => {
                    // If backend says running, force true
                    if (data.running && !prev) return true;
                    // If backend says NOT running, always sync to false (trust backend)
                    // This prevents "Zombie Running" state if stream hangs
                    if (!data.running && prev) return false;
                    return prev;
                });
            } catch (e) { console.error(e) }
        }
        const timer = setInterval(checkStatus, 2000);
        return () => clearInterval(timer);
    }, [])

    // Refresh history when loading finishes (and not streaming)
    const prevLoading = useRef(false);
    useEffect(() => {
        if (prevLoading.current && !loading && !isStreaming.current) {
            fetch('/api/history')
                .then(res => res.json())
                .then(data => {
                    if (data.history) setMessages(data.history)
                })
        }
        prevLoading.current = loading;
    }, [loading])

    const handleStop = async () => {
        try {
            await fetch('/api/stop', { method: 'POST' })
        } catch (error) {
            console.error('Failed to stop:', error)
        }
    }

    const sendMessage = async () => {
        if (!input.trim() || loading) return

        const userMsg = input
        setInput('')

        // Add user message temporarily (time is placeholder, will be updated by server history later)
        setMessages(prev => [...prev, { role: 'user', content: userMsg, time: '...' }])
        setLoading(true)
        isStreaming.current = true;

        try {
            const isNewTask = !isInteractive || messages.length <= 1
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    is_new_task: isNewTask,
                    loop_count: isLoopMode ? loopCount : 1
                })
            })

            // We rely on polling to keep loading true if needed, or the stream reader loop 
            // Step 901 implemented a reader loop.
            // If we keep the reader loop, it might conflict with polling if polling sets loading=false?
            // Polling sets loading=false ONLY if backend says not running.
            // If reader loop is active, backend IS running.
            // If reader loop finishes, backend might still be running (finishing up)?
            // Actually, reader loop finishes when stream ends.
            // Stream ends when agent finishes.
            // So they should be consistent.

            if (!response.body) throw new Error("No response body")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            // Create a placeholder assistant message
            setMessages(prev => [...prev, { role: 'assistant', content: '', thinking: '' }])

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const event = JSON.parse(line)

                        setMessages(prev => {
                            const newMsgs = [...prev]
                            const lastMsg = newMsgs[newMsgs.length - 1]

                            if (lastMsg.role !== 'assistant') return prev

                            if (event.type === 'status') {
                                return newMsgs.map((m, i) => i === newMsgs.length - 1 ? { ...m, thinking: event.content } : m)
                            } else if (event.type === 'step') {
                                let newThinking = event.thinking || lastMsg.thinking
                                let newContent = lastMsg.content

                                if (event.action) {
                                    const actionStr = JSON.stringify(event.action)
                                    newThinking = `执行动作: ${actionStr}`
                                }

                                if (event.message) {
                                    if (event.finished) {
                                        newContent += (newContent ? '\n' : '') + event.message
                                    } else {
                                        // Only add to thinking if it's an intermediate result
                                        // Avoid duplicate newlines if logic runs multiple times? 
                                        // Actually event.message is the delta/current step message.
                                        // We append it.
                                        newThinking += `\n执行结果: ${event.message}`
                                    }
                                }

                                return newMsgs.map((m, i) => i === newMsgs.length - 1 ? {
                                    ...m,
                                    thinking: newThinking,
                                    content: newContent
                                } : m)
                            } else if (event.type === 'done') {
                                return newMsgs.map((m, i) => i === newMsgs.length - 1 ? {
                                    ...m,
                                    content: event.content,
                                    time: event.time,
                                    duration: event.duration
                                } : m)
                            } else if (event.type === 'error') {
                                return newMsgs.map((m, i) => i === newMsgs.length - 1 ? { ...m, content: event.content } : m)
                            }
                            return newMsgs
                        })
                    } catch (e) {
                        console.error("Error parsing JSON chunk", e)
                    }
                }
            }
        } catch (e) {
            console.error(e)
            setMessages(prev => [...prev, { role: 'assistant', content: '发生网络错误或系统被中断。' }])
        } finally {
            isStreaming.current = false;
            // Do NOT forcefully set loading false if backend is still reported as running?
            // Actually, if stream ends, agent SHOULD be done.
            // But if network error, stream ends but agent might run.
            // We let Polling handle the 'false' state?
            // Or we treat stream end as local end?
            // Safest: Set local loading false, let polling re-enable if backend is stubborn.
            setLoading(false)
        }
    }

    const clearHistory = async () => {
        try {
            const res = await fetch('/api/history', { method: 'DELETE' })
            const data = await res.json()
            if (data.history) {
                setMessages(data.history)
            }
        } catch (e) {
            console.error("Failed to clear history:", e)
        }
    }

    // Timer logic
    const [timer, setTimer] = useState(0)
    useEffect(() => {
        let interval: NodeJS.Timeout
        if (loading || stopping) {
            interval = setInterval(() => {
                setTimer(t => t + 1)
            }, 1000)
        } else {
            setTimer(0)
        }
        return () => clearInterval(interval)
    }, [loading, stopping])

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    return (
        <div className="flex flex-col h-full bg-slate-900">
            {/* Header */}
            <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/90 backdrop-blur-sm z-50 sticky top-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                        <Bot className="text-blue-500" size={20} />
                        AI 助手
                    </h2>
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${stopping
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : loading
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${stopping ? 'bg-amber-400 animate-pulse'
                            : loading ? 'bg-blue-400 animate-pulse'
                                : 'bg-emerald-400'
                            }`} />
                        {stopping ? '正在停止...' : (loading ? `运行中 (${formatTime(timer)})` : '就绪')}
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
                        <span className="text-xs text-slate-400">交互模式</span>
                        <button
                            onClick={() => setIsInteractive(!isInteractive)}
                            className={`relative w-8 h-4 rounded-full transition-colors ${isInteractive ? 'bg-blue-600' : 'bg-slate-600'}`}
                            title={isInteractive ? "交互模式: 开启 (保留上下文)" : "交互模式: 关闭 (每次都是新任务)"}
                        >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isInteractive ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
                        <span className="text-xs text-slate-400">循环执行</span>
                        <button
                            onClick={() => setIsLoopMode(!isLoopMode)}
                            className={`relative w-8 h-4 rounded-full transition-colors ${isLoopMode ? 'bg-purple-600' : 'bg-slate-600'}`}
                            title={isLoopMode ? "循环模式: 开启" : "循环模式: 关闭 (执行一次)"}
                        >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isLoopMode ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                        {isLoopMode && (
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={loopCount}
                                onChange={(e) => setLoopCount(Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-12 h-5 text-xs bg-slate-900 border border-slate-600 rounded px-1 text-center text-white focus:border-purple-500 outline-none"
                                title="循环次数"
                            />
                        )}
                    </div>
                    <button
                        onClick={clearHistory}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="清空记录"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            </header>

            {/* Messages */}
            < div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth" ref={scrollRef} >
                {
                    messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1 shadow-lg shadow-blue-900/20">
                                    <Bot size={16} className="text-white" />
                                </div>
                            )}

                            <div className={`max-w-[80%] rounded-2xl px-5 py-3 ${msg.role === 'user'
                                ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-tr-none shadow-lg shadow-blue-900/20'
                                : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700 shadow-sm'
                                }`}>
                                {msg.thinking && (
                                    <div className="text-xs text-slate-400 mb-2 italic border-l-2 border-slate-600 pl-2">
                                        思考中: {msg.thinking}
                                    </div>
                                )}
                                {msg.role === 'user' ? (
                                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                                ) : (
                                    <div className="leading-relaxed space-y-2">
                                        {msg.content.replace(/\\n/g, '\n').split('\n').map((line, i) => {
                                            // Handle headers
                                            if (line.trim().startsWith('### ')) return <h3 key={i} className="text-lg font-bold text-blue-300 mt-2">{line.trim().substring(4)}</h3>
                                            if (line.trim().startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-blue-200 mt-3">{line.trim().substring(3)}</h2>

                                            // Handle list items
                                            if (line.trim().startsWith('- ')) {
                                                const content = line.trim().substring(2)
                                                return (
                                                    <div key={i} className="flex gap-2 ml-2">
                                                        <span className="text-blue-400 mt-1.5">•</span>
                                                        <span>{content.split(/(\*\*.*?\*\*)/).map((p, j) =>
                                                            p.startsWith('**') ? <strong key={j} className="text-blue-200">{p.slice(2, -2)}</strong> : p
                                                        )}</span>
                                                    </div>
                                                )
                                            }

                                            // Handle numbered lists
                                            const numMatch = line.trim().match(/^(\d+)\.\s/)
                                            if (numMatch) {
                                                const content = line.trim().substring(numMatch[0].length)
                                                return (
                                                    <div key={i} className="flex gap-2 ml-2">
                                                        <span className="text-blue-400 font-mono">{numMatch[1]}.</span>
                                                        <span>{content.split(/(\*\*.*?\*\*)/).map((p, j) =>
                                                            p.startsWith('**') ? <strong key={j} className="text-blue-200">{p.slice(2, -2)}</strong> : p
                                                        )}</span>
                                                    </div>
                                                )
                                            }

                                            // Default paragraph with bold support
                                            if (!line.trim()) return <div key={i} className="h-2" />
                                            return (
                                                <div key={i}>
                                                    {line.split(/(\*\*.*?\*\*)/).map((p, j) =>
                                                        p.startsWith('**') ? <strong key={j} className="text-blue-200">{p.slice(2, -2)}</strong> : p
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                                {msg.time && (
                                    <div className={`text-xs mt-2 text-right opacity-60 ${msg.role === 'user' ? 'text-blue-200' : 'text-slate-500'}`}>
                                        {msg.time}
                                        {msg.duration && <span className="ml-2">({msg.duration})</span>}
                                    </div>
                                )}
                            </div>

                            {msg.role === 'user' && (
                                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 mt-1 border border-slate-600">
                                    <User size={16} className="text-slate-300" />
                                </div>
                            )}
                        </div>
                    ))
                }
                {
                    loading && (
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                                <Bot size={16} className="text-white" />
                            </div>
                            <div className="bg-slate-800 rounded-2xl rounded-tl-none px-5 py-3 flex items-center gap-2 border border-slate-700">
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    )
                }
            </div >

            {/* Input */}
            < div className="p-4 border-t border-slate-800 bg-slate-900" >
                <div className="max-w-4xl mx-auto relative group">
                    <textarea
                        className="w-full bg-slate-800 text-slate-100 pl-6 pr-14 py-4 rounded-xl border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-500 shadow-lg resize-none overflow-y-auto max-h-[200px]"
                        placeholder="输入指令即可控制手机... (Shift+Enter 换行)"
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            // Auto-grow
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                sendMessage()
                            }
                        }}
                        disabled={loading}
                        rows={1}
                        style={{ minHeight: '58px' }}
                    />
                    {loading ? (
                        <button
                            onClick={handleStop}
                            className="absolute right-3 top-3 p-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors shadow-md animate-pulse flex items-center gap-1"
                            title="停止 (Stop)"
                        >
                            <Square size={16} fill="currentColor" />
                            <span className="text-xs font-bold">停止</span>
                        </button>
                    ) : (
                        <button
                            onClick={sendMessage}
                            disabled={!input.trim()}
                            className="absolute right-3 top-3 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-md"
                        >
                            <Send size={18} />
                        </button>
                    )}
                </div>
                <p className="text-center text-xs text-slate-500 mt-3">
                    AutoGLM 可以控制您的应用交互。请负责任地使用。
                </p>
            </div >
        </div >
    )
}
