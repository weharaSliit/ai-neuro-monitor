import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { Welcome } from './pages/welcome';
import { Permissions } from './pages/permissions';
import PhenotypingDashboard from './pages/PhenotypingDashboard';
import { BaselineSurvey } from './pages/BaselineSurvey';
import { SetupComplete } from './pages/SetupComplete';
import { DigitalSignals } from './pages/DigitalSignals';
import { AlertDetail } from './pages/AlertDetail';
import { SignalDetail } from './pages/SignalDetail';
import { SignalHistory } from './pages/SignalHistory';
import { Analysis } from './pages/Analysis';
import { Profile } from './pages/Profile';
import { EmaSurvey } from './pages/EmaSurvey';

function App() {
    return (
        <ThemeProvider>
            <Router>
                {/* IMPORTANT: No height/overflow here — each page manages itself */}
                <Routes>
                    <Route path="/" element={<Welcome />} />
                    <Route path="/permissions" element={<Permissions />} />
                    <Route path="/baseline" element={<BaselineSurvey />} />
                    <Route path="/setup-complete" element={<SetupComplete />} />
                    <Route path="/dashboard" element={<PhenotypingDashboard />} />
                    <Route path="/signals" element={<DigitalSignals />} />
                    <Route path="/alert-detail" element={<AlertDetail />} />
                    <Route path="/signal-detail/:signalId" element={<SignalDetail />} />
                    <Route path="/signal-history/:signalId" element={<SignalHistory />} />
                    <Route path="/analysis" element={<Analysis />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/ema-survey" element={<EmaSurvey />} />
                </Routes>
            </Router>
        </ThemeProvider>
    );
}

export default App;