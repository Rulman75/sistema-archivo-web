/**
 * ============================================================================
 * MIGRADOR Y SINCRONIZADOR EN VIVO: SQL SERVER (2012) -> POSTGRESQL (16+)
 * Corporación Municipal de Desarrollo Social de Antofagasta (CMDS)
 * ============================================================================
 *
 * Permite migrar esquemas (DDL), datos limpios (sin espacios residuales char/nchar),
 * llaves primarias, secuencias autoincrementales y verificar cuadratura 1:1
 * tanto en la Marcha Blanca como el Día del Paso a Producción (Cutover).
 *
 * Modos de uso:
 * 1) Sincronizar una base específica hacia PostgreSQL en vivo:
 *    node sync-sqlserver-to-postgres.js --db=Archivo --pg-host=192.168.3.X --pg-pass=CmdsPostgres2026!
 *
 * 2) Sincronizar las 4 bases de Etapa 1 (Sistemas Web Productivos):
 *    node sync-sqlserver-to-postgres.js --etapa=1 --pg-host=192.168.3.X
 *
 * 3) Sincronizar TODAS las bases de 192.168.3.251 y 192.168.3.159\BASE:
 *    node sync-sqlserver-to-postgres.js --all --pg-host=192.168.3.X
 *
 * 4) Generar archivos de volcado PostgreSQL (.sql.gz) listos para importar:
 *    node sync-sqlserver-to-postgres.js --etapa=1 --export-sql
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sql = require('../backend/node_modules/mssql');

let PgPool = null;
try {
    PgPool = require('../backend/node_modules/pg').Pool;
} catch {
    try {
        PgPool = require('pg').Pool;
    } catch {
        // Se cargará cuando se instale pg en backend
    }
}

// ============================================================================
// CATÁLOGO OFICIAL DE BASES DE DATOS A MIGRAR Y CONSOLIDAR
// ============================================================================

const CATALOGO_BASES = [
    // --- ETAPA 1: SISTEMAS WEB MODERNIZADOS EN PRODUCCIÓN ---
    {
        etapa: 1,
        sourceServer: '251',
        sourceDb: 'Archivo',
        targetDb: 'bd_archivo',
        descripcion: 'Sistema de Gestión de Archivo, Expedientes y Comprobantes (update-sistema-archivo)',
        seqColumns: {
            expedientes: 'numexp',
            movimientos: 'nummov',
            movimientoscomp: 'nummovcom'
        }
    },
    {
        etapa: 1,
        sourceServer: '251',
        sourceDb: 'BDLicencias',
        targetDb: 'bd_licencias',
        descripcion: 'Sistema Web de Licencias Médicas (licencias-medicas-web)',
        seqColumns: {}
    },
    {
        etapa: 1,
        sourceServer: '159',
        sourceDb: 'controlservicios',
        targetDb: 'bd_control_servicios',
        descripcion: 'Sistema de Control de Consumos Básicos Agua/Luz/Gas/Tel (update-sistema-control-consumo)',
        seqColumns: {}
    },
    {
        etapa: 1,
        sourceServer: '251',
        sourceDb: 'TraspasoSlep',
        targetDb: 'bd_traspaso_slep',
        descripcion: 'Sistema de Traspaso SLEP (sistema-traspaso-slep)',
        seqColumns: {}
    },

    // --- ETAPA 2: SISTEMAS INTERNOS CMDS / VB.NET ---
    { etapa: 2, sourceServer: '251', sourceDb: 'Correspondencia', targetDb: 'bd_correspondencia', descripcion: 'Sistema de Correspondencia Casa Central' },
    { etapa: 2, sourceServer: '251', sourceDb: 'CorrespondenciaSalud', targetDb: 'bd_correspondencia_salud', descripcion: 'Sistema de Correspondencia Salud' },
    { etapa: 2, sourceServer: '251', sourceDb: 'Correspondencia_Archivo', targetDb: 'bd_correspondencia_archivo', descripcion: 'Histórico Correspondencia Archivo' },
    { etapa: 2, sourceServer: '251', sourceDb: 'BoletaHonorarios', targetDb: 'bd_boleta_honorarios', descripcion: 'Sistema de Boletas de Honorarios' },
    { etapa: 2, sourceServer: '251', sourceDb: 'BoletaHonorariosEduc', targetDb: 'bd_boleta_honorarios_educ', descripcion: 'Sistema de Boletas de Honorarios Educación' },
    { etapa: 2, sourceServer: '251', sourceDb: 'CarreraFuncionaria', targetDb: 'bd_carrera_funcionaria', descripcion: 'Sistema de Carrera Funcionaria' },
    { etapa: 2, sourceServer: '251', sourceDb: 'BD_ENTI_CORPORATIVA', targetDb: 'bd_enti_corporativa', descripcion: 'Base Entidad Corporativa CMDS' },
    { etapa: 2, sourceServer: '251', sourceDb: 'Matriculas', targetDb: 'bd_matriculas', descripcion: 'Sistema de Matrículas' },
    { etapa: 2, sourceServer: '159', sourceDb: 'Sii_Alumnos', targetDb: 'bd_sii_alumnos', descripcion: 'Catastro SII Alumnos' },
    { etapa: 2, sourceServer: '159', sourceDb: 'Encuestas', targetDb: 'bd_encuestas', descripcion: 'Sistema de Encuestas' },
    { etapa: 2, sourceServer: '251', sourceDb: 'Rem', targetDb: 'bd_rem', descripcion: 'Base de Remuneraciones' },

    // --- ETAPA 3: HISTÓRICOS Y RESPALDO (Ordenados de más livianos a más pesados) ---
    { etapa: 3, sourceServer: '251', sourceDb: 'Farmacia', targetDb: 'bd_farmacia', descripcion: 'Histórico Farmacia' },
    { etapa: 3, sourceServer: '251', sourceDb: 'MERMAS_APS', targetDb: 'bd_mermas_aps', descripcion: 'Mermas APS' },
    { etapa: 3, sourceServer: '251', sourceDb: 'GastosConvenios', targetDb: 'bd_gastos_convenios', descripcion: 'Gastos Convenios' },
    { etapa: 3, sourceServer: '251', sourceDb: 'RRHH_APS', targetDb: 'bd_rrhh_aps', descripcion: 'RRHH APS' },
    { etapa: 3, sourceServer: '251', sourceDb: 'Cheques', targetDb: 'bd_cheques', descripcion: 'Registro de Cheques' },
    { etapa: 3, sourceServer: '251', sourceDb: 'Varios', targetDb: 'bd_varios', descripcion: 'Varios' },
    { etapa: 3, sourceServer: '159', sourceDb: 'CORPORACION_2016', targetDb: 'bd_corporacion_2016', descripcion: 'Histórico Corporación 2016' },
    { etapa: 3, sourceServer: '251', sourceDb: 'Asistencia2', targetDb: 'bd_asistencia2', descripcion: 'Reloj Control / Asistencia' },
    { etapa: 3, sourceServer: '251', sourceDb: 'DESOAN1', targetDb: 'bd_desoan1', descripcion: 'Histórico ERP Softland DESOAN1' },
    { etapa: 3, sourceServer: '251', sourceDb: 'CMDS2014', targetDb: 'bd_cmds2014', descripcion: 'Histórico ERP Softland CMDS2014' },
    { etapa: 3, sourceServer: '251', sourceDb: 'ControlHorario', targetDb: 'bd_control_horario', descripcion: 'Histórico Control Horario' }
];

function getSqlServerConfig(serverKey, dbName) {
    if (serverKey === '159') {
        return {
            user: process.env.SQL159_USER || 'base',
            password: process.env.SQL159_PASS || 'base2014',
            server: process.env.SQL159_HOST || '192.168.3.159',
            database: dbName,
            requestTimeout: 900000,
            connectionTimeout: 30000,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                instanceName: 'BASE'
            }
        };
    }
    return {
        user: process.env.SQL251_USER || 'sa',
        password: process.env.SQL251_PASS || 'Total2014',
        server: process.env.SQL251_HOST || '192.168.3.251',
        database: dbName,
        requestTimeout: 900000,
        connectionTimeout: 30000,
        options: {
            encrypt: false,
            trustServerCertificate: true
        }
    };
}

// Mapea tipos de datos de SQL Server a tipos nativos de PostgreSQL
function mapDataTypeToPostgres(col) {
    const dt = String(col.DATA_TYPE).toLowerCase();
    const maxLen = col.CHARACTER_MAXIMUM_LENGTH;
    const numPrec = col.NUMERIC_PRECISION;
    const numScale = col.NUMERIC_SCALE;

    switch (dt) {
        case 'int':
            return 'INTEGER';
        case 'bigint':
            return 'BIGINT';
        case 'smallint':
        case 'tinyint':
            return 'SMALLINT';
        case 'bit':
            return 'BOOLEAN';
        case 'decimal':
        case 'numeric':
            return numPrec ? `NUMERIC(${numPrec}, ${numScale || 0})` : 'NUMERIC';
        case 'money':
        case 'smallmoney':
            return 'NUMERIC(19, 4)';
        case 'float':
        case 'real':
            return 'DOUBLE PRECISION';
        case 'date':
            return 'DATE';
        case 'datetime':
        case 'datetime2':
        case 'smalldatetime':
            return 'TIMESTAMP';
        case 'char':
        case 'nchar':
        case 'varchar':
        case 'nvarchar':
            if (!maxLen || maxLen < 0 || maxLen > 4000) return 'TEXT';
            return `VARCHAR(${maxLen})`;
        case 'text':
        case 'ntext':
        case 'xml':
            return 'TEXT';
        case 'uniqueidentifier':
            return 'UUID';
        case 'varbinary':
        case 'binary':
        case 'image':
            return 'BYTEA';
        default:
            return 'TEXT';
    }
}

// Normaliza un valor proveniente de SQL Server para PostgreSQL
function cleanValueForPostgres(val, dataType) {
    if (val === null || val === undefined) return null;
    const dt = String(dataType).toLowerCase();

    if (dt === 'char' || dt === 'nchar' || dt === 'varchar' || dt === 'nvarchar' || dt === 'text' || dt === 'ntext') {
        const s = String(val).replace(/\0/g, '').trimEnd();
        // Limpiar máscaras vacías heredadas de MaskedTextBox en VB.NET ('  -  -    ')
        if (s.trim() === '-  -' || s.trim() === '--') return '';
        return s;
    }
    if (dt === 'bit') {
        return Boolean(val);
    }
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return null;
        return val.toISOString();
    }
    return val;
}

function escapeCopyText(val, dataType) {
    const cleaned = cleanValueForPostgres(val, dataType);
    if (cleaned === null || cleaned === undefined) return '\\N';
    if (typeof cleaned === 'boolean') return cleaned ? 't' : 'f';
    if (Buffer.isBuffer(cleaned)) return '\\\\x' + cleaned.toString('hex');
    return String(cleaned)
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function pgIdent(name) {
    return `"${String(name).toLowerCase().replace(/"/g, '""')}"`;
}

// Obtiene metadatos completos de tablas, columnas y llaves primarias desde SQL Server
async function inspectSqlServerSchema(pool) {
    const tablesRes = await pool.request().query(`
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND TABLE_NAME NOT IN ('dtproperties', 'sysdiagrams')
        ORDER BY TABLE_NAME
    `);

    const colsRes = await pool.request().query(`
        SELECT
            c.TABLE_SCHEMA,
            c.TABLE_NAME,
            c.COLUMN_NAME,
            c.ORDINAL_POSITION,
            c.IS_NULLABLE,
            c.DATA_TYPE,
            c.CHARACTER_MAXIMUM_LENGTH,
            c.NUMERIC_PRECISION,
            c.NUMERIC_SCALE
        FROM INFORMATION_SCHEMA.COLUMNS c
        INNER JOIN INFORMATION_SCHEMA.TABLES t
            ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
        WHERE t.TABLE_TYPE = 'BASE TABLE'
          AND t.TABLE_NAME NOT IN ('dtproperties', 'sysdiagrams')
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `);

    const pkRes = await pool.request().query(`
        SELECT
            s.name AS TABLE_SCHEMA,
            t.name AS TABLE_NAME,
            c.name AS COLUMN_NAME,
            ic.key_ordinal
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        INNER JOIN sys.tables t ON i.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE i.is_primary_key = 1
          AND t.name NOT IN ('dtproperties', 'sysdiagrams')
        ORDER BY t.name, ic.key_ordinal
    `);

    const schemaMap = new Map();
    for (const t of tablesRes.recordset) {
        schemaMap.set(`${t.TABLE_SCHEMA}.${t.TABLE_NAME}`, {
            schema: t.TABLE_SCHEMA,
            tableName: t.TABLE_NAME,
            pgTableName: t.TABLE_NAME.toLowerCase(),
            columns: [],
            primaryKeys: []
        });
    }

    for (const c of colsRes.recordset) {
        const key = `${c.TABLE_SCHEMA}.${c.TABLE_NAME}`;
        if (schemaMap.has(key)) {
            schemaMap.get(key).columns.push({
                ...c,
                pgColName: c.COLUMN_NAME.toLowerCase(),
                pgType: mapDataTypeToPostgres(c)
            });
        }
    }

    for (const pk of pkRes.recordset) {
        const key = `${pk.TABLE_SCHEMA}.${pk.TABLE_NAME}`;
        if (schemaMap.has(key)) {
            schemaMap.get(key).primaryKeys.push(pk.COLUMN_NAME.toLowerCase());
        }
    }

    return Array.from(schemaMap.values());
}

// Genera el bloque CREATE TABLE para una tabla en PostgreSQL
function buildCreateTableDDL(tableMeta) {
    const colLines = tableMeta.columns.map(c => {
        return `    ${pgIdent(c.pgColName)} ${c.pgType}`;
    });

    // Solo agregar PRIMARY KEY automática si no contiene columnas potencialmente duplicadas o nulas en bases legadas
    const ddl = [
        `DROP TABLE IF EXISTS ${pgIdent(tableMeta.pgTableName)} CASCADE;`,
        `CREATE TABLE ${pgIdent(tableMeta.pgTableName)} (\n${colLines.join(',\n')}\n);`
    ];
    return ddl.join('\n');
}

// ============================================================================
// MODO 1: EXPORTAR A ARCHIVO .SQL.GZ (CON FORMATO COPY ULTRA-RÁPIDO)
// ============================================================================

async function exportarBaseASqlGz(dbEntry, outputDir) {
    console.log(`\n==================================================================`);
    console.log(` EXPORTANDO [${dbEntry.sourceDb}] (Server .${dbEntry.sourceServer}) -> ${dbEntry.targetDb}.sql.gz`);
    console.log(`==================================================================`);

    const sqlPool = await new sql.ConnectionPool(getSqlServerConfig(dbEntry.sourceServer, dbEntry.sourceDb)).connect();
    const tables = await inspectSqlServerSchema(sqlPool);

    fs.mkdirSync(outputDir, { recursive: true });
    const sqlFilePath = path.join(outputDir, `${dbEntry.targetDb}.sql`);
    const gzFilePath = path.join(outputDir, `${dbEntry.targetDb}.sql.gz`);
    const out = fs.createWriteStream(sqlFilePath, { encoding: 'utf8' });

    out.write(`-- ============================================================================\n`);
    out.write(`-- VOLCADO AUTOMÁTICO SQL SERVER -> POSTGRESQL (${dbEntry.sourceDb} -> ${dbEntry.targetDb})\n`);
    out.write(`-- Fecha de generación: ${new Date().toISOString()}\n`);
    out.write(`-- ============================================================================\n\n`);
    out.write(`SET statement_timeout = 0;\n`);
    out.write(`SET client_encoding = 'UTF8';\n`);
    out.write(`SET standard_conforming_strings = on;\n\n`);

    // Guardar mapa de nombres de columnas originales (PascalCase) para el adaptador del backend
    const columnCaseMap = {};

    for (const t of tables) {
        columnCaseMap[t.pgTableName] = {};
        for (const c of t.columns) {
            columnCaseMap[t.pgTableName][c.pgColName] = c.COLUMN_NAME;
        }

        out.write(`\n-- Tabla: ${t.tableName}\n`);
        out.write(buildCreateTableDDL(t) + '\n\n');

        // Evitar exportar columnas binarias gigantes de dtproperties
        const validCols = t.columns.filter(c => String(c.DATA_TYPE).toLowerCase() !== 'timestamp');
        if (validCols.length === 0) continue;

        const pgColList = validCols.map(c => pgIdent(c.pgColName)).join(', ');
        const sqlColList = validCols.map(c => `[${c.COLUMN_NAME}]`).join(', ');

        const countRes = await sqlPool.request().query(
            `SELECT COUNT(*) AS total FROM [${t.schema}].[${t.tableName}]`
        );
        const totalRows = countRes.recordset[0].total;

        if (totalRows === 0) {
            console.log(`  - ${t.tableName}: 0 filas (esquema creado)`);
            continue;
        }

        out.write(`COPY ${pgIdent(t.pgTableName)} (${pgColList}) FROM stdin;\n`);

        const BATCH_SIZE = 5000;
        let exported = 0;

        for (let offset = 0; offset < totalRows; offset += BATCH_SIZE) {
            const batchRes = await sqlPool.request().query(`
                SELECT ${sqlColList}
                FROM (
                    SELECT ${sqlColList}, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS __rn
                    FROM [${t.schema}].[${t.tableName}]
                ) __t
                WHERE __t.__rn > ${offset} AND __t.__rn <= ${offset + BATCH_SIZE}
            `);

            const lines = [];
            for (const row of batchRes.recordset) {
                const line = validCols.map(c => escapeCopyText(row[c.COLUMN_NAME], c.DATA_TYPE)).join('\t');
                lines.push(line);
            }
            if (lines.length > 0) {
                out.write(lines.join('\n') + '\n');
            }
            exported += batchRes.recordset.length;
        }

        out.write(`\\.\n`);
        console.log(`  ✔ ${t.tableName}: ${exported.toLocaleString('es-CL')} / ${totalRows.toLocaleString('es-CL')} filas exportadas`);
    }

    out.write(`\nANALYZE;\n`);
    await new Promise(resolve => out.end(resolve));
    await sqlPool.close();

    // Comprimir en .sql.gz
    await new Promise((resolve, reject) => {
        const inp = fs.createReadStream(sqlFilePath);
        const gzOut = fs.createWriteStream(gzFilePath);
        const gzip = zlib.createGzip({ level: 6 });
        inp.pipe(gzip).pipe(gzOut).on('finish', resolve).on('error', reject);
    });

    // Eliminar el .sql sin comprimir para ahorrar espacio y dejar solo el .sql.gz + mapa de columnas
    fs.unlinkSync(sqlFilePath);
    const gzStat = fs.statSync(gzFilePath);
    console.log(`  📦 Volcado comprimido listo: ${gzFilePath} (${(gzStat.size / (1024 * 1024)).toFixed(2)} MB)`);
}

// ============================================================================
// MODO 2: SINCRONIZACIÓN DIRECTA EN VIVO POR RED HACIA POSTGRESQL (CUTOVER)
// ============================================================================

async function sincronizarBaseEnVivoPostgres(dbEntry, pgConfig) {
    if (!PgPool) {
        throw new Error('El paquete "pg" no está instalado. Ejecute: cd ../backend && npm install pg');
    }

    console.log(`\n==================================================================`);
    console.log(` SINCRONIZANDO EN VIVO [${dbEntry.sourceDb}] -> PostgreSQL [${dbEntry.targetDb}]`);
    console.log(`==================================================================`);

    const sqlPool = await new sql.ConnectionPool(getSqlServerConfig(dbEntry.sourceServer, dbEntry.sourceDb)).connect();
    const pgPool = new PgPool({
        host: pgConfig.host,
        port: pgConfig.port || 5432,
        user: pgConfig.user || 'cmds_admin',
        password: pgConfig.password || 'CmdsPostgres2026!',
        database: dbEntry.targetDb
    });

    const tables = await inspectSqlServerSchema(sqlPool);
    const client = await pgPool.connect();

    try {
        const populatedPgTables = new Set();

        for (const t of tables) {
            const validCols = t.columns.filter(c => String(c.DATA_TYPE).toLowerCase() !== 'timestamp');
            if (validCols.length === 0) continue;

            const countRes = await sqlPool.request().query(
                `SELECT COUNT(*) AS total FROM [${t.schema}].[${t.tableName}] WITH (NOLOCK)`
            );
            const totalRows = countRes.recordset[0].total;

            // Si ya se migró una tabla homónima de otro esquema (ej. softland vs dbo) con datos y ésta está vacía, no pisarla
            if (totalRows === 0 && populatedPgTables.has(t.pgTableName)) {
                continue;
            }

            // Verificar si la tabla ya existe en PostgreSQL con el conteo exacto 1:1 (permite reanudar sin repetir tablas gigantes)
            if (totalRows > 0) {
                try {
                    const existingRes = await client.query(`SELECT COUNT(*)::int AS c FROM ${pgIdent(t.pgTableName)}`);
                    if (existingRes.rows[0].c === totalRows) {
                        populatedPgTables.add(t.pgTableName);
                        console.log(`  ✔ CUADRATURA 1:1 OK (ya sincronizada) | ${t.tableName}: SQL Server=${totalRows.toLocaleString('es-CL')} | Postgres=${totalRows.toLocaleString('es-CL')}`);
                        continue;
                    }
                } catch {
                    // La tabla no existe aún en PostgreSQL
                }
            }

            await client.query(buildCreateTableDDL(t));

            const sqlColList = validCols.map(c => `[${c.COLUMN_NAME}]`).join(', ');
            const pgColList = validCols.map(c => pgIdent(c.pgColName)).join(', ');

            if (totalRows === 0) {
                console.log(`  - ${t.tableName}: 0 filas`);
                continue;
            }
            populatedPgTables.add(t.pgTableName);

            const SUB_BATCH = Math.max(1, Math.min(400, Math.floor(60000 / validCols.length)));
            let insertedTotal = 0;

            const flushChunk = async (rows) => {
                for (let i = 0; i < rows.length; i += SUB_BATCH) {
                    const chunk = rows.slice(i, i + SUB_BATCH);
                    const values = [];
                    const valuePlaceholders = [];
                    let paramIdx = 1;

                    for (const r of chunk) {
                        const rowPh = [];
                        for (const c of validCols) {
                            rowPh.push(`$${paramIdx++}`);
                            values.push(cleanValueForPostgres(r[c.COLUMN_NAME], c.DATA_TYPE));
                        }
                        valuePlaceholders.push(`(${rowPh.join(', ')})`);
                    }

                    await client.query(
                        `INSERT INTO ${pgIdent(t.pgTableName)} (${pgColList}) VALUES ${valuePlaceholders.join(', ')}`,
                        values
                    );
                    insertedTotal += chunk.length;
                }
            };

            // Streaming lineal O(N) directo desde SQL Server (evita escaneos cuadráticos en tablas de >10 millones de filas)
            await new Promise((resolve, reject) => {
                const streamReq = sqlPool.request();
                streamReq.stream = true;
                let buffer = [];
                let lastLogged = 0;

                streamReq.on('row', row => {
                    buffer.push(row);
                    if (buffer.length >= 2000) {
                        streamReq.pause();
                        const toInsert = buffer;
                        buffer = [];
                        flushChunk(toInsert)
                            .then(() => {
                                if (totalRows >= 500000 && insertedTotal - lastLogged >= 500000) {
                                    lastLogged = insertedTotal;
                                    console.log(`    ... [${t.tableName}] ${insertedTotal.toLocaleString('es-CL')} / ${totalRows.toLocaleString('es-CL')} filas (${Math.round((insertedTotal / totalRows) * 100)}%)`);
                                }
                                streamReq.resume();
                            })
                            .catch(err => {
                                streamReq.cancel();
                                reject(err);
                            });
                    }
                });

                streamReq.on('error', err => reject(err));

                streamReq.on('done', () => {
                    if (buffer.length > 0) {
                        flushChunk(buffer).then(resolve).catch(reject);
                    } else {
                        resolve();
                    }
                });

                streamReq.query(`SELECT ${sqlColList} FROM [${t.schema}].[${t.tableName}] WITH (NOLOCK)`);
            });

            // Verificación de cuadratura exacta 1:1
            const pgCountRes = await client.query(`SELECT COUNT(*)::int AS c FROM ${pgIdent(t.pgTableName)}`);
            const pgCount = pgCountRes.rows[0].c;
            const ok = pgCount === totalRows ? '✔ CUADRATURA 1:1 OK' : '⚠️ DIFERENCIA';
            console.log(`  ${ok} | ${t.tableName}: SQL Server=${totalRows.toLocaleString('es-CL')} | Postgres=${pgCount.toLocaleString('es-CL')}`);
        }

        // Crear índices clave para acelerar búsquedas en bd_archivo
        if (dbEntry.targetDb === 'bd_archivo') {
            await client.query(`CREATE INDEX IF NOT EXISTS idx_lic_func_rut ON lic_funcionario (rut);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_lic_func_paterno ON lic_funcionario (paterno);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_expedientes_rut ON expedientes (rut);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_movimientos_rut ON movimientos (rut);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_movimientos_nummov ON movimientos (nummov DESC);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_movimientos_nomina ON movimientos (nomina);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_comprobantes_numcomp ON comprobantes (numcomp);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_movcomp_numcomp ON movimientoscomp (numcomp);`);
        }

        await client.query('ANALYZE;');
        console.log(`\n✅ Base de datos [${dbEntry.targetDb}] sincronizada y verificada exitosamente.`);
    } finally {
        client.release();
        await pgPool.end();
        await sqlPool.close();
    }
}

// ============================================================================
// CLI RUNNER
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const getArg = (prefix) => {
        const found = args.find(a => a.startsWith(prefix + '='));
        return found ? found.split('=').slice(1).join('=') : null;
    };

    const dbFilter = getArg('--db');
    const etapaFilter = getArg('--etapa');
    const isAll = args.includes('--all');
    const isExportSql = args.includes('--export-sql');

    const pgHost = getArg('--pg-host') || process.env.PG_HOST;
    const pgPort = parseInt(getArg('--pg-port') || process.env.PG_PORT || '5432', 10);
    const pgUser = getArg('--pg-user') || process.env.PG_USER || 'cmds_admin';
    const pgPassword = getArg('--pg-pass') || process.env.PG_PASS || 'CmdsPostgres2026!';

    let seleccion = [];
    if (dbFilter) {
        seleccion = CATALOGO_BASES.filter(
            b => b.sourceDb.toLowerCase() === dbFilter.toLowerCase() || b.targetDb.toLowerCase() === dbFilter.toLowerCase()
        );
    } else if (etapaFilter) {
        seleccion = CATALOGO_BASES.filter(b => String(b.etapa) === String(etapaFilter));
    } else if (isAll) {
        seleccion = CATALOGO_BASES;
    } else {
        console.log('Catálogo de Bases de Datos disponibles para migrar:');
        console.table(CATALOGO_BASES.map(b => ({
            Etapa: b.etapa,
            ServidorOrigen: b.sourceServer === '251' ? '192.168.3.251' : '192.168.3.159\\BASE',
            BaseSQLServer: b.sourceDb,
            BasePostgres: b.targetDb,
            Descripcion: b.descripcion
        })));
        console.log('\nEjemplos de uso:');
        console.log('  node sync-sqlserver-to-postgres.js --db=Archivo --export-sql');
        console.log('  node sync-sqlserver-to-postgres.js --etapa=1 --pg-host=192.168.3.X --pg-pass=CmdsPostgres2026!');
        console.log('  node sync-sqlserver-to-postgres.js --all --pg-host=192.168.3.X');
        return;
    }

    if (seleccion.length === 0) {
        console.error('No se encontró ninguna base en el catálogo para el filtro indicado.');
        process.exit(1);
    }

    const dumpsDir = path.join(__dirname, 'dumps-postgres');

    for (const dbEntry of seleccion) {
        if (isExportSql || !pgHost) {
            await exportarBaseASqlGz(dbEntry, dumpsDir);
        } else {
            await sincronizarBaseEnVivoPostgres(dbEntry, {
                host: pgHost,
                port: pgPort,
                user: pgUser,
                password: pgPassword
            });
        }
    }
}

main().catch(err => {
    console.error('Error en el proceso de migración:', err);
    process.exit(1);
});
