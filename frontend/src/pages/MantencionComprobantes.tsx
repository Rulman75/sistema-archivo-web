import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface MantencionComprobantesProps {
  tabInicial?: 'ficha' | 'bitacora' | 'nominas';
}

function ddmmyyyyToISO(val: string): string {
  if (!val) return '';
  const clean = String(val).trim();
  const parts = clean.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    if (parts[0].length === 4) {
      return clean.slice(0, 10);
    }
  }
  return '';
}

export default function MantencionComprobantes({ tabInicial = 'ficha' }: MantencionComprobantesProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const todayISO = new Date().toISOString().split('T')[0];

  const [tabActiva, setTabActiva] = useState<'ficha' | 'bitacora' | 'nominas'>(tabInicial);
  useEffect(() => {
    setTabActiva(tabInicial);
  }, [tabInicial]);

  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  const unidadesComp = [
    'Departamento Auditoria',
    'Departamento Contabilidad',
    'Departamento Juridica',
    'Departamento Planificación',
    'Dirección de Educación',
    'Dirección de Obras',
    'Dirección de Salud',
    'Unidad Presupuesto',
    'Unidad Tesoreria'
  ];

  // --- ESTADO PESTAÑA 1: ANTECEDENTES COMPROBANTE ---
  const [numComp, setNumComp] = useState('');
  const [fechaComp, setFechaComp] = useState(todayISO);
  const [fechaRecep, setFechaRecep] = useState(todayISO);
  const [tipoComp, setTipoComp] = useState('CE');
  const [sectorComp, setSectorComp] = useState('Educación');
  const [numArchiv, setNumArchiv] = useState('');
  const [mesArchiv, setMesArchiv] = useState('');
  const [anoArchiv, setAnoArchiv] = useState(String(new Date().getFullYear()));
  const [obsComp, setObsComp] = useState('');
  const [existeComprobante, setExisteComprobante] = useState<boolean | null>(null);

  // Listado lateral de Comprobantes
  const [filtroTextoComp, setFiltroTextoComp] = useState('');
  const [filtroSectorComp, setFiltroSectorComp] = useState('TODOS');
  const [listaComprobantes, setListaComprobantes] = useState<any[]>([]);

  // --- ESTADO PESTAÑA 2: REGISTRO BITÁCORA COMPROBANTE ---
  const [modoBitacora, setModoBitacora] = useState<'entrega' | 'devolucion'>('entrega');
  const [nextNumMovCom, setNextNumMovCom] = useState<number>(0);
  const [numMovComSeleccionado, setNumMovComSeleccionado] = useState<number | null>(null);
  const [unidadBitacora, setUnidadBitacora] = useState('Departamento Contabilidad');
  const [responsableBitacora, setResponsableBitacora] = useState('');
  const [fechaEntBitacora, setFechaEntBitacora] = useState(todayISO);
  const [fechaDevBitacora, setFechaDevBitacora] = useState(todayISO);
  const [obsBitacora, setObsBitacora] = useState('');

  // --- ESTADO PESTAÑA 3: NÓMINAS DE COMPROBANTES ---
  const [modoNomina, setModoNomina] = useState<'entrega' | 'devolucion-parcial' | 'devolucion-total'>('entrega');
  const [numNomina, setNumNomina] = useState('');
  const [unidadNomina, setUnidadNomina] = useState('Departamento Contabilidad');
  const [responsableNomina, setResponsableNomina] = useState('');
  const [fechaEntNomina, setFechaEntNomina] = useState(todayISO);
  const [fechaDevNomina, setFechaDevNomina] = useState(todayISO);
  const [obsNomina, setObsNomina] = useState('');
  const [numCompAgregarNomina, setNumCompAgregarNomina] = useState('');
  const [numMovComNominaSel, setNumMovComNominaSel] = useState<number | null>(null);

  // Grilla Inferior MovimientosComp
  const [movimientosBitacora, setMovimientosBitacora] = useState<any[]>([]);
  const [mostrandoTodosMov, setMostrandoTodosMov] = useState(false);

  const cargarListaComprobantes = async () => {
    try {
      const res = await axios.get('/api/comprobantes/lista', {
        params: { q: filtroTextoComp, sector: filtroSectorComp }
      });
      if (res.data.status === 'ok') {
        setListaComprobantes(res.data.registros || []);
      }
    } catch (err) {
      console.error('Error cargando lista de comprobantes:', err);
    }
  };

  useEffect(() => {
    cargarListaComprobantes();
  }, [filtroSectorComp]);

  useEffect(() => {
    const nc = searchParams.get('numComp');
    if (nc) {
      setNumComp(nc);
      buscarComprobante(nc);
    }
  }, [searchParams]);

  const buscarComprobante = async (nRaw?: string) => {
    const n = String(nRaw ?? numComp).trim();
    if (!n) {
      setMensaje({ tipo: 'error', texto: 'Ingrese un N° de Comprobante para consultar' });
      return;
    }

    setCargando(true);
    setMensaje(null);
    setMostrandoTodosMov(false);
    try {
      const res = await axios.get(`/api/comprobantes/ficha/${encodeURIComponent(n)}`);
      const data = res.data;
      if (data.nextNumMovCom) setNextNumMovCom(data.nextNumMovCom);

      if (data.status === 'ok' && data.comprobante) {
        const c = data.comprobante;
        setExisteComprobante(true);
        setNumComp(String(c.NumComp));
        setFechaComp(ddmmyyyyToISO(c.FechaComp) || todayISO);
        setFechaRecep(ddmmyyyyToISO(c.FechaRecep) || todayISO);
        setTipoComp(c.TipoComp || 'CE');
        setSectorComp(c.SectorComp || 'Educación');
        setNumArchiv(c.NumArchiv !== null && c.NumArchiv !== undefined ? String(c.NumArchiv) : '');
        setMesArchiv(c.MesArchiv || '');
        setAnoArchiv(c.AnoArchiv || '');
        setObsComp(c.ObsComp || '');

        const movs = data.movimientos || [];
        setMovimientosBitacora(movs);

        if (movs.length > 0 && String(movs[0].Estado).toUpperCase() === 'ENTREGADO') {
          setNumMovComSeleccionado(movs[0].NumMovCom);
          setUnidadBitacora(movs[0].Unidad || 'Departamento Contabilidad');
          setResponsableBitacora(movs[0].Responsable || '');
          setObsBitacora(movs[0].Observacion || '');
        } else {
          setNumMovComSeleccionado(null);
        }
      } else {
        setExisteComprobante(false);
        setMovimientosBitacora([]);
        setMensaje({
          tipo: 'info',
          texto: `El Comprobante N° ${n} no está registrado. Complete los antecedentes y presione "Guardar Comprobante" para crearlo.`
        });
      }
    } catch (err: any) {
      setMensaje({
        tipo: 'error',
        texto: err.response?.data?.error || 'Error al consultar el comprobante'
      });
    } finally {
      setCargando(false);
    }
  };

  const limpiarComprobante = () => {
    setNumComp('');
    setFechaComp(todayISO);
    setFechaRecep(todayISO);
    setTipoComp('CE');
    setSectorComp('Educación');
    setNumArchiv('');
    setMesArchiv('');
    setAnoArchiv(String(new Date().getFullYear()));
    setObsComp('');
    setExisteComprobante(null);
    setMovimientosBitacora([]);
    setNumMovComSeleccionado(null);
    setMensaje(null);
  };

  const guardarComprobante = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numComp.trim()) {
      setMensaje({ tipo: 'error', texto: 'Debe ingresar el N° de Comprobante' });
      return;
    }

    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.post('/api/comprobantes/ficha', {
        numComp,
        fechaComp,
        fechaRecep,
        tipoComp,
        sectorComp,
        numArchiv,
        mesArchiv,
        anoArchiv,
        obsComp
      });
      if (res.data.status === 'ok') {
        setMensaje({ tipo: 'ok', texto: res.data.message });
        await buscarComprobante(numComp);
        cargarListaComprobantes();
      }
    } catch (err: any) {
      setMensaje({
        tipo: 'error',
        texto: err.response?.data?.error || 'Error al guardar el comprobante'
      });
    } finally {
      setCargando(false);
    }
  };

  const guardarBitacoraComprobante = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modoBitacora === 'entrega') {
      if (!numComp.trim()) {
        setMensaje({ tipo: 'error', texto: 'Primero seleccione o busque un N° de Comprobante' });
        return;
      }
      if (!unidadBitacora.trim() || !responsableBitacora.trim()) {
        setMensaje({ tipo: 'error', texto: 'Complete "Solicitado por" y "Quien Retira"' });
        return;
      }

      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.post('/api/comprobantes/bitacora/entrega', {
          numComp,
          unidad: unidadBitacora,
          responsable: responsableBitacora,
          fechaEnt: fechaEntBitacora,
          observacion: obsBitacora
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          setObsBitacora('');
          await buscarComprobante(numComp);
          cargarListaComprobantes();
        }
      } catch (err: any) {
        setMensaje({
          tipo: 'error',
          texto: err.response?.data?.error || 'No fue posible registrar la entrega del comprobante'
        });
      } finally {
        setCargando(false);
      }
    } else {
      if (!numMovComSeleccionado) {
        setMensaje({
          tipo: 'error',
          texto: 'Seleccione en la tabla inferior la solicitud con estado ENTREGADO que desea devolver'
        });
        return;
      }
      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.put(`/api/comprobantes/bitacora/devolucion/${numMovComSeleccionado}`, {
          fechaDev: fechaDevBitacora,
          unidad: unidadBitacora,
          responsable: responsableBitacora,
          observacion: obsBitacora
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          if (numComp) await buscarComprobante(numComp);
          else await verTodosMovimientosComp();
          cargarListaComprobantes();
        }
      } catch (err: any) {
        setMensaje({
          tipo: 'error',
          texto: err.response?.data?.error || 'Error al registrar la devolución'
        });
      } finally {
        setCargando(false);
      }
    }
  };

  // --- FUNCIONES PESTAÑA 3: NÓMINAS DE COMPROBANTES ---
  const obtenerSiguienteNominaComp = async () => {
    try {
      const res = await axios.get('/api/comprobantes/nominas/next-id');
      if (res.data.status === 'ok') {
        setNumNomina(String(res.data.nextNomina));
        setMovimientosBitacora([]);
        setMensaje({
          tipo: 'info',
          texto: `Se asignó el correlativo N° de Nómina ${res.data.nextNomina} para Comprobantes.`
        });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al obtener correlativo de nómina de comprobantes' });
    }
  };

  const buscarNominaComp = async (nNom?: string) => {
    const num = String(nNom ?? numNomina).trim();
    if (!num) {
      setMensaje({ tipo: 'error', texto: 'Ingrese un N° de Nómina de Comprobantes' });
      return;
    }

    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get(`/api/comprobantes/nominas/${encodeURIComponent(num)}`);
      if (res.data.status === 'ok') {
        const movs = res.data.movimientos || [];
        setMovimientosBitacora(movs);
        if (movs.length > 0) {
          setUnidadNomina(movs[0].Unidad || 'Departamento Contabilidad');
          setResponsableNomina(movs[0].Responsable || '');
          setObsNomina(movs[0].Observacion || '');
        } else {
          setMensaje({ tipo: 'info', texto: `La Nómina de Comprobantes N° ${num} aún no tiene registros` });
        }
      }
    } catch (err: any) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al consultar la nómina' });
    } finally {
      setCargando(false);
    }
  };

  const ejecutarAccionNominaComp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numNomina.trim()) {
      setMensaje({ tipo: 'error', texto: 'Indique o genere un N° de Nómina' });
      return;
    }

    if (modoNomina === 'entrega') {
      if (!numCompAgregarNomina.trim()) {
        setMensaje({ tipo: 'error', texto: 'Ingrese el N° de Comprobante a agregar en la nómina' });
        return;
      }
      if (!unidadNomina.trim() || !responsableNomina.trim()) {
        setMensaje({ tipo: 'error', texto: 'Complete "Solicitado por" y "Quien Retira"' });
        return;
      }

      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.post('/api/comprobantes/nominas/entrega', {
          nomina: numNomina,
          numComp: numCompAgregarNomina,
          unidad: unidadNomina,
          responsable: responsableNomina,
          fechaEnt: fechaEntNomina,
          observacion: obsNomina
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          setNumCompAgregarNomina('');
          await buscarNominaComp(numNomina);
          cargarListaComprobantes();
        }
      } catch (err: any) {
        setMensaje({
          tipo: 'error',
          texto: err.response?.data?.error || 'Error al agregar comprobante a la nómina'
        });
      } finally {
        setCargando(false);
      }
    } else if (modoNomina === 'devolucion-parcial') {
      if (!numMovComNominaSel) {
        setMensaje({
          tipo: 'error',
          texto: 'Seleccione una fila en la tabla inferior para registrar su Devolución Parcial'
        });
        return;
      }
      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.put(`/api/comprobantes/nominas/devolucion-parcial/${numMovComNominaSel}`, {
          fechaDev: fechaDevNomina
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          setNumMovComNominaSel(null);
          await buscarNominaComp(numNomina);
          cargarListaComprobantes();
        }
      } catch (err: any) {
        setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error en devolución parcial' });
      } finally {
        setCargando(false);
      }
    } else {
      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.put(`/api/comprobantes/nominas/devolucion-total/${encodeURIComponent(numNomina)}`, {
          fechaDev: fechaDevNomina
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          await buscarNominaComp(numNomina);
          cargarListaComprobantes();
        }
      } catch (err: any) {
        setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error en devolución total' });
      } finally {
        setCargando(false);
      }
    }
  };

  const verTodosMovimientosComp = async () => {
    setCargando(true);
    setMostrandoTodosMov(true);
    try {
      const res = await axios.get('/api/comprobantes/bitacora');
      if (res.data.status === 'ok') {
        setMovimientosBitacora(res.data.movimientos || []);
        if (res.data.nextNumMovCom) setNextNumMovCom(res.data.nextNumMovCom);
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al consultar la bitácora general de comprobantes' });
    } finally {
      setCargando(false);
    }
  };

  const exportarBitacoraCompExcel = () => {
    if (movimientosBitacora.length === 0) return;
    const rows = movimientosBitacora.map((m) => ({
      'N° Solicitud': m.NumMovCom,
      'N° Comprobante': m.NumComp,
      'Tipo': m.TipoComp || tipoComp,
      'Sector': m.SectorComp || sectorComp,
      'Solicitado por': m.Unidad,
      'Quien Retira': m.Responsable,
      'Fecha Entrega': m.FechaEnt,
      'Fecha Devolución': m.FechaDev,
      'Estado': m.Estado,
      'N° Nómina': m.Nomina || '',
      'Observación': m.Observacion
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bitacora_Comprobantes');
    XLSX.writeFile(wb, `Bitacora_Comprobantes_${todayISO}.xlsx`);
  };

  const ultimoMovCompEntregado =
    movimientosBitacora.length > 0 &&
    !mostrandoTodosMov &&
    String(movimientosBitacora[0].Estado).toUpperCase() === 'ENTREGADO'
      ? movimientosBitacora[0]
      : null;

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado y Pestañas */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#016098]">Gestión de Comprobantes Contables</h1>
          <p className="text-xs text-[#64748b] mt-1">
            Registro de Comprobantes (CC, CI, CE), Archivadores, Bitácora de Préstamos y Nóminas de Salida
          </p>
        </div>

        <div className="flex flex-wrap gap-2 bg-[#f1f5f9] p-1.5 rounded-xl">
          <button
            onClick={() => navigate('/comprobantes/ficha')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              tabActiva === 'ficha' ? 'bg-[#016098] text-white shadow-sm' : 'text-[#475569] hover:text-[#016098]'
            }`}
          >
            Antecedentes Comprobante
          </button>
          <button
            onClick={() => navigate('/comprobantes/bitacora')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              tabActiva === 'bitacora' ? 'bg-[#016098] text-white shadow-sm' : 'text-[#475569] hover:text-[#016098]'
            }`}
          >
            Registro Bitácora Comp.
          </button>
          <button
            onClick={() => navigate('/comprobantes/nominas')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              tabActiva === 'nominas' ? 'bg-[#016098] text-white shadow-sm' : 'text-[#475569] hover:text-[#016098]'
            }`}
          >
            Nóminas de Comprobantes
          </button>
        </div>
      </div>

      {mensaje && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium flex justify-between items-center ${
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
          PESTAÑA 1: ANTECEDENTES DEL COMPROBANTE (comprobantes.vb TabPage3)
      ===================================================================== */}
      {tabActiva === 'ficha' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Formulario Antecedentes Comprobante (7 columnas) */}
          <div className="xl:col-span-7 bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-6">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4 mb-5">
              <div>
                <h2 className="text-base font-bold text-[#016098]">Ficha de Comprobante Contable</h2>
                <p className="text-xs text-[#64748b]">
                  Busque por N° de Comprobante o seleccione uno del listado lateral
                </p>
              </div>
              {existeComprobante !== null && (
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    existeComprobante
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {existeComprobante ? 'Comprobante Registrado' : 'Nuevo Comprobante'}
                </span>
              )}
            </div>

            <form onSubmit={guardarComprobante} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold text-[#475569] mb-1">N° Comprobante</label>
                  <input
                    type="number"
                    value={numComp}
                    onChange={(e) => setNumComp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        buscarComprobante();
                      }
                    }}
                    placeholder="Ej: 796"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-extrabold text-[#016098]"
                  />
                </div>
                <div className="sm:col-span-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => buscarComprobante()}
                    className="px-4 py-2 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg cursor-pointer"
                  >
                    Buscar N°
                  </button>
                  <button
                    type="button"
                    onClick={limpiarComprobante}
                    className="px-3 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#475569] text-xs font-bold rounded-lg cursor-pointer"
                  >
                    Limpiar
                  </button>
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Tipo Comprobante</label>
                  <select
                    value={tipoComp}
                    onChange={(e) => setTipoComp(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold"
                  >
                    <option value="CC">CC (Comprobante Contable)</option>
                    <option value="CI">CI (Comprobante Ingreso)</option>
                    <option value="CE">CE (Comprobante Egreso)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Comprobante</label>
                  <input
                    type="date"
                    value={fechaComp}
                    onChange={(e) => setFechaComp(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Recepción Archivo</label>
                  <input
                    type="date"
                    value={fechaRecep}
                    onChange={(e) => setFechaRecep(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Sector</label>
                  <select
                    value={sectorComp}
                    onChange={(e) => setSectorComp(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-semibold"
                  >
                    <option value="Casa Central">Casa Central</option>
                    <option value="Educación">Educación</option>
                    <option value="Salud">Salud</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Número Archivador</label>
                  <input
                    type="number"
                    value={numArchiv}
                    onChange={(e) => setNumArchiv(e.target.value)}
                    placeholder="Ej: 16"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Mes Archivador</label>
                  <input
                    type="text"
                    value={mesArchiv}
                    onChange={(e) => setMesArchiv(e.target.value)}
                    placeholder="Ej: ENERO / 01"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Año Archivador</label>
                  <input
                    type="text"
                    value={anoArchiv}
                    onChange={(e) => setAnoArchiv(e.target.value)}
                    placeholder="Ej: 2025"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">Observaciones</label>
                <textarea
                  rows={2}
                  value={obsComp}
                  onChange={(e) => setObsComp(e.target.value)}
                  placeholder="Observaciones adicionales del comprobante..."
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0]">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={cargando}
                    className="px-5 py-2.5 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
                  >
                    💾 Guardar Comprobante
                  </button>
                  {numComp && (
                    <button
                      type="button"
                      onClick={() => navigate('/comprobantes/bitacora')}
                      className="px-4 py-2.5 bg-[#39BABD] hover:bg-[#2da3a6] text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
                    >
                      Ir a Bitácora Comprobante &rarr;
                    </button>
                  )}
                </div>

                {numComp && (
                  <button
                    type="button"
                    onClick={() => navigate(`/informes/bitacora-comprobante?numComp=${encodeURIComponent(numComp)}`)}
                    className="px-3.5 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#016098] text-xs font-bold rounded-lg cursor-pointer"
                  >
                    🖨️ Imprimir Bitácora Comp.
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Listado lateral de Comprobantes Registrados (5 columnas) */}
          <div className="xl:col-span-5 bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-5 flex flex-col">
            <h2 className="text-base font-bold text-[#016098] mb-1">Comprobantes en Archivo</h2>
            <p className="text-xs text-[#64748b] mb-3">
              Haga clic en cualquier comprobante para cargar sus antecedentes y bitácora
            </p>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={filtroTextoComp}
                onChange={(e) => setFiltroTextoComp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && cargarListaComprobantes()}
                placeholder="N° Comp., Mes, Obs..."
                className="w-full px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg"
              />
              <select
                value={filtroSectorComp}
                onChange={(e) => setFiltroSectorComp(e.target.value)}
                className="px-2 py-1.5 text-xs border border-[#cbd5e1] rounded-lg"
              >
                <option value="TODOS">Todos Sectores</option>
                <option value="Casa Central">Casa Central</option>
                <option value="Educación">Educación</option>
                <option value="Salud">Salud</option>
              </select>
              <button
                type="button"
                onClick={cargarListaComprobantes}
                className="px-3 py-1.5 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Filtrar
              </button>
            </div>

            <div className="overflow-y-auto max-h-[340px] border border-[#e2e8f0] rounded-lg flex-1">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[#f8fafc] text-[#475569] sticky top-0 border-b border-[#e2e8f0]">
                  <tr>
                    <th className="py-2 px-2.5">N° Comp.</th>
                    <th className="py-2 px-2.5">Tipo / Sector</th>
                    <th className="py-2 px-2.5">Fecha Comp.</th>
                    <th className="py-2 px-2.5">Archivador</th>
                    <th className="py-2 px-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e8f0]">
                  {listaComprobantes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[#64748b]">
                        No se encontraron comprobantes
                      </td>
                    </tr>
                  ) : (
                    listaComprobantes.map((c) => (
                      <tr
                        key={c.NumComp}
                        onClick={() => {
                          setNumComp(String(c.NumComp));
                          buscarComprobante(String(c.NumComp));
                        }}
                        className={`cursor-pointer transition-colors hover:bg-sky-50 ${
                          String(c.NumComp) === numComp ? 'bg-sky-100/70 font-semibold' : ''
                        }`}
                      >
                        <td className="py-2 px-2.5 font-extrabold text-[#016098]">#{c.NumComp}</td>
                        <td className="py-2 px-2.5">
                          <span className="font-bold">{c.TipoComp}</span> — {c.SectorComp}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">{c.FechaComp}</td>
                        <td className="py-2 px-2.5">
                          #{c.NumArchiv} ({c.MesArchiv}/{c.AnoArchiv})
                        </td>
                        <td className="py-2 px-2.5">
                          {c.UltimoEstado && String(c.UltimoEstado).toUpperCase() === 'ENTREGADO' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-[#EB567F]">
                              ENTREGADO
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              EN ARCHIVO
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PESTAÑA 2: REGISTRO BITÁCORA COMPROBANTE (comprobantes.vb TabPage4)
      ===================================================================== */}
      {tabActiva === 'bitacora' && (
        <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#e2e8f0]">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[#64748b] uppercase mb-1">
                  N° Comprobante
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={numComp}
                    onChange={(e) => setNumComp(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscarComprobante()}
                    placeholder="Ej: 796"
                    className="w-36 px-3 py-1.5 text-sm border border-[#cbd5e1] rounded-lg font-extrabold text-[#016098]"
                  />
                  <button
                    type="button"
                    onClick={() => buscarComprobante()}
                    className="px-3.5 py-1.5 bg-[#016098] text-white text-xs font-bold rounded-lg hover:bg-[#024a8d] cursor-pointer"
                  >
                    Cargar Comprobante
                  </button>
                </div>
              </div>

              {existeComprobante && (
                <div className="bg-[#f8fafc] border border-[#cbd5e1] px-4 py-2 rounded-lg">
                  <span className="text-[10px] font-bold text-[#64748b] uppercase block">
                    Comprobante Seleccionado
                  </span>
                  <span className="text-sm font-extrabold text-[#016098]">
                    N° {numComp} — Tipo {tipoComp} ({sectorComp})
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 bg-[#f1f5f9] p-1.5 rounded-xl">
              <button
                type="button"
                onClick={() => setModoBitacora('entrega')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoBitacora === 'entrega' ? 'bg-[#016098] text-white' : 'text-[#475569]'
                }`}
              >
                📤 Registrar Entrega
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoBitacora('devolucion');
                  if (ultimoMovCompEntregado) {
                    setNumMovComSeleccionado(ultimoMovCompEntregado.NumMovCom);
                    setUnidadBitacora(ultimoMovCompEntregado.Unidad || '');
                    setResponsableBitacora(ultimoMovCompEntregado.Responsable || '');
                    setObsBitacora(ultimoMovCompEntregado.Observacion || '');
                  }
                }}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoBitacora === 'devolucion' ? 'bg-emerald-600 text-white' : 'text-[#475569]'
                }`}
              >
                📥 Registrar Devolución
              </button>
            </div>
          </div>

          {modoBitacora === 'entrega' && ultimoMovCompEntregado && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-amber-900">
                <p className="font-bold text-sm">
                  ⚠️ Este Comprobante figura actualmente ENTREGADO (Solicitud N° {ultimoMovCompEntregado.NumMovCom})
                </p>
                <p className="mt-0.5">
                  Retirado por <strong>{ultimoMovCompEntregado.Responsable}</strong> ({ultimoMovCompEntregado.Unidad}) el{' '}
                  <strong>{ultimoMovCompEntregado.FechaEnt}</strong>. Debe registrar su DEVOLUCIÓN antes de una nueva entrega.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModoBitacora('devolucion');
                  setNumMovComSeleccionado(ultimoMovCompEntregado.NumMovCom);
                }}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer"
              >
                Pasar a Devolución
              </button>
            </div>
          )}

          <form onSubmit={guardarBitacoraComprobante} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  {modoBitacora === 'entrega' ? 'N° Solicitud (Nuevo)' : 'N° Solicitud a Devolver'}
                </label>
                <input
                  type="text"
                  readOnly
                  value={
                    modoBitacora === 'entrega'
                      ? nextNumMovCom || 'Auto'
                      : numMovComSeleccionado || 'Seleccione abajo'
                  }
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] bg-[#f8fafc] rounded-lg font-extrabold text-[#016098]"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#475569] mb-1">Solicitado por</label>
                <input
                  type="text"
                  list="unidades-comp-list"
                  value={unidadBitacora}
                  onChange={(e) => setUnidadBitacora(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                />
                <datalist id="unidades-comp-list">
                  {unidadesComp.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">Quien Retira</label>
                <input
                  type="text"
                  value={responsableBitacora}
                  onChange={(e) => setResponsableBitacora(e.target.value)}
                  placeholder="NOMBRE RESPONSABLE"
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                />
              </div>

              <div>
                {modoBitacora === 'entrega' ? (
                  <>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Entrega</label>
                    <input
                      type="date"
                      value={fechaEntBitacora}
                      onChange={(e) => setFechaEntBitacora(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-semibold text-emerald-700 mb-1">Fecha Devolución</label>
                    <input
                      type="date"
                      value={fechaDevBitacora}
                      onChange={(e) => setFechaDevBitacora(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-emerald-400 bg-emerald-50/40 rounded-lg font-bold"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-8">
                <label className="block text-xs font-semibold text-[#475569] mb-1">Observación</label>
                <input
                  type="text"
                  value={obsBitacora}
                  onChange={(e) => setObsBitacora(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                />
              </div>

              <div className="lg:col-span-4 flex flex-wrap justify-end gap-2">
                <button
                  type="submit"
                  disabled={cargando}
                  className={`px-5 py-2.5 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer ${
                    modoBitacora === 'entrega'
                      ? 'bg-[#016098] hover:bg-[#024a8d]'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {modoBitacora === 'entrega'
                    ? '📤 Confirmar Entrega'
                    : '📥 Confirmar Devolución'}
                </button>
                {numComp && (
                  <button
                    type="button"
                    onClick={() => navigate(`/informes/bitacora-comprobante?numComp=${encodeURIComponent(numComp)}`)}
                    className="px-4 py-2.5 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#016098] text-xs font-bold rounded-lg cursor-pointer"
                  >
                    🖨️ Imprimir Bitácora
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          PESTAÑA 3: NÓMINAS DE COMPROBANTES (comprobantes.vb TabPage1)
      ===================================================================== */}
      {tabActiva === 'nominas' && (
        <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#e2e8f0]">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-bold text-[#016098] uppercase mb-1">
                  N° Nómina Comprobantes
                </label>
                <input
                  type="number"
                  value={numNomina}
                  onChange={(e) => setNumNomina(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && buscarNominaComp()}
                  placeholder="Ej: 1"
                  className="w-32 px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-extrabold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => buscarNominaComp()}
                className="px-4 py-2 bg-[#016098] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Buscar Nómina
              </button>
              <button
                type="button"
                onClick={obtenerSiguienteNominaComp}
                className="px-4 py-2 bg-[#39BABD] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                + Nueva Nómina (Auto)
              </button>
              {numNomina && (
                <button
                  type="button"
                  onClick={() => navigate(`/informes/nomina-comprobantes?nomina=${encodeURIComponent(numNomina)}`)}
                  className="px-4 py-2 bg-[#f1f5f9] text-[#016098] text-xs font-bold rounded-lg cursor-pointer"
                >
                  🖨️ Imprimir Nómina Comprobantes
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 bg-[#f1f5f9] p-1.5 rounded-xl">
              <button
                type="button"
                onClick={() => setModoNomina('entrega')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg cursor-pointer ${
                  modoNomina === 'entrega' ? 'bg-[#016098] text-white' : 'text-[#475569]'
                }`}
              >
                Registrar Entrega
              </button>
              <button
                type="button"
                onClick={() => setModoNomina('devolucion-parcial')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg cursor-pointer ${
                  modoNomina === 'devolucion-parcial' ? 'bg-amber-600 text-white' : 'text-[#475569]'
                }`}
              >
                Devolución Parcial
              </button>
              <button
                type="button"
                onClick={() => setModoNomina('devolucion-total')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg cursor-pointer ${
                  modoNomina === 'devolucion-total' ? 'bg-emerald-600 text-white' : 'text-[#475569]'
                }`}
              >
                Devolución Total Nómina
              </button>
            </div>
          </div>

          <form onSubmit={ejecutarAccionNominaComp} className="space-y-4">
            {modoNomina === 'entrega' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Solicitado por</label>
                    <input
                      type="text"
                      list="unidades-comp-list"
                      value={unidadNomina}
                      onChange={(e) => setUnidadNomina(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Quien Retira</label>
                    <input
                      type="text"
                      value={responsableNomina}
                      onChange={(e) => setResponsableNomina(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Entrega</label>
                    <input
                      type="date"
                      value={fechaEntNomina}
                      onChange={(e) => setFechaEntNomina(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Observación</label>
                    <input
                      type="text"
                      value={obsNomina}
                      onChange={(e) => setObsNomina(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </div>
                </div>

                <div className="bg-[#f8fafc] border border-[#cbd5e1] rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#016098] mb-1">
                      N° de Comprobante a Incorporar en Nómina
                    </label>
                    <input
                      type="number"
                      value={numCompAgregarNomina}
                      onChange={(e) => setNumCompAgregarNomina(e.target.value)}
                      placeholder="Ej: 812"
                      className="w-48 px-3 py-2 text-sm border border-[#cbd5e1] bg-white rounded-lg font-extrabold text-[#016098]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={cargando}
                    className="px-5 py-2.5 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
                  >
                    + Agregar Comprobante a Nómina N° {numNomina || '...'}
                  </button>
                </div>
              </>
            ) : (
              <div className="bg-[#f8fafc] border border-[#cbd5e1] rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-4">
                  {modoNomina === 'devolucion-parcial' && (
                    <div>
                      <label className="block text-xs font-bold text-amber-800 mb-1">
                        Solicitud Seleccionada
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={
                          numMovComNominaSel
                            ? `Solicitud #${numMovComNominaSel}`
                            : 'Haga clic en una fila abajo'
                        }
                        className="w-56 px-3 py-2 text-sm border border-amber-300 bg-white rounded-lg font-bold text-amber-900"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-[#475569] mb-1">Fecha Devolución</label>
                    <input
                      type="date"
                      value={fechaDevNomina}
                      onChange={(e) => setFechaDevNomina(e.target.value)}
                      className="px-3 py-2 text-sm border border-[#cbd5e1] bg-white rounded-lg font-bold"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={cargando}
                  className={`px-5 py-2.5 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer ${
                    modoNomina === 'devolucion-parcial' ? 'bg-amber-600' : 'bg-emerald-600'
                  }`}
                >
                  {modoNomina === 'devolucion-parcial'
                    ? 'Confirmar Devolución Parcial'
                    : `Confirmar Devolución Total Nómina N° ${numNomina || ''}`}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* =====================================================================
          GRILLA INFERIOR: BITÁCORA DE COMPROBANTES (MovimientosComp)
      ===================================================================== */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] overflow-hidden">
        <div className="p-5 border-b border-[#e2e8f0] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#016098]">
              Movimientos en Bitácora de Comprobantes{' '}
              {tabActiva === 'nominas' && numNomina
                ? `— Nómina N° ${numNomina}`
                : mostrandoTodosMov
                ? '— Todos los Comprobantes'
                : numComp
                ? `— Comprobante N° ${numComp}`
                : ''}
            </h3>
            <p className="text-xs text-[#64748b]">
              Haga clic en un movimiento para seleccionarlo en Devolución ({movimientosBitacora.length} registros)
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={verTodosMovimientosComp}
              className="px-3.5 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#1e293b] text-xs font-bold rounded-lg cursor-pointer"
            >
              Ver Todos
            </button>
            <button
              type="button"
              onClick={exportarBitacoraCompExcel}
              disabled={movimientosBitacora.length === 0}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              📊 Exportar Excel
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-[#f8fafc] text-[#475569] uppercase sticky top-0 border-b border-[#e2e8f0]">
              <tr>
                <th className="py-3 px-4">N° Solicitud</th>
                <th className="py-3 px-4">N° Comp.</th>
                <th className="py-3 px-4">Solicitado por</th>
                <th className="py-3 px-4">Quien Retira</th>
                <th className="py-3 px-4">Fecha Entrega</th>
                <th className="py-3 px-4">Fecha Dev.</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">N° Nómina</th>
                <th className="py-3 px-4">Observación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {movimientosBitacora.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#64748b]">
                    Sin movimientos registrados para la selección actual. Haga clic en &ldquo;Ver Todos&rdquo;.
                  </td>
                </tr>
              ) : (
                movimientosBitacora.map((m) => {
                  const esEntregado = String(m.Estado).toUpperCase() === 'ENTREGADO';
                  const seleccionado =
                    numMovComSeleccionado === m.NumMovCom || numMovComNominaSel === m.NumMovCom;
                  return (
                    <tr
                      key={m.NumMovCom}
                      onClick={() => {
                        setNumMovComSeleccionado(m.NumMovCom);
                        setNumMovComNominaSel(m.NumMovCom);
                        setUnidadBitacora(m.Unidad || '');
                        setResponsableBitacora(m.Responsable || '');
                        setObsBitacora(m.Observacion || '');
                        if (esEntregado && tabActiva === 'bitacora') {
                          setModoBitacora('devolucion');
                        }
                      }}
                      className={`cursor-pointer transition-colors hover:bg-sky-50 ${
                        seleccionado ? 'bg-sky-100/70' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 font-bold text-[#016098]">#{m.NumMovCom}</td>
                      <td className="py-2.5 px-4 font-extrabold">#{m.NumComp}</td>
                      <td className="py-2.5 px-4">{m.Unidad}</td>
                      <td className="py-2.5 px-4 font-semibold">{m.Responsable}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">{m.FechaEnt}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">{m.FechaDev || '-'}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            esEntregado
                              ? 'bg-rose-100 text-[#EB567F]'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {m.Estado}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">{m.Nomina ? `#${m.Nomina}` : '-'}</td>
                      <td className="py-2.5 px-4 text-[#64748b]">{m.Observacion}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
