#!/usr/bin/env node
/**
 * ============================================================================
 * SINCRONIZADOR BIDIRECCIONAL EN TIEMPO REAL — MODO MARCHA BLANCA CMDS
 * (SQL Server 192.168.3.251 / 192.168.3.159\BASE  <===>  PostgreSQL Nuevo)
 * ============================================================================
 * Propósito:
 *   Durante el período de Marcha Blanca, los usuarios pueden operar tanto en
 *   los sistemas antiguos (que escriben directo en SQL Server) como en los
 *   nuevos sistemas Web (que con DB_ENGINE=dual o DB_ENGINE=postgres escriben
 *   en PostgreSQL).
 *
 *   Este demonio corre en segundo plano (con PM2) revisando cada N segundos
 *   las tablas operativas de ambos motores:
 *     1. Si entra un registro nuevo o devolución en SQL Server (sistema viejo)
 *        -> lo replica automáticamente en PostgreSQL.
 *     2. Si entra un registro nuevo o actualización en PostgreSQL (sistema nuevo)
 *        -> lo replica automáticamente en SQL Server.
 *
 * Uso:
 *   # Ejecución continua cada 10 segundos (ideal con PM2 durante marcha blanca):
 *   node marcha-blanca-sync.js --pg-host=192.168.3.250 --interval=10
 *
 *   # Con PM2 en el servidor Linux:
 *   pm2 start marcha-blanca-sync.js --name "marcha-blanca-sync" -- --pg-host=192.168.3.250
 *
 *   # Ejecución única de prueba:
 *   node marcha-blanca-sync.js --pg-host=192.168.3.250 --once
 * ============================================================================
 */

const sql = require('mssql');
const { Pool: PgPool } = require('pg');

const args = process.argv.slice(2);
const getArg = (prefix, def) => {
    const found = args.find(a => a.startsWith(`${prefix}=`));
    return found ? found.split('=')[1] : def;
};

const PG_HOST = getArg('--pg-host', process.env.PG_HOST || '127.0.0.1');
const PG_PORT = parseInt(getArg('--pg-port', process.env.PG_PORT || '5432'), 10);
const PG_USER = getArg('--pg-user', process.env.PG_USER || 'cmds_admin');
const PG_PASS = getArg('--pg-pass', process.env.PG_PASS || 'CmdsPostgres2026!');
const INTERVAL_SEC = Math.max(parseInt(getArg('--interval', '10'), 10) || 10, 5);
const RUN_ONCE = args.includes('--once');

