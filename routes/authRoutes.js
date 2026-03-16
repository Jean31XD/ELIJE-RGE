/**
 * routes/authRoutes.js - Microsoft OAuth login routes
 * All routes are public (no auth middleware)
 */
require('dotenv').config();
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
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

// GET /api/auth/config - Public: returns MSAL config for frontend
router.get('/config', (req, res) => {
    res.json({
        clientId: process.env.MS_LOGIN_CLIENT_ID,
        tenantId: TENANT_ID
    });
});

// POST /api/auth/login - Exchange MS ID token for session JWT
router.post('/login', async (req, res) => {
    try {
        const { idToken } = req.body;
        if (!idToken) return res.status(400).json({ error: 'idToken requerido' });

        // Decode header to get kid
        const parts = idToken.split('.');
        if (parts.length !== 3) return res.status(400).json({ error: 'Token malformado' });

        let header;
        try {
            header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
        } catch {
            return res.status(400).json({ error: 'Token header inválido' });
        }

        // Build JWKS client
        const client = jwksClient({
            jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
            cache: true,
            rateLimit: true
        });

        // Get signing key
        let signingKey;
        try {
            const key = await client.getSigningKey(header.kid);
            signingKey = key.getPublicKey();
        } catch (err) {
            return res.status(401).json({ error: 'No se pudo obtener clave de firma: ' + err.message });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(idToken, signingKey, {
                audience: process.env.MS_LOGIN_CLIENT_ID,
                issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`
            });
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido: ' + err.message });
        }

        // Extract claims
        const oid = decoded.oid;
        const email = decoded.preferred_username || decoded.email || decoded.upn;
        const displayName = decoded.name || email;

        if (!oid || !email) {
            return res.status(400).json({ error: 'Token sin OID o email' });
        }

        // Find or create user
        let user = await findUserByOid(oid);

        if (!user) {
            const firstUser = await isFirstUser();
            const role = firstUser ? 'admin' : 'viewer';
            const newId = await createUser(email, displayName, oid, role);
            if (firstUser) {
                // Give first user ALL modules
                await setUserModules(newId, ALL_MODULES);
            }
            user = await getUserWithPermissions(newId);
        }

        // Check active
        if (!user.active) {
            return res.status(403).json({ error: 'Cuenta desactivada. Contacte al administrador.' });
        }

        await updateUserLastLogin(user.id);
        const fullUser = await getUserWithPermissions(user.id);

        // Sign session JWT (24h)
        const tokenPayload = {
            sub: fullUser.id,
            email: fullUser.email,
            display_name: fullUser.display_name,
            role: fullUser.role,
            modules: fullUser.modules,
            vendors: fullUser.vendors
        };

        const sessionToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.json({
            token: sessionToken,
            user: {
                id: fullUser.id,
                email: fullUser.email,
                display_name: fullUser.display_name,
                role: fullUser.role,
                modules: fullUser.modules
            }
        });
    } catch (err) {
        console.error('[AUTH] Login error:', err);
        res.status(500).json({ error: 'Error interno de autenticación: ' + err.message });
    }
});

// GET /api/auth/me - Protected: returns current user with permissions
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
