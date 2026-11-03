import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import Login from './components/Login';
import Inicio from './pages/Inicio';
import MantencionExpedientes from './pages/MantencionExpedientes';
import MantencionComprobantes from './pages/MantencionComprobantes';
import InformesArchivo from './pages/InformesArchivo';

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const [user, setUser] = useState<any>(() => {
    const savedUser = localStorage.getItem('auth_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  useEffect(() => {
    const handleStorageChange = () => {
      setToken(localStorage.getItem('auth_token'));
      const savedUser = localStorage.getItem('auth_user');
      setUser(savedUser ? JSON.parse(savedUser) : null);
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleLoginSuccess = (newToken: string, newUser: any) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <Router>
      <Layout onLogout={handleLogout} user={user}>
        <Routes>
          <Route path="/" element={<Navigate to="/inicio" replace />} />
          <Route path="/inicio" element={<Inicio />} />

          {/* Módulo 1: Gestión de Expedientes (expedientes.vb) */}
          <Route path="/expedientes" element={<Navigate to="/expedientes/ficha" replace />} />
          <Route path="/expedientes/ficha" element={<MantencionExpedientes tabInicial="ficha" />} />
          <Route path="/expedientes/bitacora" element={<MantencionExpedientes tabInicial="bitacora" />} />
          <Route path="/expedientes/nominas" element={<MantencionExpedientes tabInicial="nominas" />} />

          {/* Módulo 2: Gestión de Comprobantes Contables (comprobantes.vb) */}
          <Route path="/comprobantes" element={<Navigate to="/comprobantes/ficha" replace />} />
          <Route path="/comprobantes/ficha" element={<MantencionComprobantes tabInicial="ficha" />} />
          <Route path="/comprobantes/bitacora" element={<MantencionComprobantes tabInicial="bitacora" />} />
          <Route path="/comprobantes/nominas" element={<MantencionComprobantes tabInicial="nominas" />} />

          {/* Módulo 3: Informes e Impresión Oficial (Report1, Report3, Report4, Report5, Report6) */}
          <Route path="/informes" element={<Navigate to="/informes/movimientos-fecha" replace />} />
          <Route path="/informes/movimientos-fecha" element={<InformesArchivo tabInicial="movimientos-fecha" />} />
          <Route path="/informes/bitacora-funcionario" element={<InformesArchivo tabInicial="bitacora-funcionario" />} />
          <Route path="/informes/nomina-expedientes" element={<InformesArchivo tabInicial="nomina-expedientes" />} />
          <Route path="/informes/bitacora-comprobante" element={<InformesArchivo tabInicial="bitacora-comprobante" />} />
          <Route path="/informes/nomina-comprobantes" element={<InformesArchivo tabInicial="nomina-comprobantes" />} />
          <Route path="/informes/pendientes" element={<InformesArchivo tabInicial="pendientes" />} />

          <Route path="*" element={<Navigate to="/inicio" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
