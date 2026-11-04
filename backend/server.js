const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { sql, poolPromise } = require('./db');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'cmds_archivo_expedientes_secret_key_2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pkg = require('./package.json');
app.get('/api/version', (req, res) => {
    res.json({ version: pkg.version || '1.1.0' });
});

// ============================================================================
// UTILIDADES DE NORMALIZACIÓN (RUT, DV, FECHAS DD-MM-YYYY Y TEXTOS CHAR/NCHAR)
// ============================================================================

function cleanStr(val) {
    if (val === null || val === undefined) return '';
    const s = String(val).trim();
    if (s === '-  -' || s === '--') return '';
    return s;
}

function cleanRutNum(rutRaw) {
    if (!rutRaw) return '';
    return String(rutRaw)
        .replace(/\./g, '')
        .split('-')[0]
        .trim()
        .replace(/^0+/, '');
}

function calcularDV(rutSinDv) {
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

// Convierte cualquier fecha ('YYYY-MM-DD' o 'DD-MM-YYYY') al formato 'DD-MM-YYYY' usado en Movimientos y Comprobantes
function toDDMMYYYY(dateStr) {
    const s = cleanStr(dateStr);
    if (!s) return '';
    const datePart = s.split('T')[0];
    const parts = datePart.split(/[-/]/);
    if (parts.length === 3) {
        if (parts[0].length === 4) {
            return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
        }
        if (parts[2].length === 4) {
            return `${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[2]}`;
        }
    }
    return s.slice(0, 10);
}

// Convierte un Date de SQL Server a 'YYYY-MM-DD' ignorando fechas centinela (1900-01-01 / 9999-01-01)
function formatSqlDateISO(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    const iso = d.toISOString().split('T')[0];
    if (iso.startsWith('1900-01-01') || iso.startsWith('9999-01-01') || iso.startsWith('1899-')) {
        return '';
    }
    return iso;
}

// ============================================================================
// 1. SALUD DEL SERVIDOR Y AUTENTICACIÓN
// ============================================================================

app.get('/api/health', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT 1 as number');
        res.json({
            status: 'ok',
            message: 'Servidor Backend y Conexión a Base de Datos Archivo funcionando correctamente',
            dbTest: result.recordset[0].number
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Fallo al conectar con la Base de Datos Archivo',
            error: error.message
        });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const uClean = cleanStr(username);
    const pClean = cleanStr(password);

    if (!uClean || !pClean) {
        return res.status(400).json({ status: 'error', message: 'Por favor ingrese usuario y contraseña' });
    }

    try {
        // 1. Credenciales históricas de LoginForm1.vb ("admin" / "archivo")
        if (uClean.toLowerCase() === 'admin' && pClean.toLowerCase() === 'archivo') {
            const userPayload = {
                username: 'admin',
                nombre: 'Administrador de Archivo CMDS',
                role: 'Administrador'
            };
            const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '12h' });
            return res.json({ status: 'ok', token, user: userPayload });
        }

        // 2. Usuarios registrados en LIC_USUARIO de la BD Archivo
        const pool = await poolPromise;
        const result = await pool.request()
            .input('u', sql.NVarChar, uClean)
            .input('p', sql.NVarChar, pClean)
            .query(`
                SELECT TOP 1
                    LTRIM(RTRIM(Usuario)) AS Usuario,
                    LTRIM(RTRIM(nombreUsuario)) AS nombreUsuario
                FROM LIC_USUARIO
                WHERE LOWER(LTRIM(RTRIM(Usuario))) = LOWER(@u)
                  AND LTRIM(RTRIM(Password)) = @p
            `);

        if (result.recordset.length > 0) {
            const dbUser = result.recordset[0];
            const userPayload = {
                username: dbUser.Usuario,
                nombre: dbUser.nombreUsuario || dbUser.Usuario,
                role: dbUser.Usuario.toLowerCase() === 'master' ? 'Administrador' : 'Operador Archivo'
            };
            const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '12h' });
            return res.json({ status: 'ok', token, user: userPayload });
        }

        return res.status(401).json({ status: 'error', message: 'Usuario o contraseña incorrectos' });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ status: 'error', message: 'Error interno del servidor al autenticar' });
    }
});

// ============================================================================
// 2. DOMINIOS Y LISTAS DESPLEGABLES
// ============================================================================

