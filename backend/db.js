const sql = require('mssql');
require('dotenv').config();

let PgPool = null;
try {
    const pgMod = require('pg');
    PgPool = pgMod.Pool;
    // Convertir INT8 / BIGINT (ej. COUNT(*) en PostgreSQL) a Number de JS igual que mssql
    pgMod.types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));
} catch (e) {
    console.warn('[AVISO] Paquete pg no disponible; usando SQL Server como respaldo.');
}

const DB_ENGINE = PgPool ? (process.env.DB_ENGINE || 'dual').toLowerCase() : 'mssql';

// ============================================================================
// TRADUCTOR Y ADAPTADOR HÍBRIDO SQL SERVER <-> POSTGRESQL
// Permite cambiar entre SQL Server (mssql) y PostgreSQL (pg) desde .env
// ============================================================================

const KNOWN_PASCAL_KEYS = {
    number: 'number',
    usuario: 'Usuario',
    password: 'Password',
    caduca: 'Caduca',
    fechacaduca: 'FechaCaduca',
    nombreusuario: 'nombreUsuario',
    codunidad: 'CodUnidad',
    codcenco: 'CodCenco',
    descripcion: 'Descripcion',
    codsector: 'CodSector',
    totalexpedientes: 'TotalExpedientes',
    totalfuncionarios: 'TotalFuncionarios',
    totalmovimientosexp: 'TotalMovimientosExp',
    expedientesprestados: 'ExpedientesPrestados',
    totalcomprobantes: 'TotalComprobantes',
    comprobantesprestados: 'ComprobantesPrestados',
    estadonombre: 'EstadoNombre',
    cantidad: 'Cantidad',
    unidad: 'Unidad',
    nummov: 'NumMov',
    numexp: 'NumExp',
    rut: 'Rut',
    dv: 'DV',
    nombre: 'Nombre',
    paterno: 'Paterno',
    materno: 'Materno',
    responsable: 'Responsable',
    observacion: 'Observacion',
    fecha: 'Fecha',
    fechadev: 'FechaDev',
    estado: 'Estado',
    nomina: 'Nomina',
    descripcionplanta: 'DescripcionPlanta',
    fechainicio: 'FechaInicio',
    fechatermino: 'FechaTermino',
    estadoexpediente: 'EstadoExpediente',
    kardex: 'Kardex',
    contenido: 'Contenido',
    fechacreacion: 'Fechacreacion',
    ubicacion: 'Ubicacion',
    cajon: 'Cajon',
    tipo: 'Tipo',
    nextnummov: 'NextNumMov',
    nextnomina: 'NextNomina',
    nextexp: 'NextExp',
    numcomp: 'NumComp',
    fechacomp: 'FechaComp',
    fecharecep: 'FechaRecep',
    tipocomp: 'TipoComp',
    sectorcomp: 'SectorComp',
    numarchiv: 'NumArchiv',
    mesarchiv: 'MesArchiv',
    anoarchiv: 'AnoArchiv',
    obscomp: 'ObsComp',
    ultimoestado: 'UltimoEstado',
    ultimoresponsable: 'UltimoResponsable',
    ultimaunidad: 'UltimaUnidad',
    nummovcom: 'NumMovCom',
    fechaent: 'FechaEnt',
    nextnummovcom: 'NextNumMovCom'
};

