import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { VERSION_DISPLAY, VERSION_TOOLTIP } from '../version';

interface LayoutProps {
  children: React.ReactNode;
  onLogout: () => void;
  user: any;
}

export const Layout: React.FC<LayoutProps> = ({ children, onLogout, user }) => {
  const location = useLocation();
  const [openMenus, setOpenMenus] = useState<{ [key: string]: boolean }>({
    expedientes: false,
    comprobantes: false,
    informes: false,
    mantenedor: false
  });

  const [mostrarCambioClave, setMostrarCambioClave] = useState(false);
  const [esCambioObligatorio, setEsCambioObligatorio] = useState(Boolean(user?.debeCambiarClave));
  const [claveActual, setClaveActual] = useState('');
  const [claveNueva, setClaveNueva] = useState('');
  const [claveConfirmar, setClaveConfirmar] = useState('');
  const [msgCambioClave, setMsgCambioClave] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [guardandoClave, setGuardandoClave] = useState(false);

  React.useEffect(() => {
    if (user?.debeCambiarClave) {
      setEsCambioObligatorio(true);
      setMostrarCambioClave(true);
    }
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.status === 'ok' && d.user?.debeCambiarClave) {
          setEsCambioObligatorio(true);
          setMostrarCambioClave(true);
        }
      })
      .catch(() => {});
  }, [user]);

  const esAdmin =
    !user ||
    String(user.tipo || '').toUpperCase() === 'A' ||
    String(user.role || '').toLowerCase().includes('admin') ||
    ['admin', 'master', 'adorador'].includes(String(user.username || '').toLowerCase());

  const handleGuardarCambioClave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgCambioClave(null);
    if (claveNueva.length < 6) {
      setMsgCambioClave({ tipo: 'err', texto: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      return;
    }
    if (claveNueva !== claveConfirmar) {
      setMsgCambioClave({ tipo: 'err', texto: 'La confirmación de la nueva contraseña no coincide.' });
      return;
    }
    setGuardandoClave(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passwordActual: claveActual,
          passwordNueva: claveNueva
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'ok') {
        setMsgCambioClave({ tipo: 'err', texto: data.message || 'No se pudo actualizar la contraseña.' });
      } else {
        setMsgCambioClave({ tipo: 'ok', texto: data.message || 'Contraseña actualizada correctamente.' });
        setEsCambioObligatorio(false);
        setClaveActual('');
        setClaveNueva('');
        setClaveConfirmar('');
        setTimeout(() => {
          setMostrarCambioClave(false);
          setMsgCambioClave(null);
        }, 1200);
      }
    } catch {
      setMsgCambioClave({ tipo: 'err', texto: 'Error de conexión con el servidor.' });
    } finally {
      setGuardandoClave(false);
    }
  };

  const toggleMenu = (menu: string) => {
    setOpenMenus(prev => ({ ...prev, [menu]: !prev[menu] }));
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#f4f7f6] text-[#1e293b] print:bg-white">
      {/* Sidebar Corporativo CMDS */}
      <aside className="w-full md:w-[265px] bg-[#016098] text-white shrink-0 shadow-lg flex flex-col justify-between print:hidden">
        <div className="p-4 overflow-y-auto max-h-[calc(100vh-80px)]">
          <div className="flex flex-col items-center pb-5 mb-5 border-b border-white/20 text-center">
            <img 
              src="/logo.png" 
              alt="Logo CMDS" 
              className="max-w-[90px] h-auto mb-2.5 bg-white p-2 rounded-lg shadow-md" 
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
            />
            <h4 className="text-[1.05rem] font-bold tracking-wide m-0 leading-tight">Sistema de Archivo</h4>
            <p className="text-[0.72rem] text-blue-200 mt-0.5">Expedientes y Comprobantes CMDS</p>
            <span
              title={VERSION_TOOLTIP}
              className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-blue-100 border border-white/15 tracking-wider"
            >
              Versión {VERSION_DISPLAY}
            </span>

            {user && (
              <div className="mt-3 bg-[#024a8d] px-3 py-1.5 rounded-full text-xs font-medium text-blue-100 flex items-center gap-1.5 border border-white/10 shadow-inner">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                <span className="truncate max-w-[130px]">{user.nombre || user.username}</span>
                <span className="text-[10px] bg-blue-800 px-1.5 py-0.5 rounded text-blue-200 uppercase">{user.role}</span>
              </div>
            )}
          </div>
          
          <nav className="space-y-1 text-sm">
            {/* 1. Inicio */}
            <Link 
              to="/inicio" 
              className={`flex items-center gap-2.5 py-2.5 px-3 rounded-lg transition-colors font-semibold ${
                isActive('/inicio') ? 'bg-[#39BABD] text-white shadow-sm' : 'text-white/90 hover:bg-white/10'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>Inicio (Dashboard)</span>
            </Link>

            {/* 2. Gestión de Expedientes */}
            <div className="pt-1">
              <button
                onClick={() => toggleMenu('expedientes')}
                className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg text-white/90 hover:bg-white/10 transition-colors font-semibold text-left"
              >
                <span className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span>Gestión Expedientes</span>
                </span>
                <svg className={`w-3.5 h-3.5 transition-transform ${openMenus.expedientes ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openMenus.expedientes && (
                <div className="ml-4 pl-3 border-l border-white/20 space-y-1 mt-1 text-xs">
                  <Link
                    to="/expedientes/ficha"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/expedientes/ficha') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Antecedentes Generales
                  </Link>
                  <Link
                    to="/expedientes/bitacora"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/expedientes/bitacora') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Registro Bitácora
                  </Link>
                  <Link
                    to="/expedientes/nominas"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/expedientes/nominas') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Nóminas de Expedientes
                  </Link>
                </div>
              )}
            </div>

            {/* 3. Gestión de Comprobantes */}
            <div className="pt-1">
              <button
                onClick={() => toggleMenu('comprobantes')}
                className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg text-white/90 hover:bg-white/10 transition-colors font-semibold text-left"
              >
                <span className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Gestión Comprobantes</span>
                </span>
                <svg className={`w-3.5 h-3.5 transition-transform ${openMenus.comprobantes ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openMenus.comprobantes && (
                <div className="ml-4 pl-3 border-l border-white/20 space-y-1 mt-1 text-xs">
                  <Link
                    to="/comprobantes/ficha"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/comprobantes/ficha') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Antecedentes Comprobante
                  </Link>
                  <Link
                    to="/comprobantes/bitacora"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/comprobantes/bitacora') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Registro Bitácora Comp.
                  </Link>
                  <Link
                    to="/comprobantes/nominas"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/comprobantes/nominas') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Nóminas de Comprobantes
                  </Link>
                </div>
              )}
            </div>

            {/* 4. Informes e Impresión Oficial */}
            <div className="pt-1">
              <button
                onClick={() => toggleMenu('informes')}
                className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg text-white/90 hover:bg-white/10 transition-colors font-semibold text-left"
              >
                <span className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span>Informes y Nóminas</span>
                </span>
                <svg className={`w-3.5 h-3.5 transition-transform ${openMenus.informes ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openMenus.informes && (
                <div className="ml-4 pl-3 border-l border-white/20 space-y-1 mt-1 text-xs">
                  <Link
                    to="/informes/movimientos-fecha"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/informes/movimientos-fecha') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Movimientos por Fecha
                  </Link>
                  <Link
                    to="/informes/bitacora-funcionario"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/informes/bitacora-funcionario') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Bitácora por Funcionario
                  </Link>
                  <Link
                    to="/informes/nomina-expedientes"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/informes/nomina-expedientes') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Nómina Salida Expedientes
                  </Link>
                  <Link
                    to="/informes/bitacora-comprobante"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/informes/bitacora-comprobante') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Bitácora por Comprobante
                  </Link>
                  <Link
                    to="/informes/nomina-comprobantes"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/informes/nomina-comprobantes') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Nómina Salida Comprobantes
                  </Link>
                  <Link
                    to="/informes/pendientes"
                    className={`block py-2 px-3 rounded-md transition-colors ${
                      isActive('/informes/pendientes') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    Préstamos Pendientes Dev.
                  </Link>
                </div>
              )}
            </div>

            {/* 5. Mantenedor y Seguridad */}
            {esAdmin && (
              <div className="pt-1">
                <button
                  onClick={() => toggleMenu('mantenedor')}
                  className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg text-white/90 hover:bg-white/10 transition-colors font-semibold text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>Mantenedor</span>
                  </span>
                  <svg className={`w-3.5 h-3.5 transition-transform ${openMenus.mantenedor ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {openMenus.mantenedor && (
                  <div className="ml-4 pl-3 border-l border-white/20 space-y-1 mt-1 text-xs">
                    <Link
                      to="/mantencion/usuarios"
                      className={`block py-2 px-3 rounded-md transition-colors ${
                        isActive('/mantencion/usuarios') ? 'bg-[#39BABD] text-white font-bold' : 'text-blue-100 hover:bg-white/10'
                      }`}
                    >
                      Usuarios y Seguridad
                    </Link>
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>

        {/* Botones Cambiar Contraseña y Cerrar Sesión */}
        <div className="p-4 border-t border-white/15 space-y-2">
          <button
            type="button"
            onClick={() => {
              setMsgCambioClave(null);
              setClaveActual('');
              setClaveNueva('');
              setClaveConfirmar('');
              setMostrarCambioClave(true);
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-white/10 hover:bg-white/20 text-blue-100 text-xs font-semibold border border-white/15 transition-colors cursor-pointer"
          >
            <span>🔑</span>
            <span>Cambiar Mi Contraseña</span>
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#EB567F] hover:bg-[#d6416a] text-white text-xs font-bold shadow transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Contenido Principal */}
      <main className="flex-1 p-5 md:p-7 overflow-x-hidden print:p-0">
        {children}
      </main>

      {mostrarCambioClave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4"
          onClick={() => {
            if (!esCambioObligatorio) setMostrarCambioClave(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#016098] text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold">
                  {esCambioObligatorio ? '⚠️ Actualización Obligatoria de Contraseña' : '🔑 Cambiar Mi Contraseña'}
                </h3>
                <p className="text-[11px] text-blue-100 mt-0.5">Usuario: {user?.username}</p>
              </div>
              {!esCambioObligatorio && (
                <button
                  type="button"
                  onClick={() => setMostrarCambioClave(false)}
                  className="text-white/80 hover:text-white font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            <form onSubmit={handleGuardarCambioClave} className="p-6 space-y-4 text-xs">
              {esCambioObligatorio && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-lg text-amber-900 font-medium">
                  El Administrador ha solicitado que defina una nueva contraseña personal antes de continuar.
                </div>
              )}
              {msgCambioClave && (
                <div
                  className={`p-3 rounded-lg font-bold ${
                    msgCambioClave.tipo === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {msgCambioClave.texto}
                </div>
              )}
              <div>
                <label className="block font-bold text-[#334155] mb-1">Contraseña Actual *</label>
                <input
                  type="password"
                  required
                  value={claveActual}
                  onChange={e => setClaveActual(e.target.value)}
                  className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                />
              </div>
              <div>
                <label className="block font-bold text-[#334155] mb-1">Nueva Contraseña (mín. 6 caracteres) *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={claveNueva}
                  onChange={e => setClaveNueva(e.target.value)}
                  className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                />
              </div>
              <div>
                <label className="block font-bold text-[#334155] mb-1">Confirmar Nueva Contraseña *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={claveConfirmar}
                  onChange={e => setClaveConfirmar(e.target.value)}
                  className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                {!esCambioObligatorio && (
                  <button
                    type="button"
                    onClick={() => setMostrarCambioClave(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={guardandoClave}
                  className="px-5 py-2 bg-[#016098] hover:bg-[#014b78] text-white font-bold rounded-xl shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {guardandoClave ? 'Actualizando...' : 'Actualizar Contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
