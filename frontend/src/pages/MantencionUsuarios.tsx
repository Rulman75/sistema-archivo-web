import React, { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface UsuarioRow {
  Usuario: string;
  NombreCompleto: string;
  Email: string;
  Rut: string;
  Tipo: string;
  TipoNormalizado: string;
  RolDescripcion: string;
  Unidad: string;
  LongitudClave: number;
  TieneHashBcrypt: boolean;
  Activo: boolean;
  DebeCambiarClave: boolean;
  IntentosFallidos: number;
  BloqueadoHasta: string | null;
  EstaBloqueadoTemporal: boolean;
  UltimoAcceso: string | null;
  UltimoCambioClave: string | null;
  FechaCreacion: string | null;
}

interface ResumenSeguridad {
  totalUsuarios: number;
  usuariosActivos: number;
  usuariosSuspendidos: number;
  usuariosBloqueados: number;
  usuariosConBcrypt: number;
  usuariosCambioClavePendiente: number;
  accesosHoy: number;
  fallidosHoy: number;
}

interface AuditoriaRow {
  Id: number;
  FechaHora: string;
  Usuario: string;
  Evento: string;
  Detalle: string;
  IpOrigen: string;
  UserAgent: string;
  Exitoso: number;
}

const ROLES_OPCIONES = [
  { codigo: 'A', nombre: 'A — Administrador de Archivo (Control Total y Seguridad)' },
  { codigo: 'O', nombre: 'O — Operador de Archivo (Gestión de Expedientes y Comprobantes)' },
  { codigo: 'U', nombre: 'U — Consulta / Solo Lectura (Informes y Búsqueda)' }
];

function formatDateTimeDDMMYYYY(isoStr: string | null | undefined): string {
  if (!isoStr) return 'Sin registro';
  const clean = String(isoStr).replace('T', ' ').trim();
  const [datePart, timePart] = clean.split(' ');
  if (!datePart) return clean;
  const parts = datePart.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const ddmmyyyy = `${parts[2]}-${parts[1]}-${parts[0]}`;
    return timePart ? `${ddmmyyyy} ${timePart.slice(0, 5)}` : ddmmyyyy;
  }
  return clean;
}

