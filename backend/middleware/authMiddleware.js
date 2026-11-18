const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sql, poolPromise } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'cmds_archivo_expedientes_secret_key_2026';
const BCRYPT_ROUNDS = 12;

const userStatusCache = new Map();
const USER_CACHE_TTL_MS = 15 * 1000;

const loginFailuresByIp = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES_PER_IP = 15;

const apiRequestsByIp = new Map();
const API_WINDOW_MS = 60 * 1000;
const MAX_API_REQ_PER_MIN = 350;

function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    const xReal = req.headers['x-real-ip'];
    if (xReal) return String(xReal).trim();
    return String(req.ip || req.socket?.remoteAddress || 'desconocida').replace(/^::ffff:/, '');
}

function invalidateUserCache(username) {
    if (!username) {
        userStatusCache.clear();
        return;
    }
    userStatusCache.delete(String(username).trim().toLowerCase());
}

function securityHeadersMiddleware(req, res, next) {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}

function apiRateLimiter(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    let entry = apiRequestsByIp.get(ip);
    if (!entry || now > entry.resetAt) {
        entry = { count: 1, resetAt: now + API_WINDOW_MS };
        apiRequestsByIp.set(ip, entry);
        return next();
    }
    entry.count += 1;
    if (entry.count > MAX_API_REQ_PER_MIN) {
        return res.status(429).json({
            status: 'error',
            message: 'Demasiadas solicitudes desde su dirección IP. Por favor aguarde un minuto.'
        });
    }
    next();
}

function checkLoginIpRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = loginFailuresByIp.get(ip);
    if (entry && now < entry.resetAt && entry.failures >= MAX_LOGIN_FAILURES_PER_IP) {
        const minsLeft = Math.max(1, Math.ceil((entry.resetAt - now) / 60000));
        return res.status(429).json({
            status: 'error',
            message: `Demasiados intentos fallidos desde esta dirección IP (${ip}). Intente nuevamente en ${minsLeft} minutos.`
        });
    }
    next();
}

function recordLoginIpResult(req, success) {
    const ip = getClientIp(req);
    if (success) {
        loginFailuresByIp.delete(ip);
        return;
    }
    const now = Date.now();
    let entry = loginFailuresByIp.get(ip);
    if (!entry || now > entry.resetAt) {
        entry = { failures: 1, resetAt: now + LOGIN_WINDOW_MS };
    } else {
        entry.failures += 1;
    }
    loginFailuresByIp.set(ip, entry);
}

async function registrarAuditoriaAcceso(pool, { usuario, evento, detalle = '', req = null, exitoso = true }) {
    try {
        const ip = req ? getClientIp(req) : 'sistema';
        const ua = req ? String(req.headers['user-agent'] || '').slice(0, 290) : 'sistema';
        const userClean = String(usuario || 'desconocido').trim().slice(0, 48);
        const evClean = String(evento || 'EVENTO').trim().slice(0, 48);
        const detClean = String(detalle || '').trim().slice(0, 490);
        const exInt = exitoso ? 1 : 0;

        await pool
            .request()
            .input('Usuario', sql.NVarChar, userClean)
            .input('Evento', sql.NVarChar, evClean)
            .input('Detalle', sql.NVarChar, detClean)
            .input('IpOrigen', sql.NVarChar, ip)
            .input('UserAgent', sql.NVarChar, ua)
            .input('Exitoso', sql.Int, exInt)
            .query(`
                INSERT INTO LIC_AUDITORIA_ACCESOS (FechaHora, Usuario, Evento, Detalle, IpOrigen, UserAgent, Exitoso)
                VALUES (GETDATE(), @Usuario, @Evento, @Detalle, @IpOrigen, @UserAgent, @Exitoso)
            `);
    } catch (err) {
        console.warn('[AUDITORIA ARCHIVO] No se pudo registrar evento:', err.message);
    }
}

