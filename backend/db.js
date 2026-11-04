const sql = require('mssql');
const { Pool: PgPool, types: pgTypes } = require('pg');
require('dotenv').config();

// Convertir INT8 / BIGINT (ej. COUNT(*) en PostgreSQL) a Number de JS igual que mssql
pgTypes.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));

const DB_ENGINE = (process.env.DB_ENGINE || 'mssql').toLowerCase();

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

    // 3. Transformar SELECT TOP (N) o SELECT TOP N a LIMIT N
    // 3a. Consultas o subconsultas con ORDER BY
    q = q.replace(
        /\bSELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+)\s*\)?\s+([\s\S]*?)(ORDER\s+BY\s+[^\n\r;)]+)/gi,
        (match, distinctPart, limitNum, body, orderClause) => {
            return `SELECT ${distinctPart || ''}${body}${orderClause} LIMIT ${limitNum}`;
        }
    );

    // 3b. Consultas principales con SELECT TOP N sin ORDER BY
    q = q.replace(
        /^\s*SELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+)\s*\)?\s+([\s\S]*?)\s*;?\s*$/i,
        (match, distinctPart, limitNum, body) => {
            return `SELECT ${distinctPart || ''}${body} LIMIT ${limitNum}`;
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

let poolPromise;

if (DB_ENGINE === 'postgres' || DB_ENGINE === 'pg' || DB_ENGINE === 'postgresql') {
    const pgConfig = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
              host: process.env.PG_HOST || process.env.DB_SERVER || '127.0.0.1',
              port: parseInt(process.env.PG_PORT || process.env.DB_PORT || '5432', 10),
              user: process.env.PG_USER || process.env.DB_USER || 'cmds_admin',
              password: process.env.PG_PASS || process.env.DB_PASS || 'CmdsPostgres2026!',
              database: process.env.PG_DB || process.env.DB_NAME || 'bd_archivo',
              max: 15,
              idleTimeoutMillis: 30000
          };

    const pgPool = new PgPool(pgConfig);
    poolPromise = pgPool
        .query('SELECT 1')
        .then(() => {
            console.log(`Conectado a PostgreSQL exitosamente (${pgConfig.host || 'URL'} -> ${pgConfig.database || 'bd_archivo'})`);
            return {
                request: () => new PgRequestWrapper(pgPool),
                query: (q) => new PgRequestWrapper(pgPool).query(q),
                close: () => pgPool.end()
            };
        })
        .catch(err => {
            console.error('Error de conexión a PostgreSQL:', err.message);
            throw err;
        });
} else {
    const rawServer = process.env.DB_SERVER || '192.168.3.251';
    const [serverHost, instanceName] = rawServer.includes('\\')
        ? rawServer.split('\\')
        : [rawServer, undefined];

    const config = {
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
    };

    poolPromise = new sql.ConnectionPool(config)
        .connect()
        .then(pool => {
            console.log('Conectado a SQL Server exitosamente (' + rawServer + ' -> ' + process.env.DB_NAME + ')');
            return pool;
        })
        .catch(err => {
            console.error('Error de conexión a la Base de Datos SQL Server: ', err);
            throw err;
        });
}

const getPool = async () => poolPromise;
const getConnection = async () => poolPromise;

module.exports = {
    sql,
    poolPromise,
    getPool,
    getConnection,
    DB_ENGINE
};
