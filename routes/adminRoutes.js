/**
 * routes/adminRoutes.js - Admin panel API routes
 * All routes protected with requireAuth + requireAdmin
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
    listUsers,
    getUserDetail,
    updateUser,
    setUserModules,
    setUserVendors,
    setUserVendorGroups,
    listVendorGroups,
    createVendorGroup,
    updateVendorGroup,
    deleteVendorGroup,
    getAvailableVendors
} = require('../db/authDb');

// Apply auth middleware to all routes
router.use(requireAuth, requireAdmin);

// GET /api/admin/users
router.get('/users', async (req, res) => {
    try {
        const users = await listUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res) => {
    try {
        const user = await getUserDetail(parseInt(req.params.id));
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/users/:id
router.put('/users/:id', async (req, res) => {
    try {
        await updateUser(parseInt(req.params.id), req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/users/:id/modules
router.put('/users/:id/modules', async (req, res) => {
    try {
        await setUserModules(parseInt(req.params.id), req.body.modules || []);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/users/:id/vendors
router.put('/users/:id/vendors', async (req, res) => {
    try {
        await setUserVendors(parseInt(req.params.id), req.body.vendors || []);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/users/:id/vendor-groups
router.put('/users/:id/vendor-groups', async (req, res) => {
    try {
        await setUserVendorGroups(parseInt(req.params.id), req.body.groupIds || []);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/vendor-groups
router.get('/vendor-groups', async (req, res) => {
    try {
        const groups = await listVendorGroups();
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/vendor-groups
router.post('/vendor-groups', async (req, res) => {
    try {
        const { name, description, vendors } = req.body;
        if (!name) return res.status(400).json({ error: 'Nombre requerido' });
        const id = await createVendorGroup(name, description, vendors || []);
        res.status(201).json({ ok: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/vendor-groups/:id
router.put('/vendor-groups/:id', async (req, res) => {
    try {
        const { name, description, vendors } = req.body;
        await updateVendorGroup(parseInt(req.params.id), name, description, vendors || []);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/vendor-groups/:id
router.delete('/vendor-groups/:id', async (req, res) => {
    try {
        await deleteVendorGroup(parseInt(req.params.id));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/available-vendors
router.get('/available-vendors', async (req, res) => {
    try {
        const vendors = await getAvailableVendors();
        res.json(vendors);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
