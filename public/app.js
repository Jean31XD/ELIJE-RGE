// Auth helper — delegates to login.js (loaded before app.js)
// credentials: 'include' envía la cookie HttpOnly automáticamente
function apiFetch(url, options = {}) {
    options.credentials = 'include';
    options.headers = Object.assign({}, options.headers || {});
    return fetch(url, options).then(res => {
        if (res.status === 401) {
            if (typeof mostrarLoginOverlay === 'function') mostrarLoginOverlay();
            throw new Error('No autenticado');
        }
        return res;
    });
}

// Dark mode theme toggle
function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// Mobile sidebar toggle
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) { closeSidebar(); } else { openSidebar(); }
}
function openSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}

let todosLosPedidos = [];
let pedidoActual = null;
let pedidosFiltrados = [];
let paginaActual = 1;
let registrosPorPagina = 20;
let pedidoSortCol = 'fecha_pedido';
let pedidoSortDir = 'desc';
let pedidoAutoRefresh = null;
let pedidoIndexDetalle = -1;

const formatter = new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    minimumFractionDigits: 2
});

let dynamicsData = null;
let todosLosRangos = [];
let todosLosLogs = [];
let logsPaginaActual = 1;
let logsRegistrosPorPagina = 20;
let dashboardData = null;
let dashboardCharts = {};
let todosLosCobros = [];
let cobrosFiltrados = [];
let cobrosPaginaActual = 1;
let cobrosRegistrosPorPagina = 20;

let trackingMap = null;
let trackingMarkers = [];
let trackingPolyline = null;
let todosLosTracking = [];
let trackingFiltrados = [];
let trackAutoRefresh = null;
let trackCountdownInterval = null;
let mapBoundsLocked = false;
let _suppressMapLock = false;
let trackingLastUpdated = null;
let trackingClusterGroup = null;
let trackingMarkerMap = {};
let vendedorColorMap = {};
let vendedorColorIndex = 0;

// === Inicializacion ===
window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    // Delegate to auth check — login.js calls initApp() after successful auth
    if (typeof checkAuth === 'function') {
        checkAuth();
    } else {
        initApp();
    }
});

function initApp(apiUser) {
    // Preferir el usuario del API (fresco) sobre la cookie (puede estar desactualizada)
    const user = apiUser || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);

    // Show sidebar and main content, hide overlay
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-content');
    const overlay = document.getElementById('login-overlay');
    if (sidebar) sidebar.classList.remove('auth-hidden');
    if (main) main.classList.remove('auth-hidden');
    if (overlay) overlay.classList.add('hidden');

    // Show/hide nav items based on user role and modules
    if (user) {
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            const view = item.dataset.view;
            if (view === 'admin') {
                item.style.display = user.role === 'admin' ? '' : 'none';
            } else if (user.role === 'admin') {
                item.style.display = '';
            } else {
                item.style.display = user.modules && user.modules.includes(view) ? '' : 'none';
            }
        });

        // Show user chip
        const chip = document.getElementById('user-chip');
        if (chip) {
            chip.style.display = 'flex';
            const nameStr = user.display_name || user.email || '';
            const initials = nameStr.split(' ').map(w => w[0]).filter(Boolean).join('').substring(0, 2).toUpperCase();
            const initialsEl = document.getElementById('user-initials');
            const nameEl = document.getElementById('user-chip-name');
            const roleEl = document.getElementById('user-chip-role');
            if (initialsEl) initialsEl.textContent = initials;
            if (nameEl) nameEl.textContent = user.display_name || user.email;
            const roleLabels = { admin: 'Admin', supervisor: 'Supervisor', viewer: 'Visor' };
            if (roleEl) roleEl.textContent = roleLabels[user.role] || user.role;
        }
    }

    checkHealth();
    cargarDashboard();

    document.getElementById('searchGlobal').addEventListener('input', aplicarFiltros);
    document.getElementById('fechaDesde').addEventListener('change', aplicarFiltros);
    document.getElementById('fechaHasta').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroEstado').addEventListener('change', aplicarFiltros);

    // Sort headers
    document.querySelectorAll('th.sortable[data-col]').forEach(th => {
        th.addEventListener('click', () => sortarPedidos(th.dataset.col));
    });

    // Filtros de Cobros
    const searchCobros = document.getElementById('searchCobros');
    if (searchCobros) searchCobros.addEventListener('input', aplicarFiltrosCobros);
    const cobrosDesde = document.getElementById('cobrosDesde');
    if (cobrosDesde) cobrosDesde.addEventListener('change', aplicarFiltrosCobros);
    const cobrosHasta = document.getElementById('cobrosHasta');
    if (cobrosHasta) cobrosHasta.addEventListener('change', aplicarFiltrosCobros);

    // Navegacion sidebar
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
            const view = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            switchView(view);
        });
    });

    // Formulario de Rangos
    const formRango = document.getElementById('form-rango');
    if (formRango) {
        formRango.addEventListener('submit', guardarRango);
    }

    // Buscador de Rangos
    const searchRangos = document.getElementById('searchRangos');
    if (searchRangos) {
        searchRangos.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtrados = todosLosRangos.filter(r =>
                r.categoria.toLowerCase().includes(query) ||
                String(r.rango_min).includes(query) ||
                String(r.rango_max).includes(query) ||
                String(r.valor).includes(query)
            );
            renderizarTablaRangos(filtrados);
        });
    }
}

// === Health Check ===
async function checkHealth() {
    const statusEl = document.getElementById('dbStatus');
    const dot = statusEl.querySelector('.status-dot');
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        if (data.status === 'ok') {
            dot.classList.add('connected');
            dot.classList.remove('error');
            statusEl.innerHTML = '';
            statusEl.appendChild(dot);
            statusEl.append(' Base de datos conectada');
        }
    } catch {
        dot.classList.add('error');
        dot.classList.remove('connected');
        statusEl.innerHTML = '';
        statusEl.appendChild(dot);
        statusEl.append(' Sin conexion');
    }
}

// === Cargar Pedidos ===
async function cargarPedidos() {
    const body = document.getElementById('pedidos-body');
    const loader = document.getElementById('loading-state');
    const empty = document.getElementById('empty-state');

    body.innerHTML = '';
    loader.classList.remove('hidden');
    empty.classList.add('hidden');

    try {
        const res = await apiFetch('/api/pedidos');
        if (!res.ok) throw new Error('Error del servidor');
        todosLosPedidos = await res.json();
        loader.classList.add('hidden');
        poblarVendedores();
        aplicarFiltros();
        renderizarKpisPedidos();
        checkHealth();
    } catch (error) {
        loader.innerHTML = '<p style="color: var(--danger);">Error de conexion con la base de datos</p>';
        console.error(error);
    }
}

async function cargarPedidosSilencioso() {
    try {
        const res = await apiFetch('/api/pedidos');
        if (!res.ok) return;
        const nuevos = await res.json();
        const hashNuevos = nuevos.map(p => p.pedido_id + p.enviado_dynamics + (p.sync_error || '')).join('|');
        const hashActual = todosLosPedidos.map(p => p.pedido_id + p.enviado_dynamics + (p.sync_error || '')).join('|');
        if (hashNuevos !== hashActual) {
            todosLosPedidos = nuevos;
            poblarVendedores();
            aplicarFiltros(); // llama renderizarKpisPedidos internamente
        }
    } catch { }
}

function poblarVendedores() {
    const select = document.getElementById('filtroVendedor');
    if (!select) return;
    const valorActual = select.value;
    const vendedores = [...new Set(todosLosPedidos.map(p => p.vendedor_nombre).filter(Boolean))].sort();
    select.innerHTML = '<option value="todos">Todos</option>' +
        vendedores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (vendedores.includes(valorActual)) select.value = valorActual;
}

function renderizarKpisPedidos() {
    const estadoActivo = document.getElementById('filtroEstado')?.value || 'todos';

    // Aplicar búsqueda, fechas y vendedor (todo menos estado) para que los conteos
    // reflejen el contexto actual del usuario
    const busqueda = document.getElementById('searchGlobal')?.value.toLowerCase().trim() || '';
    const desde = document.getElementById('fechaDesde')?.value || '';
    const hasta = document.getElementById('fechaHasta')?.value || '';
    const vendedor = document.getElementById('filtroVendedor')?.value || 'todos';

    const base = todosLosPedidos.filter(p => {
        if (busqueda) {
            const texto = `${p.pedido_numero} ${p.cliente_nombre} ${p.vendedor_nombre} ${p.cliente_rnc || ''} ${p.dynamics_order_number || ''}`.toLowerCase();
            if (!texto.includes(busqueda)) return false;
        }
        const fecha = p.fecha_pedido ? p.fecha_pedido.split('T')[0] : '';
        if (desde && fecha < desde) return false;
        if (hasta && fecha > hasta) return false;
        if (vendedor !== 'todos' && p.vendedor_nombre !== vendedor) return false;
        return true;
    });

    const total = base.length;
    const enviados = base.filter(p => p.enviado_dynamics).length;
    const errores = base.filter(p => p.sync_error && !p.enviado_dynamics).length;
    const pendientes = base.filter(p => !p.enviado_dynamics && !p.sync_error).length;

    const kpisEl = document.getElementById('pedidos-kpis');
    if (!kpisEl) return;
    kpisEl.innerHTML = `
        <button class="ped-kpi ${estadoActivo === 'todos' ? 'active' : ''}" onclick="filtrarPorEstado('todos')">
            <span class="ped-kpi-val">${total}</span><span class="ped-kpi-lbl">Total</span>
        </button>
        <button class="ped-kpi ped-kpi--warning ${estadoActivo === 'pendiente' ? 'active' : ''}" onclick="filtrarPorEstado('pendiente')">
            <span class="ped-kpi-val">${pendientes}</span><span class="ped-kpi-lbl">Pendientes</span>
        </button>
        <button class="ped-kpi ped-kpi--danger ${estadoActivo === 'error' ? 'active' : ''}" onclick="filtrarPorEstado('error')">
            <span class="ped-kpi-val">${errores}</span><span class="ped-kpi-lbl">Con Error</span>
        </button>
        <button class="ped-kpi ped-kpi--success ${estadoActivo === 'enviado' ? 'active' : ''}" onclick="filtrarPorEstado('enviado')">
            <span class="ped-kpi-val">${enviados}</span><span class="ped-kpi-lbl">Enviados</span>
        </button>
    `;
}

function filtrarPorEstado(estado) {
    const sel = document.getElementById('filtroEstado');
    if (sel) sel.value = estado;
    aplicarFiltros(); // ya llama renderizarKpisPedidos internamente
}

// === Filtros ===
function aplicarFiltros() {
    const busqueda = document.getElementById('searchGlobal').value.toLowerCase().trim();
    const desde = document.getElementById('fechaDesde').value;
    const hasta = document.getElementById('fechaHasta').value;
    const estado = document.getElementById('filtroEstado').value;
    const vendedor = document.getElementById('filtroVendedor')?.value || 'todos';

    pedidosFiltrados = todosLosPedidos.filter(p => {
        // Texto
        if (busqueda) {
            const texto = `${p.pedido_numero} ${p.cliente_nombre} ${p.vendedor_nombre} ${p.cliente_rnc || ''} ${p.dynamics_order_number || ''}`.toLowerCase();
            if (!texto.includes(busqueda)) return false;
        }

        // Fechas
        const fecha = p.fecha_pedido ? p.fecha_pedido.split('T')[0] : '';
        if (desde && fecha < desde) return false;
        if (hasta && fecha > hasta) return false;

        // Vendedor
        if (vendedor !== 'todos' && p.vendedor_nombre !== vendedor) return false;

        // Estado
        if (estado === 'pendiente' && (p.enviado_dynamics || p.sync_error)) return false;
        if (estado === 'enviado' && !p.enviado_dynamics) return false;
        if (estado === 'error' && !(p.sync_error && !p.enviado_dynamics)) return false;

        return true;
    });

    // Ordenar
    pedidosFiltrados.sort((a, b) => {
        let va = a[pedidoSortCol] ?? '', vb = b[pedidoSortCol] ?? '';
        if (pedidoSortCol === 'total') { va = +va; vb = +vb; }
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return pedidoSortDir === 'asc' ? cmp : -cmp;
    });

    paginaActual = 1;
    renderizarPagina();
    actualizarSortHeaders();
    renderizarKpisPedidos();
}

function sortarPedidos(col) {
    if (pedidoSortCol === col) {
        pedidoSortDir = pedidoSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        pedidoSortCol = col;
        pedidoSortDir = col === 'total' ? 'desc' : 'asc';
    }
    aplicarFiltros();
}

