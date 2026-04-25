/**
 * middleware/auth.js - JWT auth middleware
 */
const jwt = require('jsonwebtoken');

function parseCookies(req) {
    const cookies = {};
    const header = req.headers.cookie;
    if (header) header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx < 0) return;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        cookies[key] = val;
    });
    return cookies;
}

function requireAuth(req, res, next) {
    // Leer token desde cookie HttpOnly (preferido) o Authorization header (fallback)
    const cookies = parseCookies(req);
    let token = cookies['app_token'];

    if (!token) {
        const header = req.headers.authorization;
        if (header && header.startsWith('Bearer ')) token = header.split(' ')[1];
    }

    if (!token) return res.status(401).json({ error: 'No autenticado' });
    
    // Intentar verificar con el secreto principal (Node.js)
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        return next();
    } catch (err1) {
        // Si falla, intentar con el secreto del servidor móvil (PHP)
        if (process.env.MOBILE_JWT_SECRET) {
            try {
                const decoded = jwt.verify(token, process.env.MOBILE_JWT_SECRET, { algorithms: ['HS256'] });
                req.user = decoded;
                return next();
            } catch (err2) {
                console.error('[AUTH] Mobile token verification failed:', err2.message);
            }
        }
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    next();
}

// Returns null for admin (no filter), [] if user has no vendors, or string[] of vendedor_nombre
function getVendorFilter(user) {
    if (user.role === 'admin') return null;
    return user.vendors || [];
}

module.exports = { requireAuth, requireAdmin, getVendorFilter };
