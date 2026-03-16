/**
 * middleware/auth.js - JWT auth middleware
 */
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No autenticado' });
    try {
        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
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
