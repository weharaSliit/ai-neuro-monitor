import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Welcome } from './pages/welcome';
import { Permissions } from './pages/permissions';
import PhenotypingDashboard from './pages/PhenotypingDashboard';
import { BaselineSurvey } from './pages/BaselineSurvey';
import { SetupComplete } from './pages/SetupComplete';
import { DigitalSignals } from './pages/DigitalSignals';



function App() {
    return (
        <Router>
            <div className="h-screen w-full bg-black flex justify-center items-center">
                <div className="w-full h-screen max-w-md bg-[#0f0f14] relative overflow-hidden shadow-2xl">
                    <Routes>
                        <Route path="/" element={<Welcome />} />
                        <Route path="/permissions" element={<Permissions />} />
                        <Route path="/baseline" element={<BaselineSurvey />} />
                        <Route path="/setup-complete" element={<SetupComplete />} />
                        <Route path="/dashboard" element={<PhenotypingDashboard />} />
                        <Route path="/signals" element={<DigitalSignals />} />
                        {/* Add other routes as you build them */}
                    </Routes>
                </div>
            </div>
        </Router>
    );
}

export default App;