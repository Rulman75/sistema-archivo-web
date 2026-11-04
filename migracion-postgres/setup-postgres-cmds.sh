#!/usr/bin/env bash
# ==============================================================================
# APROVISIONAMIENTO AUTOMÁTICO — SERVIDOR DEDICADO POSTGRESQL INTERNO CMDS
# Reemplazo unificado para SQL Server 192.168.3.251 y 192.168.3.159\BASE
# ==============================================================================
# Uso en el nuevo servidor Linux:
#   chmod +x setup-postgres-cmds.sh
#   sudo ./setup-postgres-cmds.sh
# ==============================================================================

set -e

PG_USER_ADMIN="cmds_admin"
PG_PASS_ADMIN="${PG_PASS_ADMIN:-CmdsPostgres2026!}"
LAN_SUBNET="${LAN_SUBNET:-192.168.3.0/24}"
BACKUP_DIR="/var/backups/postgresql/cmds"

# Todas las bases de datos a crear en el servidor central PostgreSQL
DBS_ETAPA_1=(
  "bd_archivo"
  "bd_licencias"
  "bd_control_servicios"
  "bd_traspaso_slep"
)

DBS_ETAPA_2=(
  "bd_correspondencia"
  "bd_correspondencia_salud"
  "bd_correspondencia_archivo"
  "bd_boleta_honorarios"
  "bd_boleta_honorarios_educ"
  "bd_carrera_funcionaria"
  "bd_enti_corporativa"
  "bd_matriculas"
  "bd_sii_alumnos"
  "bd_encuestas"
  "bd_rem"
)

DBS_ETAPA_3=(
  "bd_control_horario"
  "bd_asistencia2"
  "bd_cmds2014"
  "bd_desoan1"
  "bd_corporacion_2016"
  "bd_farmacia"
  "bd_mermas_aps"
  "bd_gastos_convenios"
  "bd_rrhh_aps"
  "bd_cheques"
  "bd_varios"
)

ALL_DBS=("${DBS_ETAPA_1[@]}" "${DBS_ETAPA_2[@]}" "${DBS_ETAPA_3[@]}")

echo "=================================================================="
echo " 1. Instalando PostgreSQL y utilidades en el Servidor Dedicado"
echo "=================================================================="

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y postgresql postgresql-contrib gzip curl
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y postgresql-server postgresql-contrib gzip curl
  sudo postgresql-setup --initdb || true
fi

sudo systemctl enable --now postgresql

echo "=================================================================="
echo " 2. Configurando Red Interna (LAN ${LAN_SUBNET}) en PostgreSQL"
echo "=================================================================="

PG_CONF=$(sudo -u postgres psql -t -P format=unaligned -c "SHOW config_file;")
PG_HBA=$(sudo -u postgres psql -t -P format=unaligned -c "SHOW hba_file;")

echo " - Archivo postgresql.conf : ${PG_CONF}"
echo " - Archivo pg_hba.conf     : ${PG_HBA}"

# Habilitar escucha en interfaces de red local y optimizar memoria
sudo sed -i "s/^#*\s*listen_addresses\s*=.*/listen_addresses = '*'/" "${PG_CONF}"
sudo sed -i "s/^#*\s*max_connections\s*=.*/max_connections = 200/" "${PG_CONF}"

# Agregar regla para la subred interna de CMDS si no existe aún
if ! sudo grep -q "${LAN_SUBNET}" "${PG_HBA}"; then
  echo "" | sudo tee -a "${PG_HBA}" >/dev/null
  echo "# Acceso exclusivo Red Interna LAN CMDS (Sin exposición a Internet)" | sudo tee -a "${PG_HBA}" >/dev/null
  echo "host    all             all             ${LAN_SUBNET}           scram-sha-256" | sudo tee -a "${PG_HBA}" >/dev/null
  echo "host    all             all             10.0.0.0/8              scram-sha-256" | sudo tee -a "${PG_HBA}" >/dev/null
  echo "host    all             all             172.16.0.0/12           scram-sha-256" | sudo tee -a "${PG_HBA}" >/dev/null
fi

sudo systemctl restart postgresql

