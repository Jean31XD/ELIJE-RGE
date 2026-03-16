/**
 * login.js - Microsoft MSAL login logic
 * Loaded from CDN: msal-browser.min.js must be loaded before this script
 */

let msalInstance = null;

// Initialize MSAL after fetching config from server
async function initMsal() {
    if (msalInstance) return msalInstance;
    try {
        const res = await fetch('/api/auth/config');
        const config = await res.json();

        const msalConfig = {
            auth: {
                clientId: config.clientId,
                authority: 'https://login.microsoftonline.com/' + config.tenantId,
                redirectUri: window.location.origin
            },
            cache: {
                cacheLocation: 'localStorage',
                storeAuthStateInCookie: false
            }
        };

        msalInstance = new msal.PublicClientApplication(msalConfig);
        return msalInstance;
    } catch (err) {
        console.error('[Login] Error inicializando MSAL:', err);
        throw err;
    }
}

async function iniciarLoginMicrosoft() {
    const btn = document.getElementById('btn-ms-login');
    const errorEl = document.getElementById('login-error');
    const loadingEl = document.getElementById('login-loading');

    if (btn) btn.disabled = true;
    if (errorEl) errorEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
        const msal = await initMsal();

        const loginRequest = {
            scopes: ['openid', 'profile', 'email']
        };

        let result;
        try {
            result = await msal.loginPopup(loginRequest);
        } catch (err) {
            if (err.errorCode === 'user_cancelled') {
                if (loadingEl) loadingEl.style.display = 'none';
                if (btn) btn.disabled = false;
                return;
            }
            throw err;
        }

        const idToken = result.idToken;

        // Exchange MS ID token for app session JWT
        const authRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });

        const authData = await authRes.json();

        if (!authRes.ok) {
            throw new Error(authData.error || 'Error de autenticación');
        }

        // Store session
        localStorage.setItem('app_token', authData.token);
        localStorage.setItem('app_user', JSON.stringify(authData.user));

        // Hide overlay and show app
        if (loadingEl) loadingEl.style.display = 'none';
        if (btn) btn.disabled = false;

        document.getElementById('login-overlay').classList.add('hidden');

        if (typeof initApp === 'function') {
            initApp();
        }
    } catch (err) {
        console.error('[Login] Error:', err);
        if (errorEl) {
            errorEl.textContent = err.message || 'Error al iniciar sesión';
            errorEl.style.display = 'block';
        }
        if (loadingEl) loadingEl.style.display = 'none';
        if (btn) btn.disabled = false;
    }
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
    msalInstance = null;

    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.add('auth-hidden');

    const main = document.querySelector('.main-content');
    if (main) main.classList.add('auth-hidden');

    const chip = document.getElementById('user-chip');
    if (chip) chip.style.display = 'none';
}

function mostrarLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.add('auth-hidden');

    const main = document.querySelector('.main-content');
    if (main) main.classList.add('auth-hidden');
}

function checkExistingAuth() {
    const token = localStorage.getItem('app_token');
    if (!token) {
        mostrarLoginOverlay();
        return;
    }

    // Decode JWT exp without library
    try {
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error('bad token');
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp * 1000 < Date.now()) {
            localStorage.removeItem('app_token');
            localStorage.removeItem('app_user');
            mostrarLoginOverlay();
            return;
        }
        // Token valid - init app
        if (typeof initApp === 'function') {
            initApp();
        }
    } catch {
        localStorage.removeItem('app_token');
        localStorage.removeItem('app_user');
        mostrarLoginOverlay();
    }
}

// Called from DOMContentLoaded in app.js
function checkAuth() {
    checkExistingAuth();
}
