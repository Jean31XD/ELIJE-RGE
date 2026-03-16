/**
 * login.js - Autenticación Microsoft via server-side OAuth redirect
 * Sin MSAL en el browser - el servidor maneja el flujo completo
 */

function iniciarLoginMicrosoft() {
    const btn = document.getElementById('btn-ms-login');
    const errorEl = document.getElementById('login-error');
    const loadingEl = document.getElementById('login-loading');

    if (btn) btn.disabled = true;
    if (errorEl) errorEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'flex';

    // Redirigir al servidor, que redirige a Microsoft
    window.location.href = '/api/auth/microsoft';
}

function getAuthHeaders() {
    const token = localStorage.getItem('app_token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function getCurrentUser() {
    const raw = localStorage.getItem('app_user');
    try {
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function cerrarSesion() {
    localStorage.removeItem('app_token');
    localStorage.removeItem('app_user');
    mostrarLoginOverlay();
}

function mostrarLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.add('auth-hidden');

    const main = document.querySelector('.main-content');
    if (main) main.classList.add('auth-hidden');

    const chip = document.getElementById('user-chip');
    if (chip) chip.style.display = 'none';
}

// Verifica si hay token en la URL (viene del callback OAuth) o en localStorage
function checkAuth() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const userParam = params.get('user');
    const authError = params.get('auth_error');

    // Mostrar error si Microsoft devolvió uno
    if (authError) {
        mostrarLoginOverlay();
        const errorEl = document.getElementById('login-error');
        if (errorEl) {
            errorEl.textContent = decodeURIComponent(authError);
            errorEl.style.display = 'block';
        }
        window.history.replaceState({}, '', '/');
        return;
    }

    // Token recibido desde el callback OAuth
    if (token && userParam) {
        try {
            const user = JSON.parse(decodeURIComponent(userParam));
            localStorage.setItem('app_token', token);
            localStorage.setItem('app_user', JSON.stringify(user));
        } catch {
            mostrarLoginOverlay();
            return;
        }
        window.history.replaceState({}, '', '/');
        initApp();
        return;
    }

    // Verificar token existente en localStorage
    const storedToken = localStorage.getItem('app_token');
    if (!storedToken) {
        mostrarLoginOverlay();
        return;
    }

    try {
        const parts = storedToken.split('.');
        if (parts.length !== 3) throw new Error('token malformado');
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp * 1000 < Date.now()) {
            localStorage.removeItem('app_token');
            localStorage.removeItem('app_user');
            mostrarLoginOverlay();
            return;
        }
        initApp();
    } catch {
        localStorage.removeItem('app_token');
        localStorage.removeItem('app_user');
        mostrarLoginOverlay();
    }
}