echo "=================================================================="
echo " 3. Creando Usuario Corporativo (${PG_USER_ADMIN}) y Bases de Datos"
echo "=================================================================="

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER_ADMIN}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${PG_USER_ADMIN} WITH SUPERUSER CREATEDB PASSWORD '${PG_PASS_ADMIN}';"

sudo -u postgres psql -c "ALTER USER ${PG_USER_ADMIN} WITH SUPERUSER CREATEDB PASSWORD '${PG_PASS_ADMIN}';"

for db in "${ALL_DBS[@]}"; do
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE ${db} OWNER ${PG_USER_ADMIN} ENCODING 'UTF8';"
  echo "   ✔ Base de datos lista: ${db}"
done

echo "=================================================================="
echo " 4. Configurando Firewall Local (Solo LAN ${LAN_SUBNET} -> 5432)"
echo "=================================================================="

if command -v ufw >/dev/null 2>&1; then
  if sudo ufw status | grep -q "Status: active"; then
    sudo ufw allow from "${LAN_SUBNET}" to any port 5432 proto tcp
    echo "   ✔ Regla UFW aplicada para ${LAN_SUBNET} -> 5432/tcp"
  fi
elif command -v firewall-cmd >/dev/null 2>&1; then
  if sudo systemctl is-active --quiet firewalld; then
    sudo firewall-cmd --permanent --add-rich-rule="rule family='ipv4' source address='${LAN_SUBNET}' port protocol='tcp' port='5432' accept"
    sudo firewall-cmd --reload
    echo "   ✔ Regla firewalld aplicada para ${LAN_SUBNET} -> 5432/tcp"
  fi
fi

echo "=================================================================="
echo " 5. Configurando Respaldo Automático Diario (02:00 AM)"
echo "=================================================================="

sudo mkdir -p "${BACKUP_DIR}"
sudo chown -R postgres:postgres "${BACKUP_DIR}"

sudo tee /usr/local/bin/backup-postgres-cmds.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -e
BACKUP_ROOT="/var/backups/postgresql/cmds"
DATE_TAG=$(date +"%Y-%m-%d_%H%M")
TARGET_DIR="${BACKUP_ROOT}/${DATE_TAG}"
mkdir -p "${TARGET_DIR}"

DBS=$(psql -U postgres -t -A -c "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres', 'template0', 'template1') ORDER BY datname;")

for db in ${DBS}; do
  pg_dump -U postgres -d "${db}" | gzip -6 > "${TARGET_DIR}/${db}.sql.gz"
done

# Conservar los últimos 14 días de respaldos comprimidos
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF

sudo chmod +x /usr/local/bin/backup-postgres-cmds.sh

sudo tee /etc/cron.d/backup-postgres-cmds >/dev/null <<'EOF'
0 2 * * * postgres /usr/local/bin/backup-postgres-cmds.sh >/var/log/backup-postgres-cmds.log 2>&1
EOF

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "${SCRIPT_DIR}/dumps-postgres" ]; then
  echo "=================================================================="
  echo " 6. Importando Dumps Iniciales detectados en ./dumps-postgres/"
  echo "=================================================================="
  for dump_file in "${SCRIPT_DIR}/dumps-postgres"/*.sql.gz; do
    [ -e "${dump_file}" ] || continue
    db_name=$(basename "${dump_file}" .sql.gz)
    echo "   -> Restaurando ${db_name} desde $(basename "${dump_file}")..."
    gunzip -c "${dump_file}" | sudo -u postgres psql -q -d "${db_name}"
    echo "   ✔ ${db_name} importada exitosamente"
  done
fi

IP_ACTUAL=$(hostname -I | awk '{print $1}')

echo "=================================================================="
echo " ¡SERVIDOR POSTGRESQL INTERNO CMDS LISTO!"
echo " - IP del Servidor PostgreSQL : ${IP_ACTUAL}"
echo " - Puerto                     : 5432 (Restringido a LAN interna)"
echo " - Usuario Administrador      : ${PG_USER_ADMIN}"
echo " - Contraseña                 : ${PG_PASS_ADMIN}"
echo " - Total Bases Creadas        : ${#ALL_DBS[@]} bases de datos"
echo " - Respaldos Automáticos      : ${BACKUP_DIR} (Diario 02:00 AM)"
echo "=================================================================="
