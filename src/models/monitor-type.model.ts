import { db } from '../config/db.js';

export interface IFMonitorType {
    id: number;
    key: string;
    label: string;
    description: string;
    icon: string;
    category: string;
    sort_order: number;
    status: number;
}

class MonitorTypeModel {
    findAll(): IFMonitorType[] {
        return db.prepare(`
            SELECT * FROM tbl_monitor_type
            WHERE status = 1
            ORDER BY category ASC, sort_order ASC, label ASC
        `).all() as IFMonitorType[];
    }

    findByKey(key: string): IFMonitorType | undefined {
        return db.prepare(`SELECT * FROM tbl_monitor_type WHERE key = ?`).get(key) as IFMonitorType | undefined;
    }

    groupedByCategory(): Record<string, IFMonitorType[]> {
        const rows = this.findAll();
        return rows.reduce((groups: Record<string, IFMonitorType[]>, row) => {
            if (!groups[row.category]) groups[row.category] = [];
            groups[row.category].push(row);
            return groups;
        }, {});
    }
}

export const monitorTypeModel = new MonitorTypeModel();
