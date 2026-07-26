import { db } from '../config/db.js';

class MonitorNotifyRecipientModel {
    // Empty array means "no explicit selection" — callers fall back to notifying every org member.
    listUserIds(monitorId: number): number[] {
        const rows = db.prepare(`SELECT user_id FROM tbl_monitor_notify_recipients WHERE monitor_id = ?`).all(monitorId) as { user_id: number }[];
        return rows.map(r => r.user_id);
    }

    setRecipients(monitorId: number, userIds: number[]): void {
        const tx = db.transaction((ids: number[]) => {
            db.prepare(`DELETE FROM tbl_monitor_notify_recipients WHERE monitor_id = ?`).run(monitorId);
            const insert = db.prepare(`INSERT INTO tbl_monitor_notify_recipients (monitor_id, user_id) VALUES (?, ?)`);
            ids.forEach(id => insert.run(monitorId, id));
        });
        tx(userIds);
    }
}

export const monitorNotifyRecipientModel = new MonitorNotifyRecipientModel();
