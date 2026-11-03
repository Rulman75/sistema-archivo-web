const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Conectado a SQL Server exitosamente (' + process.env.DB_SERVER + ' -> ' + process.env.DB_NAME + ')');
        return pool;
    })
    .catch(err => {
        console.error('Error de conexión a la Base de Datos: ', err);
        throw err;
    });

module.exports = {
    sql,
    poolPromise
};