function translateTSqlToPostgres(queryText, paramsMap) {
    let q = String(queryText);

    // 1. Extraer identificadores con mayúsculas/minúsculas y alias explícitos (AS NombreAlias) del query
    const SQL_KEYWORDS = new Set([
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS', 'ON', 'JOIN',
        'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC',
        'HAVING', 'LIMIT', 'OFFSET', 'TOP', 'DISTINCT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
        'INSERT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'CONVERT', 'COALESCE', 'ISNULL',
        'LTRIM', 'RTRIM', 'TRIM', 'UPPER', 'LOWER', 'REPLACE', 'SUBSTRING', 'LEN', 'LENGTH', 'CONCAT',
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROW_NUMBER', 'OVER', 'PARTITION', 'VARCHAR', 'NVARCHAR',
        'CHAR', 'NCHAR', 'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DATE',
        'DATETIME', 'TIMESTAMP', 'TEXT', 'GETDATE', 'CURRENT_TIMESTAMP', 'LIKE', 'BETWEEN', 'EXISTS'
    ]);
    const aliasMap = { ...KNOWN_PASCAL_KEYS };
    const identRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = identRegex.exec(q)) !== null) {
        const word = m[1];
        const upper = word.toUpperCase();
        if (!SQL_KEYWORDS.has(upper) && /[A-Z]/.test(word) && /[a-z]/.test(word)) {
            aliasMap[word.toLowerCase()] = word;
        }
    }
    const aliasRegex = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi;
    while ((m = aliasRegex.exec(q)) !== null) {
        const word = m[1];
        const upper = word.toUpperCase();
        if (!SQL_KEYWORDS.has(upper)) {
            aliasMap[word.toLowerCase()] = word;
        }
    }

    // 2. Funciones comunes T-SQL -> PostgreSQL
    q = q.replace(/\bISNULL\s*\(/gi, 'COALESCE(');
    q = q.replace(/\bGETDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');
    q = q.replace(/\bLEN\s*\(/gi, 'LENGTH(');
    q = q.replace(/\bYEAR\s*\(\s*CURRENT_TIMESTAMP\s*\)/gi, 'EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::INT');
    q = q.replace(/\bYEAR\s*\(\s*([^()]+)\s*\)/gi, 'EXTRACT(YEAR FROM $1)::INT');
    q = q.replace(/\bMONTH\s*\(\s*CURRENT_TIMESTAMP\s*\)/gi, 'EXTRACT(MONTH FROM CURRENT_TIMESTAMP)::INT');
    q = q.replace(/\bMONTH\s*\(\s*([^()]+)\s*\)/gi, 'EXTRACT(MONTH FROM $1)::INT');
    q = q.replace(/\bDAY\s*\(\s*CURRENT_TIMESTAMP\s*\)/gi, 'EXTRACT(DAY FROM CURRENT_TIMESTAMP)::INT');
    q = q.replace(/\bDAY\s*\(\s*([^()]+)\s*\)/gi, 'EXTRACT(DAY FROM $1)::INT');
    q = q.replace(/\bCONVERT\s*\(\s*varchar(?:\(\d+\))?\s*,\s*([^,]+?)\s*,\s*23\s*\)/gi, "TO_CHAR($1, 'YYYY-MM-DD')");
    q = q.replace(/\bCONVERT\s*\(\s*varchar(?:\(\d+\))?\s*,\s*([^,]+?)\s*,\s*103\s*\)/gi, "TO_CHAR($1, 'DD/MM/YYYY')");
    q = q.replace(/\bCONVERT\s*\(\s*varchar(?:\(\d+\))?\s*,\s*([^,]+?)\s*,\s*105\s*\)/gi, "TO_CHAR($1, 'DD-MM-YYYY')");
    q = q.replace(/\bCONVERT\s*\(\s*varchar(?:\(\d+\))?\s*,\s*([^,]+?)\s*,\s*120\s*\)/gi, "TO_CHAR($1, 'YYYY-MM-DD HH24:MI:SS')");

    // 3. Transformar SELECT TOP (N) o SELECT TOP N a LIMIT N al final de la consulta
    q = q.replace(
        /^\s*SELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+)\s*\)?\s+([\s\S]*?)\s*;?\s*$/i,
        (match, distinctPart, limitNum, body) => {
            return `SELECT ${distinctPart || ''}${body.trim()} LIMIT ${limitNum}`;
        }
    );

    // 4. Reemplazar parámetros @param por $1, $2...
    const values = [];
    const paramIndexMap = new Map();

    q = q.replace(/@([A-Za-z0-9_]+)/g, (fullMatch, paramName) => {
        const key = paramName.toLowerCase();
        if (! paramsMap.has(key)) {
            return fullMatch;
        }
        if (!paramIndexMap.has(key)) {
            values.push(paramsMap.get(key));
            paramIndexMap.set(key, values.length);
        }
        return `$${paramIndexMap.get(key)}`;
    });

    return { text: q, values, aliasMap };
}

function normalizePgRows(rows, aliasMap) {
    if (!Array.isArray(rows)) return [];
    return rows.map(r => {
        const out = {};
        for (const [k, v] of Object.entries(r)) {
            const lower = k.toLowerCase();
            const mappedKey = aliasMap[lower] || KNOWN_PASCAL_KEYS[lower] || k;
            out[mappedKey] = v;
            if (mappedKey !== k) {
                out[k] = v;
            }
        }
        return out;
    });
}

