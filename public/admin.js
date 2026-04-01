/**
 * admin.js - Admin panel logic
 * Handles user management and vendor group management
 */

const ALL_MODULES_LIST = ['dashboard', 'pedidos', 'cobros', 'sync', 'logs', 'rangos', 'tracking', 'clientes-extra'];
const MODULE_LABELS = {
    dashboard: 'Dashboard',
    pedidos: 'Pedidos',
    cobros: 'Cobros',
    sync: 'Dynamics 365',
    logs: 'Logs Sync',
    rangos: 'Rangos',
    tracking: 'Tracking',
    'clientes-extra': 'Clientes Asignados'
};

let adminUsers = [];
let adminGroups = [];
let adminVendorMap = [];
let adminCatalogUsers = [];
let adminAvailableVendors = [];
let editingUserId = null;
let editingGroupId = null;
let editingMapaNombre = null;
let resetPwdUsername = null;

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('admin-tab-usuarios').style.display = tab === 'usuarios' ? '' : 'none';
    document.getElementById('admin-tab-grupos').style.display = tab === 'grupos' ? '' : 'none';
    document.getElementById('admin-tab-mapa').style.display = tab === 'mapa' ? '' : 'none';
    document.getElementById('admin-tab-catalogo').style.display = tab === 'catalogo' ? '' : 'none';
    if (tab === 'mapa' && adminVendorMap.length === 0) cargarMapaAdmin();
    if (tab === 'catalogo' && adminCatalogUsers.length === 0) cargarCatalogoAdmin();
}

async function cargarAdmin() {
    await Promise.all([cargarUsuariosAdmin(), cargarGruposAdmin()]);
}

// ============ USERS ============

