export const PERMISSIONS = {
    MONITOR_VIEW: 'monitor.view',
    MONITOR_VIEW_ALL: 'monitor.view_all',
    MONITOR_CREATE: 'monitor.create',
    MONITOR_EDIT: 'monitor.edit',
    MONITOR_DELETE: 'monitor.delete',
    ORG_VIEW: 'org.view',
    ORG_CREATE: 'org.create',
    ORG_EDIT: 'org.edit',
    ORG_DELETE: 'org.delete',
    ORG_INVITE: 'org.invite',
    ROLE_VIEW: 'role.view',
    ROLE_CREATE: 'role.create',
    ROLE_EDIT: 'role.edit',
    ROLE_DELETE: 'role.delete',
    GROUP_VIEW: 'group.view',
    GROUP_CREATE: 'group.create',
    GROUP_EDIT: 'group.edit',
    GROUP_DELETE: 'group.delete',
    TAG_MANAGE: 'tag.manage',
    SMTP_MANAGE: 'smtp.manage',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Single source of truth for "does this membership have permission X" — used by
// requirePermission() below and exposed to every EJS view as app.locals.hasPermission,
// so a nav link/button and the route/page it links to can never disagree.
export function hasPermission(perms: string[] | undefined | null, permission: Permission): boolean {
    return Array.isArray(perms) && perms.includes(permission);
}

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

// Grouped for rendering permission checklists in the UI
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
    { label: 'Monitors', permissions: [PERMISSIONS.MONITOR_VIEW, PERMISSIONS.MONITOR_VIEW_ALL, PERMISSIONS.MONITOR_CREATE, PERMISSIONS.MONITOR_EDIT, PERMISSIONS.MONITOR_DELETE] },
    { label: 'Organization', permissions: [PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_EDIT, PERMISSIONS.ORG_DELETE, PERMISSIONS.ORG_INVITE] },
    { label: 'Roles', permissions: [PERMISSIONS.ROLE_VIEW, PERMISSIONS.ROLE_CREATE, PERMISSIONS.ROLE_EDIT, PERMISSIONS.ROLE_DELETE] },
    { label: 'Groups', permissions: [PERMISSIONS.GROUP_VIEW, PERMISSIONS.GROUP_CREATE, PERMISSIONS.GROUP_EDIT, PERMISSIONS.GROUP_DELETE] },
    { label: 'Tags', permissions: [PERMISSIONS.TAG_MANAGE] },
    { label: 'Mail', permissions: [PERMISSIONS.SMTP_MANAGE] },
];

// Seeded automatically whenever a new org is created. `is_system` roles can't be deleted.
export const DEFAULT_ROLES: { name: string; permissions: Permission[]; is_system: 1 }[] = [
    { name: 'Admin', permissions: ALL_PERMISSIONS, is_system: 1 },
    {
        name: 'Member', is_system: 1, permissions: [
            PERMISSIONS.MONITOR_VIEW,
            PERMISSIONS.MONITOR_CREATE,
            PERMISSIONS.MONITOR_EDIT,
            PERMISSIONS.ORG_VIEW,
            PERMISSIONS.ROLE_VIEW,
            PERMISSIONS.GROUP_VIEW,
        ]
    },
];