async function ensureSecuritySchema(pool) {
    try {
        const msPool = pool.mssqlPool || (pool.config ? pool : null);
        const pgPool = pool.pgPool || null;

        if (msPool) {
            await msPool.request().query(`
                IF COL_LENGTH('dbo.LIC_USUARIO', 'PasswordHash') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD PasswordHash NVARCHAR(255) NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'Email') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD Email NVARCHAR(120) NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'Rut') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD Rut NVARCHAR(20) NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'Tipo') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD Tipo NVARCHAR(20) NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'Unidad') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD Unidad NVARCHAR(120) NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'Activo') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD Activo INT NOT NULL CONSTRAINT DF_LIC_USUARIO_Activo DEFAULT(1);
                IF COL_LENGTH('dbo.LIC_USUARIO', 'DebeCambiarClave') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD DebeCambiarClave INT NOT NULL CONSTRAINT DF_LIC_USUARIO_DebeCambiar DEFAULT(0);
                IF COL_LENGTH('dbo.LIC_USUARIO', 'IntentosFallidos') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD IntentosFallidos INT NOT NULL CONSTRAINT DF_LIC_USUARIO_Intentos DEFAULT(0);
                IF COL_LENGTH('dbo.LIC_USUARIO', 'BloqueadoHasta') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD BloqueadoHasta DATETIME NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'UltimoAcceso') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD UltimoAcceso DATETIME NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'UltimoCambioClave') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD UltimoCambioClave DATETIME NULL;
                IF COL_LENGTH('dbo.LIC_USUARIO', 'FechaCreacion') IS NULL
                    ALTER TABLE dbo.LIC_USUARIO ADD FechaCreacion DATETIME NULL CONSTRAINT DF_LIC_USUARIO_FechaCreacion DEFAULT(GETDATE());

                IF OBJECT_ID('dbo.LIC_AUDITORIA_ACCESOS', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.LIC_AUDITORIA_ACCESOS (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        FechaHora DATETIME NOT NULL DEFAULT GETDATE(),
                        Usuario NVARCHAR(50) NOT NULL,
                        Evento NVARCHAR(50) NOT NULL,
                        Detalle NVARCHAR(500) NULL,
                        IpOrigen NVARCHAR(80) NULL,
                        UserAgent NVARCHAR(300) NULL,
                        Exitoso INT NOT NULL DEFAULT 1
                    );
                END
            `);
        }

        if (pgPool) {
            await pgPool.query(`
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS passwordhash VARCHAR(255) NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS email VARCHAR(120) NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS rut VARCHAR(20) NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS unidad VARCHAR(120) NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS activo INT NOT NULL DEFAULT 1;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS debecambiarclave INT NOT NULL DEFAULT 0;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS intentosfallidos INT NOT NULL DEFAULT 0;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS bloqueadohasta TIMESTAMP NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS ultimoacceso TIMESTAMP NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS ultimocambioclave TIMESTAMP NULL;
                ALTER TABLE lic_usuario ADD COLUMN IF NOT EXISTS fechacreacion TIMESTAMP NULL DEFAULT NOW();

                CREATE TABLE IF NOT EXISTS lic_auditoria_accesos (
                    id SERIAL PRIMARY KEY,
                    fechahora TIMESTAMP NOT NULL DEFAULT NOW(),
                    usuario VARCHAR(50) NOT NULL,
                    evento VARCHAR(50) NOT NULL,
                    detalle VARCHAR(500) NULL,
                    iporigen VARCHAR(80) NULL,
                    useragent VARCHAR(300) NULL,
                    exitoso INT NOT NULL DEFAULT 1
                );
            `);
        }

        // Asegurar que la cuenta histórica 'admin' ('archivo') exista en LIC_USUARIO para poder administrarla desde el Mantenedor
        const adminCheck = await pool
            .request()
            .query(`SELECT TOP 1 Usuario FROM LIC_USUARIO WHERE LOWER(LTRIM(RTRIM(Usuario))) = 'admin'`);
        if (!adminCheck.recordset || adminCheck.recordset.length === 0) {
            const adminHash = await bcrypt.hash('archivo', BCRYPT_ROUNDS);
            await pool
                .request()
                .input('Hash', sql.NVarChar, adminHash)
                .query(`
                    INSERT INTO LIC_USUARIO (
                        Usuario, Password, nombreUsuario, PasswordHash, Tipo, Unidad,
                        Activo, DebeCambiarClave, IntentosFallidos, FechaCreacion
                    )
                    VALUES (
                        'admin', 'archivo', 'Administrador de Archivo CMDS', @Hash, 'A', 'cmds',
                        1, 0, 0, GETDATE()
                    )
                `);
        }

        // Hashear con Bcrypt cuentas existentes en LIC_USUARIO que aún no tengan PasswordHash
        const usersRes = await pool.request().query(`
            SELECT
                LTRIM(RTRIM(Usuario)) AS Usuario,
                LTRIM(RTRIM(ISNULL(Password, ''))) AS Clave,
                LTRIM(RTRIM(ISNULL(PasswordHash, ''))) AS PasswordHash,
                LTRIM(RTRIM(ISNULL(Tipo, ''))) AS Tipo,
                LTRIM(RTRIM(ISNULL(Unidad, ''))) AS Unidad
            FROM LIC_USUARIO
            WHERE Usuario IS NOT NULL AND LTRIM(RTRIM(Usuario)) <> ''
        `);

        let migrados = 0;
        for (const row of usersRes.recordset || []) {
            const uLower = row.Usuario.toLowerCase();
            const defaultTipo = row.Tipo || (['admin', 'master', 'adorador'].includes(uLower) ? 'A' : uLower === 'usuario' ? 'U' : 'O');
            const defaultUnidad = row.Unidad || 'cmds';

            if (!row.PasswordHash && row.Clave) {
                const hash = await bcrypt.hash(row.Clave, BCRYPT_ROUNDS);
                await pool
                    .request()
                    .input('Hash', sql.NVarChar, hash)
                    .input('Tipo', sql.NVarChar, defaultTipo)
                    .input('Unidad', sql.NVarChar, defaultUnidad)
                    .input('User', sql.NVarChar, row.Usuario)
                    .query(`
                        UPDATE LIC_USUARIO
                        SET PasswordHash = @Hash,
                            Tipo = @Tipo,
                            Unidad = @Unidad,
                            Activo = COALESCE(Activo, 1),
                            DebeCambiarClave = COALESCE(DebeCambiarClave, 0),
                            IntentosFallidos = COALESCE(IntentosFallidos, 0),
                            FechaCreacion = COALESCE(FechaCreacion, GETDATE())
                        WHERE LOWER(LTRIM(RTRIM(Usuario))) = LOWER(@User)
                    `);
                migrados++;
            } else if (!row.Tipo || !row.Unidad) {
                await pool
                    .request()
                    .input('Tipo', sql.NVarChar, defaultTipo)
                    .input('Unidad', sql.NVarChar, defaultUnidad)
                    .input('User', sql.NVarChar, row.Usuario)
                    .query(`
                        UPDATE LIC_USUARIO
                        SET Tipo = @Tipo,
                            Unidad = @Unidad
                        WHERE LOWER(LTRIM(RTRIM(Usuario))) = LOWER(@User)
                    `);
            }
        }

        if (migrados > 0) {
            console.log(`[SEGURIDAD ARCHIVO] Se generaron hashes Bcrypt (12 rondas) para ${migrados} usuarios.`);
        }
    } catch (err) {
        console.error('[SEGURIDAD ARCHIVO] Error verificando esquema:', err.message);
    }
}

