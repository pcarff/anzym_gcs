#!/bin/bash
# ==============================================================================
# ANZYM Ground Control System — Full Stack Startup Script
# Brings all services online: infrastructure (Docker), backend, frontend.
#
# Usage:
#   ./start_gcs.sh          Start everything (default)
#   ./start_gcs.sh --stop   Stop all services
#   ./start_gcs.sh --status Check service status
# ==============================================================================

set -e

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"
BACKEND_VENV="${BACKEND_DIR}/.venv"
BACKEND_PID_FILE="${SCRIPT_DIR}/.backend.pid"
FRONTEND_PID_FILE="${SCRIPT_DIR}/.frontend.pid"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[  OK]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[FAIL]${NC}  $1"; }
step()    { echo -e "${CYAN}${BOLD}──▸${NC} $1"; }

banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║        ANZYM Ground Control System               ║"
    echo "║        Full Stack Startup                        ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ── Stop all services ─────────────────────────────────────────────────────────
stop_services() {
    echo -e "\n${YELLOW}${BOLD}Stopping all GCS services...${NC}\n"

    # Stop backend
    if [ -f "${BACKEND_PID_FILE}" ]; then
        BACKEND_PID=$(cat "${BACKEND_PID_FILE}")
        if kill -0 "${BACKEND_PID}" 2>/dev/null; then
            kill "${BACKEND_PID}" 2>/dev/null || true
            pkill -P "${BACKEND_PID}" 2>/dev/null || true
            success "Backend stopped (PID ${BACKEND_PID})"
        fi
        rm -f "${BACKEND_PID_FILE}"
    fi
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    fuser -k 8000/tcp 2>/dev/null || true

    # Stop frontend
    if [ -f "${FRONTEND_PID_FILE}" ]; then
        FRONTEND_PID=$(cat "${FRONTEND_PID_FILE}")
        if kill -0 "${FRONTEND_PID}" 2>/dev/null; then
            kill "${FRONTEND_PID}" 2>/dev/null || true
            pkill -P "${FRONTEND_PID}" 2>/dev/null || true
            success "Frontend stopped (PID ${FRONTEND_PID})"
        fi
        rm -f "${FRONTEND_PID_FILE}"
    fi
    pkill -f "vite" 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true

    # Stop Docker infrastructure
    step "Stopping Docker infrastructure..."
    cd "${SCRIPT_DIR}"
    docker compose down 2>/dev/null && success "Docker containers stopped" || warn "Docker compose down failed"

    echo -e "\n${GREEN}All services stopped.${NC}\n"
}

# ── Status check ──────────────────────────────────────────────────────────────
check_status() {
    echo -e "\n${CYAN}${BOLD}ANZYM GCS Service Status${NC}\n"

    # Docker infrastructure
    echo -e "${BOLD}Infrastructure (Docker):${NC}"
    for svc in postgres redis influxdb minio; do
        CONTAINER="gcs-${svc}"
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; then
            STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo "running")
            success "  ${svc}: running (${STATUS})"
        else
            error "  ${svc}: not running"
        fi
    done

    # Backend
    echo -e "\n${BOLD}Backend (FastAPI):${NC}"
    if [ -f "${BACKEND_PID_FILE}" ] && kill -0 "$(cat "${BACKEND_PID_FILE}")" 2>/dev/null; then
        success "  uvicorn: running (PID $(cat "${BACKEND_PID_FILE}"))"
        # Health check
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")
        if [ "${HTTP_CODE}" = "200" ]; then
            success "  health: OK"
        else
            warn "  health: HTTP ${HTTP_CODE}"
        fi
    else
        error "  uvicorn: not running"
    fi

    # Frontend
    echo -e "\n${BOLD}Frontend (Vite):${NC}"
    if [ -f "${FRONTEND_PID_FILE}" ] && kill -0 "$(cat "${FRONTEND_PID_FILE}")" 2>/dev/null; then
        success "  vite: running (PID $(cat "${FRONTEND_PID_FILE}"))"
    else
        error "  vite: not running"
    fi

    # Robot connection
    echo -e "\n${BOLD}Robot Fleet:${NC}"
    ROBOTS=$(curl -s http://localhost:8000/api/robots 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "${ROBOTS}" ] && [ "${ROBOTS}" != "[]" ]; then
        echo "${ROBOTS}" | python3 -c "
import json, sys
robots = json.load(sys.stdin)
for r in robots:
    status = r.get('status', 'UNKNOWN')
    name = r.get('name', r.get('id', '?'))
    conn = '✓' if r.get('is_connected') else '✗'
    color = '\033[0;32m' if status == 'ONLINE' else '\033[0;31m'
    print(f'  {color}[{conn}]\033[0m  {name}: {status}')
" 2>/dev/null || warn "  Could not parse robot data"
    else
        warn "  No robots registered or backend unreachable"
    fi

    echo ""
}

