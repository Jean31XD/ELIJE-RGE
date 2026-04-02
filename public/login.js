/**
 * login.js - Autenticación Microsoft via server-side OAuth redirect
 * Sin MSAL en el browser - el servidor maneja el flujo completo
 * Token almacenado en cookie HttpOnly (no accesible desde JS)
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

// Las cookies HttpOnly se envían automáticamente - no se necesita Authorization header
function getAuthHeaders() {
    return {};
}

function getCookie(name) {
    const match = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    if (!match) return null;
    try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return null; }
}

function getCurrentUser() {
    const raw = getCookie('app_user');
    try {
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function cerrarSesion() {
    // El servidor limpia la cookie HttpOnly (JS no puede hacerlo directamente)
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        .catch(() => {})
        .finally(() => {
            mostrarLoginOverlay();
        });
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

// Verifica sesión: primero chequea errores en URL, luego llama /api/auth/me
function checkAuth() {
    const params = new URLSearchParams(window.location.search);
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

    // Limpiar URL si tiene parámetros residuales
    if (window.location.search) {
        window.history.replaceState({}, '', '/');
    }

    // Verificar sesión activa via cookie HttpOnly (opaca para JS)
    fetch('/api/auth/me', { credentials: 'include' })
        .then(res => {
            if (res.status === 401) {
                mostrarLoginOverlay();
                return null;
            }
            return res.json();
        })
        .then(user => {
            if (user) initApp();
        })
        .catch(() => {
            mostrarLoginOverlay();
        });
}
