/**
 * Multi-tag input widget: chips + free-text entry + a click-to-open dropdown
 * of existing org tags (from GET /api/tags). Typing a name that doesn't exist
 * yet creates it as a new chip; matching is case-insensitive so "web" reuses
 * the existing "Web" tag instead of creating a duplicate.
 *
 * Usage:
 *   TagInput.mount('formTags')                 // turns #formTags into the widget
 *   TagInput.getValues('formTags')              // -> ['Production', 'Web']
 *   TagInput.setValues('formTags', ['Web'])      // programmatically set chips
 */
(function () {
    const registry = {};
    let allTagsCache = null;
    let allTagsPromise = null;

    function loadAllTags(force) {
        if (allTagsCache && !force) return Promise.resolve(allTagsCache);
        if (allTagsPromise && !force) return allTagsPromise;
        allTagsPromise = fetch('/api/tags')
            .then(r => r.json())
            .then(res => {
                allTagsCache = (res.status && res.data && res.data.tags) ? res.data.tags : [];
                return allTagsCache;
            })
            .catch(() => (allTagsCache = []));
        return allTagsPromise;
    }

    function norm(s) {
        return (s || '').trim().toLowerCase();
    }

    function mount(inputId) {
        const original = document.getElementById(inputId);
        if (!original || registry[inputId]) return registry[inputId];

        const placeholder = original.getAttribute('placeholder') || 'Add tag...';
        const baseClass = original.className;

        const wrap = document.createElement('div');
        wrap.className = 'relative';
        wrap.innerHTML = `
            <div class="tag-input-box flex flex-wrap gap-1.5 items-center ${baseClass}" style="min-height:2.5rem;cursor:text;">
                <div class="tag-chip-list flex flex-wrap gap-1.5"></div>
                <input type="text" class="tag-search-input flex-1 min-w-[80px] bg-transparent border-none outline-none p-0 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]" placeholder="${placeholder}">
            </div>
            <div class="tag-dropdown hidden absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl shadow-xl py-1"></div>
        `;

        original.type = 'hidden';
        original.parentNode.insertBefore(wrap, original);
        wrap.appendChild(original);

        const box = wrap.querySelector('.tag-input-box');
        const chipList = wrap.querySelector('.tag-chip-list');
        const search = wrap.querySelector('.tag-search-input');
        const dropdown = wrap.querySelector('.tag-dropdown');

        let selected = [];

        function syncHidden() {
            original.value = selected.join(', ');
        }

        function renderChips() {
            chipList.innerHTML = selected.map((name, idx) => `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-[color-mix(in_srgb,var(--color-primary)_16%,transparent)] text-[var(--color-primary)]">
                    ${name}
                    <button type="button" data-idx="${idx}" class="tag-chip-remove hover:opacity-70">&times;</button>
                </span>
            `).join('');
            chipList.querySelectorAll('.tag-chip-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selected.splice(Number(btn.dataset.idx), 1);
                    renderChips();
                    syncHidden();
                });
            });
        }

        function addTag(name) {
            const trimmed = (name || '').trim();
            if (!trimmed) return;
            if (selected.some(s => norm(s) === norm(trimmed))) {
                search.value = '';
                closeDropdown();
                return;
            }
            // Reuse the existing tag's stored casing if it already exists for this org
            const existingTag = (allTagsCache || []).find(t => norm(t.name) === norm(trimmed));
            selected.push(existingTag ? existingTag.name : trimmed);
            renderChips();
            syncHidden();
            search.value = '';
            closeDropdown();
        }

        function openDropdown() {
            loadAllTags().then(tags => {
                const query = norm(search.value);
                const available = tags.filter(t => !selected.some(s => norm(s) === norm(t.name)));
                const filtered = query ? available.filter(t => norm(t.name).includes(query)) : available;

                const items = filtered.map(t => `<button type="button" data-name="${t.name.replace(/"/g, '&quot;')}" class="tag-option block w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]">${t.name}</button>`).join('');

                const showCreate = query && !tags.some(t => norm(t.name) === query);
                const createItem = showCreate
                    ? `<button type="button" data-create="${search.value.trim().replace(/"/g, '&quot;')}" class="tag-option block w-full text-left px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]">+ Create "${search.value.trim()}"</button>`
                    : '';

                dropdown.innerHTML = items + createItem || '<div class="px-3 py-1.5 text-xs text-[var(--color-text-muted)]">No tags found</div>';
                dropdown.classList.remove('hidden');

                dropdown.querySelectorAll('.tag-option').forEach(el => {
                    el.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        addTag(el.dataset.create || el.dataset.name);
                    });
                });
            });
        }

        function closeDropdown() {
            dropdown.classList.add('hidden');
        }

        box.addEventListener('click', () => search.focus());
        search.addEventListener('focus', openDropdown);
        search.addEventListener('input', openDropdown);
        search.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(search.value);
            } else if (e.key === 'Backspace' && !search.value && selected.length) {
                selected.pop();
                renderChips();
                syncHidden();
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });
        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) closeDropdown();
        });

        const controller = {
            getValues: () => selected.slice(),
            setValues: (names) => {
                selected = Array.from(new Set((names || []).map(n => (n || '').trim()).filter(Boolean)));
                renderChips();
                syncHidden();
            }
        };
        registry[inputId] = controller;
        return controller;
    }

    window.TagInput = {
        mount,
        getValues(inputId) {
            return registry[inputId] ? registry[inputId].getValues() : [];
        },
        setValues(inputId, names) {
            if (registry[inputId]) registry[inputId].setValues(names);
        },
        invalidateCache() {
            allTagsCache = null;
            allTagsPromise = null;
        }
    };
})();
