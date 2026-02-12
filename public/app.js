let todosLosPedidos = [];
let pedidoActual = null;

const formatter = new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    minimumFractionDigits: 2
});

let dynamicsData = null;

// === Inicializacion ===
window.addEventListener('DOMContentLoaded', () => {
    checkHealth();
    cargarPedidos();

    document.getElementById('searchGlobal').addEventListener('input', aplicarFiltros);
    document.getElementById('fechaDesde').addEventListener('change', aplicarFiltros);
    document.getElementById('fechaHasta').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroEstado').addEventListener('change', aplicarFiltros);

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

    const filtrados = todosLosPedidos.filter(p => {
        // Texto
        if (busqueda) {
            const texto = `${p.pedido_numero} ${p.cliente_nombre} ${p.vendedor_nombre} ${p.cliente_rnc || ''}`.toLowerCase();
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

    renderizarTabla(filtrados);
}

// === Renderizar Tabla ===
function renderizarTabla(datos) {
    const body = document.getElementById('pedidos-body');
    const contador = document.getElementById('contador');
    const empty = document.getElementById('empty-state');

    contador.textContent = `${datos.length} de ${todosLosPedidos.length}`;

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
    document.getElementById('vista-lista').classList.add('hidden');
    document.getElementById('vista-detalle').classList.add('hidden');
    document.getElementById('vista-dynamics').classList.add('hidden');
    document.getElementById('vista-logs').classList.add('hidden');

    if (view === 'pedidos') {
        document.getElementById('vista-lista').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Pedidos';
        document.getElementById('contador').classList.remove('hidden');
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

        if (logs.length === 0) {
            body.innerHTML = '<tr><td colspan="2" class="text-center" style="padding: 32px; color: var(--text-secondary);">No hay eventos registrados</td></tr>';
            return;
        }

        // Mostrar de más nuevo a más viejo
        body.innerHTML = logs.reverse().map(log => {
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
    } catch (err) {
        loading.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
    }
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

// === Utilidades ===
function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