function actualizarSortHeaders() {
    document.querySelectorAll('th.sortable[data-col]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.col === pedidoSortCol) {
            th.classList.add(pedidoSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

function renderizarPagina() {
    const totalPaginas = Math.ceil(pedidosFiltrados.length / registrosPorPagina);
    const inicio = (paginaActual - 1) * registrosPorPagina;
    const fin = inicio + registrosPorPagina;
    const datosPagina = pedidosFiltrados.slice(inicio, fin);

    renderizarTabla(datosPagina);
    renderizarPaginacion(totalPaginas);
}

function cambiarPagina(pagina) {
    const totalPaginas = Math.ceil(pedidosFiltrados.length / registrosPorPagina);
    if (pagina < 1 || pagina > totalPaginas) return;
    paginaActual = pagina;
    renderizarPagina();
}

function cambiarRegistrosPorPagina(valor) {
    registrosPorPagina = parseInt(valor);
    paginaActual = 1;
    renderizarPagina();
}

function renderizarPaginacion(totalPaginas) {
    const container = document.getElementById('pagination-container');
    if (!container) return;

    const inicio = (paginaActual - 1) * registrosPorPagina + 1;
    const fin = Math.min(paginaActual * registrosPorPagina, pedidosFiltrados.length);
    const total = pedidosFiltrados.length;

    if (total === 0) {
        container.innerHTML = '';
        return;
    }

    // Generar botones de páginas
    let paginas = '';
    const maxBotones = 5;
    let startPage = Math.max(1, paginaActual - Math.floor(maxBotones / 2));
    let endPage = Math.min(totalPaginas, startPage + maxBotones - 1);
    if (endPage - startPage < maxBotones - 1) {
        startPage = Math.max(1, endPage - maxBotones + 1);
    }

    if (startPage > 1) {
        paginas += `<button class="page-btn" onclick="cambiarPagina(1)">1</button>`;
        if (startPage > 2) paginas += `<span class="page-ellipsis">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        paginas += `<button class="page-btn ${i === paginaActual ? 'active' : ''}" onclick="cambiarPagina(${i})">${i}</button>`;
    }

    if (endPage < totalPaginas) {
        if (endPage < totalPaginas - 1) paginas += `<span class="page-ellipsis">...</span>`;
        paginas += `<button class="page-btn" onclick="cambiarPagina(${totalPaginas})">${totalPaginas}</button>`;
    }

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${inicio}-${fin}</strong> de <strong>${total}</strong> registros
        </div>
        <div class="pagination-controls">
            <select class="page-size-select" onchange="cambiarRegistrosPorPagina(this.value)">
                <option value="10" ${registrosPorPagina === 10 ? 'selected' : ''}>10 por página</option>
                <option value="20" ${registrosPorPagina === 20 ? 'selected' : ''}>20 por página</option>
                <option value="50" ${registrosPorPagina === 50 ? 'selected' : ''}>50 por página</option>
                <option value="100" ${registrosPorPagina === 100 ? 'selected' : ''}>100 por página</option>
            </select>
            <div class="page-buttons">
                <button class="page-btn nav-btn" onclick="cambiarPagina(${paginaActual - 1})" ${paginaActual === 1 ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                ${paginas}
                <button class="page-btn nav-btn" onclick="cambiarPagina(${paginaActual + 1})" ${paginaActual === totalPaginas ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        </div>
    `;
}

// === Renderizar Tabla ===
function renderizarTabla(datos) {
    const body = document.getElementById('pedidos-body');
    const contador = document.getElementById('contador');
    const empty = document.getElementById('empty-state');

    contador.textContent = `${pedidosFiltrados.length} de ${todosLosPedidos.length}`;

    if (datos.length === 0) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    body.innerHTML = datos.map(p => {
        const fecha = p.fecha_pedido
            ? new Date(p.fecha_pedido).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
            : '-';

        let estadoClass = 'status-pendiente';
        let estadoText = 'Pendiente';

        if (p.enviado_dynamics) {
            estadoClass = 'status-enviado';
            estadoText = 'Sincronizado';
        } else if (p.sync_error) {
            estadoClass = 'status-error';
            estadoText = 'Error Sync';
        }

        const errorSnippet = p.sync_error
            ? `<div class="error-snippet">${escapeHtml(p.sync_error.substring(0, 80))}${p.sync_error.length > 80 ? '…' : ''}</div>`
            : '';

        const ovCol = p.dynamics_order_number
            ? `<span class="dynamics-num">${escapeHtml(p.dynamics_order_number)}</span>
               <button class="copy-btn" title="Copiar" onclick="copiarAlPortapapeles('${escapeHtml(p.dynamics_order_number)}',event)">⎘</button>`
            : '<span style="color: var(--text-secondary);">-</span>';

        const retryBtn = (!p.enviado_dynamics)
            ? `<button class="btn btn-ghost btn-sm" onclick="reintentarPedido(event, ${p.pedido_id})" title="Forzar reintento de envío de este pedido">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
               </button>`
            : '';

        return `
            <tr id="pedido-row-${p.pedido_id}" class="clickable-row" onclick="verDetalle(${p.pedido_id})">
                <td><span class="pedido-num">${escapeHtml(p.pedido_numero)}</span></td>
                <td>${escapeHtml(p.cliente_nombre)}</td>
                <td>${escapeHtml(p.cliente_rnc || '-')}</td>
                <td>${escapeHtml(p.vendedor_nombre)}</td>
                <td>${fecha}</td>
                <td class="text-right"><span class="money">${formatter.format(p.total)}</span></td>
                <td class="text-center">
                    <span class="status ${estadoClass}">${estadoText}</span>
                    ${errorSnippet}
                </td>
                <td class="text-center">${ovCol}</td>
                <td style="white-space: nowrap;" onclick="event.stopPropagation()">
                    <div style="display: flex; gap: 4px; justify-content: flex-end;">
                        ${retryBtn}
                        <button class="btn btn-primary btn-sm" onclick="verDetalle(${p.pedido_id})">
                            Detalle
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function reintentarPedido(event, pedidoId) {
    if (event) event.stopPropagation();

    const btn = event.currentTarget;
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-sm"></div>';

    try {
        const res = await apiFetch(`/api/pedidos/${pedidoId}/retry`, { method: 'POST' });

        let data = {};
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.toLowerCase().includes("application/json")) {
            data = await res.json();
        } else if (!res.ok) {
            const text = await res.text();
            throw new Error(`Respuesta no-JSON (HTTP ${res.status}): ${text.substring(0, 100)}`);
        }

        if (!res.ok) throw new Error(data.error || 'Error al procesar pedido');

        showToast(`Pedido enviado correctamente`, 'success');
        btn.innerHTML = '✅';
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            cargarPedidosSilencioso();
        }, 1500);

    } catch (error) {
        console.error('Error en reintentarPedido:', error);
        let userMsg = error.message;
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            userMsg = 'Error de conexión con el servidor. El proceso podría seguir en curso en segundo plano.';
        }
        showToast('Error: ' + userMsg, 'error');
        btn.innerHTML = '❌';
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            cargarPedidosSilencioso();
        }, 2000);
    }
}

// === Ver Detalle ===
async function verDetalle(pedidoId) {
    pedidoActual = todosLosPedidos.find(p => p.pedido_id === pedidoId);
    if (!pedidoActual) return;

    // Índice en pedidosFiltrados para prev/next
    pedidoIndexDetalle = pedidosFiltrados.findIndex(p => p.pedido_id === pedidoId);

    // Mostrar vista detalle
    document.getElementById('vista-lista').classList.add('hidden');
    document.getElementById('vista-detalle').classList.remove('hidden');
    document.getElementById('page-title').textContent = `Pedido ${pedidoActual.pedido_numero}`;

    // Navegación prev/next
    const btnPrev = document.getElementById('btn-prev-detalle');
    const btnNext = document.getElementById('btn-next-detalle');
    const navPos = document.getElementById('detail-nav-pos');
    if (btnPrev) btnPrev.disabled = pedidoIndexDetalle <= 0;
    if (btnNext) btnNext.disabled = pedidoIndexDetalle >= pedidosFiltrados.length - 1;
    if (navPos) navPos.textContent = pedidosFiltrados.length > 0
        ? `${pedidoIndexDetalle + 1} / ${pedidosFiltrados.length}` : '';

    // Botón retry en detalle
    const retryBtn = document.getElementById('btn-retry-detalle');
    if (retryBtn) retryBtn.classList.toggle('hidden', !(pedidoActual.sync_error && !pedidoActual.enviado_dynamics));

    // Header info
    const headerEl = document.getElementById('detail-header-info');
    const fecha = pedidoActual.fecha_pedido
        ? new Date(pedidoActual.fecha_pedido).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })
        : '-';

    headerEl.innerHTML = `
        <div class="detail-field">
            <span class="label">Pedido</span>
            <span class="value">${escapeHtml(pedidoActual.pedido_numero)}</span>
        </div>
        <div class="detail-field">
            <span class="label">Cliente</span>
            <span class="value">${escapeHtml(pedidoActual.cliente_nombre)}</span>
        </div>
        <div class="detail-field">
            <span class="label">RNC</span>
            <span class="value">${escapeHtml(pedidoActual.cliente_rnc || '-')}</span>
        </div>
        <div class="detail-field">
            <span class="label">Vendedor</span>
            <span class="value">${escapeHtml(pedidoActual.vendedor_nombre)}</span>
        </div>
        <div class="detail-field">
            <span class="label">Fecha</span>
            <span class="value">${fecha}</span>
        </div>
        <div class="detail-field">
            <span class="label">Total</span>
            <span class="value" style="color: var(--success);">${formatter.format(pedidoActual.total)}</span>
        </div>
        <div class="detail-field">
            <span class="label">Estado</span>
            <span class="value">${pedidoActual.enviado_dynamics ? 'Enviado a Dynamics' : (pedidoActual.sync_error ? 'Error de Sincronización' : 'Pendiente')}</span>
        </div>
        ${pedidoActual.dynamics_order_number ? `
        <div class="detail-field">
            <span class="label">Orden Dynamics</span>
            <span class="value">${escapeHtml(pedidoActual.dynamics_order_number)}</span>
        </div>
        ` : ''}
        ${pedidoActual.sync_error ? `
        <div class="detail-field" style="grid-column: span 2; background: #fff5f5; padding: 10px; border-radius: 6px; border-left: 4px solid var(--danger);">
            <span class="label" style="color: var(--danger);">Mensaje Error Dynamics</span>
            <span class="value" style="color: var(--danger); font-size: 13px; white-space: normal;">${escapeHtml(pedidoActual.sync_error)}</span>
        </div>
        ` : ''}
        ${pedidoActual.cliente_direccion ? `
        <div class="detail-field" style="grid-column: span 2; background: #f5f7fa; padding: 10px; border-radius: 6px; border-left: 4px solid var(--text-secondary);">
            <span class="label">Dirección de Entrega</span>
            <span class="value" style="font-size: 13px; white-space: pre-line;">${escapeHtml(pedidoActual.cliente_direccion)}</span>
        </div>
        ` : ''}
        ${pedidoActual.observaciones ? `
        <div class="detail-field" style="grid-column: span 2; background: #f0f7ff; padding: 10px; border-radius: 6px; border-left: 4px solid var(--primary);">
            <span class="label">Observaciones</span>
            <span class="value" style="font-size: 13px; white-space: normal;">${escapeHtml(pedidoActual.observaciones)}</span>
        </div>
        ` : ''}
    `;

    // Cargar lineas
    const detalleBody = document.getElementById('detalle-body');
    const detalleFooter = document.getElementById('detalle-footer');
    const detalleLoading = document.getElementById('detalle-loading');

    detalleBody.innerHTML = '';
    detalleFooter.innerHTML = '';
    detalleLoading.classList.remove('hidden');

    try {
        const res = await apiFetch(`/api/pedidos/${pedidoId}/lineas`);
        if (!res.ok) throw new Error('Error del servidor');
        const lineas = await res.json();
        detalleLoading.classList.add('hidden');

        if (lineas.length === 0) {
            detalleBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary); padding: 32px;">Sin lineas de detalle</td></tr>';
            return;
        }

        let totalLineas = 0;
        let totalCantidad = 0;

        detalleBody.innerHTML = lineas.map(l => {
            totalLineas += l.subtotal_linea || 0;
            totalCantidad += l.cantidad || 0;
            return `
                <tr>
                    <td><span class="dynamics-num">${escapeHtml(l.item_id || '-')}</span></td>
                    <td style="font-weight: 500;">${escapeHtml(l.producto_nombre)}</td>
                    <td>${escapeHtml(l.categoria || '-')}</td>
                    <td>${escapeHtml(l.marca || '-')}</td>
                    <td class="text-center" style="font-weight: 600;">${l.cantidad}</td>
                    <td class="text-right"><span class="money">${formatter.format(l.precio_unitario)}</span></td>
                    <td class="text-right"><span class="money">${formatter.format(l.subtotal_linea)}</span></td>
                </tr>
            `;
        }).join('');

        detalleFooter.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: right; color: var(--text-secondary);">${lineas.length} articulo(s)</td>
                <td class="text-center">${totalCantidad}</td>
                <td></td>
                <td class="text-right"><span class="money" style="color: var(--success); font-size: 14px;">${formatter.format(totalLineas)}</span></td>
            </tr>
        `;
    } catch (error) {
        detalleLoading.classList.add('hidden');
        detalleBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--danger); padding: 32px;">Error al cargar las lineas</td></tr>';
        console.error(error);
    }
}

// === Cerrar Detalle ===
function cerrarDetalle() {
    document.getElementById('vista-lista').classList.remove('hidden');
    document.getElementById('vista-detalle').classList.add('hidden');
    document.getElementById('page-title').textContent = 'Pedidos';
    pedidoActual = null;
    pedidoIndexDetalle = -1;
}

function navegarDetalle(dir) {
    const nuevoIdx = pedidoIndexDetalle + dir;
    if (nuevoIdx < 0 || nuevoIdx >= pedidosFiltrados.length) return;
    verDetalle(pedidosFiltrados[nuevoIdx].pedido_id);
}

async function reintentarDesdeDetalle() {
    if (!pedidoActual) return;
    const btn = document.getElementById('btn-retry-detalle');
    btn.disabled = true;
    btn.textContent = 'Procesando...';
    try {
        const res = await apiFetch(`/api/pedidos/${pedidoActual.pedido_id}/retry`, { method: 'POST' });
        let data = {};
        const ct = res.headers.get('content-type');
        if (ct && ct.includes('application/json')) data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al procesar');
        showToast(`Pedido enviado: ${data.salesOrderNumber || pedidoActual.pedido_numero}`, 'success');
        await cargarPedidosSilencioso();
        // Refrescar pedidoActual desde el array actualizado
        const id = pedidoActual.pedido_id;
        pedidoActual = todosLosPedidos.find(p => p.pedido_id === id);
        if (pedidoActual) verDetalle(id);
    } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Reintentar Dynamics';
    }
}

async function reintentarTodosErrores() {
    const conError = todosLosPedidos.filter(p => p.sync_error && !p.enviado_dynamics);
    if (conError.length === 0) return;
    showToast(`Reintentando ${conError.length} pedido(s) con error...`, 'info');
    let ok = 0, fail = 0;
    for (const p of conError) {
        try {
            const res = await apiFetch(`/api/pedidos/${p.pedido_id}/retry`, { method: 'POST' });
            if (res.ok) ok++;
            else fail++;
        } catch { fail++; }
        await new Promise(r => setTimeout(r, 2000));
    }
    showToast(`Reintentos completados: ${ok} OK, ${fail} fallidos`, ok > 0 ? 'success' : 'error');
    await cargarPedidosSilencioso();
    renderizarKpisPedidos();
}

// === Limpiar Filtros ===
function limpiarFiltros() {
    document.getElementById('searchGlobal').value = '';
    document.getElementById('fechaDesde').value = '';
    document.getElementById('fechaHasta').value = '';
    document.getElementById('filtroEstado').value = 'todos';
    const filtroVendedor = document.getElementById('filtroVendedor');
    if (filtroVendedor) filtroVendedor.value = 'todos';
    pedidoSortCol = 'fecha_pedido';
    pedidoSortDir = 'desc';
    aplicarFiltros(); // llama renderizarKpisPedidos internamente
}

// === Navegacion ===
function switchView(view) {
    document.getElementById('vista-dashboard').classList.add('hidden');
    document.getElementById('vista-lista').classList.add('hidden');
    document.getElementById('vista-detalle').classList.add('hidden');
    document.getElementById('vista-dynamics').classList.add('hidden');
    document.getElementById('vista-logs').classList.add('hidden');
    document.getElementById('vista-rangos').classList.add('hidden');
    document.getElementById('vista-cobros').classList.add('hidden');
    document.getElementById('vista-tracking').classList.add('hidden');
    document.getElementById('vista-clientes-extra').classList.add('hidden');
    const vistaPub = document.getElementById('vista-publicaciones');
    if (vistaPub) vistaPub.classList.add('hidden');
    const vistaAdmin = document.getElementById('vista-admin');
    if (vistaAdmin) vistaAdmin.classList.add('hidden');

    if (view === 'dashboard') {
        document.getElementById('vista-dashboard').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Dashboard';
        document.getElementById('contador').classList.add('hidden');
        cargarDashboard();
    } else if (view === 'pedidos') {
        document.getElementById('vista-lista').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Pedidos';
        document.getElementById('contador').classList.remove('hidden');
        if (todosLosPedidos.length === 0) cargarPedidos();
        else renderizarKpisPedidos();
        if (!pedidoAutoRefresh) {
            pedidoAutoRefresh = setInterval(cargarPedidosSilencioso, 60000);
        }
    } else if (view === 'sync') {
        document.getElementById('vista-dynamics').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Dynamics 365 - Mapeo de Campos';
        document.getElementById('contador').classList.add('hidden');
        if (!dynamicsData) cargarCamposDynamics();
    } else if (view === 'logs') {
        document.getElementById('vista-logs').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Logs de Sincronización';
        document.getElementById('contador').classList.add('hidden');
        cargarLogsSync();
    } else if (view === 'rangos') {
        document.getElementById('vista-rangos').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Gestión de Rangos';
        document.getElementById('contador').classList.add('hidden');
        cargarRangos();
    } else if (view === 'cobros') {
        document.getElementById('vista-cobros').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Cobros Realizados';
        document.getElementById('contador').classList.add('hidden');
        cargarCobros();
    } else if (view === 'tracking') {
        document.getElementById('vista-tracking').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Tracking de Vendedores';
        document.getElementById('contador').classList.add('hidden');
        cargarTracking();
        // Iniciar refresco automático cada 30s si no está activo
        if (!trackAutoRefresh) {
            trackAutoRefresh = setInterval(() => cargarTracking(true), 30000);
        }
        if (!trackCountdownInterval) {
            trackCountdownInterval = setInterval(actualizarIndicadorTiempo, 5000);
        }
    } else if (view === 'clientes-extra') {
        document.getElementById('vista-clientes-extra').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Clientes Asignados a Vendedores';
        document.getElementById('contador').classList.add('hidden');
        cargarClientesExtra();
    } else if (view === 'publicaciones') {
        if (vistaPub) vistaPub.classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Publicaciones e Informaciones';
        document.getElementById('contador').classList.add('hidden');
        cargarPublicacionesAdmin();
    } else if (view === 'admin') {
        const vistaAdm = document.getElementById('vista-admin');
        if (vistaAdm) vistaAdm.classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Administración';
        document.getElementById('contador').classList.add('hidden');
        if (typeof cargarAdmin === 'function') cargarAdmin();
    }

    // Detener refresco de tracking si se sale de la vista
    if (view !== 'tracking') {
        if (trackAutoRefresh) { clearInterval(trackAutoRefresh); trackAutoRefresh = null; }
        if (trackCountdownInterval) { clearInterval(trackCountdownInterval); trackCountdownInterval = null; }
    }
    // Detener refresco de pedidos si se sale de la vista
    if (view !== 'pedidos') {
        if (pedidoAutoRefresh) { clearInterval(pedidoAutoRefresh); pedidoAutoRefresh = null; }
    }
}

// === Logs de Sincronización ===
async function cargarLogsSync() {
    const body = document.getElementById('logs-body');
    const loading = document.getElementById('logs-loading');

    body.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const res = await apiFetch('/api/sync/log');
        if (!res.ok) throw new Error('Error al cargar logs');
        const logs = await res.json();

        loading.classList.add('hidden');
        todosLosLogs = logs.reverse();
        logsPaginaActual = 1;
        renderizarPaginaLogs();
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
    }
}

function renderizarPaginaLogs() {
    const body = document.getElementById('logs-body');
    const total = todosLosLogs.length;

    if (total === 0) {
        body.innerHTML = '<tr><td colspan="2" class="text-center" style="padding: 32px; color: var(--text-secondary);">No hay eventos registrados</td></tr>';
        renderizarPaginacionLogs(0);
        return;
    }

    const totalPaginas = Math.ceil(total / logsRegistrosPorPagina);
    const inicio = (logsPaginaActual - 1) * logsRegistrosPorPagina;
    const fin = inicio + logsRegistrosPorPagina;
    const datosPagina = todosLosLogs.slice(inicio, fin);

    body.innerHTML = datosPagina.map(log => {
        const isError = log.msg.toUpperCase().includes('ERROR');
        const rowClass = isError ? 'style="background: #fff5f5;"' : '';
        const msgClass = isError ? 'style="color: var(--danger); font-weight: 500;"' : '';

        return `
            <tr ${rowClass}>
                <td style="color: var(--text-secondary); font-family: monospace;">${log.time}</td>
                <td ${msgClass}>${escapeHtml(log.msg)}</td>
            </tr>
        `;
    }).join('');

    renderizarPaginacionLogs(totalPaginas);
}

function cambiarPaginaLogs(pagina) {
    const totalPaginas = Math.ceil(todosLosLogs.length / logsRegistrosPorPagina);
    if (pagina < 1 || pagina > totalPaginas) return;
    logsPaginaActual = pagina;
    renderizarPaginaLogs();
}

function cambiarLogsRegistrosPorPagina(valor) {
    logsRegistrosPorPagina = parseInt(valor);
    logsPaginaActual = 1;
    renderizarPaginaLogs();
}

function renderizarPaginacionLogs(totalPaginas) {
    const container = document.getElementById('logs-pagination-container');
    if (!container) return;

    const total = todosLosLogs.length;
    if (total === 0) {
        container.innerHTML = '';
        return;
    }

    const inicio = (logsPaginaActual - 1) * logsRegistrosPorPagina + 1;
    const fin = Math.min(logsPaginaActual * logsRegistrosPorPagina, total);

    let paginas = '';
    const maxBotones = 5;
    let startPage = Math.max(1, logsPaginaActual - Math.floor(maxBotones / 2));
    let endPage = Math.min(totalPaginas, startPage + maxBotones - 1);
    if (endPage - startPage < maxBotones - 1) {
        startPage = Math.max(1, endPage - maxBotones + 1);
    }

    if (startPage > 1) {
        paginas += `<button class="page-btn" onclick="cambiarPaginaLogs(1)">1</button>`;
        if (startPage > 2) paginas += `<span class="page-ellipsis">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        paginas += `<button class="page-btn ${i === logsPaginaActual ? 'active' : ''}" onclick="cambiarPaginaLogs(${i})">${i}</button>`;
    }

    if (endPage < totalPaginas) {
        if (endPage < totalPaginas - 1) paginas += `<span class="page-ellipsis">...</span>`;
        paginas += `<button class="page-btn" onclick="cambiarPaginaLogs(${totalPaginas})">${totalPaginas}</button>`;
    }

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${inicio}-${fin}</strong> de <strong>${total}</strong> registros
        </div>
        <div class="pagination-controls">
            <select class="page-size-select" onchange="cambiarLogsRegistrosPorPagina(this.value)">
                <option value="20" ${logsRegistrosPorPagina === 20 ? 'selected' : ''}>20 por página</option>
                <option value="50" ${logsRegistrosPorPagina === 50 ? 'selected' : ''}>50 por página</option>
                <option value="100" ${logsRegistrosPorPagina === 100 ? 'selected' : ''}>100 por página</option>
                <option value="200" ${logsRegistrosPorPagina === 200 ? 'selected' : ''}>200 por página</option>
            </select>
            <div class="page-buttons">
                <button class="page-btn nav-btn" onclick="cambiarPaginaLogs(${logsPaginaActual - 1})" ${logsPaginaActual === 1 ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                ${paginas}
                <button class="page-btn nav-btn" onclick="cambiarPaginaLogs(${logsPaginaActual + 1})" ${logsPaginaActual === totalPaginas ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        </div>
    `;
}

// === Toast Notifications ===
function showToast(msg, type = 'info', duration = 4000) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.classList.add('toast-out'), duration - 300);
    setTimeout(() => t.remove(), duration);
}

function copiarAlPortapapeles(texto, event) {
    if (event) event.stopPropagation();
    navigator.clipboard.writeText(texto).then(() => showToast('Copiado', 'success', 2000));
}

// === Export CSV ===
function exportarCSVPedidos() {
    if (!pedidosFiltrados.length) { showToast('No hay pedidos para exportar', 'info'); return; }
    const cols = ['pedido_numero', 'cliente_nombre', 'cliente_rnc', 'vendedor_nombre', 'fecha_pedido', 'total', 'estado', 'dynamics_order_number'];
    const headers = ['Pedido', 'Cliente', 'RNC', 'Vendedor', 'Fecha', 'Total', 'Estado', 'Orden Dynamics'];
    const rows = pedidosFiltrados.map(p => {
        const estado = p.enviado_dynamics ? 'Enviado' : (p.sync_error ? 'Error' : 'Pendiente');
        const fecha = p.fecha_pedido ? p.fecha_pedido.split('T')[0] : '';
        return [
            p.pedido_numero, p.cliente_nombre, p.cliente_rnc || '', p.vendedor_nombre,
            fecha, p.total, estado, p.dynamics_order_number || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exportados ${pedidosFiltrados.length} pedidos`, 'success');
}

// === Dynamics 365 Campos ===
async function cargarCamposDynamics() {
    const headerLoading = document.getElementById('dynamics-header-loading');
    const sqlLoading = document.getElementById('sql-loading');
    sqlLoading.classList.remove('hidden');

    // Cargar columnas SQL en paralelo
    try {
        const res = await apiFetch('/api/sql/columnas');
        const cols = await res.json();
        sqlLoading.classList.add('hidden');
        const body = document.getElementById('sql-columns-body');
        body.innerHTML = cols.map(c => `
            <tr>
                <td><span class="dynamics-num">${escapeHtml(c.TABLE_NAME)}</span></td>
                <td style="font-weight: 600;">${escapeHtml(c.COLUMN_NAME)}</td>
                <td>${escapeHtml(c.DATA_TYPE)}</td>
                <td class="text-center">${c.CHARACTER_MAXIMUM_LENGTH || '-'}</td>
                <td class="text-center">${c.IS_NULLABLE}</td>
            </tr>
        `).join('');
    } catch (err) {
        sqlLoading.innerHTML = '<p style="color: var(--danger);">Error consultando SQL</p>';
    }

    // Cargar campos de Dynamics
    try {
        const res = await apiFetch('/api/dynamics/campos');
        if (!res.ok) throw new Error('Error del servidor');
        dynamicsData = await res.json();
        headerLoading.classList.add('hidden');

        document.getElementById('header-count').textContent = dynamicsData.header.length + ' campos';
        document.getElementById('lines-count').textContent = dynamicsData.lines.length + ' campos';

        renderDynamicsTable('dynamics-header-body', dynamicsData.header);
        renderDynamicsTable('dynamics-lines-body', dynamicsData.lines);

        // Filtros de busqueda
        document.getElementById('searchHeader').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const filtered = dynamicsData.header.filter(f => f.campo.toLowerCase().includes(q));
            renderDynamicsTable('dynamics-header-body', filtered);
        });
        document.getElementById('searchLines').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const filtered = dynamicsData.lines.filter(f => f.campo.toLowerCase().includes(q));
            renderDynamicsTable('dynamics-lines-body', filtered);
        });
    } catch (err) {
        headerLoading.innerHTML = '<p style="color: var(--danger);">Error consultando Dynamics 365</p>';
        console.error(err);
    }
}

function renderDynamicsTable(bodyId, fields) {
    const body = document.getElementById(bodyId);
    body.innerHTML = fields.map(f => {
        const valStr = f.valor_ejemplo === null ? '<span style="color:var(--text-secondary);">null</span>'
            : f.tipo === 'string' ? `<span style="color:#059669;">"${escapeHtml(String(f.valor_ejemplo))}"</span>`
                : `<span style="color:#2563eb;">${f.valor_ejemplo}</span>`;
        const typeColor = f.tipo === 'string' ? '#059669' : f.tipo === 'number' ? '#2563eb' : '#94a3b8';
        return `
            <tr>
                <td style="font-weight: 500; font-family: 'SF Mono','Fira Code',monospace; font-size: 12px;">${escapeHtml(f.campo)}</td>
                <td style="font-size: 12px; max-width: 400px; overflow: hidden; text-overflow: ellipsis;">${valStr}</td>
                <td><span style="color: ${typeColor}; font-size: 11px; font-weight: 600;">${f.tipo}</span></td>
            </tr>
        `;
    }).join('');
}
// === Gestión de Rangos ===
async function cargarRangos() {
    const body = document.getElementById('rangos-body');
    const loading = document.getElementById('rangos-loading');

    body.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const res = await apiFetch('/api/rangos');
        if (!res.ok) throw new Error('Error al cargar rangos');
        const rangos = await res.json();
        todosLosRangos = rangos;

        loading.classList.add('hidden');
        renderizarTablaRangos(rangos);
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
    }
}

function renderizarTablaRangos(rangos) {
    const body = document.getElementById('rangos-body');
    if (rangos.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 32px; color: var(--text-secondary);">No se encontraron rangos</td></tr>';
        return;
    }

    body.innerHTML = rangos.map(r => `
        <tr>
            <td><span style="font-weight: 600; color: var(--text);">${escapeHtml(r.categoria)}</span></td>
            <td class="text-center"><span class="dynamics-num">${r.rango_min}</span></td>
            <td class="text-center"><span class="dynamics-num">${r.rango_max}</span></td>
            <td class="text-right"><span class="money">${String(r.valor)}</span></td>
            <td class="text-right">
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="btn btn-ghost btn-sm btn-edit" onclick="abrirModalRango(${r.id})" title="Editar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm btn-delete" onclick="eliminarRango(${r.id})" title="Eliminar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function abrirModalRango(id = null) {
    const modal = document.getElementById('modal-rango');
    const titulo = document.getElementById('modal-rango-titulo');
    const form = document.getElementById('form-rango');

    form.reset();
    document.getElementById('rango-id').value = id || '';

    if (id) {
        titulo.innerText = 'Editar Rango';
        const rango = todosLosRangos.find(r => r.id === id);
        if (rango) {
            document.getElementById('rango-categoria').value = rango.categoria;
            document.getElementById('rango-min').value = rango.rango_min;
            document.getElementById('rango-max').value = rango.rango_max;
            document.getElementById('rango-valor').value = rango.valor;
        }
    } else {
        titulo.innerText = 'Nuevo Rango';
    }

    modal.classList.remove('hidden');
}

function cerrarModalRango() {
    document.getElementById('modal-rango').classList.add('hidden');
}

async function guardarRango(e) {
    e.preventDefault();
    const id = document.getElementById('rango-id').value;
    const data = {
        categoria: document.getElementById('rango-categoria').value,
        rango_min: parseInt(document.getElementById('rango-min').value),
        rango_max: parseInt(document.getElementById('rango-max').value),
        valor: parseFloat(document.getElementById('rango-valor').value)
    };

    try {
        const url = id ? `/api/rangos/${id}` : '/api/rangos';
        const method = id ? 'PUT' : 'POST';

        const res = await apiFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) throw new Error('Error al guardar el rango');

        cerrarModalRango();
        cargarRangos();
    } catch (err) {
        alert(err.message);
    }
}

async function eliminarRango(id) {
    if (!confirm('¿Estás seguro de eliminar este rango?')) return;

    try {
        const res = await apiFetch(`/api/rangos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        cargarRangos();
    } catch (err) {
        alert(err.message);
    }
}

// === Dashboard ===
let dashFilterOptions = null;

async function cargarDashboard(filters = {}) {
    const loading = document.getElementById('dashboard-loading');
    const content = document.getElementById('dashboard-content');

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        // Fetch filter options on first load
        if (!dashFilterOptions) {
            try {
                const fRes = await apiFetch('/api/dashboard/filters');
                if (fRes.ok) dashFilterOptions = await fRes.json();
            } catch (e) { console.warn('No se pudieron cargar filtros:', e); }
        }

        const params = new URLSearchParams();
        if (filters.vendedor) params.set('vendedor', filters.vendedor);
        if (filters.cliente) params.set('cliente', filters.cliente);
        if (filters.desde) params.set('desde', filters.desde);
        if (filters.hasta) params.set('hasta', filters.hasta);

        const url = '/api/dashboard' + (params.toString() ? '?' + params.toString() : '');
        const res = await apiFetch(url);
        if (!res.ok) throw new Error('Error del servidor');
        dashboardData = await res.json();

        loading.classList.add('hidden');
        content.classList.remove('hidden');
        renderDashboard(dashboardData, filters);
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error cargando dashboard: ${err.message}</p>`;
        console.error(err);
    }
}

function aplicarFiltrosDashboard() {
    const vendedor = document.getElementById('dashFiltroVendedor')?.value || '';
    const cliente = document.getElementById('dashFiltroCliente')?.value || '';
    const desde = document.getElementById('dashDesde')?.value || '';
    const hasta = document.getElementById('dashHasta')?.value || '';
    cargarDashboard({ vendedor, cliente, desde, hasta });
}

function limpiarFiltrosDashboard() {
    const v = document.getElementById('dashFiltroVendedor');
    const c = document.getElementById('dashFiltroCliente');
    const d = document.getElementById('dashDesde');
    const h = document.getElementById('dashHasta');
    if (v) v.value = '';
    if (c) c.value = '';
    if (d) d.value = '';
    if (h) h.value = '';
    cargarDashboard();
}

function renderDashboard(data, filters = {}) {
    const content = document.getElementById('dashboard-content');
    const k = data.kpis;

    const syncRate = k.total_pedidos > 0
        ? ((k.enviados_dynamics / k.total_pedidos) * 100).toFixed(1)
        : 0;

    // Dynamic greeting
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Buenos dias' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
    const dateStr = new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const hasFilters = filters.vendedor || filters.cliente || filters.desde || filters.hasta;

    // Build dropdown options
    const vendedorOpts = (dashFilterOptions?.vendedores || []).map(v =>
        `<option value="${escapeHtml(v)}" ${filters.vendedor === v ? 'selected' : ''}>${escapeHtml(v)}</option>`
    ).join('');
    const clienteOpts = (dashFilterOptions?.clientes || []).map(c =>
        `<option value="${escapeHtml(c)}" ${filters.cliente === c ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');

    content.innerHTML = `
        <div class="dashboard-welcome">
            <h2>${greeting}</h2>
            <p>${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}</p>
        </div>

        <div class="dashboard-filters">
            <div class="dash-filter-bar">
                <div class="dash-filter-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                </div>
                <div class="dash-filter-group">
                    <label>Vendedor</label>
                    <select id="dashFiltroVendedor" onchange="aplicarFiltrosDashboard()">
                        <option value="">Todos los vendedores</option>
                        ${vendedorOpts}
                    </select>
                </div>
                <div class="dash-filter-group">
                    <label>Cliente</label>
                    <select id="dashFiltroCliente" onchange="aplicarFiltrosDashboard()">
                        <option value="">Todos los clientes</option>
                        ${clienteOpts}
                    </select>
                </div>
                <div class="dash-filter-group">
                    <label>Desde</label>
                    <input type="date" id="dashDesde" value="${filters.desde || ''}" onchange="aplicarFiltrosDashboard()">
                </div>
                <div class="dash-filter-group">
                    <label>Hasta</label>
                    <input type="date" id="dashHasta" value="${filters.hasta || ''}" onchange="aplicarFiltrosDashboard()">
                </div>
                <button class="btn btn-ghost btn-sm" onclick="limpiarFiltrosDashboard()" ${!hasFilters ? 'disabled' : ''}>Limpiar</button>
                ${hasFilters ? '<span class="dash-filter-active">Filtros activos</span>' : ''}
            </div>
        </div>

        <div class="dashboard-kpis">
            <div class="kpi-card">
                <div class="kpi-icon kpi-icon-blue">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                </div>
                <div class="kpi-data">
                    <span class="kpi-value">${k.total_pedidos.toLocaleString('es-DO')}</span>
                    <span class="kpi-label">Total Pedidos</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-icon-green">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                    </svg>
                </div>
                <div class="kpi-data">
                    <span class="kpi-value">${formatter.format(k.monto_total)}</span>
                    <span class="kpi-label">Venta Total</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-icon-purple">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                </div>
                <div class="kpi-data">
                    <span class="kpi-value">${k.total_vendedores}</span>
                    <span class="kpi-label">Vendedores Activos</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-icon-teal">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                </div>
                <div class="kpi-data">
                    <span class="kpi-value">${k.total_clientes}</span>
                    <span class="kpi-label">Clientes</span>
                </div>
            </div>
        </div>

        <div class="dashboard-sync-bar">
            <div class="sync-progress-card">
                <div class="sync-progress-header">
                    <div class="sync-progress-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Sincronizacion con Dynamics 365
                    </div>
                    <span class="sync-progress-pct">${syncRate}%</span>
                </div>
                <div class="sync-progress-track">
                    <div class="sync-progress-fill" style="width: ${syncRate}%"></div>
                </div>
                <div class="sync-stats-row">
                    <div class="sync-stat sync-stat--ok">
                        <div class="sync-stat-value">${k.enviados_dynamics}</div>
                        <div class="sync-stat-label">Sincronizados</div>
                    </div>
                    <div class="sync-stat sync-stat--pending">
                        <div class="sync-stat-value">${k.pendientes}</div>
                        <div class="sync-stat-label">Pendientes</div>
                    </div>
                    <div class="sync-stat sync-stat--error">
                        <div class="sync-stat-value">${k.con_error}</div>
                        <div class="sync-stat-label">Con Error</div>
                    </div>
                    <div class="sync-stat sync-stat--avg">
                        <div class="sync-stat-value">${formatter.format(k.promedio_pedido)}</div>
                        <div class="sync-stat-label">Promedio / Pedido</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="dashboard-charts-row">
            <div class="dashboard-chart-card dashboard-chart-wide">
                <h3 class="chart-title">
                    Tendencia de Ventas
                    <span class="chart-title-badge">30 dias</span>
                </h3>
                <canvas id="chart-daily-trend"></canvas>
            </div>
            <div class="dashboard-chart-card">
                <h3 class="chart-title">Estado de Pedidos</h3>
                <canvas id="chart-sync-status"></canvas>
            </div>
        </div>

        <div class="dashboard-charts-row dashboard-charts-row-equal">
            <div class="dashboard-chart-card">
                <h3 class="chart-title">
                    Ventas Mensuales
                    <span class="chart-title-badge">12 meses</span>
                </h3>
                <canvas id="chart-monthly-trend"></canvas>
            </div>
            <div class="dashboard-chart-card">
                <h3 class="chart-title">Top Categorias</h3>
                <canvas id="chart-categories"></canvas>
            </div>
        </div>

        <div class="dashboard-rankings-row">
            <div class="dashboard-ranking-card">
                <h3 class="ranking-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    Top Vendedores
                </h3>
                <div class="ranking-list" id="ranking-vendedores"></div>
            </div>
            <div class="dashboard-ranking-card">
                <h3 class="ranking-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                        <polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    Top Clientes
                </h3>
                <div class="ranking-list" id="ranking-clientes"></div>
            </div>
            <div class="dashboard-ranking-card">
                <h3 class="ranking-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                        <path d="M16 3H8l-2 4h12l-2-4z"/>
                    </svg>
                    Top Articulos
                </h3>
                <div class="ranking-list" id="ranking-articulos"></div>
            </div>
        </div>

        <div class="dashboard-recent">
            <div class="dashboard-recent-card">
                <div class="dashboard-recent-header">
                    <h3>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Pedidos Recientes
                    </h3>
                    <span class="dashboard-recent-link" onclick="document.querySelector('[data-view=pedidos]').click()">
                        Ver todos
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </span>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Pedido</th>
                                <th>Cliente</th>
                                <th>Vendedor</th>
                                <th>Fecha</th>
                                <th class="text-right">Total</th>
                                <th class="text-center">Estado</th>
                            </tr>
                        </thead>
                        <tbody id="dashboard-recent-body"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    renderRankingList('ranking-vendedores', data.topVendedores, 'vendedor_nombre');
    renderRankingList('ranking-clientes', data.topClientes, 'cliente_nombre');
    renderArticulosList('ranking-articulos', data.topArticulos);
    renderRecentOrders(data.recentOrders);

    setTimeout(() => initDashboardCharts(data), 50);
}

function renderRankingList(containerId, items, nameField) {
    const container = document.getElementById(containerId);
    if (!items || items.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 16px;">Sin datos</p>';
        return;
    }
    const maxMonto = items[0].monto_total;

    const avatarColors = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#4f46e5', '#0d9488', '#b45309', '#be185d'];

    container.innerHTML = items.map((item, i) => {
        const pct = maxMonto > 0 ? (item.monto_total / maxMonto * 100) : 0;
        const posClass = i === 0 ? 'ranking-gold' : i === 1 ? 'ranking-silver' : i === 2 ? 'ranking-bronze' : '';
        const name = item[nameField] || '';
        const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
        const avatarBg = avatarColors[i % avatarColors.length];

        return `
            <div class="ranking-item">
                <span class="ranking-pos ${posClass}">${i + 1}</span>
                <span class="ranking-avatar" style="background: ${avatarBg};">${initials}</span>
                <div class="ranking-info">
                    <span class="ranking-name">${escapeHtml(name)}</span>
                    <div class="ranking-bar-bg">
                        <div class="ranking-bar" style="width: ${pct}%"></div>
                    </div>
                </div>
                <div class="ranking-stats">
                    <span class="ranking-amount">${formatter.format(item.monto_total)}</span>
                    <span class="ranking-count">${item.total_pedidos} pedidos</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderArticulosList(containerId, items) {
    const container = document.getElementById(containerId);
    if (!items || items.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 16px;">Sin datos</p>';
        return;
    }
    const maxMonto = items[0].monto_total;
    const iconColors = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#4f46e5', '#0d9488', '#b45309', '#be185d'];

    container.innerHTML = items.map((item, i) => {
        const pct = maxMonto > 0 ? (item.monto_total / maxMonto * 100) : 0;
        const posClass = i === 0 ? 'ranking-gold' : i === 1 ? 'ranking-silver' : i === 2 ? 'ranking-bronze' : '';
        const code = item.item_id || '';
        const desc = item.producto_nombre || '';
        const initials = code.slice(0, 2).toUpperCase() || '#';
        const bg = iconColors[i % iconColors.length];

        return `
            <div class="ranking-item">
                <span class="ranking-pos ${posClass}">${i + 1}</span>
                <span class="ranking-avatar" style="background: ${bg}; font-size: 11px;">${escapeHtml(initials)}</span>
                <div class="ranking-info">
                    <span class="ranking-name">${escapeHtml(desc)}</span>
                    <span class="ranking-subname">${escapeHtml(code)}</span>
                    <div class="ranking-bar-bg">
                        <div class="ranking-bar" style="width: ${pct}%"></div>
                    </div>
                </div>
                <div class="ranking-stats">
                    <span class="ranking-amount">${formatter.format(item.monto_total)}</span>
                    <span class="ranking-count">${item.total_cantidad ? Number(item.total_cantidad).toLocaleString('es-DO') + ' uds' : item.total_lineas + ' lineas'}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderRecentOrders(orders) {
    const body = document.getElementById('dashboard-recent-body');
    if (!orders || orders.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 32px; color: var(--text-secondary);">Sin pedidos recientes</td></tr>';
        return;
    }
    body.innerHTML = orders.map(p => {
        const fecha = p.fecha_pedido
            ? new Date(p.fecha_pedido).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
            : '-';
        let estadoClass = 'status-pendiente';
        let estadoText = 'Pendiente';
        if (p.enviado_dynamics) { estadoClass = 'status-enviado'; estadoText = 'Sincronizado'; }
        else if (p.sync_error) { estadoClass = 'status-error'; estadoText = 'Error'; }

        return `
            <tr>
                <td><span class="pedido-num">${escapeHtml(p.pedido_numero)}</span></td>
                <td>${escapeHtml(p.cliente_nombre)}</td>
                <td>${escapeHtml(p.vendedor_nombre)}</td>
                <td>${fecha}</td>
                <td class="text-right"><span class="money">${formatter.format(p.total)}</span></td>
                <td class="text-center"><span class="status ${estadoClass}">${estadoText}</span></td>
            </tr>
        `;
    }).join('');
}

function initDashboardCharts(data) {
    Object.values(dashboardCharts).forEach(c => c.destroy());
    dashboardCharts = {};

    const chartColors = {
        primary: '#2563eb',
        primaryLight: 'rgba(37, 99, 235, 0.08)',
        success: '#16a34a',
        warning: '#d97706',
        danger: '#dc2626',
        purple: '#7c3aed'
    };

    const defaultFontFamily = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

    // Tendencia diaria - Linea con gradiente
    const dailyCtx = document.getElementById('chart-daily-trend');
    if (dailyCtx) {
        const ctx2d = dailyCtx.getContext('2d');
        const gradient = ctx2d.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0.15)');
        gradient.addColorStop(1, 'rgba(37, 99, 235, 0.01)');

        dashboardCharts.daily = new Chart(dailyCtx, {
            type: 'line',
            data: {
                labels: data.dailyTrend.map(d => {
                    const date = new Date(d.fecha + 'T00:00:00');
                    return date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' });
                }),
                datasets: [{
                    label: 'Monto (DOP)',
                    data: data.dailyTrend.map(d => d.monto),
                    borderColor: chartColors.primary,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 7,
                    pointBackgroundColor: chartColors.primary,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverBorderWidth: 3,
                    borderWidth: 2.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleFont: { family: defaultFontFamily, size: 12, weight: '600' },
                        bodyFont: { family: defaultFontFamily, size: 13 },
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        callbacks: {
                            label: ctx => formatter.format(ctx.parsed.y)
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { family: defaultFontFamily, size: 11 },
                            color: '#94a3b8',
                            callback: v => 'RD$' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
                        },
                        grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }
                    },
                    x: {
                        ticks: { font: { family: defaultFontFamily, size: 11 }, color: '#94a3b8' },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // Estado de pedidos - Dona
    const syncCtx = document.getElementById('chart-sync-status');
    if (syncCtx) {
        dashboardCharts.sync = new Chart(syncCtx, {
            type: 'doughnut',
            data: {
                labels: ['Sincronizados', 'Pendientes', 'Con Error'],
                datasets: [{
                    data: [data.kpis.enviados_dynamics, data.kpis.pendientes, data.kpis.con_error],
                    backgroundColor: [chartColors.success, chartColors.warning, chartColors.danger],
                    borderWidth: 0,
                    hoverOffset: 8,
                    spacing: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                            font: { family: defaultFontFamily, size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleFont: { family: defaultFontFamily, size: 12, weight: '600' },
                        bodyFont: { family: defaultFontFamily, size: 13 },
                        padding: 12,
                        cornerRadius: 10
                    }
                }
            }
        });
    }

    // Ventas mensuales - Barras
    const monthlyCtx = document.getElementById('chart-monthly-trend');
    if (monthlyCtx) {
        dashboardCharts.monthly = new Chart(monthlyCtx, {
            type: 'bar',
            data: {
                labels: data.monthlyTrend.map(d => {
                    const [y, m] = d.mes.split('-');
                    const date = new Date(parseInt(y), parseInt(m) - 1);
                    return date.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' });
                }),
                datasets: [{
                    label: 'Monto (DOP)',
                    data: data.monthlyTrend.map(d => d.monto),
                    backgroundColor: 'rgba(37, 99, 235, 0.8)',
                    hoverBackgroundColor: chartColors.primary,
                    borderRadius: 6,
                    barPercentage: 0.55,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleFont: { family: defaultFontFamily, size: 12, weight: '600' },
                        bodyFont: { family: defaultFontFamily, size: 13 },
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        callbacks: { label: ctx => formatter.format(ctx.parsed.y) }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { family: defaultFontFamily, size: 11 },
                            color: '#94a3b8',
                            callback: v => 'RD$' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
                        },
                        grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }
                    },
                    x: {
                        ticks: { font: { family: defaultFontFamily, size: 11 }, color: '#94a3b8' },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // Top categorias - Barras horizontales
    const catCtx = document.getElementById('chart-categories');
    if (catCtx) {
        const catColors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#4f46e5', '#ca8a04', '#be185d', '#1d4ed8'];
        dashboardCharts.categories = new Chart(catCtx, {
            type: 'bar',
            data: {
                labels: data.topCategorias.map(c => c.categoria),
                datasets: [{
                    label: 'Monto (DOP)',
                    data: data.topCategorias.map(c => c.monto_total),
                    backgroundColor: catColors.slice(0, data.topCategorias.length).map(c => c + 'cc'),
                    hoverBackgroundColor: catColors.slice(0, data.topCategorias.length),
                    borderRadius: 6,
                    barPercentage: 0.65,
                    borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleFont: { family: defaultFontFamily, size: 12, weight: '600' },
                        bodyFont: { family: defaultFontFamily, size: 13 },
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        callbacks: { label: ctx => formatter.format(ctx.parsed.x) }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            font: { family: defaultFontFamily, size: 11 },
                            color: '#94a3b8',
                            callback: v => 'RD$' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
                        },
                        grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }
                    },
                    y: {
                        ticks: { font: { family: defaultFontFamily, size: 12 }, color: '#475569' },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

// === Cobros Realizados ===
async function cargarCobros() {
    const body = document.getElementById('cobros-body');
    const loading = document.getElementById('cobros-loading');
    const empty = document.getElementById('cobros-empty-state');

    body.innerHTML = '';
    loading.classList.remove('hidden');
    empty.classList.add('hidden');

    try {
        const res = await apiFetch('/api/cobros');
        if (!res.ok) throw new Error('Error al cargar historial de cobros');
        todosLosCobros = await res.json();

        loading.classList.add('hidden');
        aplicarFiltrosCobros();
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
        console.error(err);
    }
}

function aplicarFiltrosCobros() {
    const busqueda = (document.getElementById('searchCobros')?.value || '').toLowerCase().trim();
    const desde = document.getElementById('cobrosDesde')?.value;
    const hasta = document.getElementById('cobrosHasta')?.value;

    cobrosFiltrados = todosLosCobros.filter(c => {
        // Texto
        if (busqueda) {
            const texto = `${c.invoice} ${c.custname} ${c.cobrador} ${c.accountnum}`.toLowerCase();
            if (!texto.includes(busqueda)) return false;
        }

        // Fechas
        const fecha = c.fecha_cobro ? c.fecha_cobro.split('T')[0] : '';
        if (desde && fecha < desde) return false;
        if (hasta && fecha > hasta) return false;

        return true;
    });

    cobrosPaginaActual = 1;
    renderizarPaginaCobros();
}

function renderizarPaginaCobros() {
    const totalPaginas = Math.ceil(cobrosFiltrados.length / cobrosRegistrosPorPagina);
    const inicio = (cobrosPaginaActual - 1) * cobrosRegistrosPorPagina;
    const fin = inicio + cobrosRegistrosPorPagina;
    const datosPagina = cobrosFiltrados.slice(inicio, fin);

    renderizarTablaCobros(datosPagina);
    renderizarPaginacionCobros(totalPaginas);
}

function renderizarTablaCobros(datos) {
    const body = document.getElementById('cobros-body');
    const empty = document.getElementById('cobros-empty-state');

    if (datos.length === 0) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    body.innerHTML = datos.map(c => {
        const fecha = c.fecha_cobro
            ? new Date(c.fecha_cobro).toLocaleString('es-DO', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            })
            : '-';

        return `
            <tr>
                <td><span class="pedido-num">${escapeHtml(c.invoice)}</span></td>
                <td>
                    <div style="font-weight: 500;">${escapeHtml(c.custname)}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(c.accountnum)}</div>
                </td>
                <td class="text-right"><span class="money" style="color: var(--success); font-weight: 600;">${formatter.format(c.monto_cobrado)}</span></td>
                <td class="text-right"><span class="money">${formatter.format(c.saldo_anterior)}</span></td>
                <td class="text-right"><span class="money">${formatter.format(c.saldo_nuevo)}</span></td>
                <td style="font-size: 12px; color: var(--text-secondary);">${fecha}</td>
                <td>${escapeHtml(c.cobrador)}</td>
                <td><span class="badge" style="font-size: 10px; background: #f1f5f9; color: #475569;">${escapeHtml(c.metodo_pago)}</span></td>
            </tr>
        `;
    }).join('');
}

function renderizarPaginacionCobros(totalPaginas) {
    const container = document.getElementById('cobros-pagination-container');
    if (!container) return;

    const total = cobrosFiltrados.length;
    if (total === 0) {
        container.innerHTML = '';
        return;
    }

    const inicio = (cobrosPaginaActual - 1) * cobrosRegistrosPorPagina + 1;
    const fin = Math.min(cobrosPaginaActual * cobrosRegistrosPorPagina, total);

    let paginas = '';
    const maxBotones = 5;
    let startPage = Math.max(1, cobrosPaginaActual - Math.floor(maxBotones / 2));
    let endPage = Math.min(totalPaginas, startPage + maxBotones - 1);
    if (endPage - startPage < maxBotones - 1) {
        startPage = Math.max(1, endPage - maxBotones + 1);
    }

    if (startPage > 1) {
        paginas += `<button class="page-btn" onclick="cambiarPaginaCobros(1)">1</button>`;
        if (startPage > 2) paginas += `<span class="page-ellipsis">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        paginas += `<button class="page-btn ${i === cobrosPaginaActual ? 'active' : ''}" onclick="cambiarPaginaCobros(${i})">${i}</button>`;
    }

    if (endPage < totalPaginas) {
        if (endPage < totalPaginas - 1) paginas += `<span class="page-ellipsis">...</span>`;
        paginas += `<button class="page-btn" onclick="cambiarPaginaCobros(${totalPaginas})">${totalPaginas}</button>`;
    }

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${inicio}-${fin}</strong> de <strong>${total}</strong> registros
        </div>
        <div class="pagination-controls">
            <select class="page-size-select" onchange="cambiarCobrosRegistrosPorPagina(this.value)">
                <option value="20" ${cobrosRegistrosPorPagina === 20 ? 'selected' : ''}>20 por página</option>
                <option value="50" ${cobrosRegistrosPorPagina === 50 ? 'selected' : ''}>50 por página</option>
                <option value="100" ${cobrosRegistrosPorPagina === 100 ? 'selected' : ''}>100 por página</option>
            </select>
            <div class="page-buttons">
                <button class="page-btn nav-btn" onclick="cambiarPaginaCobros(${cobrosPaginaActual - 1})" ${cobrosPaginaActual === 1 ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                ${paginas}
                <button class="page-btn nav-btn" onclick="cambiarPaginaCobros(${cobrosPaginaActual + 1})" ${cobrosPaginaActual === totalPaginas ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        </div>
    `;
}

function cambiarPaginaCobros(pagina) {
    const totalPaginas = Math.ceil(cobrosFiltrados.length / cobrosRegistrosPorPagina);
    if (pagina < 1 || pagina > totalPaginas) return;
    cobrosPaginaActual = pagina;
    renderizarPaginaCobros();
}

function cambiarCobrosRegistrosPorPagina(valor) {
    cobrosRegistrosPorPagina = parseInt(valor);
    cobrosPaginaActual = 1;
    renderizarPaginaCobros();
}

function limpiarFiltrosCobros() {
    document.getElementById('searchCobros').value = '';
    document.getElementById('cobrosDesde').value = '';
    document.getElementById('cobrosHasta').value = '';
    aplicarFiltrosCobros();
}

// === Tracking ===

const VENDOR_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#059669', '#b45309', '#0369a1'];

function getVendedorColor(vendedorId) {
    if (!vendedorColorMap[vendedorId]) {
        vendedorColorMap[vendedorId] = VENDOR_COLORS[vendedorColorIndex % VENDOR_COLORS.length];
        vendedorColorIndex++;
    }
    return vendedorColorMap[vendedorId];
}

const _tileProviders = () => ({
    'Claro': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }),
    'Calles': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }),
    'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles © Esri', maxZoom: 19 }),
    'Oscuro': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }),
    'Topográfico': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles © Esri', maxZoom: 19 })
});

function initTrackingMap() {
    if (trackingMap) return;

    const providers = _tileProviders();
    const defaultLayer = providers['Claro'];

    trackingMap = L.map('tracking-map', {
        zoomControl: false,
        center: [18.4861, -69.9312],
        zoom: 12,
        layers: [defaultLayer]
    });

    L.control.zoom({ position: 'bottomright' }).addTo(trackingMap);
    L.control.layers(providers, null, { position: 'topright', collapsed: false }).addTo(trackingMap);

    trackingMap.on('movestart', () => {
        if (_suppressMapLock) return;
        mapBoundsLocked = true;
        document.getElementById('btnCentrarMapa')?.classList.remove('hidden');
    });
}

async function cargarTracking(isAutoRefresh = false) {
    const today = new Date().toISOString().split('T')[0];

    const desdeEl = document.getElementById('filtroDesdeTracking');
    const hastaEl = document.getElementById('filtroHastaTracking');
    if (desdeEl && !desdeEl.value) desdeEl.value = today;
    if (hastaEl && !hastaEl.value) hastaEl.value = today;

    if (!isAutoRefresh) {
        document.getElementById('tracking-event-list').innerHTML = '<div class="loading-state">Cargando registros...</div>';
        mapBoundsLocked = false;
    }

    initTrackingMap();

    try {
        const params = new URLSearchParams();
        if (desdeEl?.value) params.set('fechaDesde', desdeEl.value);
        if (hastaEl?.value) params.set('fechaHasta', hastaEl.value);

        const res = await apiFetch(`/api/tracking?${params.toString()}`);
        if (!res.ok) throw new Error('Error al cargar datos de tracking');
        todosLosTracking = await res.json();

        trackingLastUpdated = new Date();
        actualizarIndicadorTiempo();

        if (!isAutoRefresh) {
            const select = document.getElementById('filtroVendedorTracking');
            const vendedorActual = select.value;
            const vendedoresUnicos = [...new Set(todosLosTracking.map(t => `${t.vendedor_id}|${t.vendedor_nombre}`))];
            select.innerHTML = '<option value="todos">Todos los vendedores</option>';
            vendedoresUnicos.forEach(v => {
                const [id, nombre] = v.split('|');
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = nombre;
                select.appendChild(opt);
            });
            select.value = vendedorActual || 'todos';
        }

        aplicarFiltrosTracking(isAutoRefresh);

    } catch (err) {
        if (!isAutoRefresh) {
            document.getElementById('tracking-event-list').innerHTML = `<div class="trk-empty" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</div>`;
        }
        console.error(err);
    }
}

function limpiarFiltrosTracking() {
    const today = new Date().toISOString().split('T')[0];
    const desdeEl = document.getElementById('filtroDesdeTracking');
    const hastaEl = document.getElementById('filtroHastaTracking');
    if (desdeEl) desdeEl.value = today;
    if (hastaEl) hastaEl.value = today;
    document.getElementById('filtroVendedorTracking').value = 'todos';
    document.getElementById('filtroAccionTracking').value = 'todos';
    cargarTracking();
}

function actualizarIndicadorTiempo() {
    const el = document.getElementById('trackingLastUpdated');
    if (!el || !trackingLastUpdated) return;
    const diffSec = Math.floor((new Date() - trackingLastUpdated) / 1000);
    if (diffSec < 10) el.textContent = 'Actualizado hace unos segundos';
    else if (diffSec < 60) el.textContent = `Actualizado hace ${diffSec}s`;
    else el.textContent = `Actualizado hace ${Math.floor(diffSec / 60)} min`;
}

function centrarMapa() {
    mapBoundsLocked = false;
    document.getElementById('btnCentrarMapa')?.classList.add('hidden');
    fitBoundsTracking();
}

function fitBoundsTracking() {
    if (!trackingMap) return;
    const markersArr = Object.values(trackingMarkerMap);
    if (markersArr.length === 0) return;
    _suppressMapLock = true;
    const group = new L.featureGroup(markersArr);
    trackingMap.fitBounds(group.getBounds().pad(0.12));
    trackingMap.once('moveend', () => { _suppressMapLock = false; });
}

const _actionStyle = {
    ORDER: { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0', dot: '#16a34a', label: 'Pedido' },
    CHECKIN: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb', label: 'Check-in' },
    PERIODIC: { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0', dot: '#94a3b8', label: 'Periódico' }
};

function renderSummaryPanel(datos) {
    const el = document.getElementById('tracking-summary');
    if (!el) return;
    if (datos.length === 0) { el.innerHTML = '<div class="trk-empty">Sin datos</div>'; return; }

    const orders = datos.filter(t => t.action === 'ORDER').length;
    const checkins = datos.filter(t => t.action === 'CHECKIN').length;
    const vendedores = new Set(datos.map(t => t.vendedor_id)).size;

    el.innerHTML = `
        <div class="trk-kpi"><span class="trk-kpi-val">${datos.length}</span><span class="trk-kpi-lbl">Total</span></div>
        <div class="trk-kpi"><span class="trk-kpi-val" style="color:#16a34a;">${orders}</span><span class="trk-kpi-lbl">Pedidos</span></div>
        <div class="trk-kpi"><span class="trk-kpi-val" style="color:#2563eb;">${checkins}</span><span class="trk-kpi-lbl">Check-ins</span></div>
        <div class="trk-kpi"><span class="trk-kpi-val" style="color:#7c3aed;">${vendedores}</span><span class="trk-kpi-lbl">Vendedores</span></div>
    `;
}

function renderEventList(datos) {
    const el = document.getElementById('tracking-event-list');
    const cntEl = document.getElementById('tracking-list-count');
    if (!el) return;

    if (cntEl) cntEl.textContent = datos.length ? `${datos.length} registros` : '';

    if (datos.length === 0) {
        el.innerHTML = '<div class="trk-empty">Sin registros para el período</div>';
        return;
    }

    el.innerHTML = datos.map((t, i) => {
        const as = _actionStyle[t.action] || _actionStyle.PERIODIC;
        const color = getVendedorColor(t.vendedor_id);
        const fecha = t.created_at
            ? new Date(t.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '—';

        let ovHtml = '';
        if (t.dynamics_order_number && t.pedido_id) {
            ovHtml = `<a href="#" class="trk-ov-link" onclick="abrirDetalleOV(${t.pedido_id},'${escapeHtml(t.dynamics_order_number)}');return false;">${escapeHtml(t.dynamics_order_number)}</a>`;
        } else if (t.dynamics_order_number) {
            ovHtml = `<span class="trk-ov-static">${escapeHtml(t.dynamics_order_number)}</span>`;
        }

        const hasMap = t.latitude && t.longitude;

        return `
            <div class="trk-event${hasMap ? '' : ' trk-event--nomap'}" data-trk-id="${t.id}" onclick="focusTrackingMarker('${t.id}')">
                <div class="trk-event-dot-col">
                    <div class="trk-event-dot" style="background:${as.dot};"></div>
                    ${i < datos.length - 1 ? '<div class="trk-event-line"></div>' : ''}
                </div>
                <div class="trk-event-body">
                    <div class="trk-event-top">
                        <span class="trk-event-badge" style="background:${as.bg};color:${as.color};border-color:${as.border};">${as.label}</span>
                        <span class="trk-event-time">${fecha}</span>
                    </div>
                    <div class="trk-event-vendor" style="color:${color};">${escapeHtml(t.vendedor_nombre)}</div>
                    ${ovHtml ? `<div class="trk-event-ov">${ovHtml}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function focusTrackingMarker(trackingId) {
    const marker = trackingMarkerMap[trackingId];
    if (!marker || !trackingMap) return;
    mapBoundsLocked = true;
    document.getElementById('btnCentrarMapa')?.classList.remove('hidden');
    trackingMap.setView(marker.getLatLng(), Math.max(trackingMap.getZoom(), 15), { animate: true });
    marker.openPopup();
}

function renderMarcadoresTracking(datos, vendedorFiltro) {
    if (trackingClusterGroup) {
        trackingMap.removeLayer(trackingClusterGroup);
        trackingClusterGroup = null;
    }
    Object.values(trackingMarkerMap).forEach(m => {
        if (trackingMap.hasLayer(m)) trackingMap.removeLayer(m);
    });
    trackingMarkerMap = {};
    trackingMarkers = [];
    if (trackingPolyline) { trackingMap.removeLayer(trackingPolyline); trackingPolyline = null; }

    const markerSize = { ORDER: 11, CHECKIN: 8, PERIODIC: 5 };
    const usarCluster = vendedorFiltro === 'todos' && datos.length > 30
        && typeof L.markerClusterGroup !== 'undefined';

    const clusterGroup = usarCluster ? L.markerClusterGroup({
        iconCreateFunction: (cluster) => L.divIcon({
            html: `<div class="trk-cluster">${cluster.getChildCount()}</div>`,
            className: '',
            iconSize: [36, 36]
        }),
        maxClusterRadius: 50,
        showCoverageOnHover: false
    }) : null;

    const coordsRuta = [];

    datos.forEach(t => {
        if (!t.latitude || !t.longitude) return;

        const color = getVendedorColor(t.vendedor_id);
        const r = markerSize[t.action] || 5;
        const as = _actionStyle[t.action] || _actionStyle.PERIODIC;

        const marker = L.circleMarker([t.latitude, t.longitude], {
            radius: r,
            fillColor: vendedorFiltro === 'todos' ? color : as.dot,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        });

        const fecha = new Date(t.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const ovPopupLine = t.dynamics_order_number
            ? (t.pedido_id
                ? `<div style="margin-top:8px;"><a href="#" onclick="trackingMap.closePopup();abrirDetalleOV(${t.pedido_id},'${escapeHtml(t.dynamics_order_number)}');return false;" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none;">Ver OV ${escapeHtml(t.dynamics_order_number)}</a></div>`
                : `<div style="margin-top:6px;font-size:12px;font-weight:600;color:#166534;">OV: ${escapeHtml(t.dynamics_order_number)}</div>`)
            : '';

        marker.bindPopup(`
            <div style="font-family:'Inter',sans-serif;min-width:180px;line-height:1.6;">
                <div style="font-weight:700;font-size:13px;">${escapeHtml(t.vendedor_nombre)}</div>
                <div style="margin-top:4px;">
                    <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:${as.bg};color:${as.color};border:1px solid ${as.border};">${as.label}</span>
                </div>
                ${ovPopupLine}
                <div style="margin-top:6px;font-size:11px;color:#64748b;">${fecha}</div>
                <div style="margin-top:6px;border-top:1px solid #f1f5f9;padding-top:6px;">
                    <a href="https://www.google.com/maps?q=${t.latitude},${t.longitude}" target="_blank" style="font-size:11px;color:#2563eb;text-decoration:none;">Ver en Google Maps</a>
                </div>
            </div>
        `, { maxWidth: 220 });

        trackingMarkerMap[t.id] = marker;
        trackingMarkers.push(marker);
        coordsRuta.push([t.latitude, t.longitude]);

        if (usarCluster) clusterGroup.addLayer(marker);
        else marker.addTo(trackingMap);
    });

    if (usarCluster && clusterGroup) {
        clusterGroup.addTo(trackingMap);
        trackingClusterGroup = clusterGroup;
    }

    if (vendedorFiltro !== 'todos' && coordsRuta.length >= 2) {
        const vendColor = vendedorColorMap[vendedorFiltro] || '#2563eb';
        trackingPolyline = L.polyline(coordsRuta, {
            color: vendColor,
            weight: 2.5,
            opacity: 0.6,
            dashArray: '6, 8',
            lineJoin: 'round'
        }).addTo(trackingMap);
    }
}

function aplicarFiltrosTracking(isAutoRefresh = false) {
    if (!trackingMap) return;

    const vendedorId = document.getElementById('filtroVendedorTracking').value;
    const accionFiltro = document.getElementById('filtroAccionTracking').value;

    trackingFiltrados = todosLosTracking.filter(t => {
        if (vendedorId !== 'todos' && t.vendedor_id !== vendedorId) return false;
        if (accionFiltro !== 'todos' && t.action !== accionFiltro) return false;
        return true;
    });

    const datosOrdenados = [...trackingFiltrados].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const datosParaMapa = [...trackingFiltrados].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    renderSummaryPanel(trackingFiltrados);
    renderEventList(datosOrdenados);
    renderMarcadoresTracking(datosParaMapa, vendedorId);

    if (!mapBoundsLocked) fitBoundsTracking();
}

// === Detalle de OV desde Tracking ===
async function abrirDetalleOV(pedidoId, ovNumber) {
    if (!pedidoId) return;
    const modal = document.getElementById('modal-ov-tracking');
    const titleEl = document.getElementById('modal-ov-titulo');
    const headerEl = document.getElementById('modal-ov-header');
    const bodyEl = document.getElementById('modal-ov-body');
    const loadingEl = document.getElementById('modal-ov-loading');

    titleEl.textContent = ovNumber;
    headerEl.innerHTML = '';
    bodyEl.innerHTML = '';
    loadingEl.classList.remove('hidden');
    modal.classList.remove('hidden');

    try {
        const [pedidoRes, lineasRes] = await Promise.all([
            apiFetch(`/api/pedidos/${pedidoId}`),
            apiFetch(`/api/pedidos/${pedidoId}/lineas`)
        ]);
        const pedido = await pedidoRes.json();
        const lineas = await lineasRes.json();
        loadingEl.classList.add('hidden');

        const fecha = pedido.fecha_pedido
            ? new Date(pedido.fecha_pedido).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })
            : '—';

        headerEl.innerHTML = `
            <div class="detail-header">
                <div class="detail-field"><span class="label">Pedido</span><span class="value">${escapeHtml(pedido.pedido_numero)}</span></div>
                <div class="detail-field"><span class="label">Cliente</span><span class="value">${escapeHtml(pedido.cliente_nombre)}</span></div>
                <div class="detail-field"><span class="label">Vendedor</span><span class="value">${escapeHtml(pedido.vendedor_nombre)}</span></div>
                <div class="detail-field"><span class="label">Fecha</span><span class="value">${fecha}</span></div>
                <div class="detail-field"><span class="label">Total</span><span class="value" style="color:var(--success);font-weight:700;">${formatter.format(pedido.total)}</span></div>
                <div class="detail-field"><span class="label">Orden Dynamics</span><span class="value dynamics-num">${escapeHtml(pedido.dynamics_order_number || ovNumber)}</span></div>
            </div>
        `;

        if (lineas.length === 0) {
            bodyEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:32px;">Sin líneas de detalle</p>';
            return;
        }

        const totalMonto = lineas.reduce((s, l) => s + (l.subtotal_linea || 0), 0);
        const totalCant = lineas.reduce((s, l) => s + (l.cantidad || 0), 0);

        bodyEl.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead><tr>
                        <th>Código</th><th>Producto</th><th>Categoría</th>
                        <th class="text-center">Cant.</th>
                        <th class="text-right">Precio Unit.</th>
                        <th class="text-right">Subtotal</th>
                    </tr></thead>
                    <tbody>
                        ${lineas.map(l => `
                            <tr>
                                <td><span class="dynamics-num">${escapeHtml(l.item_id || '—')}</span></td>
                                <td style="font-weight:500;">${escapeHtml(l.producto_nombre)}</td>
                                <td style="color:var(--text-secondary);">${escapeHtml(l.categoria || '—')}</td>
                                <td class="text-center">${l.cantidad}</td>
                                <td class="text-right"><span class="money">${formatter.format(l.precio_unitario)}</span></td>
                                <td class="text-right"><span class="money">${formatter.format(l.subtotal_linea)}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="3" style="text-align:right;color:var(--text-secondary);font-size:12px;">${lineas.length} artículo(s)</td>
                            <td class="text-center" style="font-weight:600;">${totalCant}</td>
                            <td></td>
                            <td class="text-right"><span class="money" style="color:var(--success);font-size:14px;font-weight:700;">${formatter.format(totalMonto)}</span></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    } catch (err) {
        loadingEl.classList.add('hidden');
        bodyEl.innerHTML = `<p style="text-align:center;color:var(--danger);padding:32px;">Error al cargar: ${err.message}</p>`;
    }
}

function cerrarDetalleOV() {
    document.getElementById('modal-ov-tracking').classList.add('hidden');
}

// === Clientes Asignados a Vendedores ===

let todosLosClientesExtra      = [];
let clientesExtraFiltrados     = [];
let todosLosClientesDisponibles = [];
let cePaginaActual             = 1;
let ceRegistrosPorPagina       = 20;

async function cargarClientesExtra() {
    const loading = document.getElementById('ce-loading');
    loading.classList.remove('hidden');
    document.getElementById('ce-body').innerHTML = '';
    document.getElementById('ce-empty').classList.add('hidden');
    document.getElementById('ce-pagination').innerHTML = '';

    try {
        const [asignaciones, vendedores, clientes] = await Promise.all([
            apiFetch('/api/clientes-extra').then(r => r.json()),
            apiFetch('/api/vendedores').then(r => r.json()),
            apiFetch('/api/clientes').then(r => r.json())
        ]);

        todosLosClientesExtra      = asignaciones;
        todosLosClientesDisponibles = clientes;
        loading.classList.add('hidden');

        const opcionesVendedor = vendedores.map(v =>
            `<option value="${escapeHtml(v.empleado_responsable)}" data-nombre="${escapeHtml(v.vendedor_nombre)}">${escapeHtml(v.vendedor_nombre)}</option>`
        ).join('');

        document.getElementById('ce-vendedor').innerHTML =
            '<option value="">Seleccionar vendedor...</option>' + opcionesVendedor;
        document.getElementById('ce-filtro-vendedor').innerHTML =
            '<option value="todos">Todos</option>' + opcionesVendedor;

        poblarSelectClientes(clientes);
        filtrarTablaClientesExtra();
        renderizarKpisCE();
    } catch (err) {
        loading.innerHTML = `<p style="color:var(--danger);">Error: ${escapeHtml(err.message)}</p>`;
    }
}

function renderizarKpisCE() {
    const total      = todosLosClientesExtra.length;
    const vendedores = new Set(todosLosClientesExtra.map(a => a.empleado_responsable)).size;
    const hoy        = new Date().toDateString();
    const recientes  = todosLosClientesExtra.filter(a => a.fecha_asignacion && new Date(a.fecha_asignacion).toDateString() === hoy).length;

    document.getElementById('ce-kpis').innerHTML = `
        <div class="ce-kpi">
            <div class="ce-kpi-icon ce-kpi-icon--blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
            </div>
            <div class="ce-kpi-text">
                <span class="ce-kpi-val">${total}</span>
                <span class="ce-kpi-lbl">Asignaciones totales</span>
            </div>
        </div>
        <div class="ce-kpi">
            <div class="ce-kpi-icon ce-kpi-icon--green">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
            </div>
            <div class="ce-kpi-text">
                <span class="ce-kpi-val">${vendedores}</span>
                <span class="ce-kpi-lbl">Vendedores con extras</span>
            </div>
        </div>
        <div class="ce-kpi">
            <div class="ce-kpi-icon ce-kpi-icon--amber">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
            </div>
            <div class="ce-kpi-text">
                <span class="ce-kpi-val">${recientes}</span>
                <span class="ce-kpi-lbl">Asignadas hoy</span>
            </div>
        </div>
    `;
}

function poblarSelectClientes(lista) {
    const sel = document.getElementById('ce-select-cliente');
    sel.innerHTML = '<option value="">-- Selecciona un cliente --</option>' +
        lista.map(c =>
            `<option value="${escapeHtml(c.accountnum)}" data-nombre="${escapeHtml(c.custname)}">${escapeHtml(c.custname)} (${escapeHtml(c.accountnum)})</option>`
        ).join('');
    document.getElementById('ce-cliente-accountnum').value = '';
    document.getElementById('ce-cliente-nombre').value = '';
    sel.value = '';
    document.getElementById('ce-selected-display').className = 'ce-selected-empty';
    document.getElementById('ce-selected-display').innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>Ninguno`;
}

function filtrarSelectClientes() {
    const q = (document.getElementById('ce-filtro-cliente').value || '').toLowerCase().trim();
    const filtrados = q
        ? todosLosClientesDisponibles.filter(c =>
            c.custname.toLowerCase().includes(q) || c.accountnum.toLowerCase().includes(q))
        : todosLosClientesDisponibles;
    const sel = document.getElementById('ce-select-cliente');
    sel.innerHTML = '<option value="">-- Selecciona un cliente --</option>' +
        filtrados.map(c =>
            `<option value="${escapeHtml(c.accountnum)}" data-nombre="${escapeHtml(c.custname)}">${escapeHtml(c.custname)} (${escapeHtml(c.accountnum)})</option>`
        ).join('');
    sel.value = '';
}

function seleccionarClienteLista(sel) {
    const opt = sel.options[sel.selectedIndex];
    const display = document.getElementById('ce-selected-display');
    if (!opt || !opt.value) {
        document.getElementById('ce-cliente-accountnum').value = '';
        document.getElementById('ce-cliente-nombre').value = '';
        display.className = 'ce-selected-empty';
        display.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>Ninguno`;
        return;
    }
    document.getElementById('ce-cliente-accountnum').value = opt.value;
    document.getElementById('ce-cliente-nombre').value = opt.dataset.nombre;
    display.className = 'ce-selected-badge';
    display.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(opt.dataset.nombre)}</span>
        <span style="font-size:11px;opacity:0.7;">${escapeHtml(opt.value)}</span>`;
}

function limpiarFiltrosCE() {
    document.getElementById('ce-buscar-tabla').value = '';
    document.getElementById('ce-filtro-vendedor').value = 'todos';
    filtrarTablaClientesExtra();
}

function filtrarTablaClientesExtra() {
    const vendedor = document.getElementById('ce-filtro-vendedor')?.value || 'todos';
    const busq = (document.getElementById('ce-buscar-tabla')?.value || '').toLowerCase().trim();

    clientesExtraFiltrados = todosLosClientesExtra.filter(a => {
        if (vendedor !== 'todos' && a.empleado_responsable !== vendedor) return false;
        if (busq) {
            const texto = `${a.vendedor_nombre} ${a.cliente_nombre} ${a.cliente_accountnum}`.toLowerCase();
            if (!texto.includes(busq)) return false;
        }
        return true;
    });

    cePaginaActual = 1;
    renderizarPaginaCE();
}

function renderizarPaginaCE() {
    const total   = clientesExtraFiltrados.length;
    const inicio  = (cePaginaActual - 1) * ceRegistrosPorPagina;
    const fin     = inicio + ceRegistrosPorPagina;
    const pagData = clientesExtraFiltrados.slice(inicio, fin);

    renderizarTablaClientesExtra(pagData, total);
    renderizarPaginacionCE(Math.ceil(total / ceRegistrosPorPagina), total, inicio + 1, Math.min(fin, total));
}

function renderizarTablaClientesExtra(datos, total) {
    const body  = document.getElementById('ce-body');
    const empty = document.getElementById('ce-empty');

    if (total === 0) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        document.getElementById('ce-pagination').innerHTML = '';
        return;
    }
    empty.classList.add('hidden');

    body.innerHTML = datos.map(a => {
        const fecha = a.fecha_asignacion
            ? new Date(a.fecha_asignacion).toLocaleDateString('es-DO', { day:'2-digit', month:'short', year:'numeric' })
            : '-';
        return `
        <tr>
            <td><span class="ce-vendor-badge">${escapeHtml(a.vendedor_nombre)}</span></td>
            <td style="font-weight:500;">${escapeHtml(a.cliente_nombre)}</td>
            <td><span class="ce-code">${escapeHtml(a.cliente_accountnum)}</span></td>
            <td><span class="ce-date">${fecha}</span></td>
            <td class="text-center">
                <button class="btn-quitar"
                    onclick="eliminarClienteExtra(${a.id}, '${escapeHtml(a.cliente_nombre).replace(/'/g,"\\'")}', '${escapeHtml(a.vendedor_nombre).replace(/'/g,"\\'")}')">
                    Quitar
                </button>
            </td>
        </tr>`;
    }).join('');
}

function renderizarPaginacionCE(totalPaginas, total, desde, hasta) {
    const container = document.getElementById('ce-pagination');
    if (total === 0) { container.innerHTML = ''; return; }

    let paginas = '';
    const max = 5;
    let start = Math.max(1, cePaginaActual - Math.floor(max / 2));
    let end   = Math.min(totalPaginas, start + max - 1);
    if (end - start < max - 1) start = Math.max(1, end - max + 1);

    if (start > 1) {
        paginas += `<button class="page-btn" onclick="ceCambiarPagina(1)">1</button>`;
        if (start > 2) paginas += `<span class="page-ellipsis">…</span>`;
    }
    for (let i = start; i <= end; i++) {
        paginas += `<button class="page-btn ${i === cePaginaActual ? 'active' : ''}" onclick="ceCambiarPagina(${i})">${i}</button>`;
    }
    if (end < totalPaginas) {
        if (end < totalPaginas - 1) paginas += `<span class="page-ellipsis">…</span>`;
        paginas += `<button class="page-btn" onclick="ceCambiarPagina(${totalPaginas})">${totalPaginas}</button>`;
    }

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${desde}–${hasta}</strong> de <strong>${total}</strong> asignaciones
        </div>
        <div class="pagination-controls">
            <select class="page-size-select" onchange="ceCambiarRegistros(this.value)">
                <option value="10"  ${ceRegistrosPorPagina===10  ? 'selected':''}>10 por página</option>
                <option value="20"  ${ceRegistrosPorPagina===20  ? 'selected':''}>20 por página</option>
                <option value="50"  ${ceRegistrosPorPagina===50  ? 'selected':''}>50 por página</option>
                <option value="100" ${ceRegistrosPorPagina===100 ? 'selected':''}>100 por página</option>
            </select>
            <div class="page-buttons">
                <button class="page-btn nav-btn" onclick="ceCambiarPagina(${cePaginaActual-1})" ${cePaginaActual===1?'disabled':''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                ${paginas}
                <button class="page-btn nav-btn" onclick="ceCambiarPagina(${cePaginaActual+1})" ${cePaginaActual===totalPaginas?'disabled':''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        </div>`;
}

function ceCambiarPagina(p) {
    const total = Math.ceil(clientesExtraFiltrados.length / ceRegistrosPorPagina);
    if (p < 1 || p > total) return;
    cePaginaActual = p;
    renderizarPaginaCE();
}

function ceCambiarRegistros(val) {
    ceRegistrosPorPagina = parseInt(val);
    cePaginaActual = 1;
    renderizarPaginaCE();
}

async function asignarClienteExtra() {
    const selVendedor       = document.getElementById('ce-vendedor');
    const empleadoResponsable = selVendedor.value;
    const vendedorNombre    = selVendedor.options[selVendedor.selectedIndex]?.dataset?.nombre || '';
    const accountnum        = document.getElementById('ce-cliente-accountnum').value;
    const nombre            = document.getElementById('ce-cliente-nombre').value;

    if (!empleadoResponsable) { showToast('Selecciona un vendedor', 'warning'); return; }
    if (!accountnum)          { showToast('Selecciona un cliente de la lista', 'warning'); return; }

    const btn = document.querySelector('.ce-btn-asignar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
        const res = await apiFetch('/api/clientes-extra', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vendedor_nombre: vendedorNombre, empleado_responsable: empleadoResponsable, cliente_accountnum: accountnum, cliente_nombre: nombre })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Error al asignar', 'error'); return; }

        document.getElementById('ce-vendedor').value = '';
        document.getElementById('ce-filtro-cliente').value = '';
        poblarSelectClientes(todosLosClientesDisponibles);
        showToast('Cliente asignado correctamente', 'success');
        cargarClientesExtra();
    } catch {
        showToast('Error de conexión', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Asignar`; }
    }
}

async function eliminarClienteExtra(id, clienteNombre, vendedorNombre) {
    if (!confirm(`¿Quitar a "${clienteNombre}" del vendedor "${vendedorNombre}"?`)) return;

    try {
        const res = await apiFetch(`/api/clientes-extra/${id}`, { method: 'DELETE' });
        if (!res.ok) { showToast('Error al eliminar', 'error'); return; }
        showToast('Asignación eliminada', 'success');
        todosLosClientesExtra = todosLosClientesExtra.filter(a => a.id !== id);
        filtrarTablaClientesExtra();
        renderizarKpisCE();
    } catch {
        showToast('Error de conexión', 'error');
    }
}

// === Publicaciones Admin ===

let todasLasPublicaciones = [];

async function cargarPublicacionesAdmin() {
    const body = document.getElementById('pub-body');
    const loading = document.getElementById('pub-loading');
    const empty = document.getElementById('pub-empty');

    body.innerHTML = '';
    loading.classList.remove('hidden');
    empty.classList.add('hidden');

    try {
        const res = await apiFetch('/api/publicaciones');
        if (!res.ok) throw new Error('Error al cargar publicaciones');
        todasLasPublicaciones = await res.json();
        
        loading.classList.add('hidden');
        if (todasLasPublicaciones.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        renderizarTablaPublicaciones();
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
    }
}

function renderizarTablaPublicaciones() {
    const body = document.getElementById('pub-body');
    body.innerHTML = todasLasPublicaciones.map(p => `
        <tr>
            <td style="color: var(--text-secondary); font-size: 13px;">${new Date(p.fecha_creacion).toLocaleDateString()}</td>
            <td style="font-weight: 500;">${escapeHtml(p.titulo)}</td>
            <td><span class="badge">${escapeHtml(p.grupo_vendedores)}</span></td>
            <td class="text-center">${p.total_likes}</td>
            <td class="text-right">
                <button class="btn btn-ghost btn-sm btn-delete" onclick="eliminarPublicacion(${p.id})" title="Eliminar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        </tr>
    `).join('');
}

function abrirModalPublicacion() {
    const modal = document.getElementById('modal-pub');
    const form = document.getElementById('form-pub');
    form.reset();
    
    // Poblar grupos
    const select = document.getElementById('pub-grupo');
    if (select) {
        select.innerHTML = '<option value="TODOS">TODOS LOS VENDEDORES</option>';
        if (dashFilterOptions && dashFilterOptions.vendedores) {
             // Podriamos usar grupos si existieran en el admin, 
             // por ahora usaremos los nombres de los vendedores o TODOS.
             // El usuario menciono "separar por grupo de vendedores".
             // Si el admin tiene grupos definidos, los usaremos.
        }
    }

    modal.classList.remove('hidden');
}

function cerrarModalPublicacion() {
    document.getElementById('modal-pub').classList.add('hidden');
}

document.getElementById('form-pub').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        titulo: document.getElementById('pub-titulo').value,
        contenido: document.getElementById('pub-contenido').value,
        imagen_url: document.getElementById('pub-imagen').value,
        grupo_vendedores: document.getElementById('pub-grupo').value
    };

    try {
        const res = await apiFetch('/api/publicaciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) throw new Error('Error al publicar');
        
        showToast('Publicación creada correctamente', 'success');
        cerrarModalPublicacion();
        cargarPublicacionesAdmin();
    } catch (err) {
        alert(err.message);
    }
});

async function eliminarPublicacion(id) {
    if (!confirm('¿Estás seguro de eliminar esta publicación?')) return;

    try {
        const res = await apiFetch(`/api/publicaciones/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        showToast('Publicación eliminada', 'success');
        cargarPublicacionesAdmin();
    } catch (err) {
        alert(err.message);
    }
}

// === Utilidades ===
function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
