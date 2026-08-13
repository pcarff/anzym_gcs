-- Initialize PostgreSQL database schema for Ground Control System (GCS)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Robots table
CREATE TABLE IF NOT EXISTS robots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    serial_number VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'OFFLINE',
    last_seen_at TIMESTAMPTZ,
    current_mission_id UUID,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Missions table
CREATE TABLE IF NOT EXISTS missions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    robot_id UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name VARCHAR(200),
    waypoints JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Add foreign key constraint for robots.current_mission_id after missions table creation
ALTER TABLE robots
    ADD CONSTRAINT fk_robots_current_mission
    FOREIGN KEY (current_mission_id) REFERENCES missions(id) ON DELETE SET NULL;

-- Mission logs table
CREATE TABLE IF NOT EXISTS mission_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    level VARCHAR(10) DEFAULT 'INFO',
    message TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Map assets table
CREATE TABLE IF NOT EXISTS map_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    robot_id UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    map_type VARCHAR(10) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    map_name VARCHAR(200),
    resolution FLOAT,
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_robots_status ON robots(status);
CREATE INDEX IF NOT EXISTS idx_missions_robot_id ON missions(robot_id);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
