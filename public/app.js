let todosLosPedidos = [];
let pedidoActual = null;
let pedidosFiltrados = [];
let paginaActual = 1;
let registrosPorPagina = 20;

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
let trackingPaginaActual = 1;
let trackingRegistrosPorPagina = 20;
let trackAutoRefresh = null;

// === Inicializacion ===
window.addEventListener('DOMContentLoaded', () => {
    checkHealth();
    cargarDashboard();

    document.getElementById('searchGlobal').addEventListener('input', aplicarFiltros);
    document.getElementById('fechaDesde').addEventListener('change', aplicarFiltros);
    document.getElementById('fechaHasta').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroEstado').addEventListener('change', aplicarFiltros);

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
});

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
        const res = await fetch('/api/pedidos');
        if (!res.ok) throw new Error('Error del servidor');
        todosLosPedidos = await res.json();
        loader.classList.add('hidden');
        aplicarFiltros();
        checkHealth();
    } catch (error) {
        loader.innerHTML = '<p style="color: var(--danger);">Error de conexion con la base de datos</p>';
        console.error(error);
    }
}

// === Filtros ===
function aplicarFiltros() {
    const busqueda = document.getElementById('searchGlobal').value.toLowerCase().trim();
    const desde = document.getElementById('fechaDesde').value;
    const hasta = document.getElementById('fechaHasta').value;
    const estado = document.getElementById('filtroEstado').value;

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

        // Estado
        if (estado === 'pendiente' && p.enviado_dynamics) return false;
        if (estado === 'enviado' && !p.enviado_dynamics) return false;

        return true;
    });

    paginaActual = 1;
    renderizarPagina();
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
        let tooltip = '';

        if (p.enviado_dynamics) {
            estadoClass = 'status-enviado';
            estadoText = 'Sincronizado';
        } else if (p.sync_error) {
            estadoClass = 'status-error';
            estadoText = 'Error Sync';
            tooltip = p.sync_error;
        }

        const dynamicsCol = p.dynamics_order_number
            ? `<span class="dynamics-num">${escapeHtml(p.dynamics_order_number)}</span>`
            : '<span style="color: var(--text-secondary);">-</span>';

        const retryBtn = (!p.enviado_dynamics)
            ? `<button class="btn btn-ghost btn-sm" onclick="reintentarPedido(event, ${p.pedido_id})" title="Forzar reintento de envío de este pedido">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
               </button>`
            : '';

        return `
            <tr id="pedido-row-${p.pedido_id}">
                <td><span class="pedido-num">${escapeHtml(p.pedido_numero)}</span></td>
                <td>${escapeHtml(p.cliente_nombre)}</td>
                <td>${escapeHtml(p.cliente_rnc || '-')}</td>
                <td>${escapeHtml(p.vendedor_nombre)}</td>
                <td>${fecha}</td>
                <td class="text-right"><span class="money">${formatter.format(p.total)}</span></td>
                <td class="text-center">
                    <span class="status ${estadoClass}" title="${escapeHtml(tooltip)}">${estadoText}</span>
                </td>
                <td class="text-center">${dynamicsCol}</td>
                <td style="white-space: nowrap;">
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
        const res = await fetch(`/api/pedidos/${pedidoId}/retry`, { method: 'POST' });

        let data = {};
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.toLowerCase().includes("application/json")) {
            data = await res.json();
        } else if (!res.ok) {
            const text = await res.text();
            throw new Error(`Respuesta no-JSON (HTTP ${res.status}): ${text.substring(0, 100)}`);
        }

        if (!res.ok) throw new Error(data.error || 'Error al procesar pedido');

        // Notificar éxito visualmente
        btn.innerHTML = '✅';
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            cargarPedidos(); // Recargar lista para ver cambios
        }, 1500);

    } catch (error) {
        alert('Error de Dynamics: ' + error.message);
        btn.innerHTML = '❌';
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            cargarPedidos(); // Recargar para mostrar el error guardado en la tabla
        }, 2000);
    }
}

// === Ver Detalle ===
async function verDetalle(pedidoId) {
    pedidoActual = todosLosPedidos.find(p => p.pedido_id === pedidoId);
    if (!pedidoActual) return;

    // Mostrar vista detalle
    document.getElementById('vista-lista').classList.add('hidden');
    document.getElementById('vista-detalle').classList.remove('hidden');
    document.getElementById('page-title').textContent = `Pedido ${pedidoActual.pedido_numero}`;

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
    `;

    // Cargar lineas
    const detalleBody = document.getElementById('detalle-body');
    const detalleFooter = document.getElementById('detalle-footer');
    const detalleLoading = document.getElementById('detalle-loading');

    detalleBody.innerHTML = '';
    detalleFooter.innerHTML = '';
    detalleLoading.classList.remove('hidden');

    try {
        const res = await fetch(`/api/pedidos/${pedidoId}/lineas`);
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
}

