/**
 * Lightweight promise-based modal utilities — replaces native confirm()/prompt().
 *   await openConfirmModal({ title, message, confirmLabel, danger }) -> boolean
 *   await openPromptModal({ title, label, placeholder, defaultValue, confirmLabel }) -> string | null
 */
(function () {
    function overlayEl() {
        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:10000',
            'background:rgba(0,0,0,0.55)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'padding:1rem',
            'opacity:0', 'transition:opacity 0.15s ease',
        ].join(';');
        return overlay;
    }

    function cardEl() {
        const card = document.createElement('div');
        card.style.cssText = [
            'width:100%', 'max-width:26rem',
            'background:var(--color-bg-surface)',
            'border:1px solid color-mix(in srgb, var(--color-border) 80%, transparent)',
            'border-radius:1rem',
            'box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)',
            'padding:1.5rem',
            'transform:translateY(8px) scale(0.98)',
            'transition:transform 0.15s ease',
        ].join(';');
        return card;
    }

    function show(overlay, card) {
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            card.style.transform = 'translateY(0) scale(1)';
        });
    }

    function close(overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 150);
    }

    window.openConfirmModal = function (opts) {
        opts = opts || {};
        const title = opts.title || 'Are you sure?';
        const message = opts.message || '';
        const confirmLabel = opts.confirmLabel || 'Confirm';
        const cancelLabel = opts.cancelLabel || 'Cancel';
        const danger = !!opts.danger;

        return new Promise((resolve) => {
            const overlay = overlayEl();
            const card = cardEl();

            card.innerHTML = `
                <h3 style="font-size:1rem;font-weight:800;color:var(--color-text-primary);margin:0 0 0.5rem">${title}</h3>
                <p style="font-size:0.8125rem;color:var(--color-text-secondary);line-height:1.5;margin:0 0 1.25rem">${message}</p>
                <div style="display:flex;justify-content:flex-end;gap:0.5rem">
                    <button type="button" data-cancel style="padding:0.5rem 1rem;border-radius:0.5rem;font-size:0.8125rem;font-weight:700;background:transparent;color:var(--color-text-secondary);border:1px solid color-mix(in srgb, var(--color-border) 70%, transparent);cursor:pointer">${cancelLabel}</button>
                    <button type="button" data-confirm style="padding:0.5rem 1rem;border-radius:0.5rem;font-size:0.8125rem;font-weight:700;border:none;cursor:pointer;color:${danger ? '#fff' : 'var(--color-bg-main)'};background:${danger ? 'var(--color-error)' : 'var(--color-primary)'}">${confirmLabel}</button>
                </div>
            `;
            overlay.appendChild(card);

            const finish = (result) => { close(overlay); resolve(result); };
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
            card.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
            card.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
            document.addEventListener('keydown', function onKey(e) {
                if (e.key === 'Escape') { finish(false); document.removeEventListener('keydown', onKey); }
            });

            show(overlay, card);
        });
    };

    window.openPromptModal = function (opts) {
        opts = opts || {};
        const title = opts.title || 'Enter a value';
        const label = opts.label || '';
        const placeholder = opts.placeholder || '';
        const defaultValue = opts.defaultValue || '';
        const confirmLabel = opts.confirmLabel || 'Save';

        return new Promise((resolve) => {
            const overlay = overlayEl();
            const card = cardEl();

            card.innerHTML = `
                <h3 style="font-size:1rem;font-weight:800;color:var(--color-text-primary);margin:0 0 1rem">${title}</h3>
                <label style="display:block;font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--color-text-secondary);margin-bottom:0.375rem">${label}</label>
                <input type="text" data-input placeholder="${placeholder}" value="${defaultValue}"
                    style="width:100%;padding:0.5rem 0.75rem;border-radius:0.5rem;background:var(--color-bg-main);border:1px solid color-mix(in srgb, var(--color-border) 70%, transparent);color:var(--color-text-primary);font-size:0.875rem;margin-bottom:1.25rem;box-sizing:border-box">
                <div style="display:flex;justify-content:flex-end;gap:0.5rem">
                    <button type="button" data-cancel style="padding:0.5rem 1rem;border-radius:0.5rem;font-size:0.8125rem;font-weight:700;background:transparent;color:var(--color-text-secondary);border:1px solid color-mix(in srgb, var(--color-border) 70%, transparent);cursor:pointer">Cancel</button>
                    <button type="button" data-confirm style="padding:0.5rem 1rem;border-radius:0.5rem;font-size:0.8125rem;font-weight:700;border:none;cursor:pointer;color:var(--color-bg-main);background:var(--color-primary)">${confirmLabel}</button>
                </div>
            `;
            overlay.appendChild(card);

            const input = card.querySelector('[data-input]');
            const finish = (result) => { close(overlay); resolve(result); };
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
            card.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
            card.querySelector('[data-confirm]').addEventListener('click', () => finish(input.value.trim() || null));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') finish(input.value.trim() || null);
                if (e.key === 'Escape') finish(null);
            });

            show(overlay, card);
            setTimeout(() => input.focus(), 50);
        });
    };
})();