# ── Main startup ──────────────────────────────────────────────────────────────
start_services() {
    banner

    # ── 1. Docker Infrastructure ──────────────────────────────────────────
    step "Starting Docker infrastructure (Postgres, Redis, InfluxDB, MinIO)..."
    cd "${SCRIPT_DIR}"
    docker compose up -d postgres redis influxdb minio 2>&1 | grep -E "(Started|Creating|Error)" || true

    # Wait for health checks
    info "Waiting for services to be healthy..."
    RETRIES=0
    MAX_RETRIES=30
    while [ ${RETRIES} -lt ${MAX_RETRIES} ]; do
        PG_READY=$(docker inspect --format='{{.State.Health.Status}}' gcs-postgres 2>/dev/null || echo "none")
        REDIS_READY=$(docker inspect --format='{{.State.Health.Status}}' gcs-redis 2>/dev/null || echo "none")
        if [ "${PG_READY}" = "healthy" ] && [ "${REDIS_READY}" = "healthy" ]; then
            break
        fi
        RETRIES=$((RETRIES + 1))
        sleep 1
    done

    if [ ${RETRIES} -ge ${MAX_RETRIES} ]; then
        warn "Timed out waiting for infrastructure health checks"
    else
        success "PostgreSQL: healthy"
        success "Redis: healthy"
        success "InfluxDB: running"
        success "MinIO: running"
    fi

    # ── 2. Python Virtual Environment ─────────────────────────────────────
    step "Setting up backend Python environment..."
    if [ ! -d "${BACKEND_VENV}" ]; then
        info "Creating virtual environment..."
        python3 -m venv "${BACKEND_VENV}"
        source "${BACKEND_VENV}/bin/activate"
        pip install --quiet -e "${BACKEND_DIR}[dev]"
        success "Virtual environment created and dependencies installed"
    else
        source "${BACKEND_VENV}/bin/activate"
        success "Virtual environment activated"
    fi

    # ── 3. Start Backend ──────────────────────────────────────────────────
    step "Starting FastAPI backend on :8000..."

    # Kill any existing backend
    if [ -f "${BACKEND_PID_FILE}" ]; then
        OLD_PID=$(cat "${BACKEND_PID_FILE}")
        kill "${OLD_PID}" 2>/dev/null && pkill -P "${OLD_PID}" 2>/dev/null || true
        rm -f "${BACKEND_PID_FILE}"
    fi
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    fuser -k 8000/tcp 2>/dev/null || true

    cd "${BACKEND_DIR}"
    source "${BACKEND_VENV}/bin/activate"

    # Launch uvicorn fully detached
    setsid nohup bash -c "
        export REDIS_HOST=localhost
        export POSTGRES_HOST=localhost
        export INFLUXDB_URL=http://localhost:8086
        export MINIO_ENDPOINT=localhost:9000
        exec '${BACKEND_VENV}/bin/python3' -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    " > "${SCRIPT_DIR}/logs/backend.log" 2>&1 &
    echo $! > "${BACKEND_PID_FILE}"

    # Wait for backend to respond
    RETRIES=0
    while [ ${RETRIES} -lt 15 ]; do
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")
        if [ "${HTTP_CODE}" = "200" ]; then
            break
        fi
        RETRIES=$((RETRIES + 1))
        sleep 1
    done

    if [ "${HTTP_CODE}" = "200" ]; then
        success "Backend running (PID $(cat "${BACKEND_PID_FILE}"))"
    else
        warn "Backend started but health check returned HTTP ${HTTP_CODE}"
        info "Check logs: ${SCRIPT_DIR}/logs/backend.log"
    fi

    # ── 4. Start Frontend ─────────────────────────────────────────────────
    step "Starting Vite frontend on :5173..."

    # Kill any existing frontend
    if [ -f "${FRONTEND_PID_FILE}" ]; then
        OLD_PID=$(cat "${FRONTEND_PID_FILE}")
        kill "${OLD_PID}" 2>/dev/null && pkill -P "${OLD_PID}" 2>/dev/null || true
        rm -f "${FRONTEND_PID_FILE}"
    fi
    pkill -f "vite" 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true

    cd "${FRONTEND_DIR}"

    # Install deps if node_modules missing
    if [ ! -d "node_modules" ]; then
        info "Installing frontend dependencies..."
        npm install --silent
    fi

    setsid nohup npm run dev > "${SCRIPT_DIR}/logs/frontend.log" 2>&1 &
    echo $! > "${FRONTEND_PID_FILE}"

    # Wait for vite to be ready
    sleep 2
    if kill -0 "$(cat "${FRONTEND_PID_FILE}")" 2>/dev/null; then
        success "Frontend running (PID $(cat "${FRONTEND_PID_FILE}"))"
    else
        warn "Frontend may have failed to start"
        info "Check logs: ${SCRIPT_DIR}/logs/frontend.log"
    fi

    # ── 5. Summary ────────────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║  GCS is online!                                  ║${NC}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  Frontend:  ${CYAN}http://localhost:5173${NC}               ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  Backend:   ${CYAN}http://localhost:8000${NC}               ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  API Docs:  ${CYAN}http://localhost:8000/docs${NC}          ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  Logs:                                           ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}    Backend:  ${DIM}logs/backend.log${NC}                   ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}    Frontend: ${DIM}logs/frontend.log${NC}                  ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}    Infra:    ${DIM}docker compose logs -f${NC}             ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  Commands:                                       ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}    ${DIM}./start_gcs.sh --status${NC}   Check services     ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}    ${DIM}./start_gcs.sh --stop${NC}     Stop everything    ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ── CLI Dispatch ──────────────────────────────────────────────────────────────
mkdir -p "${SCRIPT_DIR}/logs"

case "${1:-}" in
    --stop|-s)
        stop_services
        ;;
    --status|-S)
        check_status
        ;;
    --help|-h)
        echo "Usage: $0 [--stop | --status | --help]"
        echo ""
        echo "  (no args)   Start all GCS services"
        echo "  --stop      Stop all GCS services"
        echo "  --status    Show status of all services"
        echo "  --help      Show this help"
        ;;
    *)
        start_services
        ;;
esac