// === Limpiar Filtros ===
function limpiarFiltros() {
    document.getElementById('searchGlobal').value = '';
    document.getElementById('fechaDesde').value = '';
    document.getElementById('fechaHasta').value = '';
    document.getElementById('filtroEstado').value = 'todos';
    aplicarFiltros();
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
            trackAutoRefresh = setInterval(cargarTracking, 30000);
        }
    }

    // Detener refresco de tracking si se sale de la vista
    if (view !== 'tracking' && trackAutoRefresh) {
        clearInterval(trackAutoRefresh);
        trackAutoRefresh = null;
    }
}

// === Logs de Sincronización ===
async function cargarLogsSync() {
    const body = document.getElementById('logs-body');
    const loading = document.getElementById('logs-loading');

    body.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const res = await fetch('/api/sync/log');
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

// === Dynamics 365 Campos ===
async function cargarCamposDynamics() {
    const headerLoading = document.getElementById('dynamics-header-loading');
    const sqlLoading = document.getElementById('sql-loading');
    sqlLoading.classList.remove('hidden');

    // Cargar columnas SQL en paralelo
    try {
        const res = await fetch('/api/sql/columnas');
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
        const res = await fetch('/api/dynamics/campos');
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
        const res = await fetch('/api/rangos');
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

        const res = await fetch(url, {
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
        const res = await fetch(`/api/rangos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        cargarRangos();
    } catch (err) {
        alert(err.message);
    }
}

// === Dashboard ===
async function cargarDashboard() {
    const loading = document.getElementById('dashboard-loading');
    const content = document.getElementById('dashboard-content');

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        const res = await fetch('/api/dashboard');
        if (!res.ok) throw new Error('Error del servidor');
        dashboardData = await res.json();

        loading.classList.add('hidden');
        content.classList.remove('hidden');
        renderDashboard(dashboardData);
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error cargando dashboard: ${err.message}</p>`;
        console.error(err);
    }
}

function renderDashboard(data) {
    const content = document.getElementById('dashboard-content');
    const k = data.kpis;

    const syncRate = k.total_pedidos > 0
        ? ((k.enviados_dynamics / k.total_pedidos) * 100).toFixed(1)
        : 0;

    content.innerHTML = `
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
                    <span class="kpi-label">Vendedores</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon kpi-icon-orange">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                </div>
                <div class="kpi-data">
                    <span class="kpi-value">${syncRate}%</span>
                    <span class="kpi-label">Tasa de Sync</span>
                </div>
            </div>
        </div>

        <div class="dashboard-sync-status">
            <div class="sync-mini-card sync-ok">
                <span class="sync-count">${k.enviados_dynamics}</span>
                <span class="sync-label">Sincronizados</span>
            </div>
            <div class="sync-mini-card sync-pending">
                <span class="sync-count">${k.pendientes}</span>
                <span class="sync-label">Pendientes</span>
            </div>
            <div class="sync-mini-card sync-error">
                <span class="sync-count">${k.con_error}</span>
                <span class="sync-label">Con Error</span>
            </div>
            <div class="sync-mini-card sync-avg">
                <span class="sync-count">${formatter.format(k.promedio_pedido)}</span>
                <span class="sync-label">Promedio por Pedido</span>
            </div>
        </div>

        <div class="dashboard-charts-row">
            <div class="dashboard-chart-card dashboard-chart-wide">
                <h3 class="chart-title">Tendencia de Ventas (30 dias)</h3>
                <canvas id="chart-daily-trend"></canvas>
            </div>
            <div class="dashboard-chart-card">
                <h3 class="chart-title">Estado de Pedidos</h3>
                <canvas id="chart-sync-status"></canvas>
            </div>
        </div>

        <div class="dashboard-charts-row dashboard-charts-row-equal">
            <div class="dashboard-chart-card">
                <h3 class="chart-title">Ventas Mensuales</h3>
                <canvas id="chart-monthly-trend"></canvas>
            </div>
            <div class="dashboard-chart-card">
                <h3 class="chart-title">Top Categorias</h3>
                <canvas id="chart-categories"></canvas>
            </div>
        </div>

        <div class="dashboard-rankings-row">
            <div class="dashboard-ranking-card">
                <h3 class="ranking-title">Top Vendedores</h3>
                <div class="ranking-list" id="ranking-vendedores"></div>
            </div>
            <div class="dashboard-ranking-card">
                <h3 class="ranking-title">Top Clientes</h3>
                <div class="ranking-list" id="ranking-clientes"></div>
            </div>
        </div>

        <div class="dashboard-recent">
            <h3 class="ranking-title">Pedidos Recientes</h3>
            <div class="table-card" style="margin: 0;">
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

    container.innerHTML = items.map((item, i) => {
        const pct = maxMonto > 0 ? (item.monto_total / maxMonto * 100) : 0;
        return `
            <div class="ranking-item">
                <span class="ranking-pos ${i < 3 ? 'ranking-top' : ''}">${i + 1}</span>
                <div class="ranking-info">
                    <span class="ranking-name">${escapeHtml(item[nameField])}</span>
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
        primaryLight: 'rgba(37, 99, 235, 0.1)',
        success: '#16a34a',
        warning: '#d97706',
        danger: '#dc2626',
        purple: '#7c3aed'
    };

    // Tendencia diaria - Linea
    const dailyCtx = document.getElementById('chart-daily-trend');
    if (dailyCtx) {
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
                    backgroundColor: chartColors.primaryLight,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => formatter.format(ctx.parsed.y)
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: v => 'RD$' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
                        },
                        grid: { color: 'rgba(0,0,0,0.04)' }
                    },
                    x: { grid: { display: false } }
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
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } }
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
                    backgroundColor: chartColors.primary,
                    borderRadius: 4,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: ctx => formatter.format(ctx.parsed.y) }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: v => 'RD$' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
                        },
                        grid: { color: 'rgba(0,0,0,0.04)' }
                    },
                    x: { grid: { display: false } }
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
                    backgroundColor: catColors.slice(0, data.topCategorias.length),
                    borderRadius: 4,
                    barPercentage: 0.7
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: ctx => formatter.format(ctx.parsed.x) }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            callback: v => 'RD$' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
                        },
                        grid: { color: 'rgba(0,0,0,0.04)' }
                    },
                    y: { grid: { display: false } }
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
        const res = await fetch('/api/cobros');
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
async function cargarTracking() {
    const body = document.getElementById('tracking-body');
    const loading = document.getElementById('tracking-loading');
    const empty = document.getElementById('tracking-empty');

    body.innerHTML = '';
    loading.classList.remove('hidden');
    empty.classList.add('hidden');

    // Inicializar fecha si está vacía
    const inputFecha = document.getElementById('filtroFechaTracking');
    if (inputFecha && !inputFecha.value) {
        inputFecha.value = new Date().toISOString().split('T')[0];
    }

    // Inicializar mapa si no existe
    if (!trackingMap) {
        // Centro en Santo Domingo por defecto
        trackingMap = L.map('map').setView([18.4861, -69.9312], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(trackingMap);
    }

    // Limpiar marcadores previos
    trackingMarkers.forEach(m => {
        if (trackingMap.hasLayer(m)) trackingMap.removeLayer(m);
    });
    trackingMarkers = [];

    try {
        const res = await fetch('/api/tracking');
        if (!res.ok) throw new Error('Error al cargar datos de tracking');
        todosLosTracking = await res.json();

        loading.classList.add('hidden');

        if (todosLosTracking.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        // Poblar selector de vendedores
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

        aplicarFiltrosTracking();

    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
        console.error(err);
    }
}

function renderTablaTracking(datos) {
    const body = document.getElementById('tracking-body');
    const total = datos.length;

    if (total === 0) {
        body.innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 32px; color: var(--text-secondary);">No hay registros disponibles para el filtro</td></tr>';
        renderizarPaginacionTracking(0);
        return;
    }

    const totalPaginas = Math.ceil(total / trackingRegistrosPorPagina);
    const inicio = (trackingPaginaActual - 1) * trackingRegistrosPorPagina;
    const fin = inicio + trackingRegistrosPorPagina;
    const datosPagina = datos.slice(inicio, fin);

    body.innerHTML = datosPagina.map(t => {
        const fecha = t.created_at
            ? new Date(t.created_at).toLocaleString('es-DO', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            })
            : '-';

        let actionClass = 'badge';
        if (t.action === 'ORDER') actionClass += ' status-enviado';
        else if (t.action === 'CHECKIN') actionClass += ' status-pendiente';

        const ovHtml = t.dynamics_order_number
            ? `<div style="margin-top: 4px;"><span class="badge" style="background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;">OV: ${t.dynamics_order_number}</span></div>`
            : '';

        return `
            <tr>
                <td>
                    <div style="font-weight: 600;">${escapeHtml(t.vendedor_nombre)}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">ID: ${escapeHtml(t.vendedor_id)}</div>
                </td>
                <td>
                    <span class="${actionClass}" style="font-size: 10px;">${escapeHtml(t.action)}</span>
                    ${ovHtml}
                </td>
                <td style="font-family: monospace; font-size: 12px;">${t.latitude}, ${t.longitude}</td>
                <td>${fecha}</td>
            </tr>
        `;
    }).join('');

    renderizarPaginacionTracking(totalPaginas);
}

function renderMarcadoresTracking(datos) {
    // Si hay una polilinea previa, quitarla
    if (trackingPolyline) {
        trackingMap.removeLayer(trackingPolyline);
        trackingPolyline = null;
    }

    const coordsRuta = [];

    datos.forEach(t => {
        if (!t.latitude || !t.longitude) return;

        const color = t.action === 'ORDER' ? '#16a34a' : (t.action === 'CHECKIN' ? '#2563eb' : '#64748b');

        const marker = L.circleMarker([t.latitude, t.longitude], {
            radius: 8,
            fillColor: color,
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(trackingMap);

        const fecha = new Date(t.created_at).toLocaleString('es-DO');
        marker.bindPopup(`
            <div style="font-family: 'Inter', sans-serif;">
                <b style="color: var(--primary);">${escapeHtml(t.vendedor_nombre)}</b><br>
                <span class="badge" style="margin: 5px 0; font-size: 10px;">${escapeHtml(t.action)}</span><br>
                <small style="color: var(--text-secondary);">${fecha}</small>
            </div>
        `);

        trackingMarkers.push(marker);
        coordsRuta.push([t.latitude, t.longitude]);
    });

    // Dibujar ruta solo si se seleccionó un vendedor y hay al menos 2 puntos
    const vendedorId = document.getElementById('filtroVendedorTracking').value;
    if (vendedorId !== 'todos' && coordsRuta.length >= 2) {
        trackingPolyline = L.polyline(coordsRuta, {
            color: 'var(--primary)',
            weight: 3,
            opacity: 0.6,
            dashArray: '10, 10',
            lineJoin: 'round'
        }).addTo(trackingMap);
    }
}

function aplicarFiltrosTracking() {
    const vendedorId = document.getElementById('filtroVendedorTracking').value;
    const fechaFiltro = document.getElementById('filtroFechaTracking').value;
    const accionFiltro = document.getElementById('filtroAccionTracking').value;

    // Limpiar marcadores previos
    trackingMarkers.forEach(m => {
        if (trackingMap.hasLayer(m)) trackingMap.removeLayer(m);
    });
    trackingMarkers = [];

    trackingFiltrados = todosLosTracking.filter(t => {
        // Filtro Vendedor
        if (vendedorId !== 'todos' && t.vendedor_id !== vendedorId) return false;

        // Filtro Fecha
        if (fechaFiltro) {
            const fechaAudit = t.created_at ? t.created_at.split('T')[0] : '';
            if (fechaAudit !== fechaFiltro) return false;
        }

        // Filtro Acción
        if (accionFiltro !== 'todos' && t.action !== accionFiltro) return false;

        return true;
    });

    // Ordenar por fecha para la ruta (polyline exige orden cronológico)
    const datosOrdenados = [...trackingFiltrados].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    trackingPaginaActual = 1;
    renderTablaTracking(trackingFiltrados); // Tabla usa el set filtrado (con paginacion)
    renderMarcadoresTracking(datosOrdenados); // Mapa usa el set ordenado ascendente

    if (trackingMarkers.length > 0) {
        const group = new L.featureGroup(trackingMarkers);
        trackingMap.fitBounds(group.getBounds().pad(0.1));
    }
}

function cambiarPaginaTracking(pagina) {
    const totalPaginas = Math.ceil(trackingFiltrados.length / trackingRegistrosPorPagina);
    if (pagina < 1 || pagina > totalPaginas) return;
    trackingPaginaActual = pagina;
    renderTablaTracking(trackingFiltrados);
}

function renderizarPaginacionTracking(totalPaginas) {
    const container = document.getElementById('tracking-pagination-container');
    if (!container) return;

    if (totalPaginas <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `
        <div class="pagination-controls">
            <button onclick="cambiarPaginaTracking(${trackingPaginaActual - 1})" ${trackingPaginaActual === 1 ? 'disabled' : ''}>Anterior</button>
            <span style="margin: 0 15px;">Página ${trackingPaginaActual} de ${totalPaginas}</span>
            <button onclick="cambiarPaginaTracking(${trackingPaginaActual + 1})" ${trackingPaginaActual === totalPaginas ? 'disabled' : ''}>Siguiente</button>
        </div>
    `;
    container.innerHTML = html;
}

// === Utilidades ===
function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