class PgRequestWrapper {
    constructor(pgPool) {
        this.pgPool = pgPool;
        this.params = new Map();
    }

    input(name, typeOrVal, val) {
        const value = arguments.length === 2 ? typeOrVal : val;
        this.params.set(String(name).toLowerCase(), value);
        return this;
    }

    async query(queryText) {
        const { text, values, aliasMap } = translateTSqlToPostgres(queryText, this.params);
        const res = await this.pgPool.query(text, values);
        const normalized = normalizePgRows(res.rows, aliasMap);
        return {
            recordset: normalized,
            recordsets: [normalized],
            rowsAffected: [res.rowCount || 0]
        };
    }
}

class DualRequestWrapper {
    constructor(mssqlPool, pgPool) {
        this.mssqlReq = mssqlPool.request();
        this.pgReq = new PgRequestWrapper(pgPool);
    }

    input(name, typeOrVal, val) {
        if (arguments.length === 2) {
            this.mssqlReq.input(name, typeOrVal);
            this.pgReq.input(name, typeOrVal);
        } else {
            this.mssqlReq.input(name, typeOrVal, val);
            this.pgReq.input(name, typeOrVal, val);
        }
        return this;
    }

    async query(queryText) {
        const qTrim = String(queryText).trim();
        const isWrite = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(qTrim);
        const isMaxQuery = /\bMAX\s*\(/i.test(qTrim) && /^\s*SELECT\b/i.test(qTrim);

        if (isWrite) {
            // En SQL Server, las tablas Expedientes, Movimientos y MovimientosComp tienen columna IDENTITY
            let mssqlQueryText = queryText;
            const idTableMatch = qTrim.match(/^\s*INSERT\s+INTO\s+(Expedientes|Movimientos|MovimientosComp)\s*\(/i);
            if (idTableMatch) {
                const tbl = idTableMatch[1];
                mssqlQueryText = `SET IDENTITY_INSERT ${tbl} ON;\n${queryText};\nSET IDENTITY_INSERT ${tbl} OFF;`;
            }

            // Modo Marcha Blanca: Escribir simultáneamente en PostgreSQL y SQL Server
            const [pgOutcome, mssqlOutcome] = await Promise.allSettled([
                this.pgReq.query(queryText),
                this.mssqlReq.query(mssqlQueryText)
            ]);
            if (pgOutcome.status === 'rejected') {
                console.error('[DUAL-WRITE] Error en PostgreSQL:', pgOutcome.reason?.message);
            }
            if (mssqlOutcome.status === 'rejected') {
                console.error('[DUAL-WRITE] Error en SQL Server:', mssqlOutcome.reason?.message);
            }
            if (pgOutcome.status === 'fulfilled') return pgOutcome.value;
            if (mssqlOutcome.status === 'fulfilled') return mssqlOutcome.value;
            throw pgOutcome.reason || mssqlOutcome.reason;
        }

        if (isMaxQuery) {
            // Coordinar correlativos (MAX + 1) entre ambos motores para evitar colisiones de IDs
            const [pgRes, mssqlRes] = await Promise.all([
                this.pgReq.query(queryText),
                this.mssqlReq.query(queryText)
            ]);
            const rowPg = (pgRes.recordset && pgRes.recordset[0]) || {};
            const rowMs = (mssqlRes.recordset && mssqlRes.recordset[0]) || {};
            const merged = { ...rowPg };
            for (const key of Object.keys(rowMs)) {
                const vPg = Number(merged[key]);
                const vMs = Number(rowMs[key]);
                if (!isNaN(vPg) && !isNaN(vMs)) {
                    merged[key] = Math.max(vPg, vMs);
                }
            }
            return {
                recordset: [merged],
                recordsets: [[merged]],
                rowsAffected: [1]
            };
        }

        // Lecturas normales: leer desde PostgreSQL (con fallback automático a SQL Server)
        try {
            return await this.pgReq.query(queryText);
        } catch (err) {
            console.warn('[DUAL-READ] Fallback a SQL Server por:', err.message);
            return await this.mssqlReq.query(queryText);
        }
    }
}

function createPgConfig(defaultDbName) {
    return process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
              host: process.env.PG_HOST || '192.168.30.47',
              port: parseInt(process.env.PG_PORT || '5432', 10),
              user: process.env.PG_USER || 'cmds_admin',
              password: process.env.PG_PASS || 'CmdsPostgres2026!',
              database: process.env.PG_DB || defaultDbName,
              max: 15,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 5000
          };
}

function createMssqlConfig() {
    const rawServer = process.env.DB_SERVER || '192.168.3.251';
    const [serverHost, instanceName] = rawServer.includes('\\')
        ? rawServer.split('\\')
        : [rawServer, undefined];

    return {
        rawServer,
        config: {
            user: process.env.DB_USER,
            password: process.env.DB_PASS || process.env.DB_PASSWORD,
            server: process.env.DB_PORT ? serverHost : rawServer,
            ...(process.env.DB_PORT ? { port: Number(process.env.DB_PORT) } : {}),
            database: process.env.DB_NAME,
            requestTimeout: 90000,
            connectionTimeout: 30000,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true,
                ...(!process.env.DB_PORT && instanceName ? { instanceName } : {})
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            }
        }
    };
}

