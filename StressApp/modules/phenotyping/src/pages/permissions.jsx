import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Keyboard, Smartphone, RefreshCw, Activity, ArrowLeft, Check } from 'lucide-react';

const permissionList = [
    { id: 'keyboard', icon: Keyboard, title: 'Keyboard activity', status: 'Required', description: 'Typing pace and rhythm — no text content is recorded', required: true },
    { id: 'screen', icon: Smartphone, title: 'Screen activity', status: 'Required', description: 'How often you unlock and use your phone', required: true },
    { id: 'app_switch', icon: RefreshCw, title: 'App switching', status: 'Required', description: 'App transitions and multitasking patterns to detect context switches', required: true },
    { id: 'activity', icon: Activity, title: 'Physical activity & motion', status: 'Required', description: 'Accelerometer context filtering — identifies walking/moving vs stationary', required: true },
];

export function Permissions() {
    const navigate = useNavigate();
    const [granted, setGranted] = useState({});

    const togglePermission = (id) => setGranted(prev => ({ ...prev, [id]: !prev[id] }));

    const grantedCount = Object.values(granted).filter(Boolean).length;
    const allGranted = grantedCount === permissionList.length;

    return (
        /**
         * LAYOUT:
         *  - Page body scrolls naturally (overflow default = auto on html/body)
         *  - Fixed bottom bar always visible via position:fixed + pb padding on content
         */
        <div className="bg-[#0f0f14] font-sans" style={{ minHeight: '100dvh' }}>

            {/* Scrollable content — extra bottom padding clears the fixed button bar */}
            <div className="w-full max-w-4xl mx-auto px-4 md:px-12 pt-5 pb-32">

                {/* Back + Step progress */}
                <div className="mb-4">
                    <button onClick={() => navigate(-1)} className="text-white/60 hover:text-white mb-3 flex items-center gap-2 transition-colors">
                        <ArrowLeft size={20} />
                        <span className="text-sm font-semibold hidden md:inline">Back</span>
                    </button>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest text-center mb-1.5 font-bold">Setup · Step 1 of 3</p>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden max-w-md mx-auto">
                        <div className="w-1/3 h-full bg-[#7c6bf7] rounded-full" />
                    </div>
                </div>

                {/* Title */}
                <div className="mb-5">
                    <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-1">What we need access to</h1>
                    <p className="text-xs md:text-sm text-gray-400 leading-relaxed">
                        Passive monitoring only — we never read your messages or calls
                    </p>
                </div>

                {/* Permission cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {permissionList.map((p) => {
                        const isGranted = granted[p.id];
                        return (
                            <button
                                key={p.id}
                                onClick={() => togglePermission(p.id)}
                                className={`w-full p-4 rounded-2xl border text-left transition-all duration-200 ${
                                    isGranted
                                        ? 'bg-[#1a1228] border-[#7c6bf7]/50 shadow-lg'
                                        : 'bg-[#14141f] border-[#2a2a38] hover:border-zinc-600'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="p-2 bg-zinc-800/60 rounded-xl shrink-0 mt-0.5">
                                        <p.icon size={18} className={isGranted ? 'text-[#7c6bf7]' : 'text-gray-400'} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                            <span className="text-sm font-bold text-white">{p.title}</span>
                                            <span className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase bg-[#7c6bf7]/10 text-[#7c6bf7] border border-[#7c6bf7]/20">
                                                {p.status}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-gray-400 leading-snug">{p.description}</p>
                                    </div>
                                    {isGranted && <Check size={16} className="text-[#7c6bf7] shrink-0 mt-0.5" />}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Important Setup Instructions for Accessibility */}
                <div className="mt-8 p-5 rounded-2xl bg-[#7c6bf7]/10 border border-[#7c6bf7]/30 flex flex-col gap-3">
                    <div className="flex items-center gap-3 text-[#7c6bf7]">
                        <div className="w-8 h-8 rounded-full bg-[#7c6bf7]/20 flex items-center justify-center shrink-0">
                            <span className="font-bold">!</span>
                        </div>
                        <h3 className="font-bold text-sm">Action Required</h3>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                        To capture keystroke dynamics and app usage, you must manually enable the PhenoCare accessibility service in your phone's settings.
                    </p>
                    <div className="bg-[#0f0f14]/80 p-3 rounded-xl border border-zinc-800">
                        <ol className="text-xs text-gray-400 space-y-2 list-decimal list-inside font-medium">
                            <li>Open your phone's <strong>Settings</strong> app</li>
                            <li>Navigate to <strong>Accessibility</strong></li>
                            <li>Find and tap on <strong>PhenoCare Sensor</strong></li>
                            <li>Toggle the switch to <strong>On</strong></li>
                        </ol>
                    </div>
                </div>
            </div>

            {/* FIXED bottom action bar — always visible on mobile & desktop */}
            <div
                className="fixed bottom-0 left-0 right-0 z-50 bg-[#0f0f14] border-t border-zinc-800/60 px-4 pt-3"
                style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            >
                <div className="max-w-md mx-auto flex flex-col gap-2">
                    <button
                        onClick={() => navigate('/baseline')}
                        disabled={!allGranted}
                        className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${
                            allGranted
                                ? 'bg-white text-black hover:bg-gray-100 shadow-lg active:scale-[0.98]'
                                : 'bg-zinc-800 text-gray-500 cursor-not-allowed'
                        }`}
                    >
                        {allGranted
                            ? 'Grant permissions to continue'
                            : `Select ${permissionList.length - grantedCount} more to continue`}
                    </button>
                    <button onClick={() => navigate('/baseline')} className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors text-center pb-1">
                        Skip optional permissions
                    </button>
                </div>
            </div>
        </div>
    );
}