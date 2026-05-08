import React from 'react';
import { Home, Activity, BarChart3, Sparkles, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export function BottomNav() {
    const navigate = useNavigate();
    const location = useLocation();

    const navItems = [
        { icon: Home, label: 'Home', path: '/dashboard' },
        { icon: Activity, label: 'Signals', path: '/signals' },
        { icon: BarChart3, label: 'Analysis', path: '/analysis' },
        { icon: Sparkles, label: 'Toolkit', path: '/toolkit' },
        { icon: User, label: 'Profile', path: '/profile' },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0f0f14] border-t border-[#1e1e2e] px-6 py-3 flex justify-between items-center z-50 max-w-md mx-auto">
            {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                    <button
                        key={item.label}
                        onClick={() => navigate(item.path)}
                        className="flex flex-col items-center gap-1 transition-colors"
                    >
                        <item.icon
                            size={22}
                            className={isActive ? 'text-[#7c6bf7]' : 'text-[#4a4a5e]'}
                            fill={isActive ? 'currentColor' : 'none'}
                            fillOpacity={0.2}
                        />
                        <span className={`text-[10px] font-medium ${isActive ? 'text-[#c0c0d8]' : 'text-[#4a4a5e]'}`}>
                            {item.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}