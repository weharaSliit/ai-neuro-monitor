import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import UserDashboard from './pages/UserDashboard';
import AdminDashboard from './pages/AdminDashboard';
import SetupPage from './pages/SetupPage';
import PhenotypingPage from './pages/PhenotypingPage';
import RelaxPage from './pages/RelaxPage';
import UsersOverview from './pages/UsersOverview';

function RequireAuth({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<UserDashboard />} />
        <Route path="phone" element={<PhenotypingPage />} />
        <Route path="relax" element={<RelaxPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="clinical" element={<AdminDashboard />} />
        <Route path="clinical/:userId" element={<AdminDashboard />} />
        <Route path="users" element={<UsersOverview />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