function clean(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function normRutKey(rutRaw) {
    return clean(rutRaw).replace(/^0+/, '');
}

// ============================================================================
// 1. SINCRONIZACIÓN BIDIRECCIONAL: SISTEMA DE ARCHIVO (Archivo <-> bd_archivo)
// ============================================================================

async function syncBidireccionalArchivo(msPool, pgPool) {
    let cambiosSqlAPg = 0;
    let cambiosPgASql = 0;

    // ------------------------------------------------------------------------
    // A. Tabla Movimientos (Bitácora de Expedientes — PK lógica: NumMov)
    // ------------------------------------------------------------------------
    const [msMovRes, pgMovRes] = await Promise.all([
        msPool.request().query(`
            SELECT NumMov, NumExp, LTRIM(RTRIM(ISNULL(Rut, ''))) AS Rut,
                   LTRIM(RTRIM(ISNULL(Unidad, ''))) AS Unidad,
                   LTRIM(RTRIM(ISNULL(Responsable, ''))) AS Responsable,
                   LTRIM(RTRIM(ISNULL(Observacion, ''))) AS Observacion,
                   LTRIM(RTRIM(ISNULL(Fecha, ''))) AS Fecha,
                   LTRIM(RTRIM(ISNULL(FechaDev, ''))) AS FechaDev,
                   LTRIM(RTRIM(ISNULL(Estado, ''))) AS Estado,
                   nomina
            FROM Movimientos
            WHERE NumMov IS NOT NULL
        `),
        pgPool.query(`
            SELECT nummov AS "NumMov", numexp AS "NumExp", COALESCE(TRIM(rut), '') AS "Rut",
                   COALESCE(TRIM(unidad), '') AS "Unidad",
                   COALESCE(TRIM(responsable), '') AS "Responsable",
                   COALESCE(TRIM(observacion), '') AS "Observacion",
                   COALESCE(TRIM(fecha), '') AS "Fecha",
                   COALESCE(TRIM(fechadev), '') AS "FechaDev",
                   COALESCE(TRIM(estado), '') AS "Estado",
                   nomina
            FROM movimientos
            WHERE nummov IS NOT NULL
        `)
    ]);

    const msMovMap = new Map(msMovRes.recordset.map(r => [Number(r.NumMov), r]));
    const pgMovMap = new Map(pgMovRes.rows.map(r => [Number(r.NumMov), r]));

    // A1. Nuevos o actualizados en SQL Server -> PostgreSQL
    for (const [numMov, msRow] of msMovMap.entries()) {
        const pgRow = pgMovMap.get(numMov);
        if (!pgRow) {
            await pgPool.query(
                `INSERT INTO movimientos (nummov, numexp, rut, unidad, responsable, observacion, fecha, fechadev, estado, nomina)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    numMov,
                    msRow.NumExp,
                    clean(msRow.Rut),
                    clean(msRow.Unidad),
                    clean(msRow.Responsable),
                    clean(msRow.Observacion),
                    clean(msRow.Fecha),
                    clean(msRow.FechaDev),
                    clean(msRow.Estado),
                    msRow.nomina
                ]
            );
            cambiosSqlAPg++;
        } else if (
            clean(msRow.Estado).toUpperCase() === 'DEVUELTO' &&
            clean(pgRow.Estado).toUpperCase() !== 'DEVUELTO'
        ) {
            // Se devolvió en el sistema antiguo VB.NET -> reflejar devolución en PostgreSQL
            await pgPool.query(
                `UPDATE movimientos
                 SET estado = $1, fechadev = $2, observacion = $3
                 WHERE nummov = $4`,
                [clean(msRow.Estado), clean(msRow.FechaDev), clean(msRow.Observacion), numMov]
            );
            cambiosSqlAPg++;
        }
    }

    // A2. Nuevos o actualizados en PostgreSQL -> SQL Server
    for (const [numMov, pgRow] of pgMovMap.entries()) {
        const msRow = msMovMap.get(numMov);
        if (!msRow) {
            await msPool
                .request()
                .input('numMov', sql.Int, numMov)
                .input('numExp', sql.Int, pgRow.NumExp)
                .input('rut', sql.NChar, clean(pgRow.Rut))
                .input('unidad', sql.NChar, clean(pgRow.Unidad))
                .input('responsable', sql.NChar, clean(pgRow.Responsable))
                .input('observacion', sql.NChar, clean(pgRow.Observacion))
                .input('fecha', sql.NChar, clean(pgRow.Fecha))
                .input('fechaDev', sql.NChar, clean(pgRow.FechaDev))
                .input('estado', sql.NChar, clean(pgRow.Estado))
                .input('nomina', sql.Int, pgRow.nomina)
                .query(`
                    INSERT INTO Movimientos (NumMov, NumExp, Rut, Unidad, Responsable, Observacion, Fecha, FechaDev, Estado, nomina)
                    VALUES (@numMov, @numExp, @rut, @unidad, @responsable, @observacion, @fecha, @fechaDev, @estado, @nomina)
                `);
            cambiosPgASql++;
        } else if (
            clean(pgRow.Estado).toUpperCase() === 'DEVUELTO' &&
            clean(msRow.Estado).toUpperCase() !== 'DEVUELTO'
        ) {
            // Se devolvió en el sistema nuevo Web -> reflejar devolución en SQL Server
            await msPool
                .request()
                .input('numMov', sql.Int, numMov)
                .input('estado', sql.NChar, clean(pgRow.Estado))
                .input('fechaDev', sql.NChar, clean(pgRow.FechaDev))
                .input('observacion', sql.NChar, clean(pgRow.Observacion))
                .query(`
                    UPDATE Movimientos
                    SET Estado = @estado, FechaDev = @fechaDev, Observacion = @observacion
                    WHERE NumMov = @numMov
                `);
            cambiosPgASql++;
        }
    }

    // ------------------------------------------------------------------------
    // B. Tabla MovimientosComp (Bitácora de Comprobantes — PK lógica: NumMovCom)
    // ------------------------------------------------------------------------
    const [msMcRes, pgMcRes] = await Promise.all([
        msPool.request().query(`
            SELECT NumMovCom, NumComp,
                   LTRIM(RTRIM(ISNULL(Unidad, ''))) AS Unidad,
                   LTRIM(RTRIM(ISNULL(Responsable, ''))) AS Responsable,
                   LTRIM(RTRIM(ISNULL(Observacion, ''))) AS Observacion,
                   LTRIM(RTRIM(ISNULL(FechaEnt, ''))) AS FechaEnt,
                   LTRIM(RTRIM(ISNULL(FechaDev, ''))) AS FechaDev,
                   LTRIM(RTRIM(ISNULL(Estado, ''))) AS Estado,
                   Nomina
            FROM MovimientosComp
            WHERE NumMovCom IS NOT NULL
        `),
        pgPool.query(`
            SELECT nummovcom AS "NumMovCom", numcomp AS "NumComp",
                   COALESCE(TRIM(unidad), '') AS "Unidad",
                   COALESCE(TRIM(responsable), '') AS "Responsable",
                   COALESCE(TRIM(observacion), '') AS "Observacion",
                   COALESCE(TRIM(fechaent), '') AS "FechaEnt",
                   COALESCE(TRIM(fechadev), '') AS "FechaDev",
                   COALESCE(TRIM(estado), '') AS "Estado",
                   nomina AS "Nomina"
            FROM movimientoscomp
            WHERE nummovcom IS NOT NULL
        `)
    ]);

    const msMcMap = new Map(msMcRes.recordset.map(r => [Number(r.NumMovCom), r]));
    const pgMcMap = new Map(pgMcRes.rows.map(r => [Number(r.NumMovCom), r]));

    for (const [numMovCom, msRow] of msMcMap.entries()) {
        const pgRow = pgMcMap.get(numMovCom);
        if (!pgRow) {
            await pgPool.query(
                `INSERT INTO movimientoscomp (nummovcom, numcomp, unidad, responsable, observacion, fechaent, fechadev, estado, nomina)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    numMovCom,
                    msRow.NumComp,
                    clean(msRow.Unidad),
                    clean(msRow.Responsable),
                    clean(msRow.Observacion),
                    clean(msRow.FechaEnt),
                    clean(msRow.FechaDev),
                    clean(msRow.Estado),
                    msRow.Nomina
                ]
            );
            cambiosSqlAPg++;
        } else if (
            clean(msRow.Estado).toUpperCase() === 'DEVUELTO' &&
            clean(pgRow.Estado).toUpperCase() !== 'DEVUELTO'
        ) {
            await pgPool.query(
                `UPDATE movimientoscomp
                 SET estado = $1, fechadev = $2, observacion = $3
                 WHERE nummovcom = $4`,
                [clean(msRow.Estado), clean(msRow.FechaDev), clean(msRow.Observacion), numMovCom]
            );
            cambiosSqlAPg++;
        }
    }

    for (const [numMovCom, pgRow] of pgMcMap.entries()) {
        const msRow = msMcMap.get(numMovCom);
        if (!msRow) {
            await msPool
                .request()
                .input('numMovCom', sql.Int, numMovCom)
                .input('numComp', sql.Int, pgRow.NumComp)
                .input('unidad', sql.VarChar, clean(pgRow.Unidad))
                .input('responsable', sql.VarChar, clean(pgRow.Responsable))
                .input('observacion', sql.VarChar, clean(pgRow.Observacion))
                .input('fechaEnt', sql.VarChar, clean(pgRow.FechaEnt))
                .input('fechaDev', sql.VarChar, clean(pgRow.FechaDev))
                .input('estado', sql.VarChar, clean(pgRow.Estado))
                .input('nomina', sql.Int, pgRow.Nomina)
                .query(`
                    INSERT INTO MovimientosComp (NumMovCom, NumComp, Unidad, Responsable, Observacion, FechaEnt, FechaDev, Estado, Nomina)
                    VALUES (@numMovCom, @numComp, @unidad, @responsable, @observacion, @fechaEnt, @fechaDev, @estado, @nomina)
                `);
            cambiosPgASql++;
        } else if (
            clean(pgRow.Estado).toUpperCase() === 'DEVUELTO' &&
            clean(msRow.Estado).toUpperCase() !== 'DEVUELTO'
        ) {
            await msPool
                .request()
                .input('numMovCom', sql.Int, numMovCom)
                .input('estado', sql.VarChar, clean(pgRow.Estado))
                .input('fechaDev', sql.VarChar, clean(pgRow.FechaDev))
                .input('observacion', sql.VarChar, clean(pgRow.Observacion))
                .query(`
                    UPDATE MovimientosComp
                    SET Estado = @estado, FechaDev = @fechaDev, Observacion = @observacion
                    WHERE NumMovCom = @numMovCom
                `);
            cambiosPgASql++;
        }
    }

    // ------------------------------------------------------------------------
    // C. Tabla Comprobantes (PK lógica: NumComp)
    // ------------------------------------------------------------------------
    const [msCompRes, pgCompRes] = await Promise.all([
        msPool.request().query(`
            SELECT NumComp,
                   LTRIM(RTRIM(ISNULL(FechaComp, ''))) AS FechaComp,
                   LTRIM(RTRIM(ISNULL(FechaRecep, ''))) AS FechaRecep,
                   LTRIM(RTRIM(ISNULL(TipoComp, ''))) AS TipoComp,
                   LTRIM(RTRIM(ISNULL(SectorComp, ''))) AS SectorComp,
                   NumArchiv,
                   LTRIM(RTRIM(ISNULL(MesArchiv, ''))) AS MesArchiv,
                   LTRIM(RTRIM(ISNULL(AnoArchiv, ''))) AS AnoArchiv,
                   LTRIM(RTRIM(ISNULL(ObsComp, ''))) AS ObsComp
            FROM Comprobantes
            WHERE NumComp IS NOT NULL
        `),
        pgPool.query(`
            SELECT numcomp AS "NumComp",
                   COALESCE(TRIM(fechacomp), '') AS "FechaComp",
                   COALESCE(TRIM(fecharecep), '') AS "FechaRecep",
                   COALESCE(TRIM(tipocomp), '') AS "TipoComp",
                   COALESCE(TRIM(sectorcomp), '') AS "SectorComp",
                   numarchiv AS "NumArchiv",
                   COALESCE(TRIM(mesarchiv), '') AS "MesArchiv",
                   COALESCE(TRIM(anoarchiv), '') AS "AnoArchiv",
                   COALESCE(TRIM(obscomp), '') AS "ObsComp"
            FROM comprobantes
            WHERE numcomp IS NOT NULL
        `)
    ]);

    const msCompMap = new Map(msCompRes.recordset.map(r => [Number(r.NumComp), r]));
    const pgCompMap = new Map(pgCompRes.rows.map(r => [Number(r.NumComp), r]));

    for (const [numComp, msRow] of msCompMap.entries()) {
        if (!pgCompMap.has(numComp)) {
            await pgPool.query(
                `INSERT INTO comprobantes (numcomp, fechacomp, fecharecep, tipocomp, sectorcomp, numarchiv, mesarchiv, anoarchiv, obscomp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    numComp,
                    clean(msRow.FechaComp),
                    clean(msRow.FechaRecep),
                    clean(msRow.TipoComp),
                    clean(msRow.SectorComp),
                    msRow.NumArchiv,
                    clean(msRow.MesArchiv),
                    clean(msRow.AnoArchiv),
                    clean(msRow.ObsComp)
                ]
            );
            cambiosSqlAPg++;
        }
    }

    for (const [numComp, pgRow] of pgCompMap.entries()) {
        if (!msCompMap.has(numComp)) {
            await msPool
                .request()
                .input('numComp', sql.Int, numComp)
                .input('fechaComp', sql.VarChar, clean(pgRow.FechaComp))
                .input('fechaRecep', sql.VarChar, clean(pgRow.FechaRecep))
                .input('tipoComp', sql.VarChar, clean(pgRow.TipoComp))
                .input('sectorComp', sql.VarChar, clean(pgRow.SectorComp))
                .input('numArchiv', sql.Int, pgRow.NumArchiv)
                .input('mesArchiv', sql.VarChar, clean(pgRow.MesArchiv))
                .input('anoArchiv', sql.VarChar, clean(pgRow.AnoArchiv))
                .input('obsComp', sql.VarChar, clean(pgRow.ObsComp))
                .query(`
                    INSERT INTO Comprobantes (NumComp, FechaComp, FechaRecep, TipoComp, SectorComp, NumArchiv, MesArchiv, AnoArchiv, ObsComp)
                    VALUES (@numComp, @fechaComp, @fechaRecep, @tipoComp, @sectorComp, @numArchiv, @mesArchiv, @anoArchiv, @obsComp)
                `);
            cambiosPgASql++;
        }
    }

    // ------------------------------------------------------------------------
    // D. Tabla Expedientes (PK lógica: Rut normalizado)
    // ------------------------------------------------------------------------
    const [msExpRes, pgExpRes] = await Promise.all([
        msPool.request().query(`
            SELECT LTRIM(RTRIM(Rut)) AS Rut,
                   LTRIM(RTRIM(ISNULL(Dv, ''))) AS Dv,
                   LTRIM(RTRIM(ISNULL(Contenido, ''))) AS Contenido,
                   LTRIM(RTRIM(ISNULL(Estado, ''))) AS Estado,
                   LTRIM(RTRIM(ISNULL(Observacion, ''))) AS Observacion,
                   Fechacreacion,
                   NumExp,
                   LTRIM(RTRIM(ISNULL(Kardex, ''))) AS Kardex
            FROM Expedientes
            WHERE LTRIM(RTRIM(ISNULL(Rut, ''))) <> ''
        `),
        pgPool.query(`
            SELECT TRIM(rut) AS "Rut",
                   COALESCE(TRIM(dv), '') AS "Dv",
                   COALESCE(TRIM(contenido), '') AS "Contenido",
                   COALESCE(TRIM(estado), '') AS "Estado",
                   COALESCE(TRIM(observacion), '') AS "Observacion",
                   fechacreacion AS "Fechacreacion",
                   numexp AS "NumExp",
                   COALESCE(TRIM(kardex), '') AS "Kardex"
            FROM expedientes
            WHERE COALESCE(TRIM(rut), '') <> ''
        `)
    ]);

    const msExpMap = new Map(msExpRes.recordset.map(r => [normRutKey(r.Rut), r]));
    const pgExpMap = new Map(pgExpRes.rows.map(r => [normRutKey(r.Rut), r]));

    for (const [rutKey, msRow] of msExpMap.entries()) {
        if (!rutKey) continue;
        const pgRow = pgExpMap.get(rutKey);
        if (!pgRow) {
            await pgPool.query(
                `INSERT INTO expedientes (rut, dv, contenido, estado, observacion, fechacreacion, numexp, kardex)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    clean(msRow.Rut),
                    clean(msRow.Dv),
                    clean(msRow.Contenido),
                    clean(msRow.Estado),
                    clean(msRow.Observacion),
                    msRow.Fechacreacion || new Date(),
                    msRow.NumExp,
                    clean(msRow.Kardex)
                ]
            );
            cambiosSqlAPg++;
        } else if (
            clean(msRow.Contenido) !== clean(pgRow.Contenido) ||
            clean(msRow.Estado) !== clean(pgRow.Estado) ||
            clean(msRow.Kardex) !== clean(pgRow.Kardex)
        ) {
            await pgPool.query(
                `UPDATE expedientes
                 SET contenido = $1, estado = $2, kardex = $3
                 WHERE TRIM(rut) IN ($4, $5)`,
                [clean(msRow.Contenido), clean(msRow.Estado), clean(msRow.Kardex), rutKey, '0' + rutKey]
            );
            cambiosSqlAPg++;
        }
    }

    for (const [rutKey, pgRow] of pgExpMap.entries()) {
        if (!rutKey) continue;
        if (!msExpMap.has(rutKey)) {
            await msPool
                .request()
                .input('rut', sql.Char, clean(pgRow.Rut))
                .input('dv', sql.NChar, clean(pgRow.Dv))
                .input('contenido', sql.NChar, clean(pgRow.Contenido))
                .input('estado', sql.NChar, clean(pgRow.Estado))
                .input('observacion', sql.NChar, clean(pgRow.Observacion))
                .input('fecha', sql.DateTime, pgRow.Fechacreacion || new Date())
                .input('numExp', sql.Int, pgRow.NumExp)
                .input('kardex', sql.NChar, clean(pgRow.Kardex))
                .query(`
                    INSERT INTO Expedientes (Rut, Dv, Contenido, Estado, Observacion, Fechacreacion, NumExp, Kardex)
                    VALUES (@rut, @dv, @contenido, @estado, @observacion, @fecha, @numExp, @kardex)
                `);
            cambiosPgASql++;
        }
    }

    return { cambiosSqlAPg, cambiosPgASql };
}

