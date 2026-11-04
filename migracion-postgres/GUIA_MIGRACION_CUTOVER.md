# Guía de Aprovisionamiento y Traspaso Productivo (Cutover) a PostgreSQL Interno CMDS

Esta guía detalla paso a paso cómo levantar el **nuevo servidor dedicado de PostgreSQL 16 en la red interna (`192.168.3.x`)**, aislado de Internet, y cómo ejecutar la sincronización en caliente el día exacto del paso a producción sin perder ningún registro.

---

## 1. Levantar el Nuevo Servidor Linux PostgreSQL Dedicado

En la nueva máquina virtual Linux (Ubuntu 22.04 / 24.04 LTS o Debian 12) conectada a la red interna `192.168.3.x`:

```bash
# 1. Clonar el repositorio que incluye el kit de migración y los dumps iniciales
git clone https://github.com/Rulman75/sistema-archivo-web.git
cd sistema-archivo-web/migracion-postgres

# 2. Dar permisos de ejecución y correr el instalador automático
chmod +x setup-postgres-cmds.sh
sudo ./setup-postgres-cmds.sh
```

### ¿Qué deja configurado automáticamente `setup-postgres-cmds.sh`?
- **Motor**: PostgreSQL 16 escuchando en el puerto `5432`.
- **Seguridad de Red (`pg_hba.conf` + Firewall)**: Acceso permitido **únicamente** desde la red interna `192.168.3.0/24` (sin exposición a Internet).
- **Credenciales Corporativas**:
  - **Usuario**: `cmds_admin`
  - **Contraseña**: `CmdsPostgres2026!` (personalizable exportando `PG_PASS_ADMIN` antes de ejecutar el script).
- **26 Bases de Datos Creadas (`UTF-8`)**:
  - **Etapa 1 (Sistemas Web Productivos)**: `bd_archivo`, `bd_licencias`, `bd_control_servicios`, `bd_traspaso_slep`.
  - **Etapa 2 (Sistemas Departamentales)**: `bd_correspondencia`, `bd_correspondencia_salud`, `bd_correspondencia_archivo`, `bd_boleta_honorarios`, `bd_boleta_honorarios_educ`, `bd_carrera_funcionaria`, `bd_enti_corporativa`, `bd_matriculas`, `bd_sii_alumnos`, `bd_encuestas`, `bd_rem`.
  - **Etapa 3 (Bóveda Histórica)**: `bd_control_horario`, `bd_asistencia2`, `bd_cmds2014`, `bd_desoan1`, `bd_corporacion_2016`, `bd_farmacia`, `bd_mermas_aps`, `bd_gastos_convenios`, `bd_rrhh_aps`, `bd_cheques`, `bd_varios`.
- **Importación Automática Inicial**: Si en la carpeta `./dumps-postgres/` existen archivos `.sql.gz` pre-generados (`bd_archivo.sql.gz`, `bd_control_servicios.sql.gz`, `bd_traspaso_slep.sql.gz`), los restaura automáticamente.
- **Respaldo Automático Diario**: Configura `/usr/local/bin/backup-postgres-cmds.sh` todos los días a las **02:00 AM** en `/var/backups/postgresql/cmds/` con retención de 14 días.

---

## 2. Sincronizar en Caliente desde SQL Server (`.251` y `.159\BASE`) hacia PostgreSQL

El script [`sync-sqlserver-to-postgres.js`](./sync-sqlserver-to-postgres.js) es **idempotente y re-ejecutable**: puede correrse tantas veces como se desee (para pruebas previas o el día definitivo del corte productivo).

### Comandos de uso (desde cualquier equipo o servidor en la red `192.168.3.x`):

```bash
cd migracion-postgres
npm install
```

- **Sincronizar las 4 bases de la Etapa 1 directo al nuevo PostgreSQL** (reemplaza `192.168.3.250` por la IP real del nuevo servidor PostgreSQL):
  ```bash
  node sync-sqlserver-to-postgres.js --etapa=1 --pg-host=192.168.3.250
  ```
- **Sincronizar una sola base de datos específica en segundos** (ideal para el día del corte productivo de un sistema):
  ```bash
  # Sistema de Archivo y Expedientes (demora ~12 segundos)
  node sync-sqlserver-to-postgres.js --db=Archivo --pg-host=192.168.3.250

  # Sistema de Control de Consumos Básicos (demora ~10 segundos)
  node sync-sqlserver-to-postgres.js --db=ControlServicios --pg-host=192.168.3.250

  # Sistema de Licencias Médicas (demora ~90 segundos)
  node sync-sqlserver-to-postgres.js --db=BDLicencias --pg-host=192.168.3.250

  # Sistema Traspaso SLEP (demora ~5 segundos)
  node sync-sqlserver-to-postgres.js --db=TraspasoSlep --pg-host=192.168.3.250
  ```
- **Sincronizar Etapa 2 o Etapa 3 completas**:
  ```bash
  node sync-sqlserver-to-postgres.js --etapa=2 --pg-host=192.168.3.250
  node sync-sqlserver-to-postgres.js --etapa=3 --pg-host=192.168.3.250
  ```

---

## 3. Protocolo de Corte Productivo ("Zero-Data-Loss Cutover" en 3 Minutos)

Como los sistemas actuales siguen recibiendo datos en SQL Server hasta el momento exacto del cambio, **el día y minuto en que pases un sistema a producción con PostgreSQL** sigue estos 4 pasos:

### Paso 1: Congelar escritura en el sistema antiguo (30 segundos)
- Si estás reemplazando el sistema de escritorio antiguo (`Archivo.exe` o `ControlServicios.exe`), solicita a los operadores cerrar la aplicación y deja la base en SQL Server en modo lectura para evitar ingresos tardíos:
  ```sql
  -- Opcional en SQL Server Management Studio para bloquear escritura en el sistema viejo:
  ALTER DATABASE [Archivo] SET READ_ONLY WITH ROLLBACK IMMEDIATE;
  ```
- Si es un sistema web que ya corre en `srvcmdslm01` con PM2:
  ```bash
  pm2 stop archivo-web
  ```

### Paso 2: Ejecutar la Sincronización Final Delta (15 a 90 segundos)
Ejecuta el sincronizador apuntando a la base correspondiente. Esto copiará hasta el último registro ingresado hace 1 segundo y verificará que el conteo de filas (`COUNT(*)`) sea 100% idéntico entre SQL Server y PostgreSQL:
```bash
node sync-sqlserver-to-postgres.js --db=Archivo --pg-host=192.168.3.250
```

### Paso 3: Cambiar `DB_ENGINE=postgres` en el `.env` del Backend (15 segundos)
Los 4 sistemas de la Etapa 1 (`update-sistema-archivo`, `update-sistema-control-consumo`, `licencias-medicas-web`, `sistema-traspaso-slep`) ya cuentan con el **Adaptador Dual-Engine (`mssql` + `pg`)** en su archivo `backend/db.js`. Solo debes editar `backend/.env`:

```env
DB_ENGINE=postgres
PG_HOST=192.168.3.250
PG_PORT=5432
PG_USER=cmds_admin
PG_PASS=CmdsPostgres2026!
PG_DB=bd_archivo
```

### Paso 4: Iniciar el servicio en PM2 y verificar `/api/health` (15 segundos)
```bash
pm2 restart archivo-web
curl http://localhost:3002/api/health
```
¡Listo! El sistema queda operando 100% sobre el nuevo servidor PostgreSQL interno con exactamente la misma información del instante del corte.
