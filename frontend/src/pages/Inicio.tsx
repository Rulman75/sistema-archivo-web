import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

const COLORS = ['#016098', '#39BABD', '#22c55e', '#f59e0b', '#EB567F', '#6366f1'];

export default function Inicio() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    kpis: {
      TotalExpedientes: number;
      TotalFuncionarios: number;
      TotalMovimientosExp: number;
      ExpedientesPrestados: number;
      TotalComprobantes: number;
      ComprobantesPrestados: number;
    };
    porEstadoExpediente: { EstadoNombre: string; Cantidad: number }[];
    porUnidadSolicitante: { Unidad: string; Cantidad: number }[];
    prestamosRecientes: any[];
  } | null>(null);

  const cargarDashboard = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/dashboard/stats');
      if (res.data.status === 'ok') {
        setStats(res.data.data);
      }
    } catch (err) {
      console.error('Error al cargar dashboard de archivo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDashboard();
  }, []);

  const pieData = (stats?.porEstadoExpediente || []).map((item, idx) => ({
    name: item.EstadoNombre,
    value: item.Cantidad,
    color: COLORS[idx % COLORS.length]
  }));

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-6 rounded-xl shadow-sm border border-[#e2e8f0] gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#016098] mb-1">Dashboard General de Archivo</h1>
          <p className="text-sm text-[#64748b]">
            Resumen operativo de Expedientes de Funcionarios, Bitácoras de Préstamo y Comprobantes Contables CMDS
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/expedientes/ficha"
            className="px-4 py-2 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            + Gestionar Expedientes
          </Link>
          <Link
            to="/comprobantes/ficha"
            className="px-4 py-2 bg-[#39BABD] hover:bg-[#2da3a6] text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            + Gestionar Comprobantes
          </Link>
          <button
            onClick={cargarDashboard}
            className="px-3 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#475569] text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className={`transition-opacity duration-300 space-y-6 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        {stats && (
          <>
            {/* Tarjetas KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Total Expedientes */}
              <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-[#016098] flex items-center gap-4">
                <div className="bg-[#e0f2fe] p-3.5 rounded-full shrink-0">
                  <svg className="w-7 h-7 text-[#016098]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#64748b] uppercase tracking-wide">Total Expedientes</p>
                  <p className="text-2xl font-black text-[#1e293b] leading-tight">
                    {stats.kpis.TotalExpedientes.toLocaleString('es-CL')}
                  </p>
                  <p className="text-[11px] text-[#64748b] mt-0.5">
                    {stats.kpis.TotalFuncionarios.toLocaleString('es-CL')} funcionarios en nómina
                  </p>
                </div>
              </div>

              {/* Expedientes en Préstamo */}
              <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-[#EB567F] flex items-center gap-4">
                <div className="bg-rose-100 p-3.5 rounded-full shrink-0">
                  <svg className="w-7 h-7 text-[#EB567F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#64748b] uppercase tracking-wide">Exp. en Préstamo</p>
                  <p className="text-2xl font-black text-[#EB567F] leading-tight">
                    {stats.kpis.ExpedientesPrestados.toLocaleString('es-CL')}
                  </p>
                  <p className="text-[11px] text-[#64748b] mt-0.5">Estado actual: ENTREGADO</p>
                </div>
              </div>

              {/* Movimientos en Bitácora */}
              <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-[#39BABD] flex items-center gap-4">
                <div className="bg-cyan-100 p-3.5 rounded-full shrink-0">
                  <svg className="w-7 h-7 text-[#39BABD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#64748b] uppercase tracking-wide">Movimientos Bitácora</p>
                  <p className="text-2xl font-black text-[#1e293b] leading-tight">
                    {stats.kpis.TotalMovimientosExp.toLocaleString('es-CL')}
                  </p>
                  <p className="text-[11px] text-[#64748b] mt-0.5">Registros históricos de archivo</p>
                </div>
              </div>

              {/* Comprobantes Contables */}
              <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-amber-500 flex items-center gap-4">
                <div className="bg-amber-100 p-3.5 rounded-full shrink-0">
                  <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#64748b] uppercase tracking-wide">Comprobantes</p>
                  <p className="text-2xl font-black text-[#1e293b] leading-tight">
                    {stats.kpis.TotalComprobantes.toLocaleString('es-CL')}
                  </p>
                  <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
                    {stats.kpis.ComprobantesPrestados} actualmente en préstamo
                  </p>
                </div>
              </div>
            </div>

            {/* Gráficos Estadísticos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Distribución por Estado de Expediente */}
              <div className="bg-white rounded-xl shadow-sm p-6 border border-[#e2e8f0]">
                <h3 className="text-sm font-bold text-[#016098] uppercase mb-4">
                  Distribución de Expedientes por Estado
                </h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={true}
                        outerRadius={95}
                        dataKey="value"
                        label={({ name, percent }) =>
                          (percent || 0) > 0.02 ? `${name} ${((percent || 0) * 100).toFixed(1)}%` : ''
                        }
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: any) => [Number(value).toLocaleString('es-CL'), 'Expedientes']}
                        contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Movimientos por Unidad Solicitante */}
              <div className="bg-white rounded-xl shadow-sm p-6 border border-[#e2e8f0]">
                <h3 className="text-sm font-bold text-[#016098] uppercase mb-4">
                  Solicitudes de Préstamo por Unidad / Dirección
                </h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.porUnidadSolicitante}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        dataKey="Unidad"
                        type="category"
                        width={165}
                        tick={{ fontSize: 11, fill: '#334155' }}
                      />
                      <RechartsTooltip
                        formatter={(value: any) => [Number(value).toLocaleString('es-CL'), 'Movimientos']}
                        contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                      />
                      <Bar dataKey="Cantidad" fill="#016098" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Tabla Rápida: Últimos Expedientes Prestados (Pendientes de Devolución) */}
            <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] overflow-hidden">
              <div className="p-5 border-b border-[#e2e8f0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-[#016098]">
                    Últimos Expedientes Entregados (Pendientes de Devolución)
                  </h3>
                  <p className="text-xs text-[#64748b]">
                    Haga clic en &ldquo;Gestionar Devolución&rdquo; para abrir directamente la bitácora del funcionario
                  </p>
                </div>
                <Link
                  to="/informes/pendientes"
                  className="text-xs font-bold text-[#016098] hover:underline"
                >
                  Ver informe completo de pendientes &rarr;
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-[#f8fafc] text-[#475569] uppercase border-b border-[#e2e8f0]">
                    <tr>
                      <th className="py-3 px-4">N° Solicitud</th>
                      <th className="py-3 px-4">RUT</th>
                      <th className="py-3 px-4">Funcionario</th>
                      <th className="py-3 px-4">Unidad Solicitante</th>
                      <th className="py-3 px-4">Quien Retira</th>
                      <th className="py-3 px-4">Fecha Entrega</th>
                      <th className="py-3 px-4">N° Nómina</th>
                      <th className="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {stats.prestamosRecientes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#64748b]">
                          No hay expedientes pendientes de devolución en este momento.
                        </td>
                      </tr>
                    ) : (
                      stats.prestamosRecientes.map((item) => (
                        <tr key={item.NumMov} className="hover:bg-[#f8fafc] transition-colors">
                          <td className="py-2.5 px-4 font-bold text-[#016098]">#{item.NumMov}</td>
                          <td className="py-2.5 px-4 font-semibold whitespace-nowrap">
                            {item.Rut}{item.DV ? `-${item.DV}` : ''}
                          </td>
                          <td className="py-2.5 px-4 font-medium">
                            {`${item.Nombre} ${item.Paterno} ${item.Materno}`.trim() || 'Sin nombre en nómina'}
                          </td>
                          <td className="py-2.5 px-4">{item.Unidad}</td>
                          <td className="py-2.5 px-4 font-semibold">{item.Responsable}</td>
                          <td className="py-2.5 px-4 whitespace-nowrap">{item.Fecha}</td>
                          <td className="py-2.5 px-4">
                            {item.Nomina ? (
                              <span className="bg-blue-50 text-[#016098] font-bold px-2 py-0.5 rounded">
                                Nómina #{item.Nomina}
                              </span>
                            ) : (
                              <span className="text-gray-400">Individual</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              onClick={() => navigate(`/expedientes/bitacora?rut=${encodeURIComponent(item.Rut)}`)}
                              className="px-3 py-1 bg-[#016098] hover:bg-[#024a8d] text-white font-bold rounded-md text-[11px] transition-colors cursor-pointer"
                            >
                              Gestionar Devolución
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
