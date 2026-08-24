# AGENTS.md — Ground Control Station (`anzym_gcs_ws`)

## Subsystem Architecture
- **Backend**: FastAPI with Python 3.12, Uvicorn, Asyncpg/PostgreSQL, Redis, InfluxDB, MinIO, Pydantic v2.
  - Template Engine: `app/services/template_manager.py` resolves platform YAML configs (`backend/templates/`).
  - ROSBridge Manager: Manages async JSON WebSocket connections to robot rosbridge nodes (`ws://<ip>:9090`).
  - Zumo Bridge: Direct micro-ROS UDP bridge translating packed 32-bit integer commands.
- **Frontend**: React 18, Vite, TypeScript, TailwindCSS, Zustand store (`useFleetStore`), Lucide icons, Three.js / Foxglove 3D canvas.

## Verification Commands
- **Backend Tests**: `.venv/bin/pytest app/tests`
- **Backend Linting**: `.venv/bin/ruff check app`
- **Backend Format**: `.venv/bin/ruff format app`
- **Frontend Tests**: `npm test -- --run` (in `frontend/`)
- **Frontend TypeScript & Build**: `npm run build` (in `frontend/`)

## Key Constraints
- Never commit broken TypeScript types or failing Vitest tests.
- When adding new platform templates, place YAMLs in `backend/templates/platforms/` and ensure schema validity.
- WebSocket `/ws/fleet` messages must strictly follow the JSON envelope structure `{ type: string, robot_id?: string, data: any }`.
