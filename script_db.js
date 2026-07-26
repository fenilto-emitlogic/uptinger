import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE
        FOREIGN KEY (created_by) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (updated_by) REFERENCES tbl_users(id) ON DELETE CASCADE
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
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES tbl_monitors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_user_orgs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (org_id) REFERENCES tbl_organization(id) ON DELETE CASCADE
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (created_by) REFERENCES tbl_users(id) ON DELETE CASCADE
        FOREIGN KEY (updated_by) REFERENCES tbl_users(id) ON DELETE CASCADE
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
`);