function isUserAdmin(tipoRaw) {
    const t = String(tipoRaw || '').trim().toUpperCase();
    return t === 'A' || t === 'ADMINISTRADOR';
}

async function authenticateJWT(req, res, next) {
    try {
        let token = null;
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (authHeader && String(authHeader).startsWith('Bearer ')) {
            token = String(authHeader).slice(7).trim();
        } else if (req.query && req.query.token) {
            token = String(req.query.token).trim();
        }

        if (!token) {
            return res.status(401).json({
                status: 'error',
                code: 'NO_TOKEN',
                message: 'Sesión no autenticada. Por favor inicie sesión.'
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({
                status: 'error',
                code: 'INVALID_TOKEN',
                message: 'Su sesión ha expirado o no es válida. Por favor inicie sesión nuevamente.'
            });
        }

        const usernameKey = String(decoded.username || '').trim().toLowerCase();
        if (!usernameKey) {
            return res.status(401).json({ status: 'error', message: 'Token de usuario inválido.' });
        }

        const now = Date.now();
        let cached = userStatusCache.get(usernameKey);
        if (!cached || now > cached.expiresAt) {
            const pool = await poolPromise;
            const dbRes = await pool
                .request()
                .input('u', sql.NVarChar, String(decoded.username).trim())
                .query(`
                    SELECT
                        LTRIM(RTRIM(Usuario)) AS Usuario,
                        LTRIM(RTRIM(ISNULL(Tipo, 'O'))) AS Tipo,
                        LTRIM(RTRIM(ISNULL(Unidad, 'cmds'))) AS Unidad,
                        LTRIM(RTRIM(ISNULL(nombreUsuario, ''))) AS NombreCompleto,
                        ISNULL(Activo, 1) AS Activo,
                        ISNULL(DebeCambiarClave, 0) AS DebeCambiarClave
                    FROM LIC_USUARIO
                    WHERE LOWER(LTRIM(RTRIM(Usuario))) = LOWER(@u)
                `);

            if (!dbRes.recordset || dbRes.recordset.length === 0) {
                return res.status(401).json({
                    status: 'error',
                    code: 'USER_NOT_FOUND',
                    message: 'La cuenta de usuario ya no existe.'
                });
            }

            const uRow = dbRes.recordset[0];
            const tipoCode = String(uRow.Tipo || (['admin', 'master'].includes(usernameKey) ? 'A' : 'O')).trim().toUpperCase();
            cached = {
                username: uRow.Usuario,
                tipo: tipoCode,
                role: tipoCode === 'A' ? 'Administrador' : tipoCode === 'U' ? 'Consulta' : 'Operador Archivo',
                unidad: uRow.Unidad || 'cmds',
                nombreCompleto: uRow.NombreCompleto || uRow.Usuario,
                activo: Number(uRow.Activo) === 1,
                debeCambiarClave: Number(uRow.DebeCambiarClave) === 1,
                expiresAt: now + USER_CACHE_TTL_MS
            };
            userStatusCache.set(usernameKey, cached);
        }

        if (!cached.activo) {
            return res.status(401).json({
                status: 'error',
                code: 'USER_SUSPENDED',
                message: 'Su cuenta de usuario se encuentra suspendida. Contacte al Administrador.'
            });
        }

        req.user = {
            username: cached.username,
            nombre: cached.nombreCompleto,
            nombreCompleto: cached.nombreCompleto,
            tipo: cached.tipo,
            role: cached.role,
            unidad: cached.unidad,
            debeCambiarClave: cached.debeCambiarClave
        };

        next();
    } catch (err) {
        console.error('[AUTH ARCHIVO] Error en authenticateJWT:', err.message);
        res.status(500).json({ status: 'error', message: 'Error interno verificando sesión.' });
    }
}

function requireRoles(...allowedRoles) {
    const normalizedAllowed = allowedRoles.map(r => String(r).trim().toUpperCase());
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ status: 'error', message: 'No autenticado.' });
        }
        const userRole = isUserAdmin(req.user.tipo || req.user.role) ? 'A' : String(req.user.tipo || 'O').trim().toUpperCase();
        if (userRole === 'A' || normalizedAllowed.includes(userRole)) {
            return next();
        }
        return res.status(403).json({
            status: 'error',
            code: 'FORBIDDEN_ROLE',
            message: `Su perfil (${req.user.role || req.user.tipo}) no cuenta con permisos para ejecutar esta operación.`
        });
    };
}

module.exports = {
    JWT_SECRET,
    BCRYPT_ROUNDS,
    getClientIp,
    invalidateUserCache,
    securityHeadersMiddleware,
    apiRateLimiter,
    checkLoginIpRateLimit,
    recordLoginIpResult,
    registrarAuditoriaAcceso,
    ensureSecuritySchema,
    authenticateJWT,
    requireRoles,
    isUserAdmin
};
