-- Nomi V1 Schema
-- Core tables: runs, steps, assistants, events, memory, permissions

-- Runs table
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    assistant_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    current_step_id TEXT,
    plan_version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (assistant_id) REFERENCES assistants(id)
);

CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_assistant ON runs(assistant_id);
CREATE INDEX idx_runs_created_at ON runs(created_at);

-- Steps table
CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input TEXT,
    output TEXT,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_steps_run ON steps(run_id);
CREATE INDEX idx_steps_status ON steps(status);

-- Assistants table
CREATE TABLE IF NOT EXISTS assistants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    channels TEXT, -- JSON array
    capabilities TEXT, -- JSON array
    contexts TEXT, -- JSON array of ContextAttachment
    memory_policy TEXT, -- JSON
    permission_policy TEXT, -- JSON
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assistants_name ON assistants(name);

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT,
    payload TEXT NOT NULL, -- JSON
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_run ON events(run_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_timestamp ON events(timestamp);

-- Memory table (Mnemos)
CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'workspace', -- 'profile' | 'workspace'
    content TEXT NOT NULL,
    assistant_id TEXT,
    run_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE SET NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_memory_scope ON memory(scope);
CREATE INDEX idx_memory_assistant ON memory(assistant_id);
CREATE INDEX idx_memory_run ON memory(run_id);

-- Permissions table (for explicit capability grants)
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'deny', -- 'allow' | 'confirm' | 'deny'
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
    UNIQUE(assistant_id, capability)
);

CREATE INDEX idx_permissions_assistant ON permissions(assistant_id);

-- Approval requests table
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    capability TEXT NOT NULL,
    context TEXT, -- JSON context for the request
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
    resolved_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (step_id) REFERENCES steps(id) ON DELETE SET NULL
);

CREATE INDEX idx_approvals_run ON approvals(run_id);
CREATE INDEX idx_approvals_status ON approvals(status);
