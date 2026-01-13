import { useState } from 'react'
import { MessageSquare, Settings, Smartphone, Terminal, Monitor } from 'lucide-react'
import ChatView from './views/ChatView'
import SettingsView from './views/SettingsView'
import DevicesView from './views/DevicesView'
import LogView from './views/LogView'
import MonitorView from './views/MonitorView'

function App() {
    const [activeTab, setActiveTab] = useState('chat')

    return (
        <div className="flex h-screen bg-slate-900 text-slate-50 overflow-hidden font-sans">
            {/* Sidebar */}
            <div className="w-16 md:w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between transition-all duration-300">
                <div>
                    <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-slate-800">
                        <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent hidden md:block">
                            AutoGLM
                        </span>
                        <span className="md:hidden text-xl font-bold text-blue-400">AG</span>
                    </div>

                    <nav className="mt-4 flex flex-col cursor-pointer">
                        <NavItem
                            icon={<MessageSquare size={20} />}
                            label="对话"
                            active={activeTab === 'chat'}
                            onClick={() => setActiveTab('chat')}
                        />
                        <NavItem
                            icon={<Monitor size={20} />}
                            label="查看"
                            active={activeTab === 'monitor'}
                            onClick={() => setActiveTab('monitor')}
                        />
                        <NavItem
                            icon={<Settings size={20} />}
                            label="设置"
                            active={activeTab === 'settings'}
                            onClick={() => setActiveTab('settings')}
                        />
                        <NavItem
                            icon={<Smartphone size={20} />}
                            label="设备"
                            active={activeTab === 'devices'}
                            onClick={() => setActiveTab('devices')}
                        />
                        <NavItem
                            icon={<Terminal size={20} />}
                            label="日志"
                            active={activeTab === 'logs'}
                            onClick={() => setActiveTab('logs')}
                        />
                    </nav>
                </div>

                <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center md:text-left">
                    <span className="hidden md:inline">v0.1.0 Alpha</span>
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative">
                <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
                    <ChatView />
                </div>
                <div className={`h-full ${activeTab === 'monitor' ? 'block' : 'hidden'}`}>
                    <MonitorView />
                </div>
                <div className={`h-full ${activeTab === 'settings' ? 'block' : 'hidden'}`}>
                    <SettingsView />
                </div>
                <div className={`h-full ${activeTab === 'devices' ? 'block' : 'hidden'}`}>
                    <DevicesView />
                </div>
                <div className={`h-full ${activeTab === 'logs' ? 'block' : 'hidden'}`}>
                    <LogView />
                </div>
            </main>
        </div>
    )
}

function NavItem({ icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) {
    return (
        <div
            onClick={onClick}
            className={`
        flex items-center px-4 py-3 mx-2 my-1 rounded-lg transition-colors
        ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}
      `}
        >
            <div className="flex-shrink-0">{icon}</div>
            <span className="ml-3 font-medium hidden md:block">{label}</span>
        </div>
    )
}

export default App
