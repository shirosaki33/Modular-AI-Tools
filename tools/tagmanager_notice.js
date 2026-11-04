/* =========================================================================
   NOTICE BARS (Tag Manager) — single place for persistent notice bars
   ---------------------------------------------------------------------
   Persistent bars ("You have unsaved changes", "Auto-Do modified ...") used
   to be separate hand-styled <div>s. Now they all live in one stack
   (#tm-notice-stack, created on demand right before #workspace) and share
   the same look.

     TM.notice.show(id, { text | html, theme, icon, order, dismissible, onDismiss })
         theme: 'warn' (yellow) | 'success' (green) | 'error' | 'info'
         order: lower = higher in the stack (default 0)
         Calling show() again with the same id updates the bar in place.
     TM.notice.hide(id)    -> removes the bar (no-op if not shown)
     TM.notice.has(id)     -> true if the bar is currently shown

   Transient messages keep using window.showAlert (tagmanager_alert.js).
   Must load after tagmanager_tm.js; no other dependency.
========================================================================= */

(function () {
    const TM = window.TM = window.TM || {};
    if (TM.notice) return;

    const THEMES = {
        warn:    { accent: '#ffd040', bg: '#101723', icon: '⚠️' },
        success: { accent: '#00ff99', bg: '#0d1f16', icon: '⚡' },
        error:   { accent: '#ff6060', bg: '#2a0000', icon: '❌' },
        info:    { accent: '#66ccff', bg: '#001a2a', icon: 'ℹ️' }
    };

    const style = document.createElement('style');
    style.textContent = `
        #tm-notice-stack { display: flex; flex-direction: column; gap: 8px; margin: 12px 20px 0 20px; flex-shrink: 0; }
        #tm-notice-stack:empty { display: none; }
        .tm-notice { position: relative; padding: 10px 14px; color: #f5f5f5; border-radius: 7px; font-size: 13.5px; line-height: 1.45; text-align: center; box-sizing: border-box; border-left: 3px solid var(--tm-notice-accent); border-right: 3px solid var(--tm-notice-accent); background: var(--tm-notice-bg); }
        .tm-notice-icon { color: var(--tm-notice-accent); margin: 0 6px; font-size: 14px; line-height: 1; }
        .tm-notice-close { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--tm-notice-accent); font-size: 16px; font-weight: bold; cursor: pointer; padding: 0 6px; line-height: 1; }
    `;
    document.head.appendChild(style);

    function getStack() {
        let stack = document.getElementById('tm-notice-stack');
        if (stack) return stack;
        stack = document.createElement('div');
        stack.id = 'tm-notice-stack';
        const workspace = document.getElementById('workspace');
        if (workspace && workspace.parentNode) workspace.parentNode.insertBefore(stack, workspace);
        else document.body.appendChild(stack);
        return stack;
    }

    function esc(v) { return typeof window.escHTML === 'function' ? window.escHTML(v) : String(v); }

    TM.notice = {
        show(id, opts = {}) {
            const theme = THEMES[opts.theme] || THEMES.warn;
            const stack = getStack();
            let el = document.getElementById(id);
            if (!el || el.parentNode !== stack) {
                el = document.createElement('div');
                el.id = id;
                el.className = 'tm-notice';
                stack.appendChild(el);
            }
            el.style.setProperty('--tm-notice-accent', theme.accent);
            el.style.setProperty('--tm-notice-bg', theme.bg);
            el.style.order = Number.isFinite(opts.order) ? opts.order : 0;

            const icon = `<span class="tm-notice-icon">${opts.icon || theme.icon}</span>`;
            const body = opts.html !== undefined ? opts.html : esc(opts.text === undefined ? '' : opts.text);
            el.innerHTML = `${icon}${body}${icon}` + (opts.dismissible ? '<button class="tm-notice-close" title="Dismiss this notice">&times;</button>' : '');

            if (opts.dismissible) {
                el.querySelector('.tm-notice-close').onclick = () => {
                    TM.notice.hide(id);
                    if (typeof opts.onDismiss === 'function') opts.onDismiss();
                };
            }
            return el;
        },
        hide(id) {
            const el = document.getElementById(id);
            if (el && el.classList.contains('tm-notice')) el.remove();
        },
        has(id) {
            const el = document.getElementById(id);
            return !!(el && el.classList.contains('tm-notice'));
        }
    };
})();
