import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';

type TabInforme =
  | 'movimientos-fecha'
  | 'bitacora-funcionario'
  | 'nomina-expedientes'
  | 'bitacora-comprobante'
  | 'nomina-comprobantes'
  | 'pendientes';

interface InformesArchivoProps {
  tabInicial?: TabInforme;
}

function isoToDDMMYYYY(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('T')[0].split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return iso;
}

export default function InformesArchivo({ tabInicial = 'movimientos-fecha' }: InformesArchivoProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const todayISO = new Date().toISOString().split('T')[0];

  const [tabActiva, setTabActiva] = useState<TabInforme>(tabInicial);
  useEffect(() => {
    setTabActiva(tabInicial);
  }, [tabInicial]);

  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  // Parámetros de consulta de cada reporte
  const [fechaMov, setFechaMov] = useState(searchParams.get('fecha') || todayISO);
  const [rutFunc, setRutFunc] = useState(searchParams.get('rut') || '');
  const [nominaExp, setNominaExp] = useState(searchParams.get('nomina') || '');
  const [numComp, setNumComp] = useState(searchParams.get('numComp') || '');
  const [nominaComp, setNominaComp] = useState(searchParams.get('nomina') || '');
  const [tipoPendiente, setTipoPendiente] = useState<'expedientes' | 'comprobantes'>('expedientes');

  // Datos cargados para el documento formal
  const [registrosReporte, setRegistrosReporte] = useState<any[]>([]);
  const [fichaCabecera, setFichaCabecera] = useState<any>(null);

  // Ejecutar búsqueda automática si vienen parámetros en URL
  useEffect(() => {
    const f = searchParams.get('fecha');
    const r = searchParams.get('rut');
    const n = searchParams.get('nomina');
    const c = searchParams.get('numComp');

    if (tabInicial === 'movimientos-fecha' && f) {
      setFechaMov(f);
      consultarMovimientosFecha(f);
    } else if (tabInicial === 'bitacora-funcionario' && r) {
      setRutFunc(r);
      consultarBitacoraFuncionario(r);
    } else if (tabInicial === 'nomina-expedientes' && n) {
      setNominaExp(n);
      consultarNominaExpedientes(n);
    } else if (tabInicial === 'bitacora-comprobante' && c) {
      setNumComp(c);
      consultarBitacoraComprobante(c);
    } else if (tabInicial === 'nomina-comprobantes' && n) {
      setNominaComp(n);
      consultarNominaComprobantes(n);
    } else if (tabInicial === 'pendientes') {
      consultarPendientes(tipoPendiente);
    }
  }, [tabInicial, searchParams]);

  // 1. Informe Movimientos por Fecha (Report1.rdlc / Form4.vb)
  const consultarMovimientosFecha = async (fVal = fechaMov) => {
    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get('/api/expedientes/bitacora', {
        params: { fecha: fVal, limit: 500 }
      });
      if (res.data.status === 'ok') {
        const movs = res.data.movimientos || [];
        setRegistrosReporte(movs);
        setFichaCabecera({ fecha: isoToDDMMYYYY(fVal) });
        if (movs.length === 0) {
          setMensaje({
            tipo: 'info',
            texto: `No se encontraron movimientos registrados en la fecha ${isoToDDMMYYYY(fVal)}`
          });
        }
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar movimientos por fecha' });
    } finally {
      setCargando(false);
    }
  };

  // 2. Reporte Bitácora por Funcionario (Report4.rdlc / Imprime_bitacora.vb)
  const consultarBitacoraFuncionario = async (rVal = rutFunc) => {
    const limpio = String(rVal).replace(/\./g, '').split('-')[0].trim();
    if (!limpio) {
      setMensaje({ tipo: 'error', texto: 'Ingrese el RUT del funcionario para generar su bitácora' });
      return;
    }
    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get(`/api/expedientes/ficha/${encodeURIComponent(limpio)}`);
      if (res.data.status === 'ok') {
        setFichaCabecera({
          funcionario: res.data.funcionario,
          expediente: res.data.expediente,
          rut: res.data.rut,
          dv: res.data.dv
        });
        setRegistrosReporte(res.data.movimientos || []);
      } else {
        setFichaCabecera(null);
        setRegistrosReporte([]);
        setMensaje({ tipo: 'error', texto: `No se encontró expediente o funcionario con RUT ${limpio}` });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar bitácora del funcionario' });
    } finally {
      setCargando(false);
    }
  };

  // 3. Nómina Salida de Expedientes (Report3.rdlc / Imprime_nominas.vb)
  const consultarNominaExpedientes = async (nVal = nominaExp) => {
    if (!String(nVal).trim()) {
      setMensaje({ tipo: 'error', texto: 'Ingrese el N° de Nómina de Expedientes' });
      return;
    }
    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get(`/api/expedientes/nominas/${encodeURIComponent(nVal.trim())}`);
      if (res.data.status === 'ok') {
        const movs = res.data.movimientos || [];
        setRegistrosReporte(movs);
        setFichaCabecera({
          nomina: nVal.trim(),
          unidad: movs[0]?.Unidad || '',
          responsable: movs[0]?.Responsable || '',
          fecha: movs[0]?.Fecha || isoToDDMMYYYY(todayISO),
          observacion: movs[0]?.Observacion || ''
        });
        if (movs.length === 0) {
          setMensaje({ tipo: 'info', texto: `La Nómina de Expedientes N° ${nVal} no registra movimientos` });
        }
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar la nómina de expedientes' });
    } finally {
      setCargando(false);
    }
  };

  // 4. Reporte Bitácora por Comprobante (Report5.rdlc / Imprime_bitacora_Comp.vb)
  const consultarBitacoraComprobante = async (cVal = numComp) => {
    if (!String(cVal).trim()) {
      setMensaje({ tipo: 'error', texto: 'Ingrese el N° de Comprobante Contable' });
      return;
    }
    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get(`/api/comprobantes/ficha/${encodeURIComponent(cVal.trim())}`);
      if (res.data.status === 'ok' && res.data.comprobante) {
        setFichaCabecera(res.data.comprobante);
        setRegistrosReporte(res.data.movimientos || []);
      } else {
        setFichaCabecera(null);
        setRegistrosReporte([]);
        setMensaje({ tipo: 'error', texto: `No se encontró el Comprobante N° ${cVal}` });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar bitácora del comprobante' });
    } finally {
      setCargando(false);
    }
  };

  // 5. Nómina Salida de Comprobantes (Report6.rdlc / Imprime_nominas_Comp.vb)
  const consultarNominaComprobantes = async (nVal = nominaComp) => {
    if (!String(nVal).trim()) {
      setMensaje({ tipo: 'error', texto: 'Ingrese el N° de Nómina de Comprobantes' });
      return;
    }
    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get(`/api/comprobantes/nominas/${encodeURIComponent(nVal.trim())}`);
      if (res.data.status === 'ok') {
        const movs = res.data.movimientos || [];
        setRegistrosReporte(movs);
        setFichaCabecera({
          nomina: nVal.trim(),
          unidad: movs[0]?.Unidad || '',
          responsable: movs[0]?.Responsable || '',
          fecha: movs[0]?.FechaEnt || isoToDDMMYYYY(todayISO),
          observacion: movs[0]?.Observacion || ''
        });
        if (movs.length === 0) {
          setMensaje({ tipo: 'info', texto: `La Nómina de Comprobantes N° ${nVal} no registra movimientos` });
        }
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar la nómina de comprobantes' });
    } finally {
      setCargando(false);
    }
  };

  // 6. Informe de Préstamos Pendientes de Devolución
  const consultarPendientes = async (tipo = tipoPendiente) => {
    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get('/api/informes/pendientes', { params: { tipo } });
      if (res.data.status === 'ok') {
        setRegistrosReporte(res.data.registros || []);
        setFichaCabecera({ tipo });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar préstamos pendientes' });
    } finally {
      setCargando(false);
    }
  };

  const exportarReporteExcel = () => {
    if (registrosReporte.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(registrosReporte);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Informe_Archivo');
    XLSX.writeFile(wb, `Informe_${tabActiva}_${todayISO}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Estilos de Impresión para documento formal CMDS */}
      <style>{`
        @media print {
          aside, .no-print {
            display: none !important;
          }
          body, html, #root {
            background: white !important;
            height: auto !important;
            overflow: visible !important;
          }
          .print-container {
            box-shadow: none !important;
            border: 1px solid #000 !important;
            padding: 18px !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>

      {/* Barra Superior de Selección de Informe (Oculta al imprimir) */}
      <div className="no-print bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-5 flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-[#016098]">
              Centro de Informes Oficiales y Nóminas de Archivo
            </h1>
            <p className="text-xs text-[#64748b] mt-0.5">
              Formatos institucionales CMDS listos para Imprimir / Guardar en PDF y Exportar a Excel
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={registrosReporte.length === 0 && !fichaCabecera}
              className="px-4 py-2 bg-[#016098] hover:bg-[#024a8d] disabled:opacity-40 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
            >
              🖨️ Imprimir / Guardar PDF
            </button>
            <button
              type="button"
              onClick={exportarReporteExcel}
              disabled={registrosReporte.length === 0}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
            >
              📊 Exportar a Excel
            </button>
          </div>
        </div>

        {/* Pestañas de los 6 Reportes */}
        <div className="flex flex-wrap gap-1.5 bg-[#f1f5f9] p-1.5 rounded-xl">
          {[
            { id: 'movimientos-fecha', label: 'Movimientos por Fecha' },
            { id: 'bitacora-funcionario', label: 'Bitácora Funcionario' },
            { id: 'nomina-expedientes', label: 'Nómina Salida Expedientes' },
            { id: 'bitacora-comprobante', label: 'Bitácora Comprobante' },
            { id: 'nomina-comprobantes', label: 'Nómina Salida Comprobantes' },
            { id: 'pendientes', label: 'Préstamos Pendientes Dev.' }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setRegistrosReporte([]);
                setFichaCabecera(null);
                setMensaje(null);
                navigate(`/informes/${t.id}`);
              }}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                tabActiva === t.id
                  ? 'bg-[#016098] text-white shadow-sm'
                  : 'text-[#475569] hover:text-[#016098]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Barra de Filtros según Reporte Activo */}
        <div className="pt-2 border-t border-[#e2e8f0] flex flex-wrap items-end gap-3">
          {tabActiva === 'movimientos-fecha' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  Fecha de Movimientos
                </label>
                <input
                  type="date"
                  value={fechaMov}
                  onChange={(e) => setFechaMov(e.target.value)}
                  className="px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => consultarMovimientosFecha()}
                disabled={cargando}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Generar Informe por Fecha
              </button>
            </>
          )}

          {tabActiva === 'bitacora-funcionario' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  RUT Funcionario (sin puntos ni DV)
                </label>
                <input
                  type="text"
                  value={rutFunc}
                  onChange={(e) => setRutFunc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && consultarBitacoraFuncionario()}
                  placeholder="Ej: 7517333"
                  className="px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => consultarBitacoraFuncionario()}
                disabled={cargando}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Generar Bitácora Funcionario
              </button>
            </>
          )}

          {tabActiva === 'nomina-expedientes' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  N° de Nómina de Expedientes
                </label>
                <input
                  type="number"
                  value={nominaExp}
                  onChange={(e) => setNominaExp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && consultarNominaExpedientes()}
                  placeholder="Ej: 1"
                  className="px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => consultarNominaExpedientes()}
                disabled={cargando}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Generar Nómina de Expedientes
              </button>
            </>
          )}

          {tabActiva === 'bitacora-comprobante' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  N° de Comprobante Contable
                </label>
                <input
                  type="number"
                  value={numComp}
                  onChange={(e) => setNumComp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && consultarBitacoraComprobante()}
                  placeholder="Ej: 796"
                  className="px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => consultarBitacoraComprobante()}
                disabled={cargando}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Generar Bitácora Comprobante
              </button>
            </>
          )}

          {tabActiva === 'nomina-comprobantes' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  N° de Nómina de Comprobantes
                </label>
                <input
                  type="number"
                  value={nominaComp}
                  onChange={(e) => setNominaComp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && consultarNominaComprobantes()}
                  placeholder="Ej: 1"
                  className="px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => consultarNominaComprobantes()}
                disabled={cargando}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Generar Nómina de Comprobantes
              </button>
            </>
          )}

          {tabActiva === 'pendientes' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  Tipo de Documento en Préstamo
                </label>
                <select
                  value={tipoPendiente}
                  onChange={(e) => {
                    const val = e.target.value as 'expedientes' | 'comprobantes';
                    setTipoPendiente(val);
                    consultarPendientes(val);
                  }}
                  className="px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                >
                  <option value="expedientes">Expedientes de Funcionarios (ENTREGADOS)</option>
                  <option value="comprobantes">Comprobantes Contables (ENTREGADOS)</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => consultarPendientes(tipoPendiente)}
                disabled={cargando}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Actualizar Listado Pendientes
              </button>
            </>
          )}
        </div>
      </div>

      {mensaje && (
        <div
          className={`no-print p-4 rounded-xl border text-sm font-medium flex justify-between items-center ${
            mensaje.tipo === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : mensaje.tipo === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'
          }`}
        >
          <span>{mensaje.texto}</span>
          <button onClick={() => setMensaje(null)} className="text-xs font-bold ml-4 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* =====================================================================
          DOCUMENTO FORMAL IMPRIMIBLE CON MEMBRETE CMDS
      ===================================================================== */}
      {(fichaCabecera || registrosReporte.length > 0) && (
        <div className="print-container bg-white rounded-xl shadow-sm border border-[#cbd5e1] p-8 max-w-5xl mx-auto text-[#1e293b] space-y-6">
          {/* Membrete Institucional CMDS */}
          <div className="flex justify-between items-start border-b-2 border-[#016098] pb-4">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="CMDS"
                className="w-14 h-auto"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div>
                <p className="text-xs font-extrabold text-[#016098] uppercase">
                  CORPORACIÓN MUNICIPAL DE DESARROLLO SOCIAL DE ANTOFAGASTA
                </p>
                <p className="text-[11px] font-semibold text-[#475569]">
                  DIRECCIÓN DE RECURSOS HUMANOS — UNIDAD DE ARCHIVO CENTRAL
                </p>
                <p className="text-[11px] text-[#64748b]">AV. ARGENTINA 1595, ANTOFAGASTA</p>
              </div>
            </div>
            <div className="text-right text-xs text-[#64748b]">
              <p>Fecha Emisión: {isoToDDMMYYYY(todayISO)}</p>
              <p className="font-bold text-[#016098]">Total Registros: {registrosReporte.length}</p>
            </div>
          </div>

          {/* Título Dinámico según el Reporte */}
          <div className="text-center space-y-1">
            {tabActiva === 'movimientos-fecha' && (
              <>
                <h2 className="text-base font-extrabold uppercase tracking-wide">
                  INFORME DE MOVIMIENTOS DIARIOS DE BITÁCORA
                </h2>
                <p className="text-xs font-bold text-[#016098]">
                  FECHA CONSULTADA: {fichaCabecera?.fecha || isoToDDMMYYYY(fechaMov)}
                </p>
              </>
            )}
            {tabActiva === 'bitacora-funcionario' && (
              <>
                <h2 className="text-base font-extrabold uppercase tracking-wide">
                  REPORTE MOVIMIENTOS BITÁCORA POR FUNCIONARIO
                </h2>
                <p className="text-xs font-bold text-[#016098]">
                  HISTORIAL DE PRÉSTAMOS Y DEVOLUCIONES DE EXPEDIENTE
                </p>
              </>
            )}
            {tabActiva === 'nomina-expedientes' && (
              <>
                <h2 className="text-base font-extrabold uppercase tracking-wide">
                  NÓMINA SALIDA DE EXPEDIENTES DE ARCHIVO
                </h2>
                <p className="text-sm font-extrabold text-[#016098]">
                  N° NÓMINA: {fichaCabecera?.nomina || nominaExp}
                </p>
              </>
            )}
            {tabActiva === 'bitacora-comprobante' && (
              <>
                <h2 className="text-base font-extrabold uppercase tracking-wide">
                  REPORTE MOVIMIENTOS BITÁCORA POR COMPROBANTE CONTABLE
                </h2>
                <p className="text-sm font-extrabold text-[#016098]">
                  COMPROBANTE N° {fichaCabecera?.NumComp || numComp}
                </p>
              </>
            )}
            {tabActiva === 'nomina-comprobantes' && (
              <>
                <h2 className="text-base font-extrabold uppercase tracking-wide">
                  NÓMINA SALIDA DE COMPROBANTES DE ARCHIVO
                </h2>
                <p className="text-sm font-extrabold text-[#016098]">
                  N° NÓMINA: {fichaCabecera?.nomina || nominaComp}
                </p>
              </>
            )}
            {tabActiva === 'pendientes' && (
              <>
                <h2 className="text-base font-extrabold uppercase tracking-wide">
                  INFORME DE CONTROL DE PRÉSTAMOS PENDIENTES DE DEVOLUCIÓN
                </h2>
                <p className="text-xs font-bold text-[#EB567F] uppercase">
                  ESTADO ACTUAL: ENTREGADO ({tipoPendiente.toUpperCase()})
                </p>
              </>
            )}
          </div>

          {/* Recuadro de Cabecera para Bitácora Funcionario */}
          {tabActiva === 'bitacora-funcionario' && fichaCabecera?.funcionario && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border border-[#cbd5e1] rounded-lg p-4 text-xs bg-[#f8fafc]">
              <div className="col-span-2">
                <span className="text-[#64748b] block">FUNCIONARIO(A)</span>
                <span className="font-bold text-sm">
                  {`${fichaCabecera.funcionario.Nombre} ${fichaCabecera.funcionario.Paterno} ${fichaCabecera.funcionario.Materno}`.trim()}
                </span>
              </div>
              <div>
                <span className="text-[#64748b] block">R.U.T.</span>
                <span className="font-bold text-sm text-[#016098]">
                  {fichaCabecera.rut}-{fichaCabecera.dv}
                </span>
              </div>
              <div>
                <span className="text-[#64748b] block">ESTADO / KÁRDEX</span>
                <span className="font-bold">
                  {fichaCabecera.expediente?.Estado || 'Vigente'} — {fichaCabecera.expediente?.Kardex || 'S/I'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-[#64748b] block">ESTABLECIMIENTO / CENCO</span>
                <span className="font-semibold">{fichaCabecera.funcionario.CodUnidad || 'No especificado'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-[#64748b] block">PLANTA / CARGO</span>
                <span className="font-semibold">{fichaCabecera.funcionario.DescripcionPlanta || 'No especificado'}</span>
              </div>
            </div>
          )}

          {/* Recuadro de Cabecera para Bitácora Comprobante */}
          {tabActiva === 'bitacora-comprobante' && fichaCabecera && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border border-[#cbd5e1] rounded-lg p-4 text-xs bg-[#f8fafc]">
              <div>
                <span className="text-[#64748b] block">N° COMPROBANTE</span>
                <span className="font-extrabold text-sm text-[#016098]">#{fichaCabecera.NumComp}</span>
              </div>
              <div>
                <span className="text-[#64748b] block">TIPO / SECTOR</span>
                <span className="font-bold">
                  {fichaCabecera.TipoComp} — {fichaCabecera.SectorComp}
                </span>
              </div>
              <div>
                <span className="text-[#64748b] block">FECHA COMP. / RECEP.</span>
                <span className="font-semibold">
                  {fichaCabecera.FechaComp} / {fichaCabecera.FechaRecep}
                </span>
              </div>
              <div>
                <span className="text-[#64748b] block">ARCHIVADOR</span>
                <span className="font-semibold">
                  N° {fichaCabecera.NumArchiv} ({fichaCabecera.MesArchiv} / {fichaCabecera.AnoArchiv})
                </span>
              </div>
            </div>
          )}

          {/* Recuadro de Cabecera para Nóminas (Expedientes o Comprobantes) */}
          {(tabActiva === 'nomina-expedientes' || tabActiva === 'nomina-comprobantes') && fichaCabecera && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border border-[#cbd5e1] rounded-lg p-4 text-xs bg-[#f8fafc]">
              <div>
                <span className="text-[#64748b] block">UNIDAD / DIRECCIÓN SOLICITANTE</span>
                <span className="font-bold text-sm">{fichaCabecera.unidad || '-'}</span>
              </div>
              <div>
                <span className="text-[#64748b] block">PERSONA QUE RETIRA (RESPONSABLE)</span>
                <span className="font-bold text-sm text-[#016098]">{fichaCabecera.responsable || '-'}</span>
              </div>
              <div>
                <span className="text-[#64748b] block">FECHA DE SALIDA</span>
                <span className="font-bold text-sm">{fichaCabecera.fecha || '-'}</span>
              </div>
            </div>
          )}

          {/* Tabla Principal del Reporte */}
          <div>
            {tabActiva === 'bitacora-comprobante' ||
            tabActiva === 'nomina-comprobantes' ||
            (tabActiva === 'pendientes' && tipoPendiente === 'comprobantes') ? (
              <table className="w-full text-xs border-collapse border border-[#cbd5e1]">
                <thead className="bg-[#f1f5f9]">
                  <tr>
                    <th className="border border-[#cbd5e1] p-2 text-left">N° Solic.</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">N° Comp.</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">Unidad Solicitante</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">Responsable Retiro</th>
                    <th className="border border-[#cbd5e1] p-2 text-center">Fecha Entrega</th>
                    <th className="border border-[#cbd5e1] p-2 text-center">Fecha Dev.</th>
                    <th className="border border-[#cbd5e1] p-2 text-center">Estado</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {registrosReporte.map((r, idx) => (
                    <tr key={idx}>
                      <td className="border border-[#cbd5e1] p-2 font-bold">#{r.NumMovCom}</td>
                      <td className="border border-[#cbd5e1] p-2 font-extrabold text-[#016098]">#{r.NumComp}</td>
                      <td className="border border-[#cbd5e1] p-2">{r.Unidad}</td>
                      <td className="border border-[#cbd5e1] p-2 font-semibold">{r.Responsable}</td>
                      <td className="border border-[#cbd5e1] p-2 text-center">{r.FechaEnt}</td>
                      <td className="border border-[#cbd5e1] p-2 text-center">{r.FechaDev || '-'}</td>
                      <td className="border border-[#cbd5e1] p-2 text-center font-bold">{r.Estado}</td>
                      <td className="border border-[#cbd5e1] p-2">{r.Observacion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs border-collapse border border-[#cbd5e1]">
                <thead className="bg-[#f1f5f9]">
                  <tr>
                    <th className="border border-[#cbd5e1] p-2 text-left">N° Solic.</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">RUT</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">Funcionario(a)</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">Unidad Solicitante</th>
                    <th className="border border-[#cbd5e1] p-2 text-left">Quien Retira</th>
                    <th className="border border-[#cbd5e1] p-2 text-center">Fecha Solic.</th>
                    <th className="border border-[#cbd5e1] p-2 text-center">Fecha Dev.</th>
                    <th className="border border-[#cbd5e1] p-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {registrosReporte.map((r, idx) => (
                    <tr key={idx}>
                      <td className="border border-[#cbd5e1] p-2 font-bold">#{r.NumMov}</td>
                      <td className="border border-[#cbd5e1] p-2 font-semibold whitespace-nowrap">
                        {r.Rut}
                        {r.DV ? `-${r.DV}` : ''}
                      </td>
                      <td className="border border-[#cbd5e1] p-2">
                        {`${r.Nombre || ''} ${r.Paterno || ''} ${r.Materno || ''}`.trim() ||
                          (fichaCabecera?.funcionario
                            ? `${fichaCabecera.funcionario.Nombre} ${fichaCabecera.funcionario.Paterno} ${fichaCabecera.funcionario.Materno}`.trim()
                            : '-')}
                      </td>
                      <td className="border border-[#cbd5e1] p-2">{r.Unidad}</td>
                      <td className="border border-[#cbd5e1] p-2 font-semibold">{r.Responsable}</td>
                      <td className="border border-[#cbd5e1] p-2 text-center">{r.Fecha}</td>
                      <td className="border border-[#cbd5e1] p-2 text-center">{r.FechaDev || '-'}</td>
                      <td className="border border-[#cbd5e1] p-2 text-center font-bold">{r.Estado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Bloque Oficial de Firmas al Pie (Report3.rdlc y Report6.rdlc) */}
          <div className="pt-16 pb-4 grid grid-cols-2 gap-12 text-center text-xs">
            <div className="border-t border-[#1e293b] pt-2 mx-8">
              <p className="font-bold uppercase">
                {fichaCabecera?.responsable || 'NOMBRE Y FIRMA RESPONSABLE RETIRO'}
              </p>
              <p className="text-[#64748b] text-[11px]">{fichaCabecera?.unidad || 'Unidad Solicitante'}</p>
            </div>
            <div className="border-t border-[#1e293b] pt-2 mx-8">
              <p className="font-bold uppercase">ENTREGADO POR (ENCARGADO DE ARCHIVO)</p>
              <p className="text-[#64748b] text-[11px]">Unidad de Archivo Central CMDS</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