let poolPromise = null;

async function initPool() {
    const { rawServer, config: mssqlConfig } = createMssqlConfig();

    if (!PgPool || (DB_ENGINE !== 'dual' && DB_ENGINE !== 'ambos' && DB_ENGINE !== 'marcha_blanca' && DB_ENGINE !== 'postgres' && DB_ENGINE !== 'pg' && DB_ENGINE !== 'postgresql')) {
        const pool = await new sql.ConnectionPool(mssqlConfig).connect();
        console.log('Conectado a SQL Server exitosamente (' + rawServer + ' -> ' + process.env.DB_NAME + ')');
        return pool;
    }

    if (DB_ENGINE === 'postgres' || DB_ENGINE === 'pg' || DB_ENGINE === 'postgresql') {
        const pgConfig = createPgConfig('bd_archivo');
        const pgPool = new PgPool(pgConfig);
        await pgPool.query('SELECT 1');
        console.log(`Conectado a PostgreSQL exitosamente (${pgConfig.host || 'URL'} -> ${pgConfig.database || 'bd_archivo'})`);
        return {
            request: () => new PgRequestWrapper(pgPool),
            query: (q) => new PgRequestWrapper(pgPool).query(q),
            close: () => pgPool.end()
        };
    }

    // Modo DUAL (SQL Server + PostgreSQL) con fallback automático si uno de los dos no responde
    const pgConfig = createPgConfig('bd_archivo');
    const pgPool = new PgPool(pgConfig);

    const [mssqlOut, pgOut] = await Promise.allSettled([
        new sql.ConnectionPool(mssqlConfig).connect(),
        pgPool.query('SELECT 1')
    ]);

    if (mssqlOut.status === 'fulfilled' && pgOut.status === 'fulfilled') {
        const mssqlPool = mssqlOut.value;
        console.log(
            `[MODO MARCHA BLANCA DUAL] Conectado simultáneamente a SQL Server (${rawServer} -> ${mssqlConfig.database}) y PostgreSQL (${pgConfig.host} -> ${pgConfig.database})`
        );
        return {
            mssqlPool,
            pgPool,
            request: () => new DualRequestWrapper(mssqlPool, pgPool),
            query: (q) => new DualRequestWrapper(mssqlPool, pgPool).query(q),
            close: async () => {
                await Promise.allSettled([mssqlPool.close(), pgPool.end()]);
            }
        };
    }

    if (mssqlOut.status === 'fulfilled') {
        console.warn('[DB DUAL] PostgreSQL no disponible (' + (pgOut.reason?.message || 'error') + '). Operando con SQL Server.');
        pgPool.end().catch(() => {});
        return mssqlOut.value;
    }

    if (pgOut.status === 'fulfilled') {
        console.warn('[DB DUAL] SQL Server no disponible (' + (mssqlOut.reason?.message || 'error') + '). Operando con PostgreSQL.');
        return {
            request: () => new PgRequestWrapper(pgPool),
            query: (q) => new PgRequestWrapper(pgPool).query(q),
            close: () => pgPool.end()
        };
    }

    throw mssqlOut.reason || pgOut.reason;
}

async function getConnection() {
    if (!poolPromise) {
        poolPromise = initPool().catch(err => {
            console.error('Error de conexión a Base de Datos Archivo:', err.message);
            poolPromise = null;
            throw err;
        });
    }
    return poolPromise;
}

const getPool = getConnection;

getConnection().catch(() => {});

module.exports = {
    sql,
    get poolPromise() {
        return getConnection();
    },
    getPool,
    getConnection,
    DB_ENGINE
};
