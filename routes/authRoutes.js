/**
 * routes/authRoutes.js - Microsoft OAuth login (server-side authorization code flow)
 * Mismo enfoque que AppLogistica PHP: sin MSAL en browser, el servidor maneja el OAuth
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const {
    findUserByOid,
    createUser,
    updateUserLastLogin,
    getUserWithPermissions,
    isFirstUser,
    setUserModules,
    ALL_MODULES
} = require('../db/authDb');
const { requireAuth } = require('../middleware/auth');

const TENANT_ID = process.env.TENANT_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const MS_AUTH_SECRET = process.env.MS_AUTH_SECRET || process.env.CLIENT_SECRET;

function getRedirectUri(req) {
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    return `${protocol}://${host}/api/auth/callback`;
}

// Estado temporal CSRF (en memoria, expira en 10 minutos)
const stateStore = new Map();

// GET /api/auth/microsoft - Redirige al login de Microsoft
router.get('/microsoft', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    stateStore.set(state, Date.now());

    // Limpiar estados expirados
    for (const [k, v] of stateStore) {
        if (Date.now() - v > 600000) stateStore.delete(k);
    }

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: getRedirectUri(req),
        scope: 'openid profile email User.Read',
        response_mode: 'query',
        state,
        prompt: 'select_account'
    });

    res.redirect(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`);
});

// GET /api/auth/callback - Microsoft devuelve el código aquí
router.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        console.error('[AUTH] Error de Microsoft:', error, error_description);
        return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
    }

    if (!state || !stateStore.has(state)) {
        return res.redirect('/?auth_error=Estado+inválido,+intenta+de+nuevo');
    }
    stateStore.delete(state);

    if (!code) {
        return res.redirect('/?auth_error=No+se+recibió+código+de+autorización');
    }

    try {
        const redirectUri = getRedirectUri(req);

        // 1. Intercambiar código por tokens
        const tokenRes = await axios.post(
            `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: MS_AUTH_SECRET,
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                scope: 'openid profile email User.Read'
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenRes.data;

        // 2. Obtener info del usuario desde Microsoft Graph
        const graphRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const msUser = graphRes.data;
        const msOid = msUser.id;
        const email = msUser.mail || msUser.userPrincipalName;
        const displayName = msUser.displayName || email;

        if (!msOid || !email) {
            return res.redirect('/?auth_error=No+se+pudo+obtener+información+del+usuario');
        }

        // 3. Buscar o crear usuario en la BD
        let user = await findUserByOid(msOid);

        if (!user) {
            const firstUser = await isFirstUser();
            const role = firstUser ? 'admin' : 'viewer';
            const newId = await createUser(email, displayName, msOid, role);
            if (firstUser) {
                await setUserModules(newId, ALL_MODULES);
            }
            user = await getUserWithPermissions(newId);
        }

        if (!user.active) {
            return res.redirect('/?auth_error=Cuenta+desactivada.+Contacte+al+administrador.');
        }

        await updateUserLastLogin(user.id);
        const fullUser = await getUserWithPermissions(user.id);

        // 4. Crear JWT de sesión (24h)
        const sessionToken = jwt.sign({
            sub: fullUser.id,
            email: fullUser.email,
            display_name: fullUser.display_name,
            role: fullUser.role,
            modules: fullUser.modules,
            vendors: fullUser.vendors
        }, process.env.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });

        // 5. Setear cookies y redirigir (sin token en URL)
        const isProduction = (req.get('x-forwarded-proto') || req.protocol) === 'https';
        const cookieOpts = {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000 // 8 horas
        };

        // Cookie HttpOnly para el JWT (no accesible desde JS)
        res.cookie('app_token', sessionToken, cookieOpts);

        // Cookie JS-readable solo para datos de display (no el token)
        res.cookie('app_user', encodeURIComponent(JSON.stringify({
            id: fullUser.id,
            email: fullUser.email,
            display_name: fullUser.display_name,
            role: fullUser.role,
            modules: fullUser.modules
        })), { ...cookieOpts, httpOnly: false });

        console.log(`[AUTH] Login exitoso: ${email} (${fullUser.role})`);
        res.redirect('/');

    } catch (err) {
        console.error('[AUTH] Error en callback:', err.response?.data || err.message);
        const msg = err.response?.data?.error_description || err.message;
        res.redirect(`/?auth_error=${encodeURIComponent(msg)}`);
    }
});

// POST /api/auth/logout - Limpia las cookies de sesión
router.post('/logout', (req, res) => {
    res.clearCookie('app_token');
    res.clearCookie('app_user');
    res.json({ ok: true });
});

// GET /api/auth/me - Retorna el usuario actual (protegido)
router.get('/me', requireAuth, async (req, res) => {
    try {
        const user = await getUserWithPermissions(req.user.sub);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
