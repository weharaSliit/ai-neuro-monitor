import React from 'react';
import { Home, Activity, BarChart3, Sparkles, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

export function BottomNav() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t, isDark } = useTheme();

    const navItems = [
        { icon: Home, label: 'Home', path: '/dashboard' },
        { icon: Activity, label: 'Signals', path: '/signals' },
        { icon: BarChart3, label: 'Analysis', path: '/analysis' },
        { icon: User, label: 'Profile', path: '/profile' },
    ];

    return (
        <div className={`fixed bottom-0 left-0 right-0 ${isDark ? 'glass-dark' : 'glass-light'} border-t ${t.navBorder} px-4 md:px-12 pt-2 pb-2 safe-bottom flex justify-between items-center z-50 max-w-5xl mx-auto md:rounded-t-2xl md:shadow-2xl`}>
            {navItems.map((item) => {
                const isActive = location.pathname === item.path ||
                    (item.path === '/signals' && location.pathname.startsWith('/signal'));
                return (
                    <button
                        key={item.label}
                        onClick={() => navigate(item.path)}
                        className="flex flex-col items-center gap-0.5 py-1 px-3 transition-all active:scale-90 relative"
                    >
                        {/* Active indicator dot */}
                        {isActive && (
                            <div className="absolute -top-1 w-5 h-[3px] rounded-full bg-[#7c6bf7] animate-fade-in" />
                        )}
                        <item.icon
                            size={21}
                            className={`transition-colors duration-200 ${isActive ? 'text-[#7c6bf7]' : t.textDim}`}
                            strokeWidth={isActive ? 2.2 : 1.8}
                        />
                        <span className={`text-[10px] font-semibold transition-colors duration-200 ${isActive ? t.accent : t.textDim}`}>
                            {item.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}