app.get('/api/dominios', async (req, res) => {
    try {
        const pool = await poolPromise;
        const estabRes = await pool.request().query(`
            SELECT
                CodUnidad,
                LTRIM(RTRIM(ISNULL(CodCenco, ''))) AS CodCenco,
                LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
                CodSector
            FROM LIC_ESTABLECIMIENTO
            WHERE LTRIM(RTRIM(ISNULL(Descripcion, ''))) <> ''
            ORDER BY Descripcion ASC
        `);

        const plantasRes = await pool.request().query(`
            SELECT DISTINCT LTRIM(RTRIM(descripcionPlanta)) AS Descripcion
            FROM LIC_FUNCIONARIO
            WHERE LTRIM(RTRIM(ISNULL(descripcionPlanta, ''))) <> ''
            ORDER BY Descripcion ASC
        `);

        res.json({
            status: 'ok',
            data: {
                establecimientos: estabRes.recordset,
                plantas: plantasRes.recordset.map(r => r.Descripcion),
                estadosExpediente: ['Vigente', 'Activo', 'Pasivo', 'bodega', 'NUEVO', 'INACTIVO'],
                unidadesExpedientes: [
                    'Departamento Juridico',
                    'Dirección de Educación',
                    'Dirección de Salud',
                    'Recursos Humanos',
                    'Secretaría General Ejecutiva'
                ],
                unidadesComprobantes: [
                    'Departamento Auditoria',
                    'Departamento Contabilidad',
                    'Departamento Juridica',
                    'Departamento Planificación',
                    'Dirección de Educación',
                    'Dirección de Obras',
                    'Dirección de Salud',
                    'Unidad Presupuesto',
                    'Unidad Tesoreria'
                ],
                tiposComprobante: ['CC', 'CI', 'CE'],
                sectoresComprobante: ['Casa Central', 'Educación', 'Salud']
            }
        });
    } catch (error) {
        console.error('Error en /api/dominios:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// ============================================================================
// 3. DASHBOARD GENERAL DE ARCHIVO (/api/dashboard/stats)
// ============================================================================

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const pool = await poolPromise;

        const kpiQuery = await pool.request().query(`
            SELECT
                (SELECT COUNT(*) FROM Expedientes) AS TotalExpedientes,
                (SELECT COUNT(*) FROM LIC_FUNCIONARIO) AS TotalFuncionarios,
                (SELECT COUNT(*) FROM Movimientos) AS TotalMovimientosExp,
                (
                    SELECT COUNT(*)
                    FROM (
                        SELECT Rut, Estado,
                               ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(Rut)) ORDER BY NumMov DESC) AS rn
                        FROM Movimientos
                        WHERE LTRIM(RTRIM(ISNULL(Rut, ''))) <> ''
                    ) t
                    WHERE t.rn = 1 AND UPPER(LTRIM(RTRIM(t.Estado))) = 'ENTREGADO'
                ) AS ExpedientesPrestados,
                (SELECT COUNT(*) FROM Comprobantes) AS TotalComprobantes,
                (
                    SELECT COUNT(*)
                    FROM (
                        SELECT NumComp, Estado,
                               ROW_NUMBER() OVER (PARTITION BY NumComp ORDER BY NumMovCom DESC) AS rn
                        FROM MovimientosComp
                        WHERE NumComp IS NOT NULL
                    ) tc
                    WHERE tc.rn = 1 AND UPPER(LTRIM(RTRIM(tc.Estado))) = 'ENTREGADO'
                ) AS ComprobantesPrestados
        `);

        const porEstadoExp = await pool.request().query(`
            SELECT
                CASE
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'VIGENTE' THEN 'Vigente'
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'ACTIVO' THEN 'Activo'
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'PASIVO' THEN 'Pasivo'
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'BODEGA' THEN 'Bodega'
                    WHEN LTRIM(RTRIM(ISNULL(Estado, ''))) = '' THEN 'Sin Especificar'
                    ELSE LTRIM(RTRIM(Estado))
                END AS EstadoNombre,
                COUNT(*) AS Cantidad
            FROM Expedientes
            GROUP BY
                CASE
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'VIGENTE' THEN 'Vigente'
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'ACTIVO' THEN 'Activo'
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'PASIVO' THEN 'Pasivo'
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'BODEGA' THEN 'Bodega'
                    WHEN LTRIM(RTRIM(ISNULL(Estado, ''))) = '' THEN 'Sin Especificar'
                    ELSE LTRIM(RTRIM(Estado))
                END
            ORDER BY Cantidad DESC
        `);

        const porUnidadMov = await pool.request().query(`
            SELECT TOP 6
                CASE
                    WHEN LTRIM(RTRIM(ISNULL(Unidad, ''))) = '' THEN 'Sin Unidad'
                    ELSE LTRIM(RTRIM(Unidad))
                END AS Unidad,
                COUNT(*) AS Cantidad
            FROM Movimientos
            GROUP BY
                CASE
                    WHEN LTRIM(RTRIM(ISNULL(Unidad, ''))) = '' THEN 'Sin Unidad'
                    ELSE LTRIM(RTRIM(Unidad))
                END
            ORDER BY Cantidad DESC
        `);

        const ultimosPrestamos = await pool.request().query(`
            SELECT TOP 15
                t.NumMov,
                LTRIM(RTRIM(t.Rut)) AS Rut,
                LTRIM(RTRIM(ISNULL(f.DV, ''))) AS DV,
                LTRIM(RTRIM(ISNULL(f.Nombre, ''))) AS Nombre,
                LTRIM(RTRIM(ISNULL(f.Paterno, ''))) AS Paterno,
                LTRIM(RTRIM(ISNULL(f.Materno, ''))) AS Materno,
                LTRIM(RTRIM(ISNULL(t.Unidad, ''))) AS Unidad,
                LTRIM(RTRIM(ISNULL(t.Responsable, ''))) AS Responsable,
                LTRIM(RTRIM(ISNULL(t.Fecha, ''))) AS Fecha,
                LTRIM(RTRIM(ISNULL(t.Estado, ''))) AS Estado,
                t.nomina AS Nomina
            FROM (
                SELECT NumMov, Rut, Unidad, Responsable, Fecha, Estado, nomina,
                       ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(Rut)) ORDER BY NumMov DESC) AS rn
                FROM Movimientos
                WHERE LTRIM(RTRIM(ISNULL(Rut, ''))) <> ''
            ) t
            LEFT JOIN LIC_FUNCIONARIO f
                ON REPLACE(LTRIM(RTRIM(f.Rut)), '0', '') = REPLACE(LTRIM(RTRIM(t.Rut)), '0', '')
                AND LTRIM(RTRIM(f.Rut)) IN (LTRIM(RTRIM(t.Rut)), CONCAT('0', LTRIM(RTRIM(t.Rut))))
            WHERE t.rn = 1 AND UPPER(LTRIM(RTRIM(t.Estado))) = 'ENTREGADO'
            ORDER BY t.NumMov DESC
        `);

        res.json({
            status: 'ok',
            data: {
                kpis: kpiQuery.recordset[0],
                porEstadoExpediente: porEstadoExp.recordset,
                porUnidadSolicitante: porUnidadMov.recordset,
                prestamosRecientes: ultimosPrestamos.recordset
            }
        });
    } catch (error) {
        console.error('Error en /api/dashboard/stats:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// ============================================================================
// 4. MÓDULO 1: GESTIÓN DE EXPEDIENTES (expedientes.vb)
// ============================================================================

// 4.1 Buscador / Nómina Alfabética de Funcionarios (GroupBox1 / ComboBox1 A-Z en expedientes.vb)
app.get('/api/expedientes/funcionarios', async (req, res) => {
    const letra = cleanStr(req.query.letra);
    const q = cleanStr(req.query.q);
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);

    try {
        const pool = await poolPromise;
        const request = pool.request();
        const conditions = [];

        if (letra && letra !== 'TODOS') {
            request.input('letra', sql.NVarChar, `${letra}%`);
            conditions.push(`LTRIM(RTRIM(f.Paterno)) LIKE @letra`);
        }

        if (q) {
            request.input('q', sql.NVarChar, `%${q}%`);
            conditions.push(`(
                LTRIM(RTRIM(f.Rut)) LIKE @q
                OR LTRIM(RTRIM(f.Paterno)) LIKE @q
                OR LTRIM(RTRIM(f.Materno)) LIKE @q
                OR LTRIM(RTRIM(f.Nombre)) LIKE @q
                OR LTRIM(RTRIM(ISNULL(e.Kardex, ''))) LIKE @q
                OR CONCAT(LTRIM(RTRIM(f.Nombre)), ' ', LTRIM(RTRIM(f.Paterno)), ' ', LTRIM(RTRIM(f.Materno))) LIKE @q
            )`);
        }

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await request.query(`
            SELECT TOP (${limit})
                LTRIM(RTRIM(f.Rut)) AS Rut,
                LTRIM(RTRIM(ISNULL(f.DV, ''))) AS DV,
                LTRIM(RTRIM(ISNULL(f.Paterno, ''))) AS Paterno,
                LTRIM(RTRIM(ISNULL(f.Materno, ''))) AS Materno,
                LTRIM(RTRIM(ISNULL(f.Nombre, ''))) AS Nombre,
                LTRIM(RTRIM(ISNULL(f.CodUnidad, ''))) AS CodUnidad,
                LTRIM(RTRIM(ISNULL(f.descripcionPlanta, ''))) AS DescripcionPlanta,
                f.FechaInicio,
                f.FechaTermino,
                LTRIM(RTRIM(ISNULL(e.Estado, ''))) AS EstadoExpediente,
                LTRIM(RTRIM(ISNULL(e.Kardex, ''))) AS Kardex,
                LTRIM(RTRIM(ISNULL(e.Contenido, ''))) AS Contenido
            FROM LIC_FUNCIONARIO f
            LEFT JOIN Expedientes e
                ON LTRIM(RTRIM(e.Rut)) IN (LTRIM(RTRIM(f.Rut)), REPLACE(LTRIM(RTRIM(f.Rut)), ' ', ''))
            ${whereSql}
            ORDER BY LTRIM(RTRIM(f.Paterno)) ASC, LTRIM(RTRIM(f.Materno)) ASC, LTRIM(RTRIM(f.Nombre)) ASC
        `);

        res.json({
            status: 'ok',
            registros: result.recordset.map(r => ({
                ...r,
                RutLimpio: cleanRutNum(r.Rut),
                DV: r.DV || calcularDV(cleanRutNum(r.Rut)),
                FechaInicio: formatSqlDateISO(r.FechaInicio),
                FechaTermino: formatSqlDateISO(r.FechaTermino)
            }))
        });
    } catch (error) {
        console.error('Error en /api/expedientes/funcionarios:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.2 Consulta Integral de Ficha de Funcionario + Expediente + Bitácora por RUT
app.get('/api/expedientes/ficha/:rut', async (req, res) => {
    const rutNum = cleanRutNum(req.params.rut);
    if (!rutNum) {
        return res.status(400).json({ status: 'error', error: 'Debe proporcionar un RUT válido' });
    }
    const rutConCero = '0' + rutNum;

    try {
        const pool = await poolPromise;

        // 1. Buscar en LIC_FUNCIONARIO
        const funcRes = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`
                SELECT TOP 1
                    LTRIM(RTRIM(Rut)) AS Rut,
                    LTRIM(RTRIM(ISNULL(DV, ''))) AS DV,
                    LTRIM(RTRIM(ISNULL(Nombre, ''))) AS Nombre,
                    LTRIM(RTRIM(ISNULL(Paterno, ''))) AS Paterno,
                    LTRIM(RTRIM(ISNULL(Materno, ''))) AS Materno,
                    LTRIM(RTRIM(ISNULL(CodUnidad, ''))) AS CodUnidad,
                    LTRIM(RTRIM(ISNULL(descripcionPlanta, ''))) AS DescripcionPlanta,
                    FechaInicio,
                    FechaTermino
                FROM LIC_FUNCIONARIO
                WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
            `);

        // 2. Buscar en Expedientes
        const expRes = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`
                SELECT TOP 1
                    LTRIM(RTRIM(Rut)) AS Rut,
                    LTRIM(RTRIM(ISNULL(Dv, ''))) AS Dv,
                    LTRIM(RTRIM(ISNULL(Contenido, ''))) AS Contenido,
                    LTRIM(RTRIM(ISNULL(Estado, ''))) AS Estado,
                    LTRIM(RTRIM(ISNULL(Observacion, ''))) AS Observacion,
                    Fechacreacion,
                    LTRIM(RTRIM(ISNULL(Ubicacion, ''))) AS Ubicacion,
                    NumExp,
                    LTRIM(RTRIM(ISNULL(Kardex, ''))) AS Kardex,
                    LTRIM(RTRIM(ISNULL(Cajon, ''))) AS Cajon,
                    LTRIM(RTRIM(ISNULL(Tipo, ''))) AS Tipo
                FROM Expedientes
                WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
            `);

        // 3. Buscar Movimientos en Bitácora
        const movRes = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`
                SELECT
                    NumMov,
                    NumExp,
                    LTRIM(RTRIM(Rut)) AS Rut,
                    LTRIM(RTRIM(ISNULL(Unidad, ''))) AS Unidad,
                    LTRIM(RTRIM(ISNULL(Responsable, ''))) AS Responsable,
                    LTRIM(RTRIM(ISNULL(Observacion, ''))) AS Observacion,
                    LTRIM(RTRIM(ISNULL(Fecha, ''))) AS Fecha,
                    LTRIM(RTRIM(ISNULL(FechaDev, ''))) AS FechaDev,
                    LTRIM(RTRIM(ISNULL(Estado, ''))) AS Estado,
                    nomina AS Nomina
                FROM Movimientos
                WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
                ORDER BY NumMov DESC
            `);

        // 4. Siguiente N° de Solicitud (MAX(NumMov) + 1)
        const nextMovRes = await pool.request().query(`
            SELECT ISNULL(MAX(NumMov), 0) + 1 AS NextNumMov FROM Movimientos
        `);

        const func = funcRes.recordset[0] || null;
        const exp = expRes.recordset[0] || null;
        const dvCalculado = (func && func.DV) || (exp && exp.Dv) || calcularDV(rutNum);

        if (!func && !exp) {
            return res.json({
                status: 'not_found',
                rut: rutNum,
                dv: dvCalculado,
                nextNumMov: nextMovRes.recordset[0].NextNumMov,
                funcionario: null,
                expediente: null,
                movimientos: []
            });
        }

        const nombre = func ? func.Nombre : '';
        const paterno = func ? func.Paterno : '';
        const materno = func ? func.Materno : '';
        const rutaCarpetaDigital = `\\\\192.168.3.159\\Archivos\\${rutNum}-${dvCalculado} ${paterno} ${materno} ${nombre}`.trim();

        res.json({
            status: 'ok',
            rut: rutNum,
            dv: dvCalculado,
            nextNumMov: nextMovRes.recordset[0].NextNumMov,
            rutaCarpetaDigital,
            funcionario: func ? {
                Rut: rutNum,
                DV: dvCalculado,
                Nombre: func.Nombre,
                Paterno: func.Paterno,
                Materno: func.Materno,
                CodUnidad: func.CodUnidad,
                DescripcionPlanta: func.DescripcionPlanta,
                FechaInicio: formatSqlDateISO(func.FechaInicio),
                FechaTermino: formatSqlDateISO(func.FechaTermino)
            } : {
                Rut: rutNum,
                DV: dvCalculado,
                Nombre: '',
                Paterno: '',
                Materno: '',
                CodUnidad: '',
                DescripcionPlanta: '',
                FechaInicio: '',
                FechaTermino: ''
            },
            expediente: exp ? {
                Rut: rutNum,
                Dv: dvCalculado,
                Contenido: exp.Contenido,
                Estado: exp.Estado,
                Observacion: exp.Observacion,
                Fechacreacion: formatSqlDateISO(exp.Fechacreacion),
                Ubicacion: exp.Ubicacion,
                NumExp: exp.NumExp,
                Kardex: exp.Kardex,
                Cajon: exp.Cajon,
                Tipo: exp.Tipo
            } : {
                Rut: rutNum,
                Dv: dvCalculado,
                Contenido: '',
                Estado: 'Vigente',
                Observacion: '',
                Fechacreacion: '',
                Ubicacion: '',
                NumExp: null,
                Kardex: '',
                Cajon: '',
                Tipo: ''
            },
            movimientos: movRes.recordset.map(m => ({
                ...m,
                Fecha: cleanStr(m.Fecha),
                FechaDev: cleanStr(m.FechaDev)
            }))
        });
    } catch (error) {
        console.error('Error en /api/expedientes/ficha/:rut:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.3 Guardar / Actualizar Antecedentes Generales (LIC_FUNCIONARIO + Expedientes)
app.post('/api/expedientes/ficha', async (req, res) => {
    const {
        rut,
        dv,
        nombre,
        paterno,
        materno,
        codUnidad,
        descripcionPlanta,
        fechaInicio,
        fechaTermino,
        estado,
        kardex,
        contenido
    } = req.body;

    const rutNum = cleanRutNum(rut);
    if (!rutNum) {
        return res.status(400).json({ status: 'error', error: 'El RUT del funcionario es obligatorio' });
    }

    const rutConCero = '0' + rutNum;
    const dvFinal = cleanStr(dv) || calcularDV(rutNum);
    const fechaIniDate = fechaInicio ? new Date(fechaInicio) : new Date('1900-01-01T00:00:00Z');
    const fechaTerDate = fechaTermino ? new Date(fechaTermino) : new Date('1900-01-01T00:00:00Z');

    try {
        const pool = await poolPromise;

        // 1. Verificar existencia en LIC_FUNCIONARIO
        const checkFunc = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`SELECT TOP 1 Rut FROM LIC_FUNCIONARIO WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)`);

        if (checkFunc.recordset.length > 0) {
            // Actualizar LIC_FUNCIONARIO (Corrigiendo bug histórico de codunidad en expedientes.vb L465)
            await pool.request()
                .input('r1', sql.NVarChar, rutNum)
                .input('r2', sql.NVarChar, rutConCero)
                .input('dv', sql.NVarChar, dvFinal)
                .input('nombre', sql.NVarChar, cleanStr(nombre).toUpperCase())
                .input('paterno', sql.NVarChar, cleanStr(paterno).toUpperCase())
                .input('materno', sql.NVarChar, cleanStr(materno).toUpperCase())
                .input('codUnidad', sql.NVarChar, cleanStr(codUnidad))
                .input('planta', sql.NVarChar, cleanStr(descripcionPlanta).toUpperCase())
                .input('fechaIni', sql.DateTime, isNaN(fechaIniDate.getTime()) ? new Date('1900-01-01T00:00:00Z') : fechaIniDate)
                .input('fechaTer', sql.DateTime, isNaN(fechaTerDate.getTime()) ? new Date('1900-01-01T00:00:00Z') : fechaTerDate)
                .query(`
                    UPDATE LIC_FUNCIONARIO
                    SET DV = @dv,
                        Nombre = @nombre,
                        Paterno = @paterno,
                        Materno = @materno,
                        CodUnidad = @codUnidad,
                        descripcionPlanta = @planta,
                        FechaInicio = @fechaIni,
                        FechaTermino = @fechaTer
                    WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
                `);
        } else {
            // Insertar nuevo funcionario en LIC_FUNCIONARIO
            await pool.request()
                .input('rut', sql.NVarChar, rutNum)
                .input('dv', sql.NVarChar, dvFinal)
                .input('nombre', sql.NVarChar, cleanStr(nombre).toUpperCase())
                .input('paterno', sql.NVarChar, cleanStr(paterno).toUpperCase())
                .input('materno', sql.NVarChar, cleanStr(materno).toUpperCase())
                .input('codUnidad', sql.NVarChar, cleanStr(codUnidad))
                .input('planta', sql.NVarChar, cleanStr(descripcionPlanta).toUpperCase())
                .input('fechaIni', sql.DateTime, isNaN(fechaIniDate.getTime()) ? new Date('1900-01-01T00:00:00Z') : fechaIniDate)
                .input('fechaTer', sql.DateTime, isNaN(fechaTerDate.getTime()) ? new Date('1900-01-01T00:00:00Z') : fechaTerDate)
                .query(`
                    INSERT INTO LIC_FUNCIONARIO (
                        Rut, DV, Nombre, Paterno, Materno, Jornada,
                        FechaInicio, FechaTermino, CodUnidad, CodContrato,
                        CodPlanta, Categoria, descripcionPlanta, UltimaPrev, fAfiliacion
                    ) VALUES (
                        @rut, @dv, @nombre, @paterno, @materno, '0',
                        @fechaIni, @fechaTer, @codUnidad, '0',
                        '0', '0', @planta, '0', '0'
                    )
                `);
        }

        // 2. Verificar existencia en Expedientes
        const checkExp = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`SELECT TOP 1 Rut FROM Expedientes WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)`);

        let accion = 'actualizado';
        if (checkExp.recordset.length > 0) {
            await pool.request()
                .input('r1', sql.NVarChar, rutNum)
                .input('r2', sql.NVarChar, rutConCero)
                .input('dv', sql.NChar, dvFinal)
                .input('contenido', sql.NChar, cleanStr(contenido))
                .input('estado', sql.NChar, cleanStr(estado) || 'Vigente')
                .input('kardex', sql.NChar, cleanStr(kardex))
                .query(`
                    UPDATE Expedientes
                    SET Dv = @dv,
                        Contenido = @contenido,
                        Estado = @estado,
                        Kardex = @kardex
                    WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
                `);
        } else {
            accion = 'creado';
            const nextExpRes = await pool.request().query(`SELECT ISNULL(MAX(NumExp), 0) + 1 AS NextExp FROM Expedientes`);
            const nextExp = nextExpRes.recordset[0].NextExp;
            await pool.request()
                .input('rut', sql.Char, rutNum)
                .input('dv', sql.NChar, dvFinal)
                .input('contenido', sql.NChar, cleanStr(contenido))
                .input('estado', sql.NChar, cleanStr(estado) || 'Vigente')
                .input('nextExp', sql.Int, nextExp)
                .input('kardex', sql.NChar, cleanStr(kardex))
                .query(`
                    INSERT INTO Expedientes (
                        Rut, Dv, Contenido, Estado, Fechacreacion, NumExp, Kardex
                    ) VALUES (
                        @rut, @dv, @contenido, @estado, GETDATE(), @nextExp, @kardex
                    )
                `);
        }

        res.json({
            status: 'ok',
            accion,
            message: `Expediente y antecedentes del funcionario RUT ${rutNum}-${dvFinal} ${accion}s exitosamente`
        });
    } catch (error) {
        console.error('Error en POST /api/expedientes/ficha:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.4 Listado General de Movimientos en Bitácora (por RUT, por Fecha, por Nómina o Ver Todos)
app.get('/api/expedientes/bitacora', async (req, res) => {
    const rut = cleanRutNum(req.query.rut);
    const fecha = cleanStr(req.query.fecha);
    const nomina = cleanStr(req.query.nomina);
    const estado = cleanStr(req.query.estado);
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);

    try {
        const pool = await poolPromise;
        const request = pool.request();
        const conditions = [];

        if (rut) {
            request.input('r1', sql.NVarChar, rut);
            request.input('r2', sql.NVarChar, '0' + rut);
            conditions.push(`LTRIM(RTRIM(m.Rut)) IN (@r1, @r2)`);
        }
        if (fecha) {
            request.input('fecha', sql.NVarChar, toDDMMYYYY(fecha));
            conditions.push(`LTRIM(RTRIM(m.Fecha)) = @fecha`);
        }
        if (nomina) {
            request.input('nomina', sql.Int, parseInt(nomina, 10));
            conditions.push(`m.nomina = @nomina`);
        }
        if (estado && estado !== 'TODOS') {
            request.input('estado', sql.NVarChar, estado.toUpperCase());
            conditions.push(`UPPER(LTRIM(RTRIM(m.Estado))) = @estado`);
        }

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await request.query(`
            SELECT TOP (${limit})
                m.NumMov,
                m.NumExp,
                LTRIM(RTRIM(m.Rut)) AS Rut,
                LTRIM(RTRIM(ISNULL(f.DV, ''))) AS DV,
                LTRIM(RTRIM(ISNULL(f.Nombre, ''))) AS Nombre,
                LTRIM(RTRIM(ISNULL(f.Paterno, ''))) AS Paterno,
                LTRIM(RTRIM(ISNULL(f.Materno, ''))) AS Materno,
                LTRIM(RTRIM(ISNULL(m.Unidad, ''))) AS Unidad,
                LTRIM(RTRIM(ISNULL(m.Responsable, ''))) AS Responsable,
                LTRIM(RTRIM(ISNULL(m.Observacion, ''))) AS Observacion,
                LTRIM(RTRIM(ISNULL(m.Fecha, ''))) AS Fecha,
                LTRIM(RTRIM(ISNULL(m.FechaDev, ''))) AS FechaDev,
                LTRIM(RTRIM(ISNULL(m.Estado, ''))) AS Estado,
                m.nomina AS Nomina
            FROM Movimientos m
            LEFT JOIN LIC_FUNCIONARIO f
                ON LTRIM(RTRIM(f.Rut)) IN (LTRIM(RTRIM(m.Rut)), CONCAT('0', LTRIM(RTRIM(m.Rut))))
            ${whereSql}
            ORDER BY m.NumMov DESC
        `);

        const nextMovRes = await pool.request().query(`
            SELECT ISNULL(MAX(NumMov), 0) + 1 AS NextNumMov FROM Movimientos
        `);

        res.json({
            status: 'ok',
            nextNumMov: nextMovRes.recordset[0].NextNumMov,
            movimientos: result.recordset.map(m => ({
                ...m,
                Fecha: cleanStr(m.Fecha),
                FechaDev: cleanStr(m.FechaDev)
            }))
        });
    } catch (error) {
        console.error('Error en GET /api/expedientes/bitacora:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.5 Registrar Entrega Individual de Expediente en Bitácora (expedientes.vb L487-534)
app.post('/api/expedientes/bitacora/entrega', async (req, res) => {
    const { rut, unidad, responsable, fecha, observacion } = req.body;
    const rutNum = cleanRutNum(rut);

    if (!rutNum) {
        return res.status(400).json({ status: 'error', error: 'Debe seleccionar un funcionario (RUT) para registrar la entrega' });
    }
    if (!cleanStr(unidad)) {
        return res.status(400).json({ status: 'error', error: 'Debe indicar la Unidad o Departamento que solicita el expediente' });
    }
    if (!cleanStr(responsable)) {
        return res.status(400).json({ status: 'error', error: 'Debe indicar la persona responsable que retira el expediente' });
    }

    const rutConCero = '0' + rutNum;
    const fechaFormateada = toDDMMYYYY(fecha) || toDDMMYYYY(new Date().toISOString());

    try {
        const pool = await poolPromise;

        // Validar si el último movimiento del expediente está en estado 'ENTREGADO'
        const ultimoMov = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`
                SELECT TOP 1 NumMov, LTRIM(RTRIM(Estado)) AS Estado
                FROM Movimientos
                WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
                ORDER BY NumMov DESC
            `);

        if (ultimoMov.recordset.length > 0 && ultimoMov.recordset[0].Estado.toUpperCase() === 'ENTREGADO') {
            return res.status(400).json({
                status: 'error',
                error: `No puede registrar una nueva ENTREGA, existe N° Solicitud: ${ultimoMov.recordset[0].NumMov} que no ha sido registrada su DEVOLUCIÓN.`
            });
        }

        const nextMovRes = await pool.request().query(`SELECT ISNULL(MAX(NumMov), 0) + 1 AS NextMov FROM Movimientos`);
        const numMovCreado = nextMovRes.recordset[0].NextMov;

        await pool.request()
            .input('nextMov', sql.Int, numMovCreado)
            .input('rut', sql.NChar, rutNum)
            .input('unidad', sql.NChar, cleanStr(unidad))
            .input('responsable', sql.NChar, cleanStr(responsable).toUpperCase())
            .input('observacion', sql.NChar, cleanStr(observacion))
            .input('fecha', sql.NChar, fechaFormateada)
            .query(`
                INSERT INTO Movimientos (
                    NumMov, Rut, Unidad, Responsable, Observacion, Fecha, FechaDev, Estado
                ) VALUES (
                    @nextMov, @rut, @unidad, @responsable, @observacion, @fecha, '', 'ENTREGADO'
                )
            `);
        res.json({
            status: 'ok',
            numMov: numMovCreado,
            message: `Entrega de expediente registrada exitosamente con N° Solicitud ${numMovCreado}`
        });
    } catch (error) {
        console.error('Error en POST /api/expedientes/bitacora/entrega:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.6 Registrar Devolución Individual de Expediente en Bitácora (expedientes.vb L520-531)
app.put('/api/expedientes/bitacora/devolucion/:numMov', async (req, res) => {
    const numMov = parseInt(req.params.numMov, 10);
    const { fechaDev, unidad, responsable, observacion } = req.body;

    if (!numMov) {
        return res.status(400).json({ status: 'error', error: 'Número de Solicitud (NumMov) inválido' });
    }

    const fechaDevFormateada = toDDMMYYYY(fechaDev) || toDDMMYYYY(new Date().toISOString());

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('numMov', sql.Int, numMov)
            .input('fechaDev', sql.NChar, fechaDevFormateada)
            .input('unidad', sql.NChar, unidad !== undefined ? cleanStr(unidad) : null)
            .input('responsable', sql.NChar, responsable !== undefined ? cleanStr(responsable).toUpperCase() : null)
            .input('observacion', sql.NChar, observacion !== undefined ? cleanStr(observacion) : null)
            .query(`
                UPDATE Movimientos
                SET FechaDev = @fechaDev,
                    Estado = 'DEVUELTO',
                    Unidad = COALESCE(@unidad, Unidad),
                    Responsable = COALESCE(@responsable, Responsable),
                    Observacion = COALESCE(@observacion, Observacion)
                WHERE NumMov = @numMov
            `);

        res.json({
            status: 'ok',
            message: `Devolución registrada exitosamente para la Solicitud N° ${numMov}`
        });
    } catch (error) {
        console.error('Error en PUT /api/expedientes/bitacora/devolucion:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.7 Nóminas de Expedientes: Obtener siguiente N° de Nómina (btn_get_nom en expedientes.vb)
app.get('/api/expedientes/nominas/next-id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT ISNULL(MAX(nomina), 0) + 1 AS NextNomina FROM Movimientos
        `);
        res.json({ status: 'ok', nextNomina: result.recordset[0].NextNomina });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.8 Nóminas de Expedientes: Consultar Nómina por Número
app.get('/api/expedientes/nominas/:nomina', async (req, res) => {
    const nomina = parseInt(req.params.nomina, 10);
    if (!nomina) {
        return res.status(400).json({ status: 'error', error: 'Ingrese un número de nómina válido' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('nomina', sql.Int, nomina)
            .query(`
                SELECT
                    m.NumMov,
                    LTRIM(RTRIM(m.Rut)) AS Rut,
                    LTRIM(RTRIM(ISNULL(f.DV, ''))) AS DV,
                    LTRIM(RTRIM(ISNULL(f.Nombre, ''))) AS Nombre,
                    LTRIM(RTRIM(ISNULL(f.Paterno, ''))) AS Paterno,
                    LTRIM(RTRIM(ISNULL(f.Materno, ''))) AS Materno,
                    LTRIM(RTRIM(ISNULL(f.CodUnidad, ''))) AS CodUnidad,
                    LTRIM(RTRIM(ISNULL(m.Unidad, ''))) AS Unidad,
                    LTRIM(RTRIM(ISNULL(m.Responsable, ''))) AS Responsable,
                    LTRIM(RTRIM(ISNULL(m.Observacion, ''))) AS Observacion,
                    LTRIM(RTRIM(ISNULL(m.Fecha, ''))) AS Fecha,
                    LTRIM(RTRIM(ISNULL(m.FechaDev, ''))) AS FechaDev,
                    LTRIM(RTRIM(ISNULL(m.Estado, ''))) AS Estado,
                    m.nomina AS Nomina
                FROM Movimientos m
                LEFT JOIN LIC_FUNCIONARIO f
                    ON LTRIM(RTRIM(f.Rut)) IN (LTRIM(RTRIM(m.Rut)), CONCAT('0', LTRIM(RTRIM(m.Rut))))
                WHERE m.nomina = @nomina
                ORDER BY m.NumMov ASC
            `);

        res.json({
            status: 'ok',
            nomina,
            movimientos: result.recordset.map(m => ({
                ...m,
                DV: m.DV || calcularDV(m.Rut),
                Fecha: cleanStr(m.Fecha),
                FechaDev: cleanStr(m.FechaDev)
            }))
        });
    } catch (error) {
        console.error('Error en GET /api/expedientes/nominas/:nomina:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.9 Nóminas de Expedientes: Agregar Entrega de Expediente a una Nómina (btn_guarda_nom en expedientes.vb)
app.post('/api/expedientes/nominas/entrega', async (req, res) => {
    const { nomina, rut, unidad, responsable, fecha, observacion } = req.body;
    const numNomina = parseInt(nomina, 10);
    const rutNum = cleanRutNum(rut);

    if (!numNomina) {
        return res.status(400).json({ status: 'error', error: 'Debe indicar un N° de Nómina válido' });
    }
    if (!rutNum) {
        return res.status(400).json({ status: 'error', error: 'Debe ingresar un RUT de funcionario válido' });
    }
    if (!cleanStr(unidad) || !cleanStr(responsable)) {
        return res.status(400).json({ status: 'error', error: 'Debe completar Solicitado por y Quien Retira para la nómina' });
    }

    const rutConCero = '0' + rutNum;
    const fechaFormateada = toDDMMYYYY(fecha) || toDDMMYYYY(new Date().toISOString());

    try {
        const pool = await poolPromise;

        // 1. Verificar que el funcionario exista en LIC_FUNCIONARIO
        const funcRes = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`
                SELECT TOP 1
                    LTRIM(RTRIM(Rut)) AS Rut,
                    LTRIM(RTRIM(ISNULL(Nombre, ''))) AS Nombre,
                    LTRIM(RTRIM(ISNULL(Paterno, ''))) AS Paterno,
                    LTRIM(RTRIM(ISNULL(Materno, ''))) AS Materno
                FROM LIC_FUNCIONARIO
                WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
            `);

        if (funcRes.recordset.length === 0) {
            return res.status(404).json({
                status: 'error',
                error: `No existe Funcionario con RUT ${rutNum} en la base de datos.`
            });
        }

        // 2. Verificar que su último movimiento no esté 'ENTREGADO'
        const ultimoMov = await pool.request()
            .input('r1', sql.NVarChar, rutNum)
            .input('r2', sql.NVarChar, rutConCero)
            .query(`
                SELECT TOP 1 NumMov, LTRIM(RTRIM(Estado)) AS Estado
                FROM Movimientos
                WHERE LTRIM(RTRIM(Rut)) IN (@r1, @r2)
                ORDER BY NumMov DESC
            `);

        if (ultimoMov.recordset.length > 0 && ultimoMov.recordset[0].Estado.toUpperCase() === 'ENTREGADO') {
            return res.status(400).json({
                status: 'error',
                error: `No puede registrar una nueva ENTREGA para RUT ${rutNum}, existe N° Solicitud: ${ultimoMov.recordset[0].NumMov} sin devolución.`
            });
        }

        // 3. Insertar en Movimientos asociado a la Nómina
        const nextMovRes = await pool.request().query(`SELECT ISNULL(MAX(NumMov), 0) + 1 AS NextMov FROM Movimientos`);
        const numMovCreado = nextMovRes.recordset[0].NextMov;

        await pool.request()
            .input('nextMov', sql.Int, numMovCreado)
            .input('rut', sql.NChar, rutNum)
            .input('unidad', sql.NChar, cleanStr(unidad))
            .input('responsable', sql.NChar, cleanStr(responsable).toUpperCase())
            .input('observacion', sql.NChar, cleanStr(observacion))
            .input('fecha', sql.NChar, fechaFormateada)
            .input('nomina', sql.Int, numNomina)
            .query(`
                INSERT INTO Movimientos (
                    NumMov, Rut, Unidad, Responsable, Observacion, Fecha, FechaDev, Estado, nomina
                ) VALUES (
                    @nextMov, @rut, @unidad, @responsable, @observacion, @fecha, '', 'ENTREGADO', @nomina
                )
            `);

        const f = funcRes.recordset[0];
        res.json({
            status: 'ok',
            numMov: numMovCreado,
            funcionario: `${f.Nombre} ${f.Paterno} ${f.Materno}`.trim(),
            message: `Expediente de ${f.Nombre} ${f.Paterno} agregado a la Nómina N° ${numNomina}`
        });
    } catch (error) {
        console.error('Error en POST /api/expedientes/nominas/entrega:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 4.10 Nóminas de Expedientes: Devolución Parcial (chk_dev_nomp) y Devolución Total (chk_dev_nomt)
app.put('/api/expedientes/nominas/devolucion-parcial/:numMov', async (req, res) => {
    const numMov = parseInt(req.params.numMov, 10);
    const fechaDev = toDDMMYYYY(req.body.fechaDev) || toDDMMYYYY(new Date().toISOString());

    if (!numMov) {
        return res.status(400).json({ status: 'error', error: 'Debe seleccionar un registro válido de la nómina' });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('numMov', sql.Int, numMov)
            .input('fechaDev', sql.NChar, fechaDev)
            .query(`
                UPDATE Movimientos
                SET FechaDev = @fechaDev,
                    Estado = 'DEVUELTO'
                WHERE NumMov = @numMov
            `);

        res.json({
            status: 'ok',
            message: `Devolución parcial registrada para Solicitud N° ${numMov}`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.put('/api/expedientes/nominas/devolucion-total/:nomina', async (req, res) => {
    const nomina = parseInt(req.params.nomina, 10);
    const fechaDev = toDDMMYYYY(req.body.fechaDev) || toDDMMYYYY(new Date().toISOString());

    if (!nomina) {
        return res.status(400).json({ status: 'error', error: 'Número de nómina inválido' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('nomina', sql.Int, nomina)
            .input('fechaDev', sql.NChar, fechaDev)
            .query(`
                UPDATE Movimientos
                SET FechaDev = @fechaDev,
                    Estado = 'DEVUELTO'
                WHERE nomina = @nomina
                  AND UPPER(LTRIM(RTRIM(Estado))) = 'ENTREGADO'
            `);

        res.json({
            status: 'ok',
            actualizados: result.rowsAffected[0] || 0,
            message: `Devolución total registrada para la Nómina N° ${nomina} (${result.rowsAffected[0] || 0} expedientes actualizados)`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// ============================================================================
// 5. MÓDULO 2: GESTIÓN DE COMPROBANTES CONTABLES (comprobantes.vb)
// ============================================================================

// 5.1 Listado / Buscador de Comprobantes
app.get('/api/comprobantes/lista', async (req, res) => {
    const q = cleanStr(req.query.q);
    const tipo = cleanStr(req.query.tipo);
    const sector = cleanStr(req.query.sector);
    const ano = cleanStr(req.query.ano);

    try {
        const pool = await poolPromise;
        const request = pool.request();
        const conditions = [];

        if (q) {
            request.input('q', sql.VarChar, `%${q}%`);
            conditions.push(`(
                CAST(c.NumComp AS VARCHAR(20)) LIKE @q
                OR ISNULL(c.ObsComp, '') LIKE @q
                OR ISNULL(c.MesArchiv, '') LIKE @q
            )`);
        }
        if (tipo && tipo !== 'TODOS') {
            request.input('tipo', sql.VarChar, tipo);
            conditions.push(`UPPER(LTRIM(RTRIM(c.TipoComp))) = UPPER(@tipo)`);
        }
        if (sector && sector !== 'TODOS') {
            request.input('sector', sql.VarChar, sector);
            conditions.push(`UPPER(LTRIM(RTRIM(c.SectorComp))) = UPPER(@sector)`);
        }
        if (ano) {
            request.input('ano', sql.VarChar, ano);
            conditions.push(`LTRIM(RTRIM(c.AnoArchiv)) = @ano`);
        }

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await request.query(`
            SELECT TOP 500
                c.NumComp,
                LTRIM(RTRIM(ISNULL(c.FechaComp, ''))) AS FechaComp,
                LTRIM(RTRIM(ISNULL(c.FechaRecep, ''))) AS FechaRecep,
                LTRIM(RTRIM(ISNULL(c.TipoComp, ''))) AS TipoComp,
                LTRIM(RTRIM(ISNULL(c.SectorComp, ''))) AS SectorComp,
                c.NumArchiv,
                LTRIM(RTRIM(ISNULL(c.MesArchiv, ''))) AS MesArchiv,
                LTRIM(RTRIM(ISNULL(c.AnoArchiv, ''))) AS AnoArchiv,
                LTRIM(RTRIM(ISNULL(c.ObsComp, ''))) AS ObsComp,
                ult.Estado AS UltimoEstado,
                ult.Responsable AS UltimoResponsable,
                ult.Unidad AS UltimaUnidad
            FROM Comprobantes c
            LEFT JOIN (
                SELECT
                    NumComp,
                    LTRIM(RTRIM(Estado)) AS Estado,
                    LTRIM(RTRIM(Responsable)) AS Responsable,
                    LTRIM(RTRIM(Unidad)) AS Unidad,
                    ROW_NUMBER() OVER (PARTITION BY NumComp ORDER BY NumMovCom DESC) AS rn
                FROM MovimientosComp
                WHERE NumComp IS NOT NULL
            ) ult ON ult.NumComp = c.NumComp AND ult.rn = 1
            ${whereSql}
            ORDER BY c.NumComp DESC
        `);

        res.json({ status: 'ok', registros: result.recordset });
    } catch (error) {
        console.error('Error en GET /api/comprobantes/lista:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 5.2 Consulta Integral de Comprobante + Bitácora por N° Comprobante
app.get('/api/comprobantes/ficha/:numComp', async (req, res) => {
    const numComp = parseInt(req.params.numComp, 10);
    if (isNaN(numComp)) {
        return res.status(400).json({ status: 'error', error: 'Número de comprobante inválido' });
    }

    try {
        const pool = await poolPromise;
        const compRes = await pool.request()
            .input('numComp', sql.Int, numComp)
            .query(`
                SELECT TOP 1
                    NumComp,
                    LTRIM(RTRIM(ISNULL(FechaComp, ''))) AS FechaComp,
                    LTRIM(RTRIM(ISNULL(FechaRecep, ''))) AS FechaRecep,
                    LTRIM(RTRIM(ISNULL(TipoComp, ''))) AS TipoComp,
                    LTRIM(RTRIM(ISNULL(SectorComp, ''))) AS SectorComp,
                    NumArchiv,
                    LTRIM(RTRIM(ISNULL(MesArchiv, ''))) AS MesArchiv,
                    LTRIM(RTRIM(ISNULL(AnoArchiv, ''))) AS AnoArchiv,
                    LTRIM(RTRIM(ISNULL(ObsComp, ''))) AS ObsComp
                FROM Comprobantes
                WHERE NumComp = @numComp
            `);

        const movRes = await pool.request()
            .input('numComp', sql.Int, numComp)
            .query(`
                SELECT
                    NumMovCom,
                    NumComp,
                    LTRIM(RTRIM(ISNULL(Unidad, ''))) AS Unidad,
                    LTRIM(RTRIM(ISNULL(Responsable, ''))) AS Responsable,
                    LTRIM(RTRIM(ISNULL(Observacion, ''))) AS Observacion,
                    LTRIM(RTRIM(ISNULL(FechaEnt, ''))) AS FechaEnt,
                    LTRIM(RTRIM(ISNULL(FechaDev, ''))) AS FechaDev,
                    LTRIM(RTRIM(ISNULL(Estado, ''))) AS Estado,
                    Nomina
                FROM MovimientosComp
                WHERE NumComp = @numComp
                ORDER BY NumMovCom DESC
            `);

        const nextMovRes = await pool.request().query(`
            SELECT ISNULL(MAX(NumMovCom), 0) + 1 AS NextNumMovCom FROM MovimientosComp
        `);

        const comp = compRes.recordset[0] || null;
        res.json({
            status: comp ? 'ok' : 'not_found',
            numComp,
            nextNumMovCom: nextMovRes.recordset[0].NextNumMovCom,
            comprobante: comp ? {
                ...comp,
                FechaComp: cleanStr(comp.FechaComp),
                FechaRecep: cleanStr(comp.FechaRecep)
            } : null,
            movimientos: movRes.recordset.map(m => ({
                ...m,
                FechaEnt: cleanStr(m.FechaEnt),
                FechaDev: cleanStr(m.FechaDev)
            }))
        });
    } catch (error) {
        console.error('Error en GET /api/comprobantes/ficha/:numComp:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 5.3 Guardar / Actualizar Antecedentes de Comprobante (btn_guarda_comp en comprobantes.vb)
app.post('/api/comprobantes/ficha', async (req, res) => {
    const {
        numComp,
        fechaComp,
        fechaRecep,
        tipoComp,
        sectorComp,
        numArchiv,
        mesArchiv,
        anoArchiv,
        obsComp
    } = req.body;

    const nComp = parseInt(numComp, 10);
    if (isNaN(nComp)) {
        return res.status(400).json({ status: 'error', error: 'Debe ingresar un N° de Comprobante numérico válido' });
    }

    try {
        const pool = await poolPromise;
        const check = await pool.request()
            .input('numComp', sql.Int, nComp)
            .query(`SELECT TOP 1 NumComp FROM Comprobantes WHERE NumComp = @numComp`);

        const fComp = toDDMMYYYY(fechaComp);
        const fRecep = toDDMMYYYY(fechaRecep) || toDDMMYYYY(new Date().toISOString());
        const nArchiv = parseInt(numArchiv || '0', 10) || 0;

        let accion = 'actualizado';
        if (check.recordset.length > 0) {
            await pool.request()
                .input('numComp', sql.Int, nComp)
                .input('fechaComp', sql.VarChar, fComp)
                .input('fechaRecep', sql.VarChar, fRecep)
                .input('tipoComp', sql.VarChar, cleanStr(tipoComp))
                .input('sectorComp', sql.VarChar, cleanStr(sectorComp))
                .input('numArchiv', sql.Int, nArchiv)
                .input('mesArchiv', sql.VarChar, cleanStr(mesArchiv))
                .input('anoArchiv', sql.VarChar, cleanStr(anoArchiv))
                .input('obsComp', sql.VarChar, cleanStr(obsComp))
                .query(`
                    UPDATE Comprobantes
                    SET FechaComp = @fechaComp,
                        FechaRecep = @fechaRecep,
                        TipoComp = @tipoComp,
                        SectorComp = @sectorComp,
                        NumArchiv = @numArchiv,
                        MesArchiv = @mesArchiv,
                        AnoArchiv = @anoArchiv,
                        ObsComp = @obsComp
                    WHERE NumComp = @numComp
                `);
        } else {
            accion = 'creado';
            await pool.request()
                .input('numComp', sql.Int, nComp)
                .input('fechaComp', sql.VarChar, fComp)
                .input('fechaRecep', sql.VarChar, fRecep)
                .input('tipoComp', sql.VarChar, cleanStr(tipoComp))
                .input('sectorComp', sql.VarChar, cleanStr(sectorComp))
                .input('numArchiv', sql.Int, nArchiv)
                .input('mesArchiv', sql.VarChar, cleanStr(mesArchiv))
                .input('anoArchiv', sql.VarChar, cleanStr(anoArchiv))
                .input('obsComp', sql.VarChar, cleanStr(obsComp))
                .query(`
                    INSERT INTO Comprobantes (
                        NumComp, FechaComp, FechaRecep, TipoComp, SectorComp,
                        NumArchiv, MesArchiv, AnoArchiv, ObsComp
                    ) VALUES (
                        @numComp, @fechaComp, @fechaRecep, @tipoComp, @sectorComp,
                        @numArchiv, @mesArchiv, @anoArchiv, @obsComp
                    )
                `);
        }

        res.json({
            status: 'ok',
            accion,
            message: `Comprobante N° ${nComp} ${accion} exitosamente`
        });
    } catch (error) {
        console.error('Error en POST /api/comprobantes/ficha:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 5.4 Bitácora General de Comprobantes
app.get('/api/comprobantes/bitacora', async (req, res) => {
    const numComp = req.query.numComp ? parseInt(req.query.numComp, 10) : null;
    const fecha = cleanStr(req.query.fecha);
    const estado = cleanStr(req.query.estado);

    try {
        const pool = await poolPromise;
        const request = pool.request();
        const conditions = [];

        if (numComp) {
            request.input('numComp', sql.Int, numComp);
            conditions.push(`mc.NumComp = @numComp`);
        }
        if (fecha) {
            request.input('fecha', sql.VarChar, toDDMMYYYY(fecha));
            conditions.push(`LTRIM(RTRIM(mc.FechaEnt)) = @fecha`);
        }
        if (estado && estado !== 'TODOS') {
            request.input('estado', sql.VarChar, estado.toUpperCase());
            conditions.push(`UPPER(LTRIM(RTRIM(mc.Estado))) = @estado`);
        }

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await request.query(`
            SELECT TOP 500
                mc.NumMovCom,
                mc.NumComp,
                LTRIM(RTRIM(ISNULL(c.TipoComp, ''))) AS TipoComp,
                LTRIM(RTRIM(ISNULL(c.SectorComp, ''))) AS SectorComp,
                LTRIM(RTRIM(ISNULL(mc.Unidad, ''))) AS Unidad,
                LTRIM(RTRIM(ISNULL(mc.Responsable, ''))) AS Responsable,
                LTRIM(RTRIM(ISNULL(mc.Observacion, ''))) AS Observacion,
                LTRIM(RTRIM(ISNULL(mc.FechaEnt, ''))) AS FechaEnt,
                LTRIM(RTRIM(ISNULL(mc.FechaDev, ''))) AS FechaDev,
                LTRIM(RTRIM(ISNULL(mc.Estado, ''))) AS Estado,
                mc.Nomina
            FROM MovimientosComp mc
            LEFT JOIN Comprobantes c ON c.NumComp = mc.NumComp
            ${whereSql}
            ORDER BY mc.NumMovCom DESC
        `);

        const nextMovRes = await pool.request().query(`
            SELECT ISNULL(MAX(NumMovCom), 0) + 1 AS NextNumMovCom FROM MovimientosComp
        `);

        res.json({
            status: 'ok',
            nextNumMovCom: nextMovRes.recordset[0].NextNumMovCom,
            movimientos: result.recordset.map(m => ({
                ...m,
                FechaEnt: cleanStr(m.FechaEnt),
                FechaDev: cleanStr(m.FechaDev)
            }))
        });
    } catch (error) {
        console.error('Error en GET /api/comprobantes/bitacora:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 5.5 Registrar Entrega Individual de Comprobante
app.post('/api/comprobantes/bitacora/entrega', async (req, res) => {
    const { numComp, unidad, responsable, fechaEnt, observacion } = req.body;
    const nComp = parseInt(numComp, 10);

    if (isNaN(nComp)) {
        return res.status(400).json({ status: 'error', error: 'Debe seleccionar un N° de Comprobante válido' });
    }
    if (!cleanStr(unidad) || !cleanStr(responsable)) {
        return res.status(400).json({ status: 'error', error: 'Debe indicar Unidad solicitante y Persona que retira' });
    }

    const fechaFormateada = toDDMMYYYY(fechaEnt) || toDDMMYYYY(new Date().toISOString());

    try {
        const pool = await poolPromise;

        const ultimoMov = await pool.request()
            .input('numComp', sql.Int, nComp)
            .query(`
                SELECT TOP 1 NumMovCom, LTRIM(RTRIM(Estado)) AS Estado
                FROM MovimientosComp
                WHERE NumComp = @numComp
                ORDER BY NumMovCom DESC
            `);

        if (ultimoMov.recordset.length > 0 && ultimoMov.recordset[0].Estado.toUpperCase() === 'ENTREGADO') {
            return res.status(400).json({
                status: 'error',
                error: `No puede registrar una nueva ENTREGA, existe N° Solicitud: ${ultimoMov.recordset[0].NumMovCom} que no ha sido registrada su DEVOLUCIÓN.`
            });
        }

        const nextMovRes = await pool.request().query(`SELECT ISNULL(MAX(NumMovCom), 0) + 1 AS NextMov FROM MovimientosComp`);
        const numMovComCreado = nextMovRes.recordset[0].NextMov;

        await pool.request()
            .input('nextMov', sql.Int, numMovComCreado)
            .input('numComp', sql.Int, nComp)
            .input('unidad', sql.VarChar, cleanStr(unidad))
            .input('responsable', sql.VarChar, cleanStr(responsable).toUpperCase())
            .input('observacion', sql.VarChar, cleanStr(observacion))
            .input('fechaEnt', sql.VarChar, fechaFormateada)
            .query(`
                INSERT INTO MovimientosComp (
                    NumMovCom, NumComp, Unidad, Responsable, Observacion, FechaEnt, FechaDev, Estado
                ) VALUES (
                    @nextMov, @numComp, @unidad, @responsable, @observacion, @fechaEnt, '', 'ENTREGADO'
                )
            `);

        res.json({
            status: 'ok',
            numMovCom: numMovComCreado,
            message: `Entrega del Comprobante N° ${nComp} registrada con Solicitud N° ${numMovComCreado}`
        });
    } catch (error) {
        console.error('Error en POST /api/comprobantes/bitacora/entrega:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 5.6 Registrar Devolución Individual de Comprobante
app.put('/api/comprobantes/bitacora/devolucion/:numMovCom', async (req, res) => {
    const numMovCom = parseInt(req.params.numMovCom, 10);
    const { fechaDev, unidad, responsable, observacion } = req.body;

    if (!numMovCom) {
        return res.status(400).json({ status: 'error', error: 'N° de Solicitud inválido' });
    }

    const fechaDevFormateada = toDDMMYYYY(fechaDev) || toDDMMYYYY(new Date().toISOString());

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('numMovCom', sql.Int, numMovCom)
            .input('fechaDev', sql.VarChar, fechaDevFormateada)
            .input('unidad', sql.VarChar, unidad !== undefined ? cleanStr(unidad) : null)
            .input('responsable', sql.VarChar, responsable !== undefined ? cleanStr(responsable).toUpperCase() : null)
            .input('observacion', sql.VarChar, observacion !== undefined ? cleanStr(observacion) : null)
            .query(`
                UPDATE MovimientosComp
                SET FechaDev = @fechaDev,
                    Estado = 'DEVUELTO',
                    Unidad = COALESCE(@unidad, Unidad),
                    Responsable = COALESCE(@responsable, Responsable),
                    Observacion = COALESCE(@observacion, Observacion)
                WHERE NumMovCom = @numMovCom
            `);

        res.json({
            status: 'ok',
            message: `Devolución registrada exitosamente para Solicitud N° ${numMovCom}`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 5.7 Nóminas de Comprobantes: Siguiente ID, Consulta, Entrega, Devolución Parcial y Total
app.get('/api/comprobantes/nominas/next-id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT ISNULL(MAX(Nomina), 0) + 1 AS NextNomina FROM MovimientosComp
        `);
        res.json({ status: 'ok', nextNomina: result.recordset[0].NextNomina });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.get('/api/comprobantes/nominas/:nomina', async (req, res) => {
    const nomina = parseInt(req.params.nomina, 10);
    if (!nomina) {
        return res.status(400).json({ status: 'error', error: 'Número de nómina inválido' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('nomina', sql.Int, nomina)
            .query(`
                SELECT
                    mc.NumMovCom,
                    mc.NumComp,
                    LTRIM(RTRIM(ISNULL(c.TipoComp, ''))) AS TipoComp,
                    LTRIM(RTRIM(ISNULL(c.SectorComp, ''))) AS SectorComp,
                    LTRIM(RTRIM(ISNULL(c.FechaComp, ''))) AS FechaComp,
                    LTRIM(RTRIM(ISNULL(mc.Unidad, ''))) AS Unidad,
                    LTRIM(RTRIM(ISNULL(mc.Responsable, ''))) AS Responsable,
                    LTRIM(RTRIM(ISNULL(mc.Observacion, ''))) AS Observacion,
                    LTRIM(RTRIM(ISNULL(mc.FechaEnt, ''))) AS FechaEnt,
                    LTRIM(RTRIM(ISNULL(mc.FechaDev, ''))) AS FechaDev,
                    LTRIM(RTRIM(ISNULL(mc.Estado, ''))) AS Estado,
                    mc.Nomina
                FROM MovimientosComp mc
                LEFT JOIN Comprobantes c ON c.NumComp = mc.NumComp
                WHERE mc.Nomina = @nomina
                ORDER BY mc.NumMovCom ASC
            `);

        res.json({
            status: 'ok',
            nomina,
            movimientos: result.recordset.map(m => ({
                ...m,
                FechaEnt: cleanStr(m.FechaEnt),
                FechaDev: cleanStr(m.FechaDev)
            }))
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.post('/api/comprobantes/nominas/entrega', async (req, res) => {
    const { nomina, numComp, unidad, responsable, fechaEnt, observacion } = req.body;
    const numNomina = parseInt(nomina, 10);
    const nComp = parseInt(numComp, 10);

    if (!numNomina || isNaN(nComp)) {
        return res.status(400).json({ status: 'error', error: 'Debe indicar N° de Nómina y N° de Comprobante válidos' });
    }
    if (!cleanStr(unidad) || !cleanStr(responsable)) {
        return res.status(400).json({ status: 'error', error: 'Debe completar Solicitado por y Quien Retira' });
    }

    const fechaFormateada = toDDMMYYYY(fechaEnt) || toDDMMYYYY(new Date().toISOString());

    try {
        const pool = await poolPromise;

        const checkComp = await pool.request()
            .input('numComp', sql.Int, nComp)
            .query(`SELECT TOP 1 NumComp, TipoComp, SectorComp FROM Comprobantes WHERE NumComp = @numComp`);

        if (checkComp.recordset.length === 0) {
            return res.status(404).json({
                status: 'error',
                error: `No existe el Comprobante N° ${nComp} registrado en la base de datos.`
            });
        }

        const ultimoMov = await pool.request()
            .input('numComp', sql.Int, nComp)
            .query(`
                SELECT TOP 1 NumMovCom, LTRIM(RTRIM(Estado)) AS Estado
                FROM MovimientosComp
                WHERE NumComp = @numComp
                ORDER BY NumMovCom DESC
            `);

        if (ultimoMov.recordset.length > 0 && ultimoMov.recordset[0].Estado.toUpperCase() === 'ENTREGADO') {
            return res.status(400).json({
                status: 'error',
                error: `No puede registrar una nueva ENTREGA para el Comprobante N° ${nComp}, existe Solicitud N° ${ultimoMov.recordset[0].NumMovCom} pendiente de devolución.`
            });
        }

        const nextMovRes = await pool.request().query(`SELECT ISNULL(MAX(NumMovCom), 0) + 1 AS NextMov FROM MovimientosComp`);
        const numMovComCreado = nextMovRes.recordset[0].NextMov;

        await pool.request()
            .input('nextMov', sql.Int, numMovComCreado)
            .input('numComp', sql.Int, nComp)
            .input('unidad', sql.VarChar, cleanStr(unidad))
            .input('responsable', sql.VarChar, cleanStr(responsable).toUpperCase())
            .input('observacion', sql.VarChar, cleanStr(observacion))
            .input('fechaEnt', sql.VarChar, fechaFormateada)
            .input('nomina', sql.Int, numNomina)
            .query(`
                INSERT INTO MovimientosComp (
                    NumMovCom, NumComp, Unidad, Responsable, Observacion, FechaEnt, FechaDev, Estado, Nomina
                ) VALUES (
                    @nextMov, @numComp, @unidad, @responsable, @observacion, @fechaEnt, '', 'ENTREGADO', @nomina
                )
            `);

        res.json({
            status: 'ok',
            numMovCom: numMovComCreado,
            message: `Comprobante N° ${nComp} agregado a la Nómina N° ${numNomina}`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.put('/api/comprobantes/nominas/devolucion-parcial/:numMovCom', async (req, res) => {
    const numMovCom = parseInt(req.params.numMovCom, 10);
    const fechaDev = toDDMMYYYY(req.body.fechaDev) || toDDMMYYYY(new Date().toISOString());

    if (!numMovCom) {
        return res.status(400).json({ status: 'error', error: 'Seleccione un movimiento válido de la nómina' });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('numMovCom', sql.Int, numMovCom)
            .input('fechaDev', sql.VarChar, fechaDev)
            .query(`
                UPDATE MovimientosComp
                SET FechaDev = @fechaDev,
                    Estado = 'DEVUELTO'
                WHERE NumMovCom = @numMovCom
            `);

        res.json({
            status: 'ok',
            message: `Devolución parcial registrada para Solicitud N° ${numMovCom}`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.put('/api/comprobantes/nominas/devolucion-total/:nomina', async (req, res) => {
    const nomina = parseInt(req.params.nomina, 10);
    const fechaDev = toDDMMYYYY(req.body.fechaDev) || toDDMMYYYY(new Date().toISOString());

    if (!nomina) {
        return res.status(400).json({ status: 'error', error: 'Número de nómina inválido' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('nomina', sql.Int, nomina)
            .input('fechaDev', sql.VarChar, fechaDev)
            .query(`
                UPDATE MovimientosComp
                SET FechaDev = @fechaDev,
                    Estado = 'DEVUELTO'
                WHERE Nomina = @nomina
                  AND UPPER(LTRIM(RTRIM(Estado))) = 'ENTREGADO'
            `);

        res.json({
            status: 'ok',
            actualizados: result.rowsAffected[0] || 0,
            message: `Devolución total registrada para la Nómina de Comprobantes N° ${nomina}`
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// ============================================================================
// 6. MÓDULO 3: INFORMES OFICIALES (Report1, Report3, Report4, Report5, Report6 + Pendientes)
// ============================================================================

app.get('/api/informes/pendientes', async (req, res) => {
    const tipo = cleanStr(req.query.tipo) || 'expedientes'; // 'expedientes' | 'comprobantes'
    const unidad = cleanStr(req.query.unidad);

    try {
        const pool = await poolPromise;
        if (tipo === 'comprobantes') {
            const request = pool.request();
            let extraWhere = '';
            if (unidad && unidad !== 'TODAS') {
                request.input('unidad', sql.VarChar, unidad);
                extraWhere = `AND UPPER(LTRIM(RTRIM(t.Unidad))) = UPPER(@unidad)`;
            }
            const result = await request.query(`
                SELECT
                    t.NumMovCom,
                    t.NumComp,
                    LTRIM(RTRIM(ISNULL(c.TipoComp, ''))) AS TipoComp,
                    LTRIM(RTRIM(ISNULL(c.SectorComp, ''))) AS SectorComp,
                    LTRIM(RTRIM(ISNULL(t.Unidad, ''))) AS Unidad,
                    LTRIM(RTRIM(ISNULL(t.Responsable, ''))) AS Responsable,
                    LTRIM(RTRIM(ISNULL(t.Observacion, ''))) AS Observacion,
                    LTRIM(RTRIM(ISNULL(t.FechaEnt, ''))) AS FechaEnt,
                    LTRIM(RTRIM(ISNULL(t.Estado, ''))) AS Estado,
                    t.Nomina
                FROM (
                    SELECT NumMovCom, NumComp, Unidad, Responsable, Observacion, FechaEnt, Estado, Nomina,
                           ROW_NUMBER() OVER (PARTITION BY NumComp ORDER BY NumMovCom DESC) AS rn
                    FROM MovimientosComp
                    WHERE NumComp IS NOT NULL
                ) t
                LEFT JOIN Comprobantes c ON c.NumComp = t.NumComp
                WHERE t.rn = 1 AND UPPER(LTRIM(RTRIM(t.Estado))) = 'ENTREGADO' ${extraWhere}
                ORDER BY t.NumMovCom DESC
            `);
            return res.json({ status: 'ok', registros: result.recordset });
        }

        const request = pool.request();
        let extraWhere = '';
        if (unidad && unidad !== 'TODAS') {
            request.input('unidad', sql.NVarChar, unidad);
            extraWhere = `AND UPPER(LTRIM(RTRIM(t.Unidad))) = UPPER(@unidad)`;
        }

        const result = await request.query(`
            SELECT TOP 500
                t.NumMov,
                LTRIM(RTRIM(t.Rut)) AS Rut,
                LTRIM(RTRIM(ISNULL(f.DV, ''))) AS DV,
                LTRIM(RTRIM(ISNULL(f.Nombre, ''))) AS Nombre,
                LTRIM(RTRIM(ISNULL(f.Paterno, ''))) AS Paterno,
                LTRIM(RTRIM(ISNULL(f.Materno, ''))) AS Materno,
                LTRIM(RTRIM(ISNULL(f.CodUnidad, ''))) AS CodUnidad,
                LTRIM(RTRIM(ISNULL(t.Unidad, ''))) AS Unidad,
                LTRIM(RTRIM(ISNULL(t.Responsable, ''))) AS Responsable,
                LTRIM(RTRIM(ISNULL(t.Observacion, ''))) AS Observacion,
                LTRIM(RTRIM(ISNULL(t.Fecha, ''))) AS Fecha,
                LTRIM(RTRIM(ISNULL(t.Estado, ''))) AS Estado,
                t.nomina AS Nomina
            FROM (
                SELECT NumMov, Rut, Unidad, Responsable, Observacion, Fecha, Estado, nomina,
                       ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(Rut)) ORDER BY NumMov DESC) AS rn
                FROM Movimientos
                WHERE LTRIM(RTRIM(ISNULL(Rut, ''))) <> ''
            ) t
            LEFT JOIN LIC_FUNCIONARIO f
                ON LTRIM(RTRIM(f.Rut)) IN (LTRIM(RTRIM(t.Rut)), CONCAT('0', LTRIM(RTRIM(t.Rut))))
            WHERE t.rn = 1 AND UPPER(LTRIM(RTRIM(t.Estado))) = 'ENTREGADO' ${extraWhere}
            ORDER BY t.NumMov DESC
        `);

        res.json({
            status: 'ok',
            registros: result.recordset.map(r => ({
                ...r,
                DV: r.DV || calcularDV(r.Rut),
                Fecha: cleanStr(r.Fecha)
            }))
        });
    } catch (error) {
        console.error('Error en GET /api/informes/pendientes:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// Fallback para SPA en producción
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor de Archivo y Expedientes CMDS corriendo en http://localhost:${PORT}`);
});
