import React, { useState } from 'react';
import axios from 'axios';

interface LoginProps {
  onLoginSuccess: (token: string, user: any) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Por favor, ingrese usuario y contraseña.');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post('/api/auth/login', {
        username,
        password
      });

      if (response.data.status === 'ok') {
        const { token, user } = response.data;
        localStorage.setItem('auth_token', token);
        localStorage.setItem('auth_user', JSON.stringify(user));
        onLoginSuccess(token, user);
      } else {
        setError(response.data.message || 'Error al iniciar sesión');
      }
    } catch (err: any) {
      if (err.response && err.response.data && err.response.data.message) {
        setError(err.response.data.message);
      } else {
        setError('Error de conexión con el servidor. Intente más tarde.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f7f6] flex flex-col justify-center items-center p-4">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row border border-gray-100">
        
        {/* Lado Izquierdo: Corporativo CMDS */}
        <div className="md:w-1/2 bg-[#016098] text-white p-10 flex flex-col justify-between items-center text-center relative overflow-hidden">
          {/* Círculos decorativos de fondo */}
          <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-white opacity-5"></div>
          <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-[#39BABD] opacity-20"></div>

          <div className="z-10 mt-6">
            <img 
              src="/logo.png" 
              alt="Logo CMDS" 
              className="w-36 h-auto mx-auto mb-6 bg-white p-3 rounded-xl shadow-md"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-yellow-400">CMDS</h1>
            <h2 className="text-lg font-medium text-blue-100">Corporación Municipal de Desarrollo Social</h2>
          </div>

          <div className="z-10 my-8">
            <p className="text-base text-blue-50 leading-relaxed font-semibold">
              Sistema de Gestión de Archivo,<br/>Expedientes y Comprobantes
            </p>
            <p className="text-xs text-blue-200 mt-2">
              Control de Kárdex, Bitácoras de Préstamo y Nóminas Oficiales
            </p>
          </div>

          <div className="z-10 text-xs text-blue-200">
            &copy; {new Date().getFullYear()} CMDS Antofagasta. Todos los derechos reservados.
          </div>
        </div>

        {/* Lado Derecho: Formulario */}
        <div className="md:w-1/2 p-10 md:p-12 flex flex-col justify-center bg-white">
          <div className="mb-8 text-center md:text-left">
            <h2 className="text-2xl font-bold text-[#1e293b] mb-2">Bienvenido</h2>
            <p className="text-sm text-[#64748b]">Ingrese sus credenciales para acceder al Sistema de Archivo</p>
          </div>

          {error && (
            <div className="mb-6 bg-[#EB567F]/10 border-l-4 border-[#EB567F] p-4 rounded-md">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-[#EB567F]" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-[#EB567F] font-medium">{error}</p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[#1e293b] mb-2" htmlFor="username">
                Usuario
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10 w-full px-4 py-3 bg-[#f8fafc] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#016098] focus:bg-white transition-colors text-[#1e293b]"
                  placeholder="Ej: admin"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1e293b] mb-2" htmlFor="password">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 w-full px-4 py-3 bg-[#f8fafc] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#016098] focus:bg-white transition-colors text-[#1e293b]"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 px-4 bg-[#016098] hover:bg-[#024a8d] text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition duration-200 flex justify-center items-center ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Verificando...
                  </>
                ) : (
                  'Iniciar Sesión'
                )}
              </button>
            </div>
          </form>

          <div className="mt-8 border-t border-gray-100 pt-6 text-center">
            <p className="text-xs text-gray-400">
              Unidad de Archivo Central y Gestión Documental — CMDS
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
