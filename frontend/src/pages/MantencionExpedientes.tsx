import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface MantencionExpedientesProps {
  tabInicial?: 'ficha' | 'bitacora' | 'nominas';
}

const LETRAS_ABECEDARIO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function calcularDVCliente(rutSinDv: string): string {
  const limpio = String(rutSinDv).replace(/\D/g, '');
  if (!limpio) return '';
  let suma = 0;
  let multiplo = 2;
  for (let i = limpio.length - 1; i >= 0; i--) {
    suma += parseInt(limpio.charAt(i), 10) * multiplo;
    multiplo = multiplo < 7 ? multiplo + 1 : 2;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

export default function MantencionExpedientes({ tabInicial = 'ficha' }: MantencionExpedientesProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const todayISO = new Date().toISOString().split('T')[0];

  const [tabActiva, setTabActiva] = useState<'ficha' | 'bitacora' | 'nominas'>(tabInicial);
  useEffect(() => {
    setTabActiva(tabInicial);
  }, [tabInicial]);

  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  // Dominios
  const [establecimientos, setEstablecimientos] = useState<{ CodUnidad: number; CodCenco: string; Descripcion: string }[]>([]);
  const [plantas, setPlantas] = useState<string[]>([]);
  const [estadosExp, setEstadosExp] = useState<string[]>(['Vigente', 'Activo', 'Pasivo', 'bodega', 'NUEVO', 'INACTIVO']);
  const [unidadesSolicitantes, setUnidadesSolicitantes] = useState<string[]>([
    'Departamento Juridico',
    'Dirección de Educación',
    'Dirección de Salud',
    'Recursos Humanos',
    'Secretaría General Ejecutiva'
  ]);

  // --- ESTADO PESTAÑA 1: ANTECEDENTES GENERALES (LIC_FUNCIONARIO + Expedientes) ---
  const [rutBusqueda, setRutBusqueda] = useState('');
  const [dvFuncionario, setDvFuncionario] = useState('');
  const [paterno, setPaterno] = useState('');
  const [materno, setMaterno] = useState('');
  const [nombres, setNombres] = useState('');
  const [codUnidadCenco, setCodUnidadCenco] = useState('');
  const [descripcionPlanta, setDescripcionPlanta] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaTermino, setFechaTermino] = useState('');
  const [estadoExpediente, setEstadoExpediente] = useState('Vigente');
  const [kardex, setKardex] = useState('');
  const [contenidoObs, setContenidoObs] = useState('');
  const [rutaCarpetaDigital, setRutaCarpetaDigital] = useState('');
  const [existeFuncionario, setExisteFuncionario] = useState<boolean | null>(null);

  // Buscador Nómina de Funcionarios (Derecha en Pestaña 1)
  const [letraFiltro, setLetraFiltro] = useState('A');
  const [textoFiltroNomina, setTextoFiltroNomina] = useState('');
  const [listaFuncionarios, setListaFuncionarios] = useState<any[]>([]);
  const [cargandoNominaFunc, setCargandoNominaFunc] = useState(false);

  // --- ESTADO PESTAÑA 2: REGISTRO BITÁCORA INDIVIDUAL ---
  const [modoBitacora, setModoBitacora] = useState<'entrega' | 'devolucion'>('entrega');
  const [nextNumMov, setNextNumMov] = useState<number>(0);
  const [numMovSeleccionado, setNumMovSeleccionado] = useState<number | null>(null);
  const [unidadBitacora, setUnidadBitacora] = useState('Departamento Juridico');
  const [responsableBitacora, setResponsableBitacora] = useState('');
  const [fechaSolBitacora, setFechaSolBitacora] = useState(todayISO);
  const [fechaDevBitacora, setFechaDevBitacora] = useState(todayISO);
  const [obsBitacora, setObsBitacora] = useState('');

  // --- ESTADO PESTAÑA 3: NÓMINAS DE EXPEDIENTES ---
  const [modoNomina, setModoNomina] = useState<'entrega' | 'devolucion-parcial' | 'devolucion-total'>('entrega');
  const [numNomina, setNumNomina] = useState('');
  const [unidadNomina, setUnidadNomina] = useState('Departamento Juridico');
  const [responsableNomina, setResponsableNomina] = useState('');
  const [fechaSolNomina, setFechaSolNomina] = useState(todayISO);
  const [fechaDevNomina, setFechaDevNomina] = useState(todayISO);
  const [obsNomina, setObsNomina] = useState('');
  const [rutAgregarNomina, setRutAgregarNomina] = useState('');
  const [dvAgregarNomina, setDvAgregarNomina] = useState('');
  const [nombreAgregarNomina, setNombreAgregarNomina] = useState('');
  const [numMovNominaSel, setNumMovNominaSel] = useState<number | null>(null);
  const [movimientosNomina, setMovimientosNomina] = useState<any[]>([]);

  // --- GRILLA INFERIOR DE MOVIMIENTOS EN BITÁCORA ---
  const [movimientosBitacora, setMovimientosBitacora] = useState<any[]>([]);
  const [mostrandoTodosMov, setMostrandoTodosMov] = useState(false);
  const [fechaFiltroImpresion, setFechaFiltroImpresion] = useState(todayISO);

  // Cargar dominios iniciales
  useEffect(() => {
    axios
      .get('/api/dominios')
      .then((res) => {
        if (res.data.status === 'ok' && res.data.data) {
          setEstablecimientos(res.data.data.establecimientos || []);
          setPlantas(res.data.data.plantas || []);
          if (res.data.data.estadosExpediente) setEstadosExp(res.data.data.estadosExpediente);
          if (res.data.data.unidadesExpedientes) setUnidadesSolicitantes(res.data.data.unidadesExpedientes);
        }
      })
      .catch(() => {});
  }, []);

  // Cargar nómina alfabética de funcionarios
  const cargarNominaFuncionarios = async (letra = letraFiltro, q = textoFiltroNomina) => {
    setCargandoNominaFunc(true);
    try {
      const res = await axios.get('/api/expedientes/funcionarios', {
        params: { letra, q, limit: 200 }
      });
      if (res.data.status === 'ok') {
        setListaFuncionarios(res.data.registros || []);
      }
    } catch (err) {
      console.error('Error cargando nómina de funcionarios:', err);
    } finally {
      setCargandoNominaFunc(false);
    }
  };

  useEffect(() => {
    cargarNominaFuncionarios(letraFiltro, textoFiltroNomina);
  }, [letraFiltro]);

  // Si viene ?rut= en la URL (ej. desde Dashboard), cargarlo automáticamente
  useEffect(() => {
    const rutParam = searchParams.get('rut');
    if (rutParam) {
      setRutBusqueda(rutParam);
      buscarFichaPorRut(rutParam);
    }
  }, [searchParams]);

  // Consultar ficha completa de un funcionario por RUT
  const buscarFichaPorRut = async (rutRaw?: string) => {
    const rutLimpio = String(rutRaw ?? rutBusqueda)
      .replace(/\./g, '')
      .split('-')[0]
      .trim();

    if (!rutLimpio) {
      setMensaje({ tipo: 'error', texto: 'Ingrese un RUT válido para consultar el expediente' });
      return;
    }

    setCargando(true);
    setMensaje(null);
    setMostrandoTodosMov(false);
    const dvCalc = calcularDVCliente(rutLimpio);
    setDvFuncionario(dvCalc);

    try {
      const res = await axios.get(`/api/expedientes/ficha/${encodeURIComponent(rutLimpio)}`);
      const data = res.data;
      if (data.nextNumMov) setNextNumMov(data.nextNumMov);

      if (data.status === 'ok') {
        setExisteFuncionario(true);
        setRutBusqueda(data.rut);
        setDvFuncionario(data.dv || dvCalc);
        setPaterno(data.funcionario?.Paterno || '');
        setMaterno(data.funcionario?.Materno || '');
        setNombres(data.funcionario?.Nombre || '');
        setCodUnidadCenco(data.funcionario?.CodUnidad || '');
        setDescripcionPlanta(data.funcionario?.DescripcionPlanta || '');
        setFechaInicio(data.funcionario?.FechaInicio || '');
        setFechaTermino(data.funcionario?.FechaTermino || '');

        setEstadoExpediente(data.expediente?.Estado || 'Vigente');
        setKardex(data.expediente?.Kardex || '');
        setContenidoObs(data.expediente?.Contenido || '');
        setRutaCarpetaDigital(data.rutaCarpetaDigital || '');

        const movs = data.movimientos || [];
        setMovimientosBitacora(movs);

        // Si el último movimiento está ENTREGADO, pre-seleccionarlo por si desea devolverlo
        if (movs.length > 0 && String(movs[0].Estado).toUpperCase() === 'ENTREGADO') {
          setNumMovSeleccionado(movs[0].NumMov);
          setUnidadBitacora(movs[0].Unidad || 'Departamento Juridico');
          setResponsableBitacora(movs[0].Responsable || '');
          setObsBitacora(movs[0].Observacion || '');
        } else {
          setNumMovSeleccionado(null);
          setResponsableBitacora('');
          setObsBitacora('');
        }
      } else {
        setExisteFuncionario(false);
        setPaterno('');
        setMaterno('');
        setNombres('');
        setCodUnidadCenco('');
        setDescripcionPlanta('');
        setFechaInicio('');
        setFechaTermino('');
        setEstadoExpediente('Vigente');
        setKardex('');
        setContenidoObs('');
        setRutaCarpetaDigital('');
        setMovimientosBitacora([]);
        setMensaje({
          tipo: 'info',
          texto: `El RUT ${rutLimpio}-${dvCalc} no registra ficha previa. Puede completar los campos y hacer clic en "Guardar Antecedentes" para crearlo.`
        });
      }
    } catch (err: any) {
      setMensaje({
        tipo: 'error',
        texto: err.response?.data?.error || 'Error al consultar la ficha del expediente'
      });
    } finally {
      setCargando(false);
    }
  };

  const limpiarFicha = () => {
    setRutBusqueda('');
    setDvFuncionario('');
    setPaterno('');
    setMaterno('');
    setNombres('');
    setCodUnidadCenco('');
    setDescripcionPlanta('');
    setFechaInicio('');
    setFechaTermino('');
    setEstadoExpediente('Vigente');
    setKardex('');
    setContenidoObs('');
    setRutaCarpetaDigital('');
    setExisteFuncionario(null);
    setMovimientosBitacora([]);
    setNumMovSeleccionado(null);
    setMensaje(null);
  };

  // Guardar Antecedentes Generales (LIC_FUNCIONARIO + Expedientes)
  const guardarAntecedentes = async (e: React.FormEvent) => {
    e.preventDefault();
    const rutLimpio = rutBusqueda.replace(/\./g, '').split('-')[0].trim();
    if (!rutLimpio) {
      setMensaje({ tipo: 'error', texto: 'Debe ingresar el RUT del funcionario' });
      return;
    }
    if (!paterno.trim() || !nombres.trim()) {
      setMensaje({ tipo: 'error', texto: 'Debe ingresar al menos Nombres y Apellido Paterno del funcionario' });
      return;
    }

    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.post('/api/expedientes/ficha', {
        rut: rutLimpio,
        dv: dvFuncionario || calcularDVCliente(rutLimpio),
        nombre: nombres,
        paterno,
        materno,
        codUnidad: codUnidadCenco,
        descripcionPlanta,
        fechaInicio,
        fechaTermino,
        estado: estadoExpediente,
        kardex,
        contenido: contenidoObs
      });

      if (res.data.status === 'ok') {
        setMensaje({ tipo: 'ok', texto: res.data.message });
        await buscarFichaPorRut(rutLimpio);
        cargarNominaFuncionarios(letraFiltro, textoFiltroNomina);
      }
    } catch (err: any) {
      setMensaje({
        tipo: 'error',
        texto: err.response?.data?.error || 'Error al guardar los antecedentes del expediente'
      });
    } finally {
      setCargando(false);
    }
  };

  // Guardar Entrega o Devolución en Bitácora Individual (Pestaña 2)
  const guardarMovimientoBitacora = async (e: React.FormEvent) => {
    e.preventDefault();
    const rutLimpio = rutBusqueda.replace(/\./g, '').split('-')[0].trim();

    if (modoBitacora === 'entrega') {
      if (!rutLimpio) {
        setMensaje({ tipo: 'error', texto: 'Primero busque o seleccione un funcionario por RUT' });
        return;
      }
      if (!unidadBitacora.trim() || !responsableBitacora.trim()) {
        setMensaje({ tipo: 'error', texto: 'Complete "Solicitado por" y "Quien Retira" para registrar la entrega' });
        return;
      }

      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.post('/api/expedientes/bitacora/entrega', {
          rut: rutLimpio,
          unidad: unidadBitacora,
          responsable: responsableBitacora,
          fecha: fechaSolBitacora,
          observacion: obsBitacora
        });

        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          setObsBitacora('');
          await buscarFichaPorRut(rutLimpio);
        }
      } catch (err: any) {
        setMensaje({
          tipo: 'error',
          texto: err.response?.data?.error || 'No fue posible registrar la entrega'
        });
      } finally {
        setCargando(false);
      }
    } else {
      // Modo Devolución
      if (!numMovSeleccionado) {
        setMensaje({
          tipo: 'error',
          texto: 'Seleccione en la tabla de Bitácora el movimiento con estado ENTREGADO que desea devolver'
        });
        return;
      }

      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.put(`/api/expedientes/bitacora/devolucion/${numMovSeleccionado}`, {
          fechaDev: fechaDevBitacora,
          unidad: unidadBitacora,
          responsable: responsableBitacora,
          observacion: obsBitacora
        });

        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          if (rutLimpio) {
            await buscarFichaPorRut(rutLimpio);
          } else {
            await verTodosMovimientos();
          }
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

  // --- FUNCIONES PESTAÑA 3: NÓMINAS DE EXPEDIENTES ---
  const obtenerSiguienteNomina = async () => {
    try {
      const res = await axios.get('/api/expedientes/nominas/next-id');
      if (res.data.status === 'ok') {
        setNumNomina(String(res.data.nextNomina));
        setMovimientosNomina([]);
        setMensaje({
          tipo: 'info',
          texto: `Se asignó el nuevo N° de Nómina ${res.data.nextNomina}. Complete el encabezado y agregue los RUTs.`
        });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al obtener correlativo de nómina' });
    }
  };

  const buscarNominaExistente = async (nNom?: string) => {
    const num = String(nNom ?? numNomina).trim();
    if (!num) {
      setMensaje({ tipo: 'error', texto: 'Ingrese un N° de Nómina para buscar' });
      return;
    }

    setCargando(true);
    setMensaje(null);
    try {
      const res = await axios.get(`/api/expedientes/nominas/${encodeURIComponent(num)}`);
      if (res.data.status === 'ok') {
        const movs = res.data.movimientos || [];
        setMovimientosNomina(movs);
        setMovimientosBitacora(movs);
        if (movs.length > 0) {
          setUnidadNomina(movs[0].Unidad || 'Departamento Juridico');
          setResponsableNomina(movs[0].Responsable || '');
          setObsNomina(movs[0].Observacion || '');
        } else {
          setMensaje({ tipo: 'info', texto: `La Nómina N° ${num} aún no tiene expedientes asociados` });
        }
      }
    } catch (err: any) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al buscar la nómina' });
    } finally {
      setCargando(false);
    }
  };

  const verificarRutParaNomina = async () => {
    const rutLimpio = rutAgregarNomina.replace(/\./g, '').split('-')[0].trim();
    if (!rutLimpio) return;
    setDvAgregarNomina(calcularDVCliente(rutLimpio));

    try {
      const res = await axios.get(`/api/expedientes/ficha/${encodeURIComponent(rutLimpio)}`);
      if (res.data.status === 'ok' && res.data.funcionario) {
        const f = res.data.funcionario;
        const nombreCompleto = `${f.Nombre} ${f.Paterno} ${f.Materno}`.trim();
        setNombreAgregarNomina(nombreCompleto);
        const movs = res.data.movimientos || [];
        if (movs.length > 0 && String(movs[0].Estado).toUpperCase() === 'ENTREGADO') {
          setMensaje({
            tipo: 'error',
            texto: `Atención: El expediente de ${nombreCompleto} ya figura ENTREGADO en Solicitud N° ${movs[0].NumMov}.`
          });
        }
      } else {
        setNombreAgregarNomina('');
        setMensaje({ tipo: 'error', texto: `No existe Funcionario con RUT ${rutLimpio} en la base de datos` });
      }
    } catch {
      setNombreAgregarNomina('');
    }
  };

  const ejecutarAccionNomina = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numNomina.trim()) {
      setMensaje({ tipo: 'error', texto: 'Debe indicar o generar un N° de Nómina' });
      return;
    }

    if (modoNomina === 'entrega') {
      const rutLimpio = rutAgregarNomina.replace(/\./g, '').split('-')[0].trim();
      if (!rutLimpio) {
        setMensaje({ tipo: 'error', texto: 'Ingrese el RUT del funcionario a incorporar en la nómina' });
        return;
      }
      if (!unidadNomina.trim() || !responsableNomina.trim()) {
        setMensaje({ tipo: 'error', texto: 'Complete "Solicitado por" y "Quien Retira" en la nómina' });
        return;
      }

      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.post('/api/expedientes/nominas/entrega', {
          nomina: numNomina,
          rut: rutLimpio,
          unidad: unidadNomina,
          responsable: responsableNomina,
          fecha: fechaSolNomina,
          observacion: obsNomina
        });

        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          setRutAgregarNomina('');
          setDvAgregarNomina('');
          setNombreAgregarNomina('');
          await buscarNominaExistente(numNomina);
        }
      } catch (err: any) {
        setMensaje({
          tipo: 'error',
          texto: err.response?.data?.error || 'Error al agregar expediente a la nómina'
        });
      } finally {
        setCargando(false);
      }
    } else if (modoNomina === 'devolucion-parcial') {
      if (!numMovNominaSel) {
        setMensaje({
          tipo: 'error',
          texto: 'Haga clic en un expediente de la tabla inferior para registrar su Devolución Parcial'
        });
        return;
      }
      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.put(`/api/expedientes/nominas/devolucion-parcial/${numMovNominaSel}`, {
          fechaDev: fechaDevNomina
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          setNumMovNominaSel(null);
          await buscarNominaExistente(numNomina);
        }
      } catch (err: any) {
        setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error en devolución parcial' });
      } finally {
        setCargando(false);
      }
    } else {
      // Devolución Total de la Nómina
      setCargando(true);
      setMensaje(null);
      try {
        const res = await axios.put(`/api/expedientes/nominas/devolucion-total/${encodeURIComponent(numNomina)}`, {
          fechaDev: fechaDevNomina
        });
        if (res.data.status === 'ok') {
          setMensaje({ tipo: 'ok', texto: res.data.message });
          await buscarNominaExistente(numNomina);
        }
      } catch (err: any) {
        setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error en devolución total de nómina' });
      } finally {
        setCargando(false);
      }
    }
  };

  // Ver todos los últimos movimientos en la grilla inferior
  const verTodosMovimientos = async () => {
    setCargando(true);
    setMostrandoTodosMov(true);
    try {
      const res = await axios.get('/api/expedientes/bitacora', { params: { limit: 250 } });
      if (res.data.status === 'ok') {
        setMovimientosBitacora(res.data.movimientos || []);
        if (res.data.nextNumMov) setNextNumMov(res.data.nextNumMov);
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al cargar el listado general de bitácora' });
    } finally {
      setCargando(false);
    }
  };

  const exportarBitacoraExcel = () => {
    if (movimientosBitacora.length === 0) return;
    const rows = movimientosBitacora.map((m) => ({
      'N° Solicitud': m.NumMov,
      'RUT': `${m.Rut}${m.DV ? '-' + m.DV : ''}`,
      'Funcionario': `${m.Nombre || ''} ${m.Paterno || ''} ${m.Materno || ''}`.trim(),
      'Unidad Solicitante': m.Unidad,
      'Quien Retira': m.Responsable,
      'Fecha Entrega': m.Fecha,
      'Fecha Devolución': m.FechaDev,
      'Estado': m.Estado,
      'N° Nómina': m.Nomina || '',
      'Observación': m.Observacion
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bitacora_Expedientes');
    XLSX.writeFile(wb, `Bitacora_Expedientes_${todayISO}.xlsx`);
  };

  const ultimoMovimientoEntregado =
    movimientosBitacora.length > 0 &&
    !mostrandoTodosMov &&
    String(movimientosBitacora[0].Estado).toUpperCase() === 'ENTREGADO'
      ? movimientosBitacora[0]
      : null;

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado y Selector de Pestañas */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#016098]">Gestión de Expedientes de Funcionarios</h1>
          <p className="text-xs text-[#64748b] mt-1">
            Mantención de Antecedentes Generales, Kárdex, Registro de Bitácora Individual y Nóminas de Entrega/Devolución
          </p>
        </div>

        <div className="flex flex-wrap gap-2 bg-[#f1f5f9] p-1.5 rounded-xl">
          <button
            onClick={() => navigate('/expedientes/ficha')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              tabActiva === 'ficha' ? 'bg-[#016098] text-white shadow-sm' : 'text-[#475569] hover:text-[#016098]'
            }`}
          >
            Antecedentes Generales
          </button>
          <button
            onClick={() => navigate('/expedientes/bitacora')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              tabActiva === 'bitacora' ? 'bg-[#016098] text-white shadow-sm' : 'text-[#475569] hover:text-[#016098]'
            }`}
          >
            Registro Bitácora
          </button>
          <button
            onClick={() => navigate('/expedientes/nominas')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              tabActiva === 'nominas' ? 'bg-[#016098] text-white shadow-sm' : 'text-[#475569] hover:text-[#016098]'
            }`}
          >
            Nóminas de Expedientes
          </button>
        </div>
      </div>

      {/* Mensajes de retroalimentación */}
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
          PESTAÑA 1: ANTECEDENTES GENERALES + NÓMINA ALFABÉTICA (expedientes.vb TabPage3)
      ===================================================================== */}
      {tabActiva === 'ficha' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Formulario de Antecedentes Generales (7 columnas) */}
          <div className="xl:col-span-7 bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-6">
            <div className="flex flex-wrap items-center justify-between border-b border-[#e2e8f0] pb-4 mb-5 gap-2">
              <div>
                <h2 className="text-base font-bold text-[#016098]">Ficha de Funcionario y Expediente</h2>
                <p className="text-xs text-[#64748b]">
                  Ingrese el RUT sin puntos ni dígito verificador o seleccione desde la nómina lateral
                </p>
              </div>
              {existeFuncionario !== null && (
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    existeFuncionario
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {existeFuncionario ? 'Expediente Registrado' : 'Nuevo Registro'}
                </span>
              )}
            </div>

            <form onSubmit={guardarAntecedentes} className="space-y-4">
              {/* Fila 1: RUT + DV + Botones Buscar / Limpiar + Estado Expediente */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold text-[#475569] mb-1">RUT Funcionario</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={rutBusqueda}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setRutBusqueda(val);
                        setDvFuncionario(calcularDVCliente(val));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          buscarFichaPorRut();
                        }
                      }}
                      placeholder="Ej: 7517333"
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098] focus:outline-none focus:ring-2 focus:ring-[#016098]"
                    />
                    <span className="text-sm font-bold text-[#64748b]">-</span>
                    <input
                      type="text"
                      value={dvFuncionario}
                      readOnly
                      className="w-10 px-2 py-2 text-sm text-center border border-[#cbd5e1] bg-[#f8fafc] rounded-lg font-bold text-[#1e293b]"
                    />
                  </div>
                </div>

                <div className="sm:col-span-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => buscarFichaPorRut()}
                    disabled={cargando}
                    className="px-4 py-2 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Buscar RUT
                  </button>
                  <button
                    type="button"
                    onClick={limpiarFicha}
                    className="px-3 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#475569] text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Estado Expediente</label>
                  <select
                    value={estadoExpediente}
                    onChange={(e) => setEstadoExpediente(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-semibold text-[#1e293b] focus:outline-none focus:ring-2 focus:ring-[#016098]"
                  >
                    {estadosExp.map((est) => (
                      <option key={est} value={est}>
                        {est}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Fila 2: Apellido Paterno, Apellido Materno, Nombres */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Apellido Paterno</label>
                  <input
                    type="text"
                    value={paterno}
                    onChange={(e) => setPaterno(e.target.value)}
                    placeholder="PATERNO"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Apellido Materno</label>
                  <input
                    type="text"
                    value={materno}
                    onChange={(e) => setMaterno(e.target.value)}
                    placeholder="MATERNO"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Nombres</label>
                  <input
                    type="text"
                    value={nombres}
                    onChange={(e) => setNombres(e.target.value)}
                    placeholder="NOMBRES"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                  />
                </div>
              </div>

              {/* Fila 3: Cenco (Establecimiento) y Planta */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">
                    Cenco / Establecimiento (Unidad)
                  </label>
                  <select
                    value={codUnidadCenco}
                    onChange={(e) => setCodUnidadCenco(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  >
                    <option value="">-- Seleccione Establecimiento / Cenco --</option>
                    {codUnidadCenco &&
                      !establecimientos.some((est) => est.Descripcion === codUnidadCenco) && (
                        <option value={codUnidadCenco}>{codUnidadCenco}</option>
                      )}
                    {establecimientos.map((est) => (
                      <option key={`${est.CodUnidad}-${est.Descripcion}`} value={est.Descripcion}>
                        {est.CodCenco ? `[${est.CodCenco}] ` : ''}
                        {est.Descripcion}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Planta / Cargo</label>
                  <input
                    type="text"
                    list="lista-plantas"
                    value={descripcionPlanta}
                    onChange={(e) => setDescripcionPlanta(e.target.value)}
                    placeholder="Ej: DOCENTE, PARADOCENTE, SALUD..."
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                  />
                  <datalist id="lista-plantas">
                    {plantas.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Fila 4: Fecha Inicio, Fecha Término, Kárdex */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Inicio</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Término</label>
                  <input
                    type="date"
                    value={fechaTermino}
                    onChange={(e) => setFechaTermino(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1">Kárdex / Ubicación</label>
                  <input
                    type="text"
                    value={kardex}
                    onChange={(e) => setKardex(e.target.value)}
                    placeholder="Ej: 20.976 / As.educacion"
                    className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-semibold text-[#016098]"
                  />
                </div>
              </div>

              {/* Fila 5: Contenido / Observaciones del Expediente */}
              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  Observaciones / Contenido del Expediente
                </label>
                <textarea
                  rows={2}
                  value={contenidoObs}
                  onChange={(e) => setContenidoObs(e.target.value)}
                  placeholder="Detalle u observaciones del expediente físico..."
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                />
              </div>

              {/* Ruta Carpeta Digital en Servidor (Btn_VerArchivos_Click en expedientes.vb) */}
              {rutaCarpetaDigital && (
                <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="truncate">
                    <span className="font-bold text-[#016098] block">Ruta Carpeta Digital (Red CMDS):</span>
                    <code className="text-[#475569]">{rutaCarpetaDigital}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(rutaCarpetaDigital);
                      setMensaje({ tipo: 'info', texto: 'Ruta de carpeta digital copiada al portapapeles' });
                    }}
                    className="px-3 py-1.5 bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] rounded-md font-bold text-[#016098] shrink-0 cursor-pointer"
                  >
                    Copiar Ruta Red
                  </button>
                </div>
              )}

              {/* Botones de Acción */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0]">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={cargando}
                    className="px-5 py-2.5 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
                  >
                    💾 Guardar Antecedentes Generales
                  </button>
                  {rutBusqueda && (
                    <button
                      type="button"
                      onClick={() => navigate('/expedientes/bitacora')}
                      className="px-4 py-2.5 bg-[#39BABD] hover:bg-[#2da3a6] text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      Ir a Bitácora (Entrega / Devolución) &rarr;
                    </button>
                  )}
                </div>

                {rutBusqueda && (
                  <button
                    type="button"
                    onClick={() => navigate(`/informes/bitacora-funcionario?rut=${encodeURIComponent(rutBusqueda)}`)}
                    className="px-3.5 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#016098] text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    🖨️ Imprimir Bitácora Funcionario
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Panel Lateral: Nómina Alfabética de Funcionarios (GroupBox1 en expedientes.vb) (5 columnas) */}
          <div className="xl:col-span-5 bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-5 flex flex-col">
            <h2 className="text-base font-bold text-[#016098] mb-1">Nómina de Funcionarios</h2>
            <p className="text-xs text-[#64748b] mb-3">
              Filtre por inicial de Apellido Paterno o busque por nombre/RUT y haga clic para cargar
            </p>

            {/* Buscador por texto + Selector de Letra A-Z */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={textoFiltroNomina}
                onChange={(e) => setTextoFiltroNomina(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && cargarNominaFuncionarios('TODOS', textoFiltroNomina)}
                placeholder="Buscar por Apellido, Nombre, RUT o Kárdex..."
                className="w-full px-3 py-1.5 text-xs border border-[#cbd5e1] rounded-lg"
              />
              <button
                type="button"
                onClick={() => {
                  setLetraFiltro('TODOS');
                  cargarNominaFuncionarios('TODOS', textoFiltroNomina);
                }}
                className="px-3 py-1.5 bg-[#016098] text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer"
              >
                Buscar
              </button>
            </div>

            {/* Botones A-Z */}
            <div className="flex flex-wrap gap-1 mb-3">
              {LETRAS_ABECEDARIO.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLetraFiltro(l)}
                  className={`w-6 h-6 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                    letraFiltro === l
                      ? 'bg-[#016098] text-white'
                      : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* Tabla compacta de Funcionarios */}
            <div className="overflow-y-auto max-h-[360px] border border-[#e2e8f0] rounded-lg flex-1">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[#f8fafc] text-[#475569] sticky top-0 border-b border-[#e2e8f0]">
                  <tr>
                    <th className="py-2 px-2.5">RUT</th>
                    <th className="py-2 px-2.5">Paterno</th>
                    <th className="py-2 px-2.5">Materno</th>
                    <th className="py-2 px-2.5">Nombres</th>
                    <th className="py-2 px-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e8f0]">
                  {cargandoNominaFunc ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[#64748b]">
                        Cargando nómina...
                      </td>
                    </tr>
                  ) : listaFuncionarios.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[#64748b]">
                        Sin funcionarios para el filtro seleccionado
                      </td>
                    </tr>
                  ) : (
                    listaFuncionarios.map((f, i) => (
                      <tr
                        key={`${f.Rut}-${i}`}
                        onClick={() => {
                          setRutBusqueda(f.RutLimpio);
                          buscarFichaPorRut(f.RutLimpio);
                        }}
                        className={`cursor-pointer transition-colors hover:bg-sky-50 ${
                          rutBusqueda === f.RutLimpio ? 'bg-sky-100/70 font-semibold' : ''
                        }`}
                      >
                        <td className="py-1.5 px-2.5 font-bold text-[#016098] whitespace-nowrap">
                          {f.RutLimpio}-{f.DV}
                        </td>
                        <td className="py-1.5 px-2.5">{f.Paterno}</td>
                        <td className="py-1.5 px-2.5">{f.Materno}</td>
                        <td className="py-1.5 px-2.5">{f.Nombre}</td>
                        <td className="py-1.5 px-2.5">
                          {f.EstadoExpediente ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                              {f.EstadoExpediente}
                            </span>
                          ) : (
                            '-'
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
          PESTAÑA 2: REGISTRO BITÁCORA INDIVIDUAL (expedientes.vb TabPage4)
      ===================================================================== */}
      {tabActiva === 'bitacora' && (
        <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-6 space-y-5">
          {/* Barra superior de selección de Funcionario en Bitácora */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#e2e8f0]">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[#64748b] uppercase mb-1">
                  RUT Funcionario
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={rutBusqueda}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setRutBusqueda(val);
                      setDvFuncionario(calcularDVCliente(val));
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && buscarFichaPorRut()}
                    placeholder="Ej: 7517333"
                    className="w-36 px-3 py-1.5 text-sm border border-[#cbd5e1] rounded-lg font-bold text-[#016098]"
                  />
                  <button
                    type="button"
                    onClick={() => buscarFichaPorRut()}
                    className="px-3.5 py-1.5 bg-[#016098] text-white text-xs font-bold rounded-lg hover:bg-[#024a8d] cursor-pointer"
                  >
                    Cargar Funcionario
                  </button>
                </div>
              </div>

              {nombres && (
                <div className="bg-[#f8fafc] border border-[#cbd5e1] px-4 py-2 rounded-lg">
                  <span className="text-[10px] font-bold text-[#64748b] uppercase block">
                    Funcionario Seleccionado
                  </span>
                  <span className="text-sm font-extrabold text-[#016098]">
                    {`${nombres} ${paterno} ${materno}`.trim()} ({rutBusqueda}-{dvFuncionario})
                  </span>
                </div>
              )}
            </div>

            {/* Selector Modo: Registrar Entrega vs Registrar Devolución (GroupBox4 en expedientes.vb) */}
            <div className="flex items-center gap-2 bg-[#f1f5f9] p-1.5 rounded-xl">
              <button
                type="button"
                onClick={() => setModoBitacora('entrega')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoBitacora === 'entrega'
                    ? 'bg-[#016098] text-white shadow-sm'
                    : 'text-[#475569] hover:text-[#016098]'
                }`}
              >
                📤 Registrar Entrega
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoBitacora('devolucion');
                  if (ultimoMovimientoEntregado) {
                    setNumMovSeleccionado(ultimoMovimientoEntregado.NumMov);
                    setUnidadBitacora(ultimoMovimientoEntregado.Unidad || '');
                    setResponsableBitacora(ultimoMovimientoEntregado.Responsable || '');
                    setObsBitacora(ultimoMovimientoEntregado.Observacion || '');
                  }
                }}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoBitacora === 'devolucion'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-[#475569] hover:text-emerald-700'
                }`}
              >
                📥 Registrar Devolución
              </button>
            </div>
          </div>

          {/* Alerta si el expediente ya se encuentra ENTREGADO */}
          {modoBitacora === 'entrega' && ultimoMovimientoEntregado && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-amber-900">
                <p className="font-bold text-sm">
                  ⚠️ Este expediente figura actualmente como ENTREGADO (Solicitud N° {ultimoMovimientoEntregado.NumMov})
                </p>
                <p className="mt-0.5">
                  Retirado por <strong>{ultimoMovimientoEntregado.Responsable}</strong> ({ultimoMovimientoEntregado.Unidad}) el{' '}
                  <strong>{ultimoMovimientoEntregado.Fecha}</strong>. Según las reglas del sistema, debe registrar su
                  DEVOLUCIÓN antes de una nueva entrega.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModoBitacora('devolucion');
                  setNumMovSeleccionado(ultimoMovimientoEntregado.NumMov);
                  setUnidadBitacora(ultimoMovimientoEntregado.Unidad || '');
                  setResponsableBitacora(ultimoMovimientoEntregado.Responsable || '');
                  setObsBitacora(ultimoMovimientoEntregado.Observacion || '');
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer"
              >
                Pasar a Devolución (Solicitud #{ultimoMovimientoEntregado.NumMov})
              </button>
            </div>
          )}

          {/* Formulario de Entrega / Devolución */}
          <form onSubmit={guardarMovimientoBitacora} className="space-y-4">
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
                      ? nextNumMov || 'Auto'
                      : numMovSeleccionado || 'Seleccione en tabla'
                  }
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] bg-[#f8fafc] rounded-lg font-extrabold text-[#016098]"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#475569] mb-1">
                  Solicitado por (Unidad / Departamento)
                </label>
                <input
                  type="text"
                  list="unidades-exp-list"
                  value={unidadBitacora}
                  onChange={(e) => setUnidadBitacora(e.target.value)}
                  placeholder="Seleccione o escriba unidad..."
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                />
                <datalist id="unidades-exp-list">
                  {unidadesSolicitantes.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1">Quien Retira (Responsable)</label>
                <input
                  type="text"
                  value={responsableBitacora}
                  onChange={(e) => setResponsableBitacora(e.target.value)}
                  placeholder="NOMBRE QUIEN RETIRA"
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                />
              </div>

              <div>
                {modoBitacora === 'entrega' ? (
                  <>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Solicitud / Entrega</label>
                    <input
                      type="date"
                      value={fechaSolBitacora}
                      onChange={(e) => setFechaSolBitacora(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-semibold text-emerald-700 mb-1">Fecha de Devolución</label>
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
                <label className="block text-xs font-semibold text-[#475569] mb-1">Observación del Movimiento</label>
                <input
                  type="text"
                  value={obsBitacora}
                  onChange={(e) => setObsBitacora(e.target.value)}
                  placeholder="Observación opcional de la entrega o devolución..."
                  className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                />
              </div>

              <div className="lg:col-span-4 flex flex-wrap justify-end gap-2">
                <button
                  type="submit"
                  disabled={cargando}
                  className={`px-5 py-2.5 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer ${
                    modoBitacora === 'entrega'
                      ? 'bg-[#016098] hover:bg-[#024a8d]'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {modoBitacora === 'entrega'
                    ? '📤 Confirmar Entrega (ENTREGADO)'
                    : '📥 Confirmar Devolución (DEVUELTO)'}
                </button>

                {rutBusqueda && (
                  <button
                    type="button"
                    onClick={() => navigate(`/informes/bitacora-funcionario?rut=${encodeURIComponent(rutBusqueda)}`)}
                    className="px-4 py-2.5 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#016098] text-xs font-bold rounded-lg transition-colors cursor-pointer"
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
          PESTAÑA 3: NÓMINAS DE EXPEDIENTES (expedientes.vb TabPage1)
      ===================================================================== */}
      {tabActiva === 'nominas' && (
        <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#e2e8f0]">
            {/* Buscador / Generador de N° de Nómina */}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-bold text-[#016098] uppercase mb-1">N° de Nómina</label>
                <input
                  type="number"
                  value={numNomina}
                  onChange={(e) => setNumNomina(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && buscarNominaExistente()}
                  placeholder="Ej: 120"
                  className="w-32 px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg font-extrabold text-[#016098]"
                />
              </div>
              <button
                type="button"
                onClick={() => buscarNominaExistente()}
                className="px-4 py-2 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Buscar Nómina
              </button>
              <button
                type="button"
                onClick={obtenerSiguienteNomina}
                className="px-4 py-2 bg-[#39BABD] hover:bg-[#2da3a6] text-white text-xs font-bold rounded-lg cursor-pointer"
                title="Obtiene el correlativo MAX(nomina) + 1"
              >
                + Nueva Nómina (Auto)
              </button>
              {numNomina && (
                <button
                  type="button"
                  onClick={() => navigate(`/informes/nomina-expedientes?nomina=${encodeURIComponent(numNomina)}`)}
                  className="px-4 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#016098] text-xs font-bold rounded-lg cursor-pointer"
                >
                  🖨️ Imprimir Nómina Oficial
                </button>
              )}
            </div>

            {/* Selector de Modo Nómina (GroupBox7 en expedientes.vb) */}
            <div className="flex flex-wrap gap-1.5 bg-[#f1f5f9] p-1.5 rounded-xl">
              <button
                type="button"
                onClick={() => setModoNomina('entrega')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoNomina === 'entrega' ? 'bg-[#016098] text-white' : 'text-[#475569]'
                }`}
              >
                Registrar Entrega
              </button>
              <button
                type="button"
                onClick={() => setModoNomina('devolucion-parcial')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoNomina === 'devolucion-parcial' ? 'bg-amber-600 text-white' : 'text-[#475569]'
                }`}
              >
                Devolución Parcial
              </button>
              <button
                type="button"
                onClick={() => setModoNomina('devolucion-total')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  modoNomina === 'devolucion-total' ? 'bg-emerald-600 text-white' : 'text-[#475569]'
                }`}
              >
                Devolución Total Nómina
              </button>
            </div>
          </div>

          <form onSubmit={ejecutarAccionNomina} className="space-y-4">
            {modoNomina === 'entrega' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Solicitado por</label>
                    <input
                      type="text"
                      list="unidades-exp-list"
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
                      placeholder="RESPONSABLE RETIRO"
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Fecha Solicitud</label>
                    <input
                      type="date"
                      value={fechaSolNomina}
                      onChange={(e) => setFechaSolNomina(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1">Observación Nómina</label>
                    <input
                      type="text"
                      value={obsNomina}
                      onChange={(e) => setObsNomina(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#cbd5e1] rounded-lg"
                    />
                  </div>
                </div>

                {/* Fila para ir agregando RUTs a la Nómina */}
                <div className="bg-[#f8fafc] border border-[#cbd5e1] rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#016098] mb-1">
                        RUT Funcionario a Incorporar
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={rutAgregarNomina}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setRutAgregarNomina(val);
                            setDvAgregarNomina(calcularDVCliente(val));
                          }}
                          onBlur={verificarRutParaNomina}
                          placeholder="Ej: 8187405"
                          className="w-36 px-3 py-2 text-sm border border-[#cbd5e1] bg-white rounded-lg font-bold text-[#016098]"
                        />
                        <span>-</span>
                        <input
                          type="text"
                          readOnly
                          value={dvAgregarNomina}
                          className="w-10 px-2 py-2 text-sm text-center border border-[#cbd5e1] bg-white rounded-lg font-bold"
                        />
                        <button
                          type="button"
                          onClick={verificarRutParaNomina}
                          className="px-3 py-2 bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-xs font-bold rounded-lg cursor-pointer"
                        >
                          Validar RUT
                        </button>
                      </div>
                    </div>

                    {nombreAgregarNomina && (
                      <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-900">
                        ✓ {nombreAgregarNomina}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={cargando}
                    className="px-5 py-2.5 bg-[#016098] hover:bg-[#024a8d] text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
                  >
                    + Agregar Expediente a Nómina N° {numNomina || '...'}
                  </button>
                </div>
              </>
            ) : (
              /* Modo Devolución Parcial o Total */
              <div className="bg-[#f8fafc] border border-[#cbd5e1] rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-4">
                  {modoNomina === 'devolucion-parcial' && (
                    <div>
                      <label className="block text-xs font-bold text-amber-800 mb-1">
                        N° Solicitud Seleccionada en Tabla
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={numMovNominaSel ? `Solicitud #${numMovNominaSel}` : 'Haga clic en una fila abajo'}
                        className="w-56 px-3 py-2 text-sm border border-amber-300 bg-white rounded-lg font-bold text-amber-900"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-[#475569] mb-1">Fecha de Devolución</label>
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
                    modoNomina === 'devolucion-parcial'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {modoNomina === 'devolucion-parcial'
                    ? 'Confirmar Devolución Parcial'
                    : `Confirmar Devolución Total de Nómina N° ${numNomina || ''}`}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* =====================================================================
          GRILLA INFERIOR: MOVIMIENTOS EN BITÁCORA (GroupBox2 en expedientes.vb)
      ===================================================================== */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] overflow-hidden">
        <div className="p-5 border-b border-[#e2e8f0] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#016098]">
              Movimientos en Bitácora{' '}
              {tabActiva === 'nominas' && numNomina
                ? `— Nómina N° ${numNomina}`
                : mostrandoTodosMov
                ? '— Últimos Movimientos Generales'
                : rutBusqueda
                ? `— RUT ${rutBusqueda}-${dvFuncionario}`
                : ''}
            </h3>
            <p className="text-xs text-[#64748b]">
              Haga clic sobre cualquier registro para seleccionarlo en Devolución ({movimientosBitacora.length} registros)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filtro de Impresión por Fecha (Dtp_FechaImp + Button4 en expedientes.vb) */}
            <div className="flex items-center gap-1.5 bg-[#f8fafc] border border-[#e2e8f0] px-2.5 py-1.5 rounded-lg">
              <span className="text-[11px] font-semibold text-[#475569]">Fecha Mov.:</span>
              <input
                type="date"
                value={fechaFiltroImpresion}
                onChange={(e) => setFechaFiltroImpresion(e.target.value)}
                className="text-xs border border-[#cbd5e1] rounded px-2 py-1 bg-white"
              />
              <button
                type="button"
                onClick={() =>
                  navigate(`/informes/movimientos-fecha?fecha=${encodeURIComponent(fechaFiltroImpresion)}`)
                }
                className="px-2.5 py-1 bg-[#016098] text-white text-[11px] font-bold rounded hover:bg-[#024a8d] cursor-pointer"
              >
                🖨️ Imprimir Fecha
              </button>
            </div>

            <button
              type="button"
              onClick={verTodosMovimientos}
              className="px-3.5 py-2 bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#1e293b] text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Ver Todos
            </button>

            <button
              type="button"
              onClick={exportarBitacoraExcel}
              disabled={movimientosBitacora.length === 0}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              📊 Exportar Excel
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-[#f8fafc] text-[#475569] uppercase sticky top-0 border-b border-[#e2e8f0]">
              <tr>
                <th className="py-3 px-4">N° Solicitud</th>
                <th className="py-3 px-4">RUT</th>
                <th className="py-3 px-4">Funcionario</th>
                <th className="py-3 px-4">Solicitado por (Unidad)</th>
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
                  <td colSpan={10} className="py-8 text-center text-[#64748b]">
                    No se registran movimientos en bitácora para la selección actual. Haga clic en &ldquo;Ver Todos&rdquo; o consulte un RUT.
                  </td>
                </tr>
              ) : (
                movimientosBitacora.map((m) => {
                  const esEntregado = String(m.Estado).toUpperCase() === 'ENTREGADO';
                  const seleccionado =
                    numMovSeleccionado === m.NumMov || numMovNominaSel === m.NumMov;
                  return (
                    <tr
                      key={m.NumMov}
                      onClick={() => {
                        setNumMovSeleccionado(m.NumMov);
                        setNumMovNominaSel(m.NumMov);
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
                      <td className="py-2.5 px-4 font-bold text-[#016098]">#{m.NumMov}</td>
                      <td className="py-2.5 px-4 font-semibold whitespace-nowrap">
                        {m.Rut}
                        {m.DV ? `-${m.DV}` : ''}
                      </td>
                      <td className="py-2.5 px-4">
                        {`${m.Nombre || ''} ${m.Paterno || ''} ${m.Materno || ''}`.trim() ||
                          `${nombres} ${paterno} ${materno}`.trim() ||
                          '-'}
                      </td>
                      <td className="py-2.5 px-4">{m.Unidad}</td>
                      <td className="py-2.5 px-4 font-semibold">{m.Responsable}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">{m.Fecha}</td>
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
                      <td className="py-2.5 px-4 text-[#64748b] max-w-[200px] truncate">{m.Observacion}</td>
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
