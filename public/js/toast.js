/**
 * Reusable toast notifications. Include this file on any page, then call:
 *   showToast('Message', 'success' | 'error' | 'warning' | 'info', 4000)
 */
(function () {
    const ICONS = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info',
    };

    const COLOR_VARS = {
        success: '--color-success',
        error: '--color-error',
        warning: '--color-warning',
        info: '--color-primary',
    };

    function getContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = [
                'position:fixed', 'top:1rem', 'right:1rem', 'z-index:9999',
                'display:flex', 'flex-direction:column', 'gap:0.75rem',
                'max-width:24rem', 'width:calc(100% - 2rem)',
                'pointer-events:none',
            ].join(';');
            document.body.appendChild(container);
        }
        return container;
    }

    function showToast(message, type = 'info', duration = 4000) {
        const container = getContainer();
        const colorVar = COLOR_VARS[type] || COLOR_VARS.info;
        const icon = ICONS[type] || ICONS.info;

        const toast = document.createElement('div');
        toast.setAttribute('role', 'alert');
        toast.style.cssText = [
            'pointer-events:auto',
            'display:flex', 'align-items:flex-start', 'gap:0.75rem',
            'padding:0.875rem 1rem',
            'background:var(--color-bg-surface)',
            `border:1px solid color-mix(in srgb, var(${colorVar}) 30%, transparent)`,
            `border-left:3px solid var(${colorVar})`,
            'border-radius:0.75rem',
            'box-shadow:0 10px 25px -5px rgba(0,0,0,0.3)',
            'font-size:0.875rem',
            'color:var(--color-text-primary)',
            'opacity:0', 'transform:translateX(1rem)',
            'transition:opacity 0.2s ease, transform 0.2s ease',
        ].join(';');

        toast.innerHTML = `
            <i class="fa-solid ${icon}" style="color:var(${colorVar});margin-top:2px;flex-shrink:0"></i>
            <span style="flex:1;line-height:1.4">${message}</span>
            <button type="button" aria-label="Dismiss" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);flex-shrink:0;padding:0;line-height:1">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        const remove = () => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(1rem)';
            setTimeout(() => toast.remove(), 200);
        };

        toast.querySelector('button').addEventListener('click', remove);
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });

        if (duration > 0) {
            setTimeout(remove, duration);
        }

        return toast;
    }

    window.showToast = showToast;
})();
