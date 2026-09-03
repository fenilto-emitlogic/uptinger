import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ALL_PERMISSIONS } from './permissions.js';

const dataDir = path.resolve('data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'monitor.db');
export const db = new Database(dbPath);

// Enable WAL mode for high-throughput reads & writes
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize required tables
db.exec(`
    CREATE TABLE IF NOT EXISTS tbl_init_setup (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status INTEGER DEFAULT 1,
        step_no INTEGER DEFAULT 1,
        is_completed INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tbl_organization (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type INTEGER,
        status INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        owner_id INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (owner_id) REFERENCES tbl_users(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES tbl_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        status INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS tbl_passwords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        password TEXT NOT NULL,
        status INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        meta TEXT,
        ip_address TEXT,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status INTEGER DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_monitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'http',
        url TEXT,
        hostname TEXT,
        port INTEGER,
        interval_seconds INTEGER DEFAULT 60,
        retry_interval INTEGER DEFAULT 60,
        max_retries INTEGER DEFAULT 3,
        resend_interval INTEGER DEFAULT 0,
        status TEXT DEFAULT 'ONLINE',
        is_paused INTEGER DEFAULT 0,
        tags TEXT DEFAULT '',
        config TEXT DEFAULT '{}',
        group_id INTEGER,
        notify_on_down INTEGER DEFAULT 1,
        notify_on_paused INTEGER DEFAULT 0,
        notify_on_recovery INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE
        FOREIGN KEY (created_by) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (updated_by) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (group_id) REFERENCES tbl_groups(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tbl_monitor_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER UNIQUE NOT NULL,
        total_checks INTEGER DEFAULT 0,
        average_response_time INTEGER DEFAULT 0,
        total_downtime INTEGER DEFAULT 0,
        total_downtime_24h INTEGER DEFAULT 0,
        total_downtime_30d INTEGER DEFAULT 0,
        total_uptime INTEGER DEFAULT 0,
        total_uptime_24h INTEGER DEFAULT 0,
        total_uptime_30d INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_monitor_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        ping_ms INTEGER DEFAULT 0,
        status_code INTEGER DEFAULT 200,
        msg TEXT DEFAULT '',
        response_headers TEXT DEFAULT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        is_system INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE,
        UNIQUE(org_id, name)
    );

    CREATE TABLE IF NOT EXISTS tbl_user_orgs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (created_by) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (updated_by) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (role_id) REFERENCES tbl_roles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tbl_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tbl_proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        protocol TEXT DEFAULT 'http',
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        auth_user TEXT,
        auth_pass TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tbl_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE,
        UNIQUE(org_id, name)
    );

    CREATE TABLE IF NOT EXISTS tbl_user_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES tbl_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tbl_monitor_notify_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE,
        UNIQUE(monitor_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tbl_smtp_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL UNIQUE,
        host TEXT,
        port INTEGER,
        username TEXT,
        password TEXT,
        encryption TEXT DEFAULT 'starttls',
        from_email TEXT,
        from_name TEXT,
        is_active INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_eagle_eye_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL UNIQUE,
        autoscroll_interval_seconds INTEGER DEFAULT 30,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_monitor_type (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        description TEXT DEFAULT '',
        icon TEXT DEFAULT '',
        category TEXT NOT NULL DEFAULT 'General',
        sort_order INTEGER DEFAULT 0,
        status INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tbl_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE,
        UNIQUE(org_id, name)
    );

    CREATE TABLE IF NOT EXISTS tbl_monitor_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tbl_tags(id) ON DELETE CASCADE,
        UNIQUE(monitor_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS tbl_email_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        html TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES tbl_users(id) ON DELETE SET NULL,
        UNIQUE(org_id, type)
    );

    -- Time-series rows pushed by the lightweight Docker agent running on a user's VPS
    -- (see /agent in the repo root). One row per push interval; monitor_id must be a
    -- monitor of type 'vps'. Disk/network are stored as JSON since a host can report
    -- an arbitrary number of mounts/interfaces.
    CREATE TABLE IF NOT EXISTS tbl_vps_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        cpu_pct REAL,
        load1 REAL,
        load5 REAL,
        load15 REAL,
        ram_used_mb INTEGER,
        ram_total_mb INTEGER,
        swap_used_mb INTEGER,
        swap_total_mb INTEGER,
        disks TEXT DEFAULT '[]',
        net_rx_bytes INTEGER,
        net_tx_bytes INTEGER,
        uptime_seconds INTEGER,
        nginx_active_connections INTEGER,
        nginx_requests_total INTEGER,
        nginx_recent_errors TEXT DEFAULT '[]',
        nginx_recent_access TEXT DEFAULT '[]',
        nginx_error_log_size_bytes INTEGER,
        nginx_access_log_size_bytes INTEGER,
        agent_version TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE
    );

    -- Raw crash/error/custom-event/session records pushed by a mobile app's Uptinger
    -- SDK (monitor_id must be of type 'mobile'). Source of truth; DAU/WAU/MAU, crash-free
    -- rate, and version/OS breakdowns are computed live via GROUP BY over this table rather
    -- than a maintained rollup — revisit if volume ever makes that too slow.
    -- TODO: no retention/pruning policy yet; this table grows unbounded over time.
    CREATE TABLE IF NOT EXISTS tbl_mobile_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_name TEXT,
        device_id TEXT NOT NULL,
        session_id TEXT,
        app_version TEXT,
        build_number TEXT,
        os_name TEXT,
        os_version TEXT,
        device_model TEXT,
        region TEXT,
        locale TEXT,
        timezone TEXT,
        props TEXT,
        stack_trace TEXT,
        fatal INTEGER DEFAULT 0,
        client_timestamp TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE
    );

    -- Deduplicated crash signatures, upserted incrementally on ingest so the crash
    -- list doesn't need to re-group the full tbl_mobile_events history on every read.
    CREATE TABLE IF NOT EXISTS tbl_mobile_crash_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        signature TEXT NOT NULL,
        title TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        occurrence_count INTEGER NOT NULL DEFAULT 0,
        is_fatal INTEGER NOT NULL DEFAULT 1,
        sample_stack_trace TEXT,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE,
        UNIQUE(monitor_id, signature)
    );

    CREATE TABLE IF NOT EXISTS tbl_password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL DEFAULT 'reset',
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
    );

    -- FK/lookup columns hit on every request (org-scoped listing, monitor detail,
    -- membership checks) but had no index, forcing a full-table scan as data grows.
    CREATE INDEX IF NOT EXISTS idx_monitors_org_id ON tbl_monitors(org_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor_id ON tbl_monitor_checks(monitor_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor_id_timestamp ON tbl_monitor_checks(monitor_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_user_orgs_user_id ON tbl_user_orgs(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_orgs_org_id ON tbl_user_orgs(org_id);
    CREATE INDEX IF NOT EXISTS idx_user_groups_user_id ON tbl_user_groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_groups_group_id ON tbl_user_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_tags_monitor_id ON tbl_monitor_tags(monitor_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_notify_recipients_monitor_id ON tbl_monitor_notify_recipients(monitor_id);
    CREATE INDEX IF NOT EXISTS idx_roles_org_id ON tbl_roles(org_id);
    CREATE INDEX IF NOT EXISTS idx_groups_org_id ON tbl_groups(org_id);
    CREATE INDEX IF NOT EXISTS idx_tags_org_id ON tbl_tags(org_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON tbl_user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON tbl_password_resets(user_id);
    CREATE INDEX IF NOT EXISTS idx_vps_metrics_monitor_id_timestamp ON tbl_vps_metrics(monitor_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_monitor_created ON tbl_mobile_events(monitor_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_monitor_type ON tbl_mobile_events(monitor_id, event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_device ON tbl_mobile_events(monitor_id, device_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mobile_crash_issues_monitor ON tbl_mobile_crash_issues(monitor_id, last_seen_at);
`);

// Backfill: orgs created before roles existed get default Admin/Member roles,
// and any membership without a role_id defaults to Admin (preserves pre-UAD access).
const orgsWithoutRoles = db.prepare(`
    SELECT o.id FROM tbl_organization o
    WHERE NOT EXISTS (SELECT 1 FROM tbl_roles r WHERE r.org_id = o.id)
`).all() as { id: number }[];
if (orgsWithoutRoles.length > 0) {
    const insertRole = db.prepare(`INSERT INTO tbl_roles (org_id, name, permissions, is_system) VALUES (?, ?, ?, 1)`);
    const backfillMemberships = db.prepare(`UPDATE tbl_user_orgs SET role_id = ? WHERE org_id = ? AND role_id IS NULL`);
    const ALL_PERMS = JSON.stringify(['monitor.view', 'monitor.create', 'monitor.edit', 'monitor.delete', 'org.view', 'org.create', 'org.edit', 'org.delete', 'org.invite', 'role.view', 'role.create', 'role.edit', 'role.delete']);
    const MEMBER_PERMS = JSON.stringify(['monitor.view', 'monitor.create', 'monitor.edit', 'org.view', 'role.view']);
    for (const org of orgsWithoutRoles) {
        const adminRole = insertRole.run(org.id, 'Admin', ALL_PERMS);
        insertRole.run(org.id, 'Member', MEMBER_PERMS);
        backfillMemberships.run(adminRole.lastInsertRowid, org.id);
    }
}

// Backfill: existing system Admin roles predate newer permissions (Groups, SMTP,
// monitor.view_all) added after they were first seeded — grant the union so
// admins don't lose access to new features on upgrade.
const systemAdminRoles = db.prepare(`SELECT id, permissions FROM tbl_roles WHERE is_system = 1 AND name = 'Admin'`).all() as { id: number; permissions: string }[];
const updateRolePerms = db.prepare(`UPDATE tbl_roles SET permissions = ? WHERE id = ?`);
for (const role of systemAdminRoles) {
    const current: string[] = JSON.parse(role.permissions || '[]');
    const merged = Array.from(new Set([...current, ...ALL_PERMISSIONS]));
    if (merged.length !== current.length) {
        updateRolePerms.run(JSON.stringify(merged), role.id);
    }
}

// Seed default monitor types (safe to re-run; keyed on unique `key`)
const monitorTypeSeed: Array<{ key: string; label: string; description: string; icon: string; category: string; sort_order: number }> = [
    { key: 'http', label: 'HTTP(s)', description: 'Monitor a website or REST endpoint over HTTP/HTTPS', icon: 'globe', category: 'General', sort_order: 1 },
    { key: 'http-keyword', label: 'HTTP(s) - Keyword', description: 'Check a page for the presence/absence of a keyword', icon: 'search', category: 'General', sort_order: 2 },
    { key: 'tcp', label: 'TCP Port', description: 'Check if a TCP port is open and accepting connections', icon: 'plug', category: 'General', sort_order: 3 },
    { key: 'ping', label: 'Ping', description: 'Send ICMP pings to check host reachability', icon: 'activity', category: 'General', sort_order: 4 },
    { key: 'dns', label: 'DNS', description: 'Resolve a DNS record and validate the response', icon: 'network', category: 'General', sort_order: 5 },
    { key: 'docker', label: 'Docker Container', description: 'Monitor the running state of a Docker container', icon: 'box', category: 'General', sort_order: 6 },
    { key: 'vps', label: 'VPS Performance', description: 'CPU, RAM, disk, network and Nginx stats pushed by a lightweight agent installed on your server', icon: 'cpu', category: 'General', sort_order: 7 },
    { key: 'push', label: 'Push', description: 'Passive monitor that expects periodic pings from your service', icon: 'upload', category: 'Passive', sort_order: 1 },
    { key: 'manual', label: 'Manual', description: 'Manually managed status, not actively checked', icon: 'hand', category: 'Passive', sort_order: 2 },
    { key: 'mobile', label: 'Mobile App', description: 'Crash, error, and usage analytics pushed from your mobile app', icon: 'smartphone', category: 'Passive', sort_order: 3 },
    { key: 'smtp', label: 'SMTP', description: 'Check an SMTP mail server connection', icon: 'mail', category: 'Specific', sort_order: 1 },
    { key: 'mqtt', label: 'MQTT', description: 'Check an MQTT broker topic', icon: 'radio', category: 'Specific', sort_order: 2 },
    { key: 'rabbitmq', label: 'RabbitMQ', description: 'Check a RabbitMQ node health', icon: 'inbox', category: 'Specific', sort_order: 3 },
    { key: 'websocket', label: 'Websocket Upgrade', description: 'Check a websocket endpoint upgrade handshake', icon: 'zap', category: 'Specific', sort_order: 4 },
    { key: 'mssql', label: 'Microsoft SQL Server', description: 'Check connectivity to a Microsoft SQL Server instance', icon: 'database', category: 'Database', sort_order: 1 },
    { key: 'mongodb', label: 'MongoDB', description: 'Check connectivity to a MongoDB instance', icon: 'database', category: 'Database', sort_order: 2 },
    { key: 'mysql', label: 'MySQL/MariaDB', description: 'Check connectivity to a MySQL or MariaDB instance', icon: 'database', category: 'Database', sort_order: 3 },
    { key: 'postgres', label: 'PostgreSQL', description: 'Check connectivity to a PostgreSQL instance', icon: 'database', category: 'Database', sort_order: 4 },
    { key: 'redis', label: 'Redis', description: 'Check connectivity to a Redis instance', icon: 'database', category: 'Database', sort_order: 5 },
];

const upsertMonitorType = db.prepare(`
    INSERT INTO tbl_monitor_type (key, label, description, icon, category, sort_order)
    VALUES (@key, @label, @description, @icon, @category, @sort_order)
    ON CONFLICT(key) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        icon = excluded.icon,
        category = excluded.category,
        sort_order = excluded.sort_order
`);
const seedMonitorTypes = db.transaction((rows: typeof monitorTypeSeed) => {
    for (const row of rows) upsertMonitorType.run(row);
});
seedMonitorTypes(monitorTypeSeed);

// Seed default tags for orgs that have none yet (new orgs, and pre-existing
// orgs from before the tags table existed).
const DEFAULT_TAG_NAMES = ['Production', 'Staging', 'Development', 'Web', 'API', 'Database', 'Critical', 'Internal'];
const orgsWithoutTags = db.prepare(`
    SELECT o.id FROM tbl_organization o
    WHERE NOT EXISTS (SELECT 1 FROM tbl_tags t WHERE t.org_id = o.id)
`).all() as { id: number }[];
if (orgsWithoutTags.length > 0) {
    const insertTag = db.prepare(`INSERT INTO tbl_tags (org_id, name) VALUES (?, ?)`);
    const seedOrgTags = db.transaction((orgs: { id: number }[]) => {
        for (const org of orgs) {
            for (const name of DEFAULT_TAG_NAMES) insertTag.run(org.id, name);
        }
    });
    seedOrgTags(orgsWithoutTags);
}

// tbl_monitor_checks.response_headers didn't exist in earlier installs — CREATE TABLE IF NOT
// EXISTS above is a no-op for a table that's already there, so add the column here for upgrades.
const existingCheckColumns = (db.prepare(`PRAGMA table_info(tbl_monitor_checks)`).all() as { name: string }[]).map(c => c.name);
if (!existingCheckColumns.includes('response_headers')) {
    db.exec(`ALTER TABLE tbl_monitor_checks ADD COLUMN response_headers TEXT DEFAULT NULL`);
}

// tbl_vps_metrics.nginx_recent_access didn't exist in earlier installs — same
// upgrade path as response_headers above.
const existingVpsMetricColumns = (db.prepare(`PRAGMA table_info(tbl_vps_metrics)`).all() as { name: string }[]).map(c => c.name);
if (!existingVpsMetricColumns.includes('nginx_recent_access')) {
    db.exec(`ALTER TABLE tbl_vps_metrics ADD COLUMN nginx_recent_access TEXT DEFAULT '[]'`);
}
if (!existingVpsMetricColumns.includes('nginx_error_log_size_bytes')) {
    db.exec(`ALTER TABLE tbl_vps_metrics ADD COLUMN nginx_error_log_size_bytes INTEGER`);
}
if (!existingVpsMetricColumns.includes('nginx_access_log_size_bytes')) {
    db.exec(`ALTER TABLE tbl_vps_metrics ADD COLUMN nginx_access_log_size_bytes INTEGER`);
}

// tbl_mobile_events.region/locale/timezone didn't exist in earlier installs — same
// upgrade path as response_headers above.
const existingMobileEventColumns = (db.prepare(`PRAGMA table_info(tbl_mobile_events)`).all() as { name: string }[]).map(c => c.name);
if (!existingMobileEventColumns.includes('region')) {
    db.exec(`ALTER TABLE tbl_mobile_events ADD COLUMN region TEXT`);
}
if (!existingMobileEventColumns.includes('locale')) {
    db.exec(`ALTER TABLE tbl_mobile_events ADD COLUMN locale TEXT`);
}
if (!existingMobileEventColumns.includes('timezone')) {
    db.exec(`ALTER TABLE tbl_mobile_events ADD COLUMN timezone TEXT`);
}

// Migrate legacy comma-separated tbl_monitors.tags into the tags table/join
// table, for monitors created before tbl_monitor_tags existed.
const monitorsWithLegacyTags = db.prepare(`
    SELECT id, org_id, tags FROM tbl_monitors
    WHERE tags IS NOT NULL AND tags != ''
    AND id NOT IN (SELECT DISTINCT monitor_id FROM tbl_monitor_tags)
`).all() as { id: number; org_id: number; tags: string }[];
if (monitorsWithLegacyTags.length > 0) {
    const findTag = db.prepare(`SELECT id FROM tbl_tags WHERE org_id = ? AND name = ?`);
    const insertTag = db.prepare(`INSERT INTO tbl_tags (org_id, name) VALUES (?, ?)`);
    const linkTag = db.prepare(`INSERT OR IGNORE INTO tbl_monitor_tags (monitor_id, tag_id) VALUES (?, ?)`);
    const migrateLegacyTags = db.transaction((rows: typeof monitorsWithLegacyTags) => {
        for (const m of rows) {
            const names = m.tags.split(',').map(t => t.trim()).filter(Boolean);
            for (const name of names) {
                const existing = findTag.get(m.org_id, name) as { id: number } | undefined;
                const tagId = existing ? existing.id : Number(insertTag.run(m.org_id, name).lastInsertRowid);
                linkTag.run(m.id, tagId);
            }
        }
    });
    migrateLegacyTags(monitorsWithLegacyTags);
}
