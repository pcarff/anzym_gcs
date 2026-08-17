#!/bin/bash
# ==============================================================================
# ANZYM Ground Control System — Shutdown Script
# Cleanly shuts down the entire GCS stack: Backend, Frontend, and Docker services.
#
# Usage:
#   ./shutdown_gcs.sh               Stop all GCS services (default)
#   ./shutdown_gcs.sh --volumes     Stop services and remove Docker data volumes
#   ./shutdown_gcs.sh --status      Verify all services are down
#   ./shutdown_gcs.sh --help        Show help
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PID_FILE="${SCRIPT_DIR}/.backend.pid"
FRONTEND_PID_FILE="${SCRIPT_DIR}/.frontend.pid"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[  OK]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[FAIL]${NC}  $1"; }
step()    { echo -e "${CYAN}${BOLD}──▸${NC} $1"; }

banner() {
    echo -e "${YELLOW}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║        ANZYM Ground Control System               ║"
    echo "║        Full Stack Shutdown                       ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

shutdown_gcs() {
    banner

    # 1. Stop FastAPI Backend
    step "Stopping FastAPI backend..."
    if [ -f "${BACKEND_PID_FILE}" ]; then
        BACKEND_PID=$(cat "${BACKEND_PID_FILE}")
        if kill -0 "${BACKEND_PID}" 2>/dev/null; then
            kill "${BACKEND_PID}" 2>/dev/null || true
            pkill -P "${BACKEND_PID}" 2>/dev/null || true
            success "Backend PID ${BACKEND_PID} terminated"
        fi
        rm -f "${BACKEND_PID_FILE}"
    fi
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    fuser -k 8000/tcp 2>/dev/null || true
    success "Backend port 8000 released"

    # 2. Stop Vite Frontend
    step "Stopping Vite frontend..."
    if [ -f "${FRONTEND_PID_FILE}" ]; then
        FRONTEND_PID=$(cat "${FRONTEND_PID_FILE}")
        if kill -0 "${FRONTEND_PID}" 2>/dev/null; then
            kill "${FRONTEND_PID}" 2>/dev/null || true
            pkill -P "${FRONTEND_PID}" 2>/dev/null || true
            success "Frontend PID ${FRONTEND_PID} terminated"
        fi
        rm -f "${FRONTEND_PID_FILE}"
    fi
    pkill -f "vite" 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true
    success "Frontend port 5173 released"

    # 3. Stop Docker Infrastructure
    step "Stopping Docker infrastructure (PostgreSQL, Redis, InfluxDB, MinIO)..."
    cd "${SCRIPT_DIR}"
    if [[ "$1" == "--volumes" ]]; then
        info "Stopping containers and removing data volumes (--volumes)..."
        docker compose down -v 2>/dev/null && success "Containers and volumes removed" || warn "Docker compose down failed"
    else
        docker compose down 2>/dev/null && success "Containers stopped (data volumes preserved)" || warn "Docker compose down failed"
    fi

    # 4. Summary
    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║  GCS has been completely shut down.              ║${NC}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  To restart:  ${CYAN}./start_gcs.sh${NC}                        ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}║${NC}  To check:    ${CYAN}./start_gcs.sh --status${NC}               ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

case "${1:-}" in
    --status|-S)
        "${SCRIPT_DIR}/start_gcs.sh" --status
        ;;
    --help|-h)
        echo "Usage: $0 [--volumes | --status | --help]"
        echo ""
        echo "  (no args)   Cleanly stop backend, frontend, and Docker containers"
        echo "  --volumes   Stop services and remove Docker data volumes"
        echo "  --status    Show current status of all services"
        echo "  --help      Show this help message"
        ;;
    *)
        shutdown_gcs "$@"
        ;;
esac