function generarClaveSegura(longitud = 9): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#';
  let out = '';
  for (let i = 0; i < longitud; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export default function MantencionUsuarios() {
  const [tabActiva, setTabActiva] = useState<'usuarios' | 'auditoria'>('usuarios');
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [resumen, setResumen] = useState<ResumenSeguridad>({
    totalUsuarios: 0,
    usuariosActivos: 0,
    usuariosSuspendidos: 0,
    usuariosBloqueados: 0,
    usuariosConBcrypt: 0,
    usuariosCambioClavePendiente: 0,
    accesosHoy: 0,
    fallidosHoy: 0
  });
  const [cargando, setCargando] = useState<boolean>(false);
  const [mensajeExito, setMensajeExito] = useState<string>('');
  const [mensajeError, setMensajeError] = useState<string>('');

  const [busqueda, setBusqueda] = useState<string>('');
  const [filtroRol, setFiltroRol] = useState<string>('');
  const [filtroEstado, setFiltroEstado] = useState<string>('');

  const [mostrarModalUsuario, setMostrarModalUsuario] = useState<boolean>(false);
  const [modoModal, setModoModal] = useState<'crear' | 'editar'>('crear');
  const [formUsuario, setFormUsuario] = useState({
    usuario: '',
    password: '',
    nombreCompleto: '',
    email: '',
    rut: '',
    tipo: 'O',
    unidad: 'cmds',
    activo: true,
    debeCambiarClave: false
  });
  const [guardandoForm, setGuardandoForm] = useState<boolean>(false);

  const [usuarioReset, setUsuarioReset] = useState<UsuarioRow | null>(null);
  const [nuevaClaveReset, setNuevaClaveReset] = useState<string>('');
  const [forzarCambioReset, setForzarCambioReset] = useState<boolean>(true);
  const [guardandoReset, setGuardandoReset] = useState<boolean>(false);

  const [auditoria, setAuditoria] = useState<AuditoriaRow[]>([]);
  const [cargandoAuditoria, setCargandoAuditoria] = useState<boolean>(false);
  const [filtroUsuarioAud, setFiltroUsuarioAud] = useState<string>('');
  const [filtroEventoAud, setFiltroEventoAud] = useState<string>('');

  const mostrarNotificacion = (tipo: 'ok' | 'err', texto: string) => {
    if (tipo === 'ok') {
      setMensajeExito(texto);
      setMensajeError('');
      setTimeout(() => setMensajeExito(''), 5000);
    } else {
      setMensajeError(texto);
      setMensajeExito('');
      setTimeout(() => setMensajeError(''), 6000);
    }
  };

  const cargarUsuarios = async () => {
    setCargando(true);
    try {
      const res = await axios.get('/api/usuarios');
      if (res.data?.status === 'ok') {
        setUsuarios(res.data.usuarios || []);
        if (res.data.resumen) setResumen(res.data.resumen);
      }
    } catch (err: any) {
      mostrarNotificacion('err', err?.response?.data?.message || 'Error al cargar usuarios del sistema.');
    } finally {
      setCargando(false);
    }
  };

  const cargarAuditoria = async () => {
    setCargandoAuditoria(true);
    try {
      const res = await axios.get('/api/usuarios/auditoria', {
        params: {
          usuario: filtroUsuarioAud,
          evento: filtroEventoAud,
          limit: 300
        }
      });
      if (res.data?.status === 'ok') {
        setAuditoria(res.data.registros || []);
      }
    } catch (err: any) {
      mostrarNotificacion('err', err?.response?.data?.message || 'Error al cargar bitácora de auditoría.');
    } finally {
      setCargandoAuditoria(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  useEffect(() => {
    if (tabActiva === 'auditoria') {
      cargarAuditoria();
    }
  }, [tabActiva, filtroEventoAud]);

  const abrirModalCrear = () => {
    setModoModal('crear');
    setFormUsuario({
      usuario: '',
      password: generarClaveSegura(9),
      nombreCompleto: '',
      email: '',
      rut: '',
      tipo: 'O',
      unidad: 'cmds',
      activo: true,
      debeCambiarClave: true
    });
    setMostrarModalUsuario(true);
  };

  const abrirModalEditar = (u: UsuarioRow) => {
    setModoModal('editar');
    setFormUsuario({
      usuario: u.Usuario,
      password: '',
      nombreCompleto: u.NombreCompleto === u.Usuario ? '' : u.NombreCompleto,
      email: u.Email || '',
      rut: u.Rut || '',
      tipo: u.TipoNormalizado || 'O',
      unidad: u.Unidad || 'cmds',
      activo: u.Activo,
      debeCambiarClave: u.DebeCambiarClave
    });
    setMostrarModalUsuario(true);
  };

  const guardarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoForm(true);
    try {
      if (modoModal === 'crear') {
        const res = await axios.post('/api/usuarios', formUsuario);
        mostrarNotificacion('ok', res.data?.message || 'Usuario creado exitosamente.');
      } else {
        const res = await axios.put(`/api/usuarios/${encodeURIComponent(formUsuario.usuario)}`, formUsuario);
        mostrarNotificacion('ok', res.data?.message || 'Usuario actualizado exitosamente.');
      }
      setMostrarModalUsuario(false);
      cargarUsuarios();
    } catch (err: any) {
      mostrarNotificacion('err', err?.response?.data?.message || 'No se pudo guardar el usuario.');
    } finally {
      setGuardandoForm(false);
    }
  };

  const ejecutarAccionEstado = async (
    u: UsuarioRow,
    accion: 'suspender' | 'activar' | 'desbloquear' | 'forzar-cambio-clave' | 'quitar-cambio-clave'
  ) => {
    try {
      const res = await axios.patch(`/api/usuarios/${encodeURIComponent(u.Usuario)}/estado`, { accion });
      mostrarNotificacion('ok', res.data?.message || 'Estado actualizado.');
      cargarUsuarios();
    } catch (err: any) {
      mostrarNotificacion('err', err?.response?.data?.message || 'Error al actualizar estado.');
    }
  };

  const confirmarResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuarioReset) return;
    setGuardandoReset(true);
    try {
      const res = await axios.post(`/api/usuarios/${encodeURIComponent(usuarioReset.Usuario)}/reset-password`, {
        nuevaPassword: nuevaClaveReset,
        debeCambiarClave: forzarCambioReset
      });
      mostrarNotificacion('ok', res.data?.message || 'Contraseña reseteada correctamente.');
      setUsuarioReset(null);
      cargarUsuarios();
    } catch (err: any) {
      mostrarNotificacion('err', err?.response?.data?.message || 'Error al resetear contraseña.');
    } finally {
      setGuardandoReset(false);
    }
  };

  const eliminarUsuario = async (u: UsuarioRow) => {
    if (!window.confirm(`¿Está seguro de eliminar permanentemente la cuenta "${u.Usuario}"?`)) {
      return;
    }
    try {
      const res = await axios.delete(`/api/usuarios/${encodeURIComponent(u.Usuario)}`);
      mostrarNotificacion('ok', res.data?.message || 'Usuario eliminado.');
      cargarUsuarios();
    } catch (err: any) {
      mostrarNotificacion('err', err?.response?.data?.message || 'Error al eliminar usuario.');
    }
  };

  const usuariosFiltrados = usuarios.filter(u => {
    if (filtroRol && u.TipoNormalizado !== filtroRol) return false;
    if (filtroEstado === 'activos' && !u.Activo) return false;
    if (filtroEstado === 'suspendidos' && u.Activo) return false;
    if (filtroEstado === 'bloqueados' && !u.EstaBloqueadoTemporal) return false;
    if (filtroEstado === 'cambio-clave' && !u.DebeCambiarClave) return false;

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      const match =
        u.Usuario.toLowerCase().includes(q) ||
        (u.NombreCompleto || '').toLowerCase().includes(q) ||
        (u.Email || '').toLowerCase().includes(q) ||
        (u.Rut || '').toLowerCase().includes(q) ||
        (u.Unidad || '').toLowerCase().includes(q) ||
        (u.RolDescripcion || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const exportarUsuariosExcel = () => {
    const rows = usuariosFiltrados.map(u => ({
      'Usuario': u.Usuario,
      'Nombre Completo': u.NombreCompleto,
      'RUT': u.Rut || '-',
      'Correo': u.Email || '-',
      'Código Rol': u.Tipo,
      'Descripción Perfil': u.RolDescripcion,
      'Unidad': u.Unidad,
      'Estado Cuenta': !u.Activo ? 'SUSPENDIDO' : u.EstaBloqueadoTemporal ? 'BLOQUEADO TEMPORAL' : 'ACTIVO',
      'Hash Bcrypt Activo': u.TieneHashBcrypt ? 'SÍ (Bcrypt 12r)' : 'NO',
      'Exigir Cambio Clave': u.DebeCambiarClave ? 'SÍ (Al próximo ingreso)' : 'NO',
      'Intentos Fallidos': u.IntentosFallidos,
      'Último Acceso': formatDateTimeDDMMYYYY(u.UltimoAcceso),
      'Último Cambio Clave': formatDateTimeDDMMYYYY(u.UltimoCambioClave)
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Usuarios_Archivo');
    XLSX.writeFile(wb, 'Usuarios_Seguridad_Archivo_CMDS.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-[#016098] text-white uppercase">
                Seguridad e Identidad
              </span>
              <h1 className="text-xl font-extrabold text-[#016098]">
                Administración de Usuarios, Perfiles y Auditoría — Sistema de Archivo
              </h1>
            </div>
            <p className="text-xs text-[#64748b] mt-1">
              Gestión centralizada de cuentas con cifrado <b>Bcrypt (12 rondas)</b>, sincronización retrocompatible con tabla <code>LIC_USUARIO</code>, bloqueo anti-fuerza bruta y bitácora de accesos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={abrirModalCrear}
              className="px-4 py-2 bg-[#016098] hover:bg-[#014b78] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              + Crear Nuevo Usuario
            </button>
            <button
              type="button"
              onClick={exportarUsuariosExcel}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              📊 Exportar Excel
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 mt-5">
          <div className="bg-[#f8fafc] rounded-xl p-3.5 border border-[#cbd5e1] border-l-4 border-l-[#016098]">
            <span className="text-[11px] font-bold text-[#64748b] uppercase">Total Usuarios</span>
            <p className="text-2xl font-extrabold text-[#016098] mt-1">{resumen.totalUsuarios}</p>
            <span className="text-[11px] text-[#475569]">Registrados en BD Dual</span>
          </div>

          <div className="bg-emerald-50/60 rounded-xl p-3.5 border border-emerald-200 border-l-4 border-l-emerald-600">
            <span className="text-[11px] font-bold text-emerald-900 uppercase">Cuentas Activas</span>
            <p className="text-2xl font-extrabold text-emerald-700 mt-1">{resumen.usuariosActivos}</p>
            <span className="text-[11px] text-emerald-800 font-semibold">
              🔒 {resumen.usuariosConBcrypt}/{resumen.totalUsuarios} con Hash Bcrypt
            </span>
          </div>

          <div className="bg-rose-50/60 rounded-xl p-3.5 border border-rose-200 border-l-4 border-l-rose-600">
            <span className="text-[11px] font-bold text-rose-900 uppercase">Suspendidos / Bloq.</span>
            <p className="text-2xl font-extrabold text-rose-700 mt-1">
              {resumen.usuariosSuspendidos} <span className="text-sm font-normal text-rose-600">/ {resumen.usuariosBloqueados} bloq.</span>
            </p>
            <span className="text-[11px] text-rose-800">Sin acceso al sistema</span>
          </div>

          <div className="bg-amber-50/70 rounded-xl p-3.5 border border-amber-200 border-l-4 border-l-amber-500">
            <span className="text-[11px] font-bold text-amber-900 uppercase">Cambio Clave Pend.</span>
            <p className="text-2xl font-extrabold text-amber-700 mt-1">{resumen.usuariosCambioClavePendiente}</p>
            <span className="text-[11px] text-amber-800">Se les exigirá al iniciar sesión</span>
          </div>

          <div className="bg-sky-50/70 rounded-xl p-3.5 border border-sky-200 border-l-4 border-l-[#39BABD]">
            <span className="text-[11px] font-bold text-sky-900 uppercase">Actividad de Hoy</span>
            <p className="text-2xl font-extrabold text-sky-800 mt-1">
              {resumen.accesosHoy} <span className="text-xs font-semibold text-emerald-700">ingresos OK</span>
            </p>
            <span className="text-[11px] text-rose-700 font-semibold">
              {resumen.fallidosHoy} intentos fallidos hoy
            </span>
          </div>
        </div>
      </div>

      {mensajeExito && (
        <div className="bg-emerald-50 border-l-4 border-emerald-600 text-emerald-900 px-4 py-3 rounded-xl text-xs font-bold shadow-xs flex items-center justify-between">
          <span>✅ {mensajeExito}</span>
          <button onClick={() => setMensajeExito('')} className="text-emerald-800 hover:underline">
            Cerrar
          </button>
        </div>
      )}
      {mensajeError && (
        <div className="bg-rose-50 border-l-4 border-rose-600 text-rose-900 px-4 py-3 rounded-xl text-xs font-bold shadow-xs flex items-center justify-between">
          <span>⚠️ {mensajeError}</span>
          <button onClick={() => setMensajeError('')} className="text-rose-800 hover:underline">
            Cerrar
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#e2e8f0] overflow-hidden">
        <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTabActiva('usuarios')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                tabActiva === 'usuarios'
                  ? 'bg-[#016098] text-white shadow-xs'
                  : 'bg-white text-[#475569] border border-[#cbd5e1] hover:bg-slate-100'
              }`}
            >
              👥 Directorio de Usuarios ({usuarios.length})
            </button>
            <button
              type="button"
              onClick={() => setTabActiva('auditoria')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                tabActiva === 'auditoria'
                  ? 'bg-[#016098] text-white shadow-xs'
                  : 'bg-white text-[#475569] border border-[#cbd5e1] hover:bg-slate-100'
              }`}
            >
              🛡️ Bitácora de Accesos y Eventos de Seguridad
            </button>
          </div>

          {tabActiva === 'usuarios' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar usuario, nombre, correo o unidad..."
                className="w-64 px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg bg-white"
              />
              <select
                value={filtroRol}
                onChange={e => setFiltroRol(e.target.value)}
                className="px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg bg-white font-semibold text-[#1e293b]"
              >
                <option value="">Todos los Perfiles</option>
                <option value="A">Rol A — Administrador</option>
                <option value="O">Rol O — Operador Archivo</option>
                <option value="U">Rol U — Consulta</option>
              </select>
              <select
                value={filtroEstado}
                onChange={e => setFiltroEstado(e.target.value)}
                className="px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg bg-white font-semibold text-[#1e293b]"
              >
                <option value="">Todos los Estados</option>
                <option value="activos">Solo Activos</option>
                <option value="suspendidos">Suspendidos</option>
                <option value="bloqueados">Bloqueados por Intentos</option>
                <option value="cambio-clave">Con Cambio de Clave Solicitado</option>
              </select>
            </div>
          )}

          {tabActiva === 'auditoria' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={filtroUsuarioAud}
                onChange={e => setFiltroUsuarioAud(e.target.value)}
                placeholder="Filtrar por usuario..."
                className="w-48 px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg bg-white"
              />
              <select
                value={filtroEventoAud}
                onChange={e => setFiltroEventoAud(e.target.value)}
                className="px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg bg-white font-semibold text-[#1e293b]"
              >
                <option value="">Todos los Eventos</option>
                <option value="LOGIN_OK">LOGIN_OK (Accesos Exitosos)</option>
                <option value="LOGIN_FAIL">LOGIN_FAIL (Contraseñas Incorrectas)</option>
                <option value="LOCKOUT">LOCKOUT (Bloqueos por Fuerza Bruta)</option>
                <option value="PASSWORD_CHANGE">PASSWORD_CHANGE (Cambio Personal)</option>
                <option value="USER_RESET_PASS">USER_RESET_PASS (Reseteo Admin)</option>
                <option value="USER_CREATE">USER_CREATE (Creación Usuario)</option>
                <option value="USER_SUSPEND">USER_SUSPEND (Suspensión)</option>
              </select>
              <button
                type="button"
                onClick={cargarAuditoria}
                className="px-3 py-1.5 bg-[#016098] text-white text-xs font-bold rounded-lg hover:bg-[#014b78] cursor-pointer"
              >
                🔍 Buscar
              </button>
            </div>
          )}
        </div>

        {tabActiva === 'usuarios' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#f1f5f9] text-[#334155] font-bold border-b border-[#e2e8f0]">
                <tr>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Nombre Completo / Contacto</th>
                  <th className="p-3">Perfil / Rol</th>
                  <th className="p-3 text-center">Unidad</th>
                  <th className="p-3 text-center">Estado Cuenta</th>
                  <th className="p-3 text-center">Seguridad Clave</th>
                  <th className="p-3 text-center">Exigir Cambio Clave</th>
                  <th className="p-3">Último Acceso</th>
                  <th className="p-3 text-right">Acciones de Administración</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {cargando ? (
                  <tr>
                    <td colSpan={9} className="p-10 text-center text-[#64748b] font-semibold">
                      Cargando cuentas de usuario...
                    </td>
                  </tr>
                ) : usuariosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-10 text-center text-[#94a3b8]">
                      No se encontraron usuarios con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  usuariosFiltrados.map(u => (
                    <tr
                      key={u.Usuario}
                      className={`hover:bg-sky-50/40 transition-colors ${!u.Activo ? 'bg-rose-50/20 opacity-75' : ''}`}
                    >
                      <td className="p-3 font-extrabold text-[#016098] whitespace-nowrap">
                        <div>{u.Usuario}</div>
                        {u.Rut && <div className="text-[10px] font-normal text-[#64748b]">RUT: {u.Rut}</div>}
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-[#1e293b]">
                          {u.NombreCompleto && u.NombreCompleto !== u.Usuario ? u.NombreCompleto : <span className="text-slate-400 italic">Sin nombre registrado</span>}
                        </div>
                        {u.Email && <div className="text-[11px] text-[#64748b]">{u.Email}</div>}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase mr-1.5 ${
                            u.TipoNormalizado === 'A'
                              ? 'bg-[#016098] text-white'
                              : u.TipoNormalizado === 'O'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          Rol {u.Tipo}
                        </span>
                        <span className="text-[11px] text-[#475569]">{u.RolDescripcion}</span>
                      </td>
                      <td className="p-3 text-center font-semibold text-[#334155] uppercase">{u.Unidad}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {!u.Activo ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300">
                            ⛔ SUSPENDIDO
                          </span>
                        ) : u.EstaBloqueadoTemporal ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                            🚨 BLOQUEADO ({u.IntentosFallidos} fallos)
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                            ● ACTIVO
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {u.TieneHashBcrypt ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
                            🔒 Bcrypt OK
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                            Texto Plano
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            ejecutarAccionEstado(
                              u,
                              u.DebeCambiarClave ? 'quitar-cambio-clave' : 'forzar-cambio-clave'
                            )
                          }
                          title="Haga clic para activar o desactivar el cambio obligatorio de contraseña en el próximo inicio de sesión"
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer ${
                            u.DebeCambiarClave
                              ? 'bg-amber-100 text-amber-900 border-amber-400 shadow-2xs'
                              : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          <span
                            className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                              u.DebeCambiarClave ? 'bg-amber-500 justify-end' : 'bg-slate-400 justify-start'
                            }`}
                          >
                            <span className="bg-white w-3 h-3 rounded-full shadow-xs" />
                          </span>
                          <span>{u.DebeCambiarClave ? 'Sí (Obligatorio)' : 'No (Activar)'}</span>
                        </button>
                      </td>
                      <td className="p-3 whitespace-nowrap text-[11px] text-[#475569]">
                        {formatDateTimeDDMMYYYY(u.UltimoAcceso)}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirModalEditar(u)}
                            className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-[#016098] border border-sky-200 rounded-lg text-[11px] font-bold cursor-pointer"
                          >
                            ✏️ Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUsuarioReset(u);
                              setNuevaClaveReset(generarClaveSegura(9));
                              setForzarCambioReset(true);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg text-[11px] font-bold cursor-pointer"
                          >
                            🔑 Reset Clave
                          </button>
                          {u.EstaBloqueadoTemporal && (
                            <button
                              type="button"
                              onClick={() => ejecutarAccionEstado(u, 'desbloquear')}
                              className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-[11px] font-bold cursor-pointer"
                            >
                              🔓 Desbloquear
                            </button>
                          )}
                          {u.Activo ? (
                            <button
                              type="button"
                              onClick={() => ejecutarAccionEstado(u, 'suspender')}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-bold cursor-pointer"
                            >
                              ⏸ Suspender
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => ejecutarAccionEstado(u, 'activar')}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-bold cursor-pointer"
                            >
                              ▶ Reactivar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => eliminarUsuario(u)}
                            className="px-2 py-1 text-slate-400 hover:text-rose-600 text-[11px] font-bold cursor-pointer"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#f1f5f9] text-[#334155] font-bold border-b border-[#e2e8f0]">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Fecha y Hora</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Evento</th>
                  <th className="p-3">Detalle de la Acción</th>
                  <th className="p-3">IP Origen</th>
                  <th className="p-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {cargandoAuditoria ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-[#64748b]">
                      Cargando bitácora de auditoría...
                    </td>
                  </tr>
                ) : auditoria.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-[#94a3b8]">
                      No hay eventos registrados para el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  auditoria.map(a => (
                    <tr key={a.Id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-[11px] text-slate-500">#{a.Id}</td>
                      <td className="p-3 whitespace-nowrap font-semibold text-[#1e293b]">
                        {formatDateTimeDDMMYYYY(a.FechaHora)}
                      </td>
                      <td className="p-3 font-bold text-[#016098]">{a.Usuario}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                            a.Evento === 'LOGIN_OK'
                              ? 'bg-emerald-100 text-emerald-800'
                              : a.Evento === 'LOGIN_FAIL' || a.Evento === 'LOCKOUT'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-sky-100 text-[#016098]'
                          }`}
                        >
                          {a.Evento}
                        </span>
                      </td>
                      <td className="p-3 text-[#334155]">{a.Detalle}</td>
                      <td className="p-3 font-mono text-[11px] text-[#475569]">{a.IpOrigen}</td>
                      <td className="p-3 text-center">
                        {Number(a.Exitoso) === 1 ? (
                          <span className="text-emerald-700 font-bold">OK</span>
                        ) : (
                          <span className="text-rose-700 font-bold">Rechazado</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL CREAR / EDITAR USUARIO */}
      {mostrarModalUsuario && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={() => setMostrarModalUsuario(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#016098] text-white px-6 py-4 flex items-center justify-between">
              <h3 className="text-base font-extrabold">
                {modoModal === 'crear' ? 'Crear Nuevo Usuario de Archivo' : `Editar Perfil: ${formUsuario.usuario}`}
              </h3>
              <button
                type="button"
                onClick={() => setMostrarModalUsuario(false)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={guardarUsuario} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-[#334155] mb-1">
                    Usuario (Login máx. 15 car.) *
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    required
                    disabled={modoModal === 'editar'}
                    value={formUsuario.usuario}
                    onChange={e => setFormUsuario({ ...formUsuario, usuario: e.target.value })}
                    placeholder="Ej: jperez"
                    className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc] disabled:opacity-60 font-bold text-[#016098]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#334155] mb-1">RUT Funcionario (Opcional)</label>
                  <input
                    type="text"
                    maxLength={15}
                    value={formUsuario.rut}
                    onChange={e => setFormUsuario({ ...formUsuario, rut: e.target.value })}
                    placeholder="Ej: 12345678-9"
                    className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#334155] mb-1">Nombre Completo (máx. 30 car.)</label>
                <input
                  type="text"
                  maxLength={30}
                  value={formUsuario.nombreCompleto}
                  onChange={e => setFormUsuario({ ...formUsuario, nombreCompleto: e.target.value })}
                  placeholder="Ej: Juan Pérez"
                  className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                />
              </div>

              <div>
                <label className="block font-bold text-[#334155] mb-1">Correo Institucional</label>
                <input
                  type="email"
                  maxLength={120}
                  value={formUsuario.email}
                  onChange={e => setFormUsuario({ ...formUsuario, email: e.target.value })}
                  placeholder="Ej: jperez@cmds.cl"
                  className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-[#334155] mb-1">Rol / Perfil de Acceso *</label>
                  <select
                    value={formUsuario.tipo}
                    onChange={e => setFormUsuario({ ...formUsuario, tipo: e.target.value })}
                    className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc] font-semibold"
                  >
                    {ROLES_OPCIONES.map(r => (
                      <option key={r.codigo} value={r.codigo}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#334155] mb-1">Unidad *</label>
                  <input
                    type="text"
                    required
                    value={formUsuario.unidad}
                    onChange={e => setFormUsuario({ ...formUsuario, unidad: e.target.value })}
                    placeholder="cmds"
                    className="w-full px-3 py-2 border border-[#cbd5e1] rounded-lg bg-[#f8fafc]"
                  />
                </div>
              </div>

              {modoModal === 'crear' && (
                <div className="bg-sky-50/70 p-3.5 rounded-xl border border-sky-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-[#016098]">Contraseña Inicial *</label>
                    <button
                      type="button"
                      onClick={() => setFormUsuario({ ...formUsuario, password: generarClaveSegura(9) })}
                      className="text-[11px] font-bold text-[#016098] hover:underline cursor-pointer"
                    >
                      🔄 Generar otra clave
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      minLength={6}
                      value={formUsuario.password}
                      onChange={e => setFormUsuario({ ...formUsuario, password: e.target.value })}
                      className="flex-1 px-3 py-2 border border-sky-300 rounded-lg bg-white font-mono font-bold text-sm text-[#016098]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(formUsuario.password);
                        mostrarNotificacion('ok', 'Contraseña copiada al portapapeles.');
                      }}
                      className="px-3 py-2 bg-white border border-sky-300 rounded-lg font-bold text-[#016098] hover:bg-sky-100 cursor-pointer"
                    >
                      📋 Copiar
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formUsuario.debeCambiarClave}
                    onChange={e => setFormUsuario({ ...formUsuario, debeCambiarClave: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  <span className="font-semibold text-[#334155]">
                    Exigir que el usuario cambie su contraseña en el próximo inicio de sesión
                  </span>
                </label>

                {modoModal === 'editar' && (
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formUsuario.activo}
                      onChange={e => setFormUsuario({ ...formUsuario, activo: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    <span className="font-semibold text-[#334155]">Cuenta Activa</span>
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setMostrarModalUsuario(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoForm}
                  className="px-5 py-2 bg-[#016098] hover:bg-[#014b78] text-white font-bold rounded-xl shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {guardandoForm ? 'Guardando...' : modoModal === 'crear' ? 'Crear Usuario' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RESETEAR CONTRASEÑA */}
      {usuarioReset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={() => setUsuarioReset(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-indigo-700 text-white px-6 py-4 flex items-center justify-between">
              <h3 className="text-base font-extrabold">🔑 Resetear Contraseña: {usuarioReset.Usuario}</h3>
              <button
                type="button"
                onClick={() => setUsuarioReset(null)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={confirmarResetPassword} className="p-6 space-y-4 text-xs">
              <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-indigo-950">Nueva Contraseña *</label>
                  <button
                    type="button"
                    onClick={() => setNuevaClaveReset(generarClaveSegura(9))}
                    className="text-[11px] font-bold text-indigo-700 hover:underline cursor-pointer"
                  >
                    🔄 Generar aleatoria
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={nuevaClaveReset}
                    onChange={e => setNuevaClaveReset(e.target.value)}
                    className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg bg-white font-mono font-bold text-sm text-indigo-900"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(nuevaClaveReset);
                      mostrarNotificacion('ok', 'Contraseña copiada al portapapeles.');
                    }}
                    className="px-3 py-2 bg-white border border-indigo-300 rounded-lg font-bold text-indigo-800 hover:bg-indigo-100 cursor-pointer"
                  >
                    📋 Copiar
                  </button>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forzarCambioReset}
                  onChange={e => setForzarCambioReset(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="font-semibold text-[#334155]">
                  Solicitar al usuario que cambie esta clave al iniciar sesión
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setUsuarioReset(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoReset}
                  className="px-5 py-2 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded-xl shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {guardandoReset ? 'Actualizando...' : 'Aplicar Nueva Contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