async function cargarUsuariosAdmin() {
    const loading = document.getElementById('admin-users-loading');
    const body = document.getElementById('admin-users-body');
    if (loading) loading.style.display = 'flex';
    if (body) body.innerHTML = '';

    try {
        const res = await apiFetch('/api/admin/users');
        if (!res.ok) throw new Error('Error al cargar usuarios');
        adminUsers = await res.json();
        renderUsuarios(adminUsers);
    } catch (err) {
        if (body) body.innerHTML = `<tr><td colspan="6" style="color:var(--danger);text-align:center;padding:16px;">Error: ${escapeHtml(err.message)}</td></tr>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderUsuarios(users) {
    const body = document.getElementById('admin-users-body');
    if (!body) return;

    if (!users || users.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:24px;">No hay usuarios registrados</td></tr>';
        return;
    }

    body.innerHTML = users.map(u => {
        const roleClass = u.role;
        const modulesHtml = (u.modules || []).map(m =>
            `<span class="module-chip">${escapeHtml(MODULE_LABELS[m] || m)}</span>`
        ).join('') || '<span style="color:var(--text-secondary);font-size:12px;">Ninguno</span>';

        const groupsCount = (u.vendorGroupIds || []).length;
        const groupsHtml = groupsCount > 0
            ? `<span class="vendor-chip">${groupsCount} grupo${groupsCount !== 1 ? 's' : ''}</span>`
            : '<span style="color:var(--text-secondary);font-size:12px;">Ninguno</span>';

        const activeHtml = u.active
            ? '<span style="color:var(--success);font-size:12px;font-weight:600;">Activo</span>'
            : '<span style="color:var(--danger);font-size:12px;font-weight:600;">Inactivo</span>';

        return `
            <tr>
                <td>
                    <div style="font-weight:500;">${escapeHtml(u.display_name || u.email)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(u.email)}</div>
                </td>
                <td><span class="role-badge ${roleClass}">${roleClass}</span></td>
                <td>${modulesHtml}</td>
                <td>${groupsHtml}</td>
                <td>${activeHtml}</td>
                <td class="text-center">
                    <button class="btn btn-ghost btn-sm" onclick="abrirModalUsuario(${u.id})">Editar</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function abrirModalUsuario(id) {
    editingUserId = id;
    const modal = document.getElementById('modal-usuario');
    if (!modal) return;

    // Reset form
    document.getElementById('modal-usuario-titulo').textContent = 'Cargando...';
    modal.classList.remove('hidden');

    try {
        const [userRes, groupsRes, vendorsRes] = await Promise.all([
            apiFetch(`/api/admin/users/${id}`).then(r => r.json()),
            apiFetch('/api/admin/vendor-groups').then(r => r.json()),
            apiFetch('/api/admin/available-vendors').then(r => r.json())
        ]);

        adminAvailableVendors = vendorsRes;
        adminGroups = groupsRes;

        document.getElementById('modal-usuario-titulo').textContent = userRes.display_name || userRes.email;

        // Role select
        const roleSelect = document.getElementById('modal-user-role');
        if (roleSelect) roleSelect.value = userRes.role;

        // Active checkbox
        const activeCheck = document.getElementById('modal-user-active');
        if (activeCheck) activeCheck.checked = !!userRes.active;

        // Modules checkboxes
        const modulesDiv = document.getElementById('modal-user-modules');
        if (modulesDiv) {
            modulesDiv.innerHTML = ALL_MODULES_LIST.map(m => `
                <label class="check-label">
                    <input type="checkbox" name="module" value="${m}" ${(userRes.modules || []).includes(m) ? 'checked' : ''}>
                    ${escapeHtml(MODULE_LABELS[m] || m)}
                </label>
            `).join('');
        }

        // Vendor groups checkboxes
        const groupsDiv = document.getElementById('modal-user-groups');
        if (groupsDiv) {
            const userGroupIds = (userRes.vendorGroups || []).map(g => g.group_id);
            groupsDiv.innerHTML = groupsRes.length === 0
                ? '<p style="color:var(--text-secondary);font-size:13px;">No hay grupos creados</p>'
                : groupsRes.map(g => `
                    <label class="check-label">
                        <input type="checkbox" name="group" value="${g.id}" ${userGroupIds.includes(g.id) ? 'checked' : ''}>
                        ${escapeHtml(g.name)} <span style="color:var(--text-secondary);font-size:11px;">(${(g.vendors || []).length} vendedores)</span>
                    </label>
                `).join('');
        }

        // Individual vendors (con búsqueda)
        renderVendorChecklist('modal-user-vendors', vendorsRes, userRes.vendors || [], 'vendor');

    } catch (err) {
        document.getElementById('modal-usuario-titulo').textContent = 'Error';
        alert('Error al cargar datos del usuario: ' + err.message);
    }
}

async function guardarUsuario() {
    if (!editingUserId) return;

    const role = document.getElementById('modal-user-role')?.value;
    const active = document.getElementById('modal-user-active')?.checked;
    const modules = [...document.querySelectorAll('#modal-user-modules input[name="module"]:checked')].map(el => el.value);
    const groupIds = [...document.querySelectorAll('#modal-user-groups input[name="group"]:checked')].map(el => parseInt(el.value));
    const vendors = [...document.querySelectorAll('#modal-user-vendors input[name="vendor"]:checked')].map(el => el.value);

    const btn = document.getElementById('btn-guardar-usuario');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
        await Promise.all([
            apiFetch(`/api/admin/users/${editingUserId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, active })
            }),
            apiFetch(`/api/admin/users/${editingUserId}/modules`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modules })
            }),
            apiFetch(`/api/admin/users/${editingUserId}/vendor-groups`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupIds })
            }),
            apiFetch(`/api/admin/users/${editingUserId}/vendors`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vendors })
            })
        ]);

        cerrarModalUsuario();
        await cargarUsuariosAdmin();
        showToastAdmin('Usuario actualizado correctamente', 'success');
    } catch (err) {
        showToastAdmin('Error al guardar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}

function cerrarModalUsuario() {
    const modal = document.getElementById('modal-usuario');
    if (modal) modal.classList.add('hidden');
    editingUserId = null;
}

// ============ VENDOR GROUPS ============

async function cargarGruposAdmin() {
    const loading = document.getElementById('admin-groups-loading');
    const body = document.getElementById('admin-groups-body');
    if (loading) loading.style.display = 'flex';
    if (body) body.innerHTML = '';

    try {
        const res = await apiFetch('/api/admin/vendor-groups');
        if (!res.ok) throw new Error('Error al cargar grupos');
        adminGroups = await res.json();
        renderGruposVendedores(adminGroups);
    } catch (err) {
        if (body) body.innerHTML = `<tr><td colspan="4" style="color:var(--danger);text-align:center;padding:16px;">Error: ${escapeHtml(err.message)}</td></tr>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderGruposVendedores(groups) {
    const body = document.getElementById('admin-groups-body');
    if (!body) return;

    if (!groups || groups.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:24px;">No hay grupos creados</td></tr>';
        return;
    }

    body.innerHTML = groups.map(g => {
        const vendorsPreview = (g.vendors || []).slice(0, 3).map(v => `<span class="vendor-chip">${escapeHtml(v)}</span>`).join('');
        const extra = (g.vendors || []).length > 3 ? `<span style="font-size:11px;color:var(--text-secondary);"> +${(g.vendors || []).length - 3} más</span>` : '';

        return `
            <tr>
                <td><span style="font-weight:500;">${escapeHtml(g.name)}</span></td>
                <td><span style="color:var(--text-secondary);font-size:13px;">${escapeHtml(g.description || '')}</span></td>
                <td>${vendorsPreview}${extra}${(g.vendors || []).length === 0 ? '<span style="color:var(--text-secondary);font-size:12px;">Sin vendedores</span>' : ''}</td>
                <td class="text-center" style="white-space:nowrap;">
                    <button class="btn btn-ghost btn-sm" onclick="abrirModalGrupo(${g.id})" style="margin-right:4px;">Editar</button>
                    <button class="btn btn-ghost btn-sm" onclick="eliminarGrupo(${g.id})" style="color:var(--danger);">Eliminar</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function abrirModalGrupo(id) {
    editingGroupId = id || null;
    const modal = document.getElementById('modal-grupo');
    if (!modal) return;

    document.getElementById('modal-grupo-titulo').textContent = id ? 'Editar Grupo' : 'Nuevo Grupo';
    document.getElementById('modal-group-name').value = '';
    document.getElementById('modal-group-desc').value = '';

    modal.classList.remove('hidden');

    // Load available vendors
    try {
        const vendors = await apiFetch('/api/admin/available-vendors').then(r => r.json());
        adminAvailableVendors = vendors;

        let selectedVendors = [];
        if (id) {
            const group = adminGroups.find(g => g.id === id);
            if (group) {
                document.getElementById('modal-group-name').value = group.name || '';
                document.getElementById('modal-group-desc').value = group.description || '';
                selectedVendors = group.vendors || [];
            }
        }

        // Vendors del grupo (con búsqueda)
        renderVendorChecklist('modal-group-vendors', vendors, selectedVendors, 'gvendor');
    } catch (err) {
        alert('Error al cargar vendedores: ' + err.message);
    }
}

async function guardarGrupo() {
    const name = document.getElementById('modal-group-name')?.value?.trim();
    const description = document.getElementById('modal-group-desc')?.value?.trim();
    const vendors = [...document.querySelectorAll('#modal-group-vendors input[name="gvendor"]:checked')].map(el => el.value);

    if (!name) {
        alert('El nombre del grupo es requerido');
        return;
    }

    const btn = document.getElementById('btn-guardar-grupo');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
        if (editingGroupId) {
            await apiFetch(`/api/admin/vendor-groups/${editingGroupId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, vendors })
            });
        } else {
            await apiFetch('/api/admin/vendor-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, vendors })
            });
        }

        cerrarModalGrupo();
        await cargarGruposAdmin();
        showToastAdmin(editingGroupId ? 'Grupo actualizado' : 'Grupo creado', 'success');
    } catch (err) {
        showToastAdmin('Error al guardar grupo: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}

function cerrarModalGrupo() {
    const modal = document.getElementById('modal-grupo');
    if (modal) modal.classList.add('hidden');
    editingGroupId = null;
}

async function eliminarGrupo(id) {
    const group = adminGroups.find(g => g.id === id);
    if (!confirm(`¿Eliminar el grupo "${group ? group.name : id}"? Esta acción no se puede deshacer.`)) return;

    try {
        const res = await apiFetch(`/api/admin/vendor-groups/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al eliminar');
        }
        await cargarGruposAdmin();
        showToastAdmin('Grupo eliminado', 'success');
    } catch (err) {
        showToastAdmin('Error: ' + err.message, 'error');
    }
}

// ============ VENDOR MAP (Mapeo Dynamics) ============

async function cargarMapaAdmin() {
    const loading = document.getElementById('admin-mapa-loading');
    const body = document.getElementById('admin-mapa-body');
    if (loading) loading.style.display = 'flex';
    if (body) body.innerHTML = '';

    try {
        const res = await apiFetch('/api/admin/vendor-map');
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `Error ${res.status}`);
        }
        adminVendorMap = await res.json();
        renderTablaMapa(adminVendorMap);
    } catch (err) {
        if (body) body.innerHTML = `<tr><td colspan="5" style="color:var(--danger);text-align:center;padding:16px;">${escapeHtml(err.message)}</td></tr>`;
        showToastAdmin('Error al cargar mapeos: ' + err.message, 'error');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderTablaMapa(datos) {
    const body = document.getElementById('admin-mapa-body');
    if (!body) return;

    if (!datos || datos.length === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:24px;">No hay mapeos configurados</td></tr>';
        return;
    }

    body.innerHTML = datos.map(m => `
        <tr data-nombre="${escapeHtml(m.vendedor_nombre)}">
            <td style="font-weight:500;">${escapeHtml(m.vendedor_nombre)}</td>
            <td><code style="background:var(--surface-hover);padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(m.personnel_number || '-')}</code></td>
            <td><code style="background:var(--surface-hover);padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(m.sales_group_id || '-')}</code></td>
            <td><code style="background:var(--surface-hover);padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(m.secretario_personnel_number || '-')}</code></td>
            <td class="text-center" style="white-space:nowrap;">
                <button class="btn btn-ghost btn-sm" onclick="abrirModalMapa('${escapeHtml(m.vendedor_nombre)}')" style="margin-right:4px;">Editar</button>
                <button class="btn btn-ghost btn-sm" onclick="eliminarMapa('${escapeHtml(m.vendedor_nombre)}')" style="color:var(--danger);">Eliminar</button>
            </td>
        </tr>
    `).join('');
}

function filtrarTablaMapa() {
    const q = document.getElementById('mapa-search')?.value.toLowerCase().trim() || '';
    document.querySelectorAll('#admin-mapa-body tr[data-nombre]').forEach(tr => {
        tr.style.display = tr.dataset.nombre.toLowerCase().includes(q) ? '' : 'none';
    });
}

function abrirModalMapa(nombreOriginal) {
    editingMapaNombre = nombreOriginal || null;
    document.getElementById('modal-mapa-titulo').textContent = nombreOriginal ? 'Editar Mapeo' : 'Nuevo Mapeo';
    document.getElementById('modal-mapa-original').value = nombreOriginal || '';

    if (nombreOriginal) {
        const entry = adminVendorMap.find(m => m.vendedor_nombre === nombreOriginal);
        document.getElementById('modal-mapa-nombre').value = entry?.vendedor_nombre || '';
        document.getElementById('modal-mapa-personnel').value = entry?.personnel_number || '';
        document.getElementById('modal-mapa-salesgroup').value = entry?.sales_group_id || '';
        document.getElementById('modal-mapa-secretario').value = entry?.secretario_personnel_number || '';
    } else {
        document.getElementById('modal-mapa-nombre').value = '';
        document.getElementById('modal-mapa-personnel').value = '';
        document.getElementById('modal-mapa-salesgroup').value = '';
        document.getElementById('modal-mapa-secretario').value = '';
    }

    document.getElementById('modal-mapa').classList.remove('hidden');
    document.getElementById('modal-mapa-nombre').focus();
}

function cerrarModalMapa() {
    document.getElementById('modal-mapa').classList.add('hidden');
    editingMapaNombre = null;
}

async function guardarMapa() {
    const vendedor_nombre = document.getElementById('modal-mapa-nombre')?.value.trim();
    const personnel_number = document.getElementById('modal-mapa-personnel')?.value.trim();
    const sales_group_id = document.getElementById('modal-mapa-salesgroup')?.value.trim();
    const secretario_personnel_number = document.getElementById('modal-mapa-secretario')?.value.trim() || null;
    const vendedor_nombre_original = document.getElementById('modal-mapa-original')?.value;

    if (!vendedor_nombre) { showToastAdmin('El nombre del vendedor es requerido', 'error'); return; }

    const btn = document.getElementById('btn-guardar-mapa');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
        if (editingMapaNombre) {
            await apiFetch('/api/admin/vendor-map', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vendedor_nombre_original, vendedor_nombre, personnel_number, sales_group_id, secretario_personnel_number })
            });
        } else {
            await apiFetch('/api/admin/vendor-map', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vendedor_nombre, personnel_number, sales_group_id, secretario_personnel_number })
            });
        }
        cerrarModalMapa();
        await cargarMapaAdmin();
        showToastAdmin(editingMapaNombre ? 'Mapeo actualizado' : 'Mapeo creado', 'success');
    } catch (err) {
        showToastAdmin('Error al guardar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}

async function eliminarMapa(vendedor_nombre) {
    if (!confirm(`¿Eliminar el mapeo de "${vendedor_nombre}"?`)) return;
    try {
        const res = await apiFetch('/api/admin/vendor-map', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vendedor_nombre })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Error');
        await cargarMapaAdmin();
        showToastAdmin('Mapeo eliminado', 'success');
    } catch (err) {
        showToastAdmin('Error: ' + err.message, 'error');
    }
}

// ============ CATALOG USERS ============

async function cargarCatalogoAdmin() {
    const loading = document.getElementById('admin-catalogo-loading');
    const body = document.getElementById('admin-catalogo-body');
    if (loading) loading.style.display = 'flex';
    if (body) body.innerHTML = '';

    try {
        const res = await apiFetch('/api/admin/catalog-users');
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `Error ${res.status}`);
        }
        adminCatalogUsers = await res.json();
        renderTablaCatalogo();
    } catch (err) {
        showToastAdmin('Error al cargar catálogo: ' + err.message, 'error');
        if (body) body.innerHTML = `<tr><td colspan="6" style="color:var(--danger);text-align:center;padding:16px;">${escapeHtml(err.message)}</td></tr>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderTablaCatalogo() {
    const body = document.getElementById('admin-catalogo-body');
    if (!body) return;

    const q = document.getElementById('catalogo-search')?.value.toLowerCase().trim() || '';
    const filtered = adminCatalogUsers.filter(u =>
        u.vendedor_id.toLowerCase().includes(q) || u.nombre_usuario.toLowerCase().includes(q)
    );

    const count = document.getElementById('catalogo-count');
    if (count) count.textContent = `${filtered.length} de ${adminCatalogUsers.length} usuarios`;

    if (filtered.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:32px;">Sin resultados</td></tr>`;
        return;
    }

    body.innerHTML = filtered.map(u => `
        <tr data-username="${escapeHtml(u.nombre_usuario)}">
            <td style="font-size:13px;">${escapeHtml(u.vendedor_id)}</td>
            <td><strong>${escapeHtml(u.nombre_usuario)}</strong></td>
            <td>
                <span style="font-family:monospace;font-size:13px;background:var(--bg);padding:2px 6px;border-radius:4px;border:1px solid var(--border);color:var(--text-secondary);">
                    ••••••••
                </span>
            </td>
            <td>
                ${u.has_password
                    ? '<span class="role-badge" style="background:#e6f4ea;color:#1a7f37;">Configurado</span>'
                    : '<span class="role-badge" style="background:#fff3cd;color:#856404;">Temporal</span>'}
            </td>
            <td>
                ${u.google2fa_secret
                    ? '<span class="role-badge" style="background:#e8f0fe;color:#1a73e8;">Activo</span>'
                    : '<span style="color:var(--text-secondary);font-size:12px;">—</span>'}
            </td>
            <td class="text-center">
                <button class="btn btn-sm btn-warning" onclick="abrirModalResetPwd('${escapeHtml(u.nombre_usuario)}')">
                    Restablecer contraseña
                </button>
            </td>
        </tr>
    `).join('');
}

function filtrarTablaCatalogo() {
    renderTablaCatalogo();
}

async function sincronizarVendedoresCatalogo() {
    const btn = document.getElementById('btn-sync-catalogo');
    if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando...'; }
    try {
        const res = await apiFetch('/api/admin/catalog-users/sync', { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error || 'Error');
        const data = await res.json();
        showToastAdmin(`Sincronización completa. ${data.inserted} usuario(s) nuevo(s) agregado(s).`, 'success');
        await cargarCatalogoAdmin();
    } catch (err) {
        showToastAdmin('Error al sincronizar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ Sincronizar desde Dynamics'; }
    }
}

function abrirModalResetPwd(username) {
    resetPwdUsername = username;
    document.getElementById('reset-pwd-username').textContent = username;
    document.getElementById('reset-pwd-value').value = 'A*12345678';
    document.getElementById('modal-reset-pwd').classList.remove('hidden');
    document.getElementById('reset-pwd-value').focus();
    document.getElementById('reset-pwd-value').select();
}

function cerrarModalResetPwd() {
    document.getElementById('modal-reset-pwd').classList.add('hidden');
    resetPwdUsername = null;
}

async function confirmarResetPwd() {
    const password = document.getElementById('reset-pwd-value')?.value.trim();
    if (!password || password.length < 8) {
        showToastAdmin('La contraseña debe tener al menos 8 caracteres', 'error');
        return;
    }

    const btn = document.getElementById('btn-confirmar-reset-pwd');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
        const res = await apiFetch(`/api/admin/catalog-users/${encodeURIComponent(resetPwdUsername)}/reset-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Error');
        cerrarModalResetPwd();
        await cargarCatalogoAdmin();
        showToastAdmin(`Contraseña restablecida para ${resetPwdUsername}`, 'success');
    } catch (err) {
        showToastAdmin('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Restablecer'; }
    }
}

// ============ VENDOR CHECKLIST WITH SEARCH ============

function renderVendorChecklist(containerId, vendors, selectedValues, inputName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!vendors || vendors.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No hay vendedores disponibles</p>';
        return;
    }

    const searchId = `${containerId}-search`;
    const listId = `${containerId}-list`;

    container.innerHTML = `
        <div style="position:sticky;top:0;background:var(--surface);padding-bottom:8px;z-index:1;">
            <input
                type="text"
                id="${searchId}"
                placeholder="Buscar vendedor..."
                oninput="filtrarVendorChecklist('${searchId}','${listId}')"
                style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;box-sizing:border-box;">
        </div>
        <div id="${listId}">
            ${vendors.map(v => `
                <label class="check-label" data-name="${escapeHtml(v.toLowerCase())}">
                    <input type="checkbox" name="${inputName}" value="${escapeHtml(v)}" ${selectedValues.includes(v) ? 'checked' : ''}>
                    ${escapeHtml(v)}
                </label>
            `).join('')}
        </div>
    `;
}

function filtrarVendorChecklist(searchId, listId) {
    const query = document.getElementById(searchId)?.value.toLowerCase().trim() || '';
    const list = document.getElementById(listId);
    if (!list) return;
    list.querySelectorAll('label[data-name]').forEach(label => {
        label.style.display = label.dataset.name.includes(query) ? '' : 'none';
    });
}

// ============ HELPERS ============

function showToastAdmin(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type);
        return;
    }
    // Fallback
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-success');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}
