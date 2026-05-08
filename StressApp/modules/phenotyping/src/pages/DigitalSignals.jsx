import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { SignalDetailCard } from '../components/SignalDetailCard';
import { BottomNav } from '../components/BottomNav';

export function DigitalSignals() {
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const userId = 's002'; // Your test user ID

    useEffect(() => {
        // 1. Point to your metrics node in Firebase
        const metricsRef = ref(db, `phenotyping/metrics/${userId}`);

        // 2. Listen for real-time changes
        const unsubscribe = onValue(metricsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // Here we map the RAW data from Firebase into the UI format
                const formattedSignals = [
                    {
                        title: "Typing pace",
                        value: `${data.typing_speed} WPM`,
                        subtext: `${data.typing_deviation}% ${data.typing_deviation > 0 ? 'faster' : 'slower'} than usual`,
                        colorClass: Math.abs(data.typing_deviation) > 20 ? "bg-orange-400" : "bg-emerald-500",
                        bars: data.typing_history // Array of {val: number, active: boolean} from Firebase
                    },
                    {
                        title: "Screen unlocks",
                        value: `${data.unlocks_count} times today`,
                        subtext: `${data.unlocks_deviation}% more than your usual`,
                        colorClass: data.unlocks_deviation > 50 ? "bg-red-500" : "bg-orange-400",
                        bars: data.unlocks_history
                    }
                    // Add others (Sleep, Location) similarly
                ];
                setMetrics(formattedSignals);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) return <div className="h-screen bg-black flex items-center justify-center text-white">Syncing with sensors...</div>;

    return (
        <div className="min-h-screen bg-[#0f0f14] text-white flex flex-col font-sans pb-32">
            {/* ... (Header and Alert Banner code remains the same) ... */}

            <div className="px-6 flex-1 overflow-y-auto">
                {metrics && metrics.map((s, i) => (
                    <SignalDetailCard key={i} {...s} />
                ))}
            </div>

            <BottomNav />
        </div>
    );
}