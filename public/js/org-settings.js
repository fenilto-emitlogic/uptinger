(function () {
    let roles = [];
    let groups = [];
    let currentPerms = [];

    function activateTab(tab) {
        const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
        const panel = document.getElementById('tab-' + tab);
        if (!btn || !panel) return;

        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('text-[var(--color-primary)]', 'border-[var(--color-primary)]');
            b.classList.add('text-[var(--color-text-secondary)]', 'border-transparent');
        });
        btn.classList.add('text-[var(--color-primary)]', 'border-[var(--color-primary)]');
        btn.classList.remove('text-[var(--color-text-secondary)]', 'border-transparent');

        document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
        panel.classList.remove('hidden');

        if (tab === 'members') loadMembers();
        if (tab === 'roles') loadRoles();
        if (tab === 'groups') loadGroups();
        if (tab === 'tags') loadTags();
        if (tab === 'mail') loadSmtp();
        if (tab === 'email-templates') loadEmailTemplates();
        if (tab === 'notifications') loadNotifications();
        if (tab === 'eagle-eye') loadEagleEyeSettings();
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    // Deep-link support: /settings/organization#members, #roles, #groups, #mail, #notifications, #eagle-eye
    const initialTab = (location.hash || '').replace('#', '');
    if (['members', 'roles', 'groups', 'tags', 'mail', 'email-templates', 'notifications', 'eagle-eye'].includes(initialTab)) {
        activateTab(initialTab);
    }

    async function api(url, opts) {
        const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
        const data = await res.json();
        return { ok: res.ok, data };
    }

    window.saveOrgName = async function () {
        const name = document.getElementById('orgNameInput').value.trim();
        if (!name) return showToast('Organization name is required', 'error');
        const { data } = await api('/api/org/' + ORG_ID, { method: 'PUT', body: JSON.stringify({ name }) });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) setTimeout(() => window.location.reload(), 800);
    };

    // ---- Members ----
    async function loadMembers() {
        const [{ data: membersRes }, { data: rolesRes }, { data: groupsRes }] = await Promise.all([
            api('/api/org/' + ORG_ID + '/members'),
            api('/api/roles'),
            api('/api/groups')
        ]);
        if (rolesRes.status) roles = rolesRes.data.roles;
        if (groupsRes.status) groups = groupsRes.data.groups;

        const roleSelect = document.getElementById('inviteRole');
        roleSelect.innerHTML = roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

        const list = document.getElementById('membersList');
        if (!membersRes.status) { list.innerHTML = '<div class="py-6 text-sm text-[var(--color-text-muted)]">Failed to load members.</div>'; return; }

        list.innerHTML = membersRes.data.members.map(m => `
            <div class="flex items-center justify-between py-3" data-member-row="${m.user_id}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_15%,transparent)] text-[var(--color-primary)] text-xs font-bold flex items-center justify-center shrink-0">
                        ${(m.first_name?.[0] || '').toUpperCase()}${(m.last_name?.[0] || '').toUpperCase()}
                    </div>
                    <div>
                        <div class="text-sm font-semibold">${m.first_name} ${m.last_name}</div>
                        <div class="text-xs text-[var(--color-text-muted)]">${m.email}</div>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <!-- Read-only preview of the member's current role; changing it requires Edit -->
                    <span class="px-2.5 py-1 rounded-lg bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-primary)_25%,transparent)] text-[var(--color-primary)] text-xs font-semibold" data-role-preview>${m.role_name || 'No role'}</span>
                    <select class="hidden px-2 py-1.5 rounded-lg bg-[var(--color-bg-main)] border border-[color-mix(in_srgb,var(--color-border)_70%,transparent)] text-xs" data-role-select>
                        ${roles.map(r => `<option value="${r.id}" ${r.id === m.role_id ? 'selected' : ''}>${r.name}</option>`).join('')}
                    </select>
                    <button onclick="toggleMemberRoleEdit(${m.user_id})" class="text-xs text-[var(--color-primary)] hover:underline" data-edit-btn>Edit</button>
                    <button onclick="confirmMemberRole(${m.user_id})" class="hidden text-xs text-[var(--color-primary)] font-bold hover:underline" data-save-btn>Save</button>
                    <button onclick="cancelMemberRoleEdit(${m.user_id})" class="hidden text-xs text-[var(--color-text-muted)] hover:underline" data-cancel-btn>Cancel</button>
                    <button onclick="manageMemberGroups(${m.user_id})" class="text-xs text-[var(--color-primary)] hover:underline">Groups</button>
                    <button onclick="removeMember(${m.user_id})" class="text-xs text-[var(--color-error)] hover:underline">Remove</button>
                </div>
            </div>
        `).join('') || '<div class="py-6 text-sm text-[var(--color-text-muted)]">No members yet.</div>';
    }

    window.manageMemberGroups = async function (userId) {
        if (groups.length === 0) return showToast('Create a group first', 'error');
        const { data } = await api(`/api/groups`);
        if (!data.status) return;
        const memberships = await Promise.all(data.data.groups.map(g => api(`/api/groups/${g.id}/members`)));
        const currentGroupIds = data.data.groups.filter((g, i) => memberships[i].data.status && memberships[i].data.data.members.some(m => m.user_id === userId)).map(g => g.id);

        const selected = new Set(currentGroupIds);
        const checklistHtml = groups.map(g => `<label class="flex items-center gap-1.5"><input type="checkbox" class="toggle-switch" value="${g.id}" ${selected.has(g.id) ? 'checked' : ''}> ${g.name}</label>`).join('<br>');
        const container = document.createElement('div');
        container.innerHTML = `<div class="text-left space-y-1">${checklistHtml}</div>`;

        const ok = await openConfirmModal({ title: 'Assign Groups', message: container.innerHTML, confirmLabel: 'Save' });
        if (!ok) return;
        // openConfirmModal renders `message` as text in most implementations — fall back to a direct save using
        // whatever checkboxes ended up in the DOM inside the modal at confirm time is unreliable, so re-query here.
        const checked = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).filter(el => groups.some(g => String(g.id) === el.value)).map(el => Number(el.value));
        const { data: saveRes } = await api('/api/groups/members/assignments', { method: 'PUT', body: JSON.stringify({ userId, groupIds: checked }) });
        showToast(saveRes.message, saveRes.status ? 'success' : 'error');
    };

    window.openInviteForm = function () {
        document.getElementById('inviteForm').classList.toggle('hidden');
        document.getElementById('inviteSuccess').classList.add('hidden');
    };

    let lastInvitedUserId = null;

    window.submitInvite = async function () {
        const email = document.getElementById('inviteEmail').value.trim();
        const first_name = document.getElementById('inviteFirstName').value.trim();
        const last_name = document.getElementById('inviteLastName').value.trim();
        const role_id = document.getElementById('inviteRole').value;
        if (!email || !role_id) return showToast('Email and role are required', 'error');

        const { data } = await api('/api/org/' + ORG_ID + '/invite', {
            method: 'POST', body: JSON.stringify({ email, first_name, last_name, role_id })
        });
        if (!data.status) return showToast(data.message, 'error');

        document.getElementById('inviteForm').classList.add('hidden');
        document.getElementById('inviteEmail').value = '';
        document.getElementById('inviteFirstName').value = '';
        document.getElementById('inviteLastName').value = '';

        lastInvitedUserId = data.data.user.id;
        document.getElementById('inviteSuccessEmail').textContent = data.data.user.email;

        const credentialsBox = document.getElementById('inviteCredentials');
        if (data.data.tempPassword) {
            document.getElementById('inviteTempPassword').value = data.data.tempPassword;
            credentialsBox.classList.remove('hidden');
        } else {
            credentialsBox.classList.add('hidden');
        }

        const { data: groupsRes } = await api('/api/groups');
        groups = groupsRes.status ? groupsRes.data.groups : [];
        document.getElementById('inviteGroupChecklist').innerHTML = groups.map(g => `
            <label class="flex items-center gap-1.5"><input type="checkbox" value="${g.id}" class="toggle-switch invite-group-checkbox"> ${g.name}</label>
        `).join('') || '<span class="text-[var(--color-text-muted)]">No groups yet — create one in the Groups tab.</span>';

        document.getElementById('inviteSuccess').classList.remove('hidden');
    };

    window.copyTempPassword = function () {
        const input = document.getElementById('inviteTempPassword');
        input.select();
        navigator.clipboard.writeText(input.value).then(() => showToast('Password copied', 'success'));
    };

    window.finishInvite = async function () {
        const groupIds = Array.from(document.querySelectorAll('.invite-group-checkbox:checked')).map(el => Number(el.value));
        if (lastInvitedUserId && groupIds.length > 0) {
            await api('/api/groups/members/assignments', { method: 'PUT', body: JSON.stringify({ userId: lastInvitedUserId, groupIds }) });
        }
        document.getElementById('inviteSuccess').classList.add('hidden');
        lastInvitedUserId = null;
        loadMembers();
    };

    function memberRow(userId) {
        return document.querySelector(`[data-member-row="${userId}"]`);
    }

    window.toggleMemberRoleEdit = function (userId) {
        const row = memberRow(userId);
        if (!row) return;
        row.querySelector('[data-role-preview]').classList.add('hidden');
        row.querySelector('[data-role-select]').classList.remove('hidden');
        row.querySelector('[data-edit-btn]').classList.add('hidden');
        row.querySelector('[data-save-btn]').classList.remove('hidden');
        row.querySelector('[data-cancel-btn]').classList.remove('hidden');
    };

    window.cancelMemberRoleEdit = function (userId) {
        const row = memberRow(userId);
        if (!row) return;
        row.querySelector('[data-role-preview]').classList.remove('hidden');
        row.querySelector('[data-role-select]').classList.add('hidden');
        row.querySelector('[data-edit-btn]').classList.remove('hidden');
        row.querySelector('[data-save-btn]').classList.add('hidden');
        row.querySelector('[data-cancel-btn]').classList.add('hidden');
    };

    window.confirmMemberRole = async function (userId) {
        const row = memberRow(userId);
        if (!row) return;
        const roleId = row.querySelector('[data-role-select]').value;
        const { data } = await api(`/api/org/${ORG_ID}/members/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role_id: roleId }) });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadMembers();
    };

    window.removeMember = async function (userId) {
        const ok = await openConfirmModal({
            title: 'Remove Member',
            message: 'This member will lose access to the organization immediately.',
            confirmLabel: 'Remove Member',
            danger: true
        });
        if (!ok) return;

        const { data } = await api(`/api/org/${ORG_ID}/members/${userId}`, { method: 'DELETE' });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadMembers();
    };

    // ---- Roles ----
    async function loadRoles() {
        const { data } = await api('/api/roles');
        const list = document.getElementById('rolesList');
        if (!data.status) { list.innerHTML = '<div class="py-6 text-sm text-[var(--color-text-muted)]">Failed to load roles.</div>'; return; }

        roles = data.data.roles;
        list.innerHTML = roles.map(r => `
            <div class="flex items-center justify-between p-3 rounded-xl bg-[var(--color-bg-main)] border border-[color-mix(in_srgb,var(--color-border)_60%,transparent)]">
                <div>
                    <div class="text-sm font-semibold flex items-center gap-2">${r.name} ${r.is_system ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-primary)_15%,transparent)] text-[var(--color-primary)]">system</span>' : ''}</div>
                    <div class="text-xs text-[var(--color-text-muted)] mt-0.5">${r.permissions.length} permission(s)</div>
                </div>
                <div class="flex items-center gap-3">
                    <button onclick="editRole(${r.id})" class="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                    ${r.is_system ? '' : `<button onclick="deleteRole(${r.id})" class="text-xs text-[var(--color-error)] hover:underline">Delete</button>`}
                </div>
            </div>
        `).join('');
    }

    function renderPermChecklist(selected) {
        const container = document.getElementById('roleFormPerms');
        container.innerHTML = PERMISSION_GROUPS.map(group => `
            <div class="col-span-full mt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">${group.label}</div>
            ${group.permissions.map(p => `
                <label class="flex items-center gap-1.5">
                    <input type="checkbox" value="${p}" ${selected.includes(p) ? 'checked' : ''} class="toggle-switch perm-checkbox">
                    <span>${p}</span>
                </label>
            `).join('')}
        `).join('');
    }

    window.openRoleForm = function () {
        document.getElementById('roleFormId').value = '';
        document.getElementById('roleFormName').value = '';
        renderPermChecklist([]);
        document.getElementById('roleForm').classList.remove('hidden');
    };

    window.editRole = function (id) {
        const role = roles.find(r => r.id === id);
        if (!role) return;
        document.getElementById('roleFormId').value = role.id;
        document.getElementById('roleFormName').value = role.name;
        renderPermChecklist(role.permissions);
        document.getElementById('roleForm').classList.remove('hidden');
    };

    window.submitRole = async function () {
        const id = document.getElementById('roleFormId').value;
        const name = document.getElementById('roleFormName').value.trim();
        const permissions = Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(el => el.value);
        if (!name) return showToast('Role name is required', 'error');

        const url = id ? `/api/roles/${id}` : '/api/roles';
        const method = id ? 'PUT' : 'POST';
        const { data } = await api(url, { method, body: JSON.stringify({ name, permissions }) });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) {
            document.getElementById('roleForm').classList.add('hidden');
            loadRoles();
        }
    };

    window.deleteRole = async function (id) {
        const ok = await openConfirmModal({
            title: 'Delete Role',
            message: 'This role will be permanently removed. Roles still assigned to members cannot be deleted.',
            confirmLabel: 'Delete Role',
            danger: true
        });
        if (!ok) return;

        const { data } = await api(`/api/roles/${id}`, { method: 'DELETE' });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadRoles();
    };

    // ---- Groups ----
    async function loadGroups() {
        const { data } = await api('/api/groups');
        const list = document.getElementById('groupsList');
        if (!data.status) { list.innerHTML = '<div class="py-6 text-sm text-[var(--color-text-muted)]">Failed to load groups.</div>'; return; }

        groups = data.data.groups;
        list.innerHTML = groups.map(g => `
            <div class="flex items-center justify-between p-3 rounded-xl bg-[var(--color-bg-main)] border border-[color-mix(in_srgb,var(--color-border)_60%,transparent)]">
                <div>
                    <div class="text-sm font-semibold">${g.name}</div>
                    <div class="text-xs text-[var(--color-text-muted)] mt-0.5">${g.description || 'No description'} · ${g.member_count} member(s) · ${g.monitor_count} monitor(s)</div>
                </div>
                <div class="flex items-center gap-3">
                    <button onclick="editGroup(${g.id})" class="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                    <button onclick="deleteGroup(${g.id})" class="text-xs text-[var(--color-error)] hover:underline">Delete</button>
                </div>
            </div>
        `).join('') || '<div class="py-6 text-sm text-[var(--color-text-muted)]">No groups yet.</div>';
    }

    window.openGroupForm = function () {
        document.getElementById('groupFormId').value = '';
        document.getElementById('groupFormName').value = '';
        document.getElementById('groupFormDescription').value = '';
        document.getElementById('groupForm').classList.remove('hidden');
    };

    window.editGroup = function (id) {
        const group = groups.find(g => g.id === id);
        if (!group) return;
        document.getElementById('groupFormId').value = group.id;
        document.getElementById('groupFormName').value = group.name;
        document.getElementById('groupFormDescription').value = group.description || '';
        document.getElementById('groupForm').classList.remove('hidden');
    };

    window.submitGroup = async function () {
        const id = document.getElementById('groupFormId').value;
        const name = document.getElementById('groupFormName').value.trim();
        const description = document.getElementById('groupFormDescription').value.trim();
        if (!name) return showToast('Group name is required', 'error');

        const url = id ? `/api/groups/${id}` : '/api/groups';
        const method = id ? 'PUT' : 'POST';
        const { data } = await api(url, { method, body: JSON.stringify({ name, description }) });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) {
            document.getElementById('groupForm').classList.add('hidden');
            loadGroups();
        }
    };

    window.deleteGroup = async function (id) {
        const ok = await openConfirmModal({
            title: 'Delete Group',
            message: 'Monitors and members assigned to this group will be unassigned. This cannot be undone.',
            confirmLabel: 'Delete Group',
            danger: true
        });
        if (!ok) return;

        const { data } = await api(`/api/groups/${id}`, { method: 'DELETE' });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadGroups();
    };

    // ---- Tags ----
    async function loadTags() {
        const { data } = await api('/api/tags?withCounts=1');
        const list = document.getElementById('tagsList');
        if (!data.status) { list.innerHTML = '<div class="py-6 text-sm text-[var(--color-text-muted)]">Failed to load tags.</div>'; return; }

        const tags = data.data.tags;
        list.innerHTML = tags.map(t => `
            <span class="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl text-xs font-semibold bg-[var(--color-bg-main)] border border-[color-mix(in_srgb,var(--color-border)_60%,transparent)]">
                ${t.name}
                <span class="text-[var(--color-text-muted)] font-normal">${t.monitor_count}</span>
                <button onclick="deleteTag(${t.id}, '${t.name.replace(/'/g, "\\'")}')" class="text-[var(--color-error)] hover:opacity-70" title="Delete tag">&times;</button>
            </span>
        `).join('') || '<div class="py-6 text-sm text-[var(--color-text-muted)]">No tags yet.</div>';
    }

    window.deleteTag = async function (id, name) {
        const ok = await openConfirmModal({
            title: 'Delete Tag',
            message: `"${name}" will be removed from every monitor it's assigned to. This cannot be undone.`,
            confirmLabel: 'Delete Tag',
            danger: true
        });
        if (!ok) return;

        const { data } = await api(`/api/tags/${id}`, { method: 'DELETE' });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadTags();
    };

    // ---- Mail / SMTP ----
    async function loadSmtp() {
        const { data } = await api('/api/smtp');
        if (!data.status || !data.data.settings) return;
        const s = data.data.settings;
        document.getElementById('smtpHost').value = s.host || '';
        document.getElementById('smtpPort').value = s.port || '';
        document.getElementById('smtpUsername').value = s.username || '';
        document.getElementById('smtpEncryption').value = s.encryption || 'starttls';
        document.getElementById('smtpFromEmail').value = s.from_email || '';
        document.getElementById('smtpFromName').value = s.from_name || '';
        document.getElementById('smtpIsActive').checked = !!s.is_active;
        document.getElementById('smtpPassword').placeholder = s.has_password ? '(unchanged — leave blank to keep)' : '';
    }

    window.saveSmtp = async function () {
        const payload = {
            host: document.getElementById('smtpHost').value.trim(),
            port: document.getElementById('smtpPort').value,
            username: document.getElementById('smtpUsername').value.trim(),
            password: document.getElementById('smtpPassword').value,
            encryption: document.getElementById('smtpEncryption').value,
            from_email: document.getElementById('smtpFromEmail').value.trim(),
            from_name: document.getElementById('smtpFromName').value.trim(),
            is_active: document.getElementById('smtpIsActive').checked
        };
        if (!payload.host || !payload.port || !payload.from_email) return showToast('Host, port and From address are required', 'error');

        const { data } = await api('/api/smtp', { method: 'PUT', body: JSON.stringify(payload) });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadSmtp();
    };

    window.sendTestEmail = async function () {
        const { data } = await api('/api/smtp/test', { method: 'POST' });
        showToast(data.message, data.status ? 'success' : 'error');
    };

    // ---- Eagle Eye ----
    async function loadEagleEyeSettings() {
        const { data } = await api('/api/eagle-eye-settings');
        if (!data.status) return;
        document.getElementById('eagleEyeScrollInterval').value = data.data.settings.autoscroll_interval_seconds;
    }

    window.saveEagleEyeSettings = async function () {
        const seconds = parseInt(document.getElementById('eagleEyeScrollInterval').value);
        if (!Number.isFinite(seconds) || seconds < 5) return showToast('Interval must be at least 5 seconds', 'error');

        const { data } = await api('/api/eagle-eye-settings', { method: 'PUT', body: JSON.stringify({ autoscroll_interval_seconds: seconds }) });
        showToast(data.message, data.status ? 'success' : 'error');
    };

    // ---- Notifications ----
    let orgMembers = [];

    async function loadNotifications() {
        const [{ data }, { data: membersRes }] = await Promise.all([
            api('/api/monitors'),
            api('/api/org/' + ORG_ID + '/members')
        ]);
        if (membersRes.status) orgMembers = membersRes.data.members;

        const tbody = document.getElementById('notificationsList');
        if (!data.status) { tbody.innerHTML = '<tr><td class="py-6 text-sm text-[var(--color-text-muted)]" colspan="5">Failed to load monitors.</td></tr>'; return; }

        const monitors = data.data.monitors;
        tbody.innerHTML = monitors.map(m => `
            <tr data-monitor-row="${m.id}">
                <td class="py-2.5 font-semibold">${m.name}</td>
                <td class="py-2.5 text-center"><input type="checkbox" class="toggle-switch" onchange="toggleNotify(${m.id}, 'notify_on_down', this.checked)" ${m.notify_on_down ? 'checked' : ''}></td>
                <td class="py-2.5 text-center"><input type="checkbox" class="toggle-switch" onchange="toggleNotify(${m.id}, 'notify_on_paused', this.checked)" ${m.notify_on_paused ? 'checked' : ''}></td>
                <td class="py-2.5 text-center"><input type="checkbox" class="toggle-switch" onchange="toggleNotify(${m.id}, 'notify_on_recovery', this.checked)" ${m.notify_on_recovery ? 'checked' : ''}></td>
                <td class="py-2.5 text-center"><button onclick="manageMonitorRecipients(${m.id}, '${m.name.replace(/'/g, "\\'")}')" class="text-xs text-[var(--color-primary)] hover:underline">Choose</button></td>
            </tr>
        `).join('') || '<tr><td class="py-6 text-sm text-center text-[var(--color-text-muted)]" colspan="5">No monitors yet.</td></tr>';
    }

    window.toggleNotify = async function (monitorId, field, checked) {
        const { data } = await api(`/api/monitors/${monitorId}/notifications`, { method: 'PATCH', body: JSON.stringify({ [field]: checked }) });
        if (!data.status) showToast(data.message, 'error');
    };

    window.manageMonitorRecipients = async function (monitorId, monitorName) {
        if (orgMembers.length === 0) return showToast('No organization members to notify', 'error');
        const { data } = await api(`/api/monitors/${monitorId}/notify-recipients`);
        if (!data.status) return showToast(data.message, 'error');

        const selected = new Set(data.data.userIds);
        const checklistHtml = orgMembers.map(m => `
            <label class="flex items-center gap-1.5">
                <input type="checkbox" class="toggle-switch" value="${m.user_id}" ${selected.has(m.user_id) ? 'checked' : ''}>
                ${m.first_name} ${m.last_name} <span class="text-[var(--color-text-muted)]">(${m.email})</span>
            </label>
        `).join('<br>');

        const container = document.createElement('div');
        container.innerHTML = `<div class="text-left space-y-1">${checklistHtml}</div>
            <p class="text-[11px] text-[var(--color-text-muted)] mt-2">Leave everyone unchecked to notify the whole organization instead.</p>`;

        const ok = await openConfirmModal({ title: `Notify for "${monitorName}"`, message: container.innerHTML, confirmLabel: 'Save' });
        if (!ok) return;

        const checked = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
            .filter(el => orgMembers.some(m => String(m.user_id) === el.value))
            .map(el => Number(el.value));

        const { data: saveRes } = await api(`/api/monitors/${monitorId}/notify-recipients`, { method: 'PUT', body: JSON.stringify({ userIds: checked }) });
        showToast(saveRes.message, saveRes.status ? 'success' : 'error');
    };

    // ---- Email Templates ----
    let emailTemplates = [];
    let activeTemplateType = null;

    async function loadEmailTemplates() {
        const { data } = await api('/api/email-templates');
        if (!data.status) return showToast(data.message, 'error');
        emailTemplates = data.data.templates;

        document.getElementById('templateTypeList').innerHTML = emailTemplates.map(t => `
            <button type="button" onclick="selectEmailTemplate('${t.type}')" data-template-type="${t.type}"
                class="template-type-btn w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-between gap-2 border border-transparent hover:border-[color-mix(in_srgb,var(--color-border)_70%,transparent)]">
                <span>${t.label}</span>
                ${t.is_custom ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]">Custom</span>' : ''}
            </button>
        `).join('');

        selectEmailTemplate(activeTemplateType || emailTemplates[0]?.type);
    }

    window.selectEmailTemplate = function (type) {
        const t = emailTemplates.find(x => x.type === type);
        if (!t) return;
        activeTemplateType = type;

        document.querySelectorAll('.template-type-btn').forEach(btn => {
            const isActive = btn.dataset.templateType === type;
            btn.classList.toggle('bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]', isActive);
            btn.classList.toggle('text-[var(--color-primary)]', isActive);
            btn.classList.toggle('text-[var(--color-text-secondary)]', !isActive);
        });

        document.getElementById('templateEditor').classList.remove('hidden');
        document.getElementById('templateEditorLabel').textContent = t.label;
        document.getElementById('templateEditorDescription').textContent = t.description;
        document.getElementById('templateVarsHint').textContent = 'Variables: ' + t.vars.map(v => `{{${v}}}`).join(', ');
        document.getElementById('templateSubject').value = t.subject;
        document.getElementById('templateHtml').value = t.html;
        document.getElementById('templateCustomBadge').classList.toggle('hidden', !t.is_custom);
        document.getElementById('templateRevertBtn').classList.toggle('hidden', !t.is_custom);
        document.getElementById('templatePreviewBox').classList.add('hidden');
    };

    window.saveEmailTemplate = async function () {
        if (!activeTemplateType) return;
        const subject = document.getElementById('templateSubject').value.trim();
        const html = document.getElementById('templateHtml').value;
        if (!subject || !html) return showToast('Subject and HTML content are required', 'error');

        const { data } = await api(`/api/email-templates/${activeTemplateType}`, { method: 'PUT', body: JSON.stringify({ subject, html }) });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadEmailTemplates();
    };

    window.revertEmailTemplate = async function () {
        if (!activeTemplateType) return;
        const ok = await openConfirmModal({
            title: 'Revert to Default',
            message: 'This template will go back to the built-in design. Your customization will be lost.',
            confirmLabel: 'Revert',
            danger: true
        });
        if (!ok) return;

        const { data } = await api(`/api/email-templates/${activeTemplateType}/revert`, { method: 'POST' });
        showToast(data.message, data.status ? 'success' : 'error');
        if (data.status) loadEmailTemplates();
    };

    window.previewEmailTemplate = async function () {
        if (!activeTemplateType) return;
        const subject = document.getElementById('templateSubject').value.trim();
        const html = document.getElementById('templateHtml').value;

        const { data } = await api(`/api/email-templates/${activeTemplateType}/preview`, { method: 'POST', body: JSON.stringify({ subject, html }) });
        if (!data.status) return showToast(data.message, 'error');

        document.getElementById('templatePreviewSubject').textContent = data.data.subject;
        document.getElementById('templatePreviewFrame').srcdoc = data.data.html;
        document.getElementById('templatePreviewBox').classList.remove('hidden');
    };

    window.sendTestEmailTemplate = async function () {
        if (!activeTemplateType) return;
        const subject = document.getElementById('templateSubject').value.trim();
        const html = document.getElementById('templateHtml').value;

        const { data } = await api(`/api/email-templates/${activeTemplateType}/send-test`, { method: 'POST', body: JSON.stringify({ subject, html }) });
        showToast(data.message, data.status ? 'success' : 'error');
    };
})();
