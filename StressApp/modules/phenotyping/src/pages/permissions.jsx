import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Keyboard, Smartphone, Bell, MapPin, ArrowLeft, Check } from 'lucide-react';

const permissionList = [
    {
        id: 'keyboard',
        icon: Keyboard,
        title: 'Keyboard activity',
        status: 'Required',
        description: 'Typing pace and rhythm — no text content is recorded',
        required: true,
    },
    {
        id: 'screen',
        icon: Smartphone,
        title: 'Screen activity',
        status: 'Required',
        description: 'How often you unlock and use your phone',
        required: true,
    },
    {
        id: 'notifications',
        icon: Bell,
        title: 'Notification timing',
        status: 'Required',
        description: 'How quickly you respond to notifications — not the content',
        required: true,
    },
    {
        id: 'location',
        icon: MapPin,
        title: 'Location',
        status: 'Optional',
        description: 'Adds location variety as a context signal — general area only',
        required: false,
    },
];

export function Permissions() {
    const navigate = useNavigate();
    const [granted, setGranted] = useState({});

    const togglePermission = (id) => {
        setGranted(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const allRequiredGranted = permissionList
        .filter(p => p.required)
        .every(p => granted[p.id]);

    return (
        <div className="h-screen bg-[#0f0f14] flex flex-col font-sans">
            {/* Header with Back Button and Progress */}
            <div className="p-6">
                <button onClick={() => navigate(-1)} className="text-white/60 mb-6">
                    <ArrowLeft size={24} />
                </button>

                <div className="text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Setup · Step 1 of 3</p>
                    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="w-1/3 h-full bg-[#7c6bf7] rounded-full"></div>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-6 overflow-y-auto">
                <h1 className="text-2xl font-bold text-white mb-2">What we need access to</h1>
                <p className="text-sm text-gray-400 mb-8 leading-relaxed">
                    Passive monitoring only — we never read your messages or calls
                </p>

                <div className="space-y-3">
                    {permissionList.map((p) => {
                        const isGranted = granted[p.id];
                        return (
                            <button
                                key={p.id}
                                onClick={() => togglePermission(p.id)}
                                className={`w-full p-5 rounded-2xl border text-left transition-all duration-300 ${isGranted ? 'bg-[#1a1228] border-[#7c6bf7]/50' : 'bg-[#14141f] border-[#2a2a38]'
                                    }`}
                            >
                                <div className="flex items-start gap-4">
                                    <div className="p-2 bg-zinc-800/50 rounded-lg">
                                        <p.icon size={18} className={isGranted ? 'text-[#7c6bf7]' : 'text-gray-400'} />
                                    </div>

                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-semibold text-white">{p.title}</span>
                                            <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-tight ${p.required ? 'bg-[#7c6bf7]/10 text-[#7c6bf7] border border-[#7c6bf7]/20' : 'bg-zinc-800 text-zinc-500'
                                                }`}>
                                                {p.status}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-gray-500 leading-snug">{p.description}</p>
                                    </div>

                                    {isGranted && <Check size={18} className="text-[#7c6bf7] mt-1" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Footer Buttons */}
            <div className="p-6 flex flex-col gap-4">
                <button
                    onClick={() => navigate('/baseline')}
                    disabled={!allRequiredGranted}
                    className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${allRequiredGranted
                        ? 'bg-white text-black'
                        : 'bg-zinc-800/50 text-gray-600 cursor-not-allowed'
                        }`}
                >
                    Grant permissions to continue
                </button>

                <button
                    onClick={() => navigate('/baseline')}
                    className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                    Skip optional permissions
                </button>
            </div>
        </div>
    );
}