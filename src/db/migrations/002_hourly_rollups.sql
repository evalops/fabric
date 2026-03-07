-- Fabric: Hourly rollup table for materialized cost/tool metrics
-- Idempotent — safe to run multiple times

CREATE TABLE IF NOT EXISTS hourly_rollups (
    hour            TIMESTAMPTZ PRIMARY KEY,
    goal_count      INTEGER NOT NULL DEFAULT 0,
    total_cost      REAL NOT NULL DEFAULT 0,
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_hourly_rollups_hour ON hourly_rollups(hour);