async function runCycle() {
    let msPool251;
    let pgPoolArchivo;
    try {
        msPool251 = await new sql.ConnectionPool({
            user: process.env.SQL251_USER || 'sa',
            password: process.env.SQL251_PASS || 'Total2014',
            server: process.env.SQL251_HOST || '192.168.3.251',
            database: 'Archivo',
            requestTimeout: 60000,
            connectionTimeout: 15000,
            options: { encrypt: false, trustServerCertificate: true }
        }).connect();

        pgPoolArchivo = new PgPool({
            host: PG_HOST,
            port: PG_PORT,
            user: PG_USER,
            password: PG_PASS,
            database: 'bd_archivo',
            max: 5
        });

        const { cambiosSqlAPg, cambiosPgASql } = await syncBidireccionalArchivo(msPool251, pgPoolArchivo);
        const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        if (cambiosSqlAPg > 0 || cambiosPgASql > 0 || RUN_ONCE) {
            console.log(
                `[${stamp}] Sincronización Marcha Blanca OK -> SQL->PG: ${cambiosSqlAPg} cambios | PG->SQL: ${cambiosPgASql} cambios`
            );
        }
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error en ciclo Marcha Blanca:`, err.message);
    } finally {
        if (msPool251) await msPool251.close().catch(() => {});
        if (pgPoolArchivo) await pgPoolArchivo.end().catch(() => {});
    }
}

async function main() {
    console.log('==================================================================');
    console.log(' DEMONIO BIDIRECCIONAL MARCHA BLANCA (SQL Server <===> PostgreSQL)');
    console.log(` - Destino PostgreSQL : ${PG_HOST}:${PG_PORT}`);
    console.log(` - Intervalo          : ${RUN_ONCE ? 'Ejecución Única (--once)' : `Cada ${INTERVAL_SEC} segundos`}`);
    console.log('==================================================================');

    await runCycle();
    if (!RUN_ONCE) {
        setInterval(runCycle, INTERVAL_SEC * 1000);
    }
}

main();
