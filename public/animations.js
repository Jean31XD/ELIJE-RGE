/**
 * animations.js — Capa de animaciones GSAP para Portal de Pedidos
 *
 * Estrategia:
 * - Se carga después de app.js/admin.js; envuelve funciones de UI existentes.
 * - NO toca lógica de negocio.
 * - Respeta prefers-reduced-motion vía gsap.matchMedia().
 * - Solo anima transform + autoAlpha (sin layout-heavy props).
 * - clearProps siempre, para no interferir con CSS base.
 */
(function () {
    if (typeof gsap === 'undefined') {
        console.warn('[animations.js] GSAP no disponible — sin animaciones.');
        return;
    }

    /* ── Defaults globales ───────────────────────────── */
    gsap.defaults({ ease: 'power2.out', duration: 0.22 });

    /* ── Duración efectiva (0 cuando reduce-motion) ──── */
    let D = 0.22;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: reduce)', () => { D = 0; });

    /* ── Utilidades ──────────────────────────────────── */
    const CLEAR = 'transform,opacity,visibility';

    function fadeIn(el, extra = {}) {
        if (!el || D === 0) return;
        gsap.fromTo(el,
            { autoAlpha: 0, y: 10 },
            { autoAlpha: 1, y: 0, duration: D, clearProps: CLEAR, ...extra }
        );
    }

    function staggerIn(els, extra = {}) {
        if (!els || !els.length || D === 0) return;
        gsap.fromTo(Array.from(els),
            { autoAlpha: 0, y: 8 },
            { autoAlpha: 1, y: 0, duration: D, stagger: 0.04, clearProps: CLEAR, ...extra }
        );
    }

    function scaleIn(el, extra = {}) {
        if (!el || D === 0) return;
        gsap.fromTo(el,
            { autoAlpha: 0, scale: 0.96, y: 14 },
            { autoAlpha: 1, scale: 1, y: 0, duration: D + 0.06, ease: 'power3.out', clearProps: CLEAR, ...extra }
        );
    }

    /* ════════════════════════════════════════════════════
       1. INICIO DE APP — sidebar + topbar + nav items
    ════════════════════════════════════════════════════ */
    const _origInitApp = window.initApp;
    if (_origInitApp) {
        window.initApp = function () {
            _origInitApp.apply(this, arguments);
            if (D === 0) return;

            const tl = gsap.timeline({ defaults: { ease: 'power3.out', clearProps: CLEAR } });
            tl.from('.sidebar',  { x: -24, autoAlpha: 0, duration: 0.38 })
              .from('.topbar',   { y: -16, autoAlpha: 0, duration: 0.3 }, '<0.08')
              .from('.nav-item', { x: -14, autoAlpha: 0, duration: 0.28, stagger: 0.045 }, '<0.05');

            const chip = document.getElementById('user-chip');
            if (chip && chip.style.display !== 'none') {
                tl.from(chip, { x: 14, autoAlpha: 0, duration: 0.26 }, '<0.1');
            }
        };
    }

    /* ════════════════════════════════════════════════════
       2. CAMBIO DE VISTA (app.js — switchView)
       Dashboard tiene animaciones por componente; el resto
       recibe un fade+slide del contenedor.
    ════════════════════════════════════════════════════ */
    const _origSwitchView = window.switchView;
    if (_origSwitchView) {
        window.switchView = function (view) {
            _origSwitchView.apply(this, arguments);
            if (D === 0 || view === 'dashboard') return;
            requestAnimationFrame(() => {
                const active = document.querySelector('[id^="vista-"]:not(.hidden)');
                if (active) fadeIn(active, { y: 8, duration: D + 0.03 });
            });
        };
    }

    /* ════════════════════════════════════════════════════
       3. CAMBIO DE TAB EN ADMIN (admin.js — switchAdminTab)
       switchAdminTab usa style.display directo, no .hidden,
       por eso necesita su propio patch.
    ════════════════════════════════════════════════════ */
    const _origSwitchAdminTab = window.switchAdminTab;
    if (_origSwitchAdminTab) {
        window.switchAdminTab = function (tab) {
            _origSwitchAdminTab.apply(this, arguments);
            if (D === 0) return;
            requestAnimationFrame(() => {
                const tabPanels = [
                    'admin-tab-usuarios', 'admin-tab-grupos',
                    'admin-tab-mapa',     'admin-tab-catalogo'
                ];
                const visible = tabPanels
                    .map(id => document.getElementById(id))
                    .find(el => el && el.style.display !== 'none');
                if (visible) fadeIn(visible, { y: 6, duration: D + 0.02 });
            });
        };
    }

    /* ════════════════════════════════════════════════════
       4. TABLAS — stagger de filas al renderizar
       Observa tbody; cuando innerHTML cambia, anima las filas.
       Límite de 35 filas para no sacrificar rendimiento.
    ════════════════════════════════════════════════════ */
    const TBODY_IDS = [
        'pedidos-body', 'cobros-body', 'logs-body', 'rangos-body',
        'admin-users-body', 'admin-groups-body', 'admin-mapa-body',
        'admin-catalogo-body', 'ce-body', 'detalle-body'
    ];

    function observeTbody(id) {
        const el = document.getElementById(id);
        if (!el) return;
        new MutationObserver(() => {
            if (D === 0) return;
            const rows = el.querySelectorAll('tr');
            if (!rows.length) return;
            const visible = Array.from(rows).slice(0, 35);
            staggerIn(visible, { stagger: rows.length > 15 ? 0.02 : 0.04 });
        }).observe(el, { childList: true });
    }

    TBODY_IDS.forEach(observeTbody);

    /* ════════════════════════════════════════════════════
       5. KPI CARDS DEL DASHBOARD — scale+fade con stagger
    ════════════════════════════════════════════════════ */
    const kpiGrid = document.querySelector('.dashboard-kpis');
    if (kpiGrid) {
        let kpiTimer = null;
        new MutationObserver(() => {
            clearTimeout(kpiTimer);
            kpiTimer = setTimeout(() => {
                if (D === 0) return;
                const cards = kpiGrid.querySelectorAll('.kpi-card');
                if (!cards.length) return;
                gsap.fromTo(Array.from(cards),
                    { autoAlpha: 0, y: 16, scale: 0.96 },
                    { autoAlpha: 1, y: 0, scale: 1, duration: D + 0.06, stagger: 0.06, ease: 'power3.out', clearProps: CLEAR }
                );
            }, 60);
        }).observe(kpiGrid, { childList: true, subtree: true });
    }

    /* ════════════════════════════════════════════════════
       6. CARDS DEL DASHBOARD (charts + rankings)
    ════════════════════════════════════════════════════ */
    const vistaDash = document.getElementById('vista-dashboard');
    if (vistaDash) {
        let dashTimer = null;
        new MutationObserver(() => {
            clearTimeout(dashTimer);
            dashTimer = setTimeout(() => {
                if (D === 0) return;
                const cards = vistaDash.querySelectorAll(
                    '.dashboard-chart-card:not([data-gsap-done]), .dashboard-ranking-card:not([data-gsap-done])'
                );
                if (!cards.length) return;
                cards.forEach(c => c.setAttribute('data-gsap-done', '1'));
                gsap.fromTo(Array.from(cards),
                    { autoAlpha: 0, y: 14 },
                    { autoAlpha: 1, y: 0, duration: D + 0.04, stagger: 0.05, ease: 'power2.out', clearProps: CLEAR }
                );
            }, 80);
        }).observe(vistaDash, { childList: true, subtree: true });
    }

    /* ════════════════════════════════════════════════════
       7. MODALES — scale+fade al abrir
       Detecta cuando se retira la clase .hidden de cualquier modal
       (funciona para los modales de app.js y admin.js).
    ════════════════════════════════════════════════════ */
    document.querySelectorAll('.modal').forEach(modal => {
        new MutationObserver((mutations) => {
            mutations.forEach(m => {
                if (m.attributeName !== 'class') return;
                const wasHidden = (m.oldValue || '').includes('hidden');
                const isVisible  = !modal.classList.contains('hidden');
                if (wasHidden && isVisible) {
                    const content = modal.querySelector('.modal-content');
                    if (content) scaleIn(content);
                }
            });
        }).observe(modal, { attributes: true, attributeOldValue: true });
    });

    /* ════════════════════════════════════════════════════
       8. TOASTS — slide desde la derecha
       Observa #toast-container para detectar cualquier toast nuevo
       (cubre tanto showToast de app.js como showToastAdmin de admin.js).
    ════════════════════════════════════════════════════ */
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) {
        new MutationObserver((mutations) => {
            if (D === 0) return;
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (!node.classList.contains('toast')) return;
                    gsap.fromTo(node,
                        { x: 60, autoAlpha: 0 },
                        { x: 0, autoAlpha: 1, duration: D + 0.04, ease: 'power3.out', clearProps: CLEAR }
                    );
                });
            });
        }).observe(toastContainer, { childList: true });
    }

    /* ════════════════════════════════════════════════════
       9. BOTONES — micro press-effect al hacer click
    ════════════════════════════════════════════════════ */
    const BTN_SEL = '.btn, .btn-primary, .btn-ghost, .btn-danger, .nav-item, .admin-tab, .btn-ms-login';

    document.addEventListener('pointerdown', (e) => {
        if (D === 0) return;
        const btn = e.target.closest(BTN_SEL);
        if (!btn) return;
        gsap.to(btn, { scale: 0.96, duration: 0.08, ease: 'power2.in', overwrite: 'auto' });
    });

    document.addEventListener('pointerup', (e) => {
        if (D === 0) return;
        const btn = e.target.closest(BTN_SEL);
        if (!btn) return;
        gsap.to(btn, { scale: 1, duration: 0.18, ease: 'back.out(2)', overwrite: 'auto', clearProps: 'transform' });
    });

    document.addEventListener('pointercancel', (e) => {
        const btn = e.target.closest(BTN_SEL);
        if (btn) gsap.set(btn, { clearProps: 'transform' });
    });

})();
