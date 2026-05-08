import React, { useState, useEffect } from 'react';
import { Bell, Info } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, query, limitToLast } from 'firebase/database';
import { BottomNav } from '../components/BottomNav';

export default function PhenotypingDashboard() {
    const [stressData, setStressData] = useState({ score: 0.64, label: 'Moderate' });
    const userId = 's002';

    // Listen to Firebase for live stress updates
    useEffect(() => {
        const predictionsRef = query(ref(db, `phenotyping/predictions/${userId}`), limitToLast(1));
        const unsubscribe = onValue(predictionsRef, (snapshot) => {
            const val = snapshot.val();
            if (val) {
                const lastEntry = Object.values(val)[0];
                setStressData({
                    score: lastEntry.score,
                    label: lastEntry.label
                });
            }
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen bg-[#0f0f14] text-white flex flex-col font-sans pb-24">
            {/* Header */}
            <header className="p-6 flex justify-between items-center">
                <h2 className="text-sm text-gray-400">
                    Mon, 5 May — <span className="text-white font-bold text-lg ml-1">Good morning, Chathurika</span>
                </h2>
                <div className="relative">
                    <Bell size={22} className="text-gray-400" />
                    <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-[#0f0f14]"></div>
                </div>
            </header>

            {/* Stress Index Gauge */}
            <div className="flex flex-col items-center my-4">
                <div className="relative w-40 h-40 rounded-full border-[10px] border-zinc-800 flex items-center justify-center">
                    {/* Progress Overlay */}
                    <svg className="absolute top-[-10px] left-[-10px] w-40 h-40 rotate-[-90deg]">
                        <circle
                            cx="80" cy="80" r="70"
                            fill="transparent"
                            stroke="#7c6bf7"
                            strokeWidth="10"
                            strokeDasharray="440"
                            strokeDashoffset={440 - (440 * stressData.score)}
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="text-center">
                        <span className="text-5xl font-bold tracking-tighter">{Math.round(stressData.score * 100)}</span>
                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mt-1">stress index</p>
                        <p className="text-sm font-bold text-orange-400 mt-0.5">{stressData.label}</p>
                    </div>
                </div>
                <p className="text-[11px] text-orange-400 font-bold mt-4">↑ 8 points since yesterday</p>
            </div>

            {/* Today's Signals */}
            <div className="px-6 space-y-4">
                <h3 className="text-sm text-gray-400 font-medium">Today's signals</h3>

                <SignalCard title="Sleep quality" metric="6.1h — 1.4h below target" progress={40} color="bg-orange-400" />
                <SignalCard title="Typing pace" metric="22% slower than usual" progress={30} color="bg-orange-400" />
                <SignalCard title="Screen unlocks" metric="81% more than usual" progress={80} color="bg-red-500" />
                <SignalCard title="Location variety" metric="Lower mobility than usual" progress={20} color="bg-orange-400" />
            </div>

            {/* Pre-stress Alert Card */}
            <div className="mx-6 mt-8 p-5 bg-[#1a1228] border border-[#7c6bf7]/40 rounded-3xl relative">
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-[#7c6bf7] rounded-full"></div>
                        <span className="text-xs font-bold text-[#c0c0d8]">Pre-stress alert</span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-bold">2h ago</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed mb-4">
                    Your behavior is outside your usual pattern — 3 signals are elevated. Tap to see what triggered this.
                </p>
                <div className="flex items-center gap-4">
                    <button className="text-[11px] font-bold text-[#7c6bf7]">See what triggered it →</button>
                    <span className="text-[11px] text-gray-600">|</span>
                    <button className="text-[11px] font-bold text-gray-600">I'm fine, dismiss</button>
                </div>
            </div>

            <p className="text-center text-[10px] text-gray-600 mt-6 font-bold uppercase tracking-widest">
                Signals updated 3 min ago
            </p>

            {/* Navigation */}
            <BottomNav />
        </div>
    );
}

function SignalCard({ title, metric, progress, color }) {
    return (
        <div className="bg-[#14141f] border border-[#2a2a38] p-4 rounded-2xl">
            <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-semibold text-gray-200">{title}</span>
                <span className={`text-[11px] font-bold ${color.replace('bg-', 'text-')}`}>{metric}</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all duration-1000`} style={{ width: `${progress}%` }}></div>
            </div>
        </div>
    );
}