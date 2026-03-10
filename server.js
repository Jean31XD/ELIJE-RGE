/**
 * server.js - Servidor Express unificado
 * API + frontend + sync automatico a Dynamics 365
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const {
    getAllOrders,
    getOrderLines,
    getPool,
    resetOrderSyncStatus,
    getOrderById,
    getRangos,
    createRango,
    updateRango,
    deleteRango,
    getDashboardData,
    getAllCobros,
    getTrackingLogs,
    getClientesExtra,
    addClienteExtra,
    deleteClienteExtra,
    getVendedores,
    buscarClientes,
    getAllClientes
} = require('./dbConnection');
const { getAccessToken } = require('./auth');
const axios = require('axios');
const {
    startSync,
    getSyncLog,
    getSyncStatus,
    pollCycle,
    processOrder,
    extractErrorMessage
} = require('./syncOrders');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 1. Logs de Debug (TODO entra aqui)
app.use((req, res, next) => {
    console.log(`[REQUEST] ${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);
    next();
});

// 2. Rutas de APIPrioritarias
app.post('/api/pedidos/:id/retry', async (req, res) => {
    const { id } = req.params;
    console.log(`[RETRY] Solicitud recibida para ID: ${id}`);
    try {
        const pedidoId = parseInt(id);
        const pedido = await getOrderById(pedidoId);
        if (!pedido) {
            console.log(`[RETRY] Pedido ${id} no encontrado en DB`);
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        console.log(`[RETRY] Procesando pedido ${pedido.pedido_numero}...`);

        console.log(`[RETRY] Obteniendo token de acceso...`);
        const token = await getAccessToken();
        console.log(`[RETRY] Token obtenido. Iniciando proceso en Dynamics...`);

        const salesOrderNumber = await processOrder(token, pedido);

        console.log(`[RETRY] ÉXITO -> ${salesOrderNumber} para pedido ${pedido.pedido_numero}`);
        res.json({ ok: true, salesOrderNumber });
    } catch (err) {
        const errMsg = extractErrorMessage(err);
        console.error(`[RETRY] ERROR en ID ${id}:`, errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// --- API DASHBOARD ---
app.get('/api/dashboard', async (req, res) => {
    try {
        const filters = {};
        if (req.query.vendedor) filters.vendedor = req.query.vendedor;
        if (req.query.cliente) filters.cliente = req.query.cliente;
        if (req.query.desde) filters.desde = req.query.desde;
        if (req.query.hasta) filters.hasta = req.query.hasta;
        const data = await getDashboardData(filters);
        res.json(data);
    } catch (err) {
        console.error('Error en /api/dashboard:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard/filters', async (req, res) => {
    try {
        const db = require('./dbConnection').getPool;
        const pool = await db();
        const [vendedores, clientes] = await Promise.all([
            pool.request().query(`SELECT DISTINCT vendedor_nombre FROM [dbo].[pedidos] WHERE vendedor_nombre IS NOT NULL AND vendedor_nombre <> '' ORDER BY vendedor_nombre`),
            pool.request().query(`SELECT DISTINCT cliente_nombre FROM [dbo].[pedidos] WHERE cliente_nombre IS NOT NULL AND cliente_nombre <> '' ORDER BY cliente_nombre`)
        ]);
        res.json({
            vendedores: vendedores.recordset.map(r => r.vendedor_nombre),
            clientes: clientes.recordset.map(r => r.cliente_nombre)
        });
    } catch (err) {
        console.error('Error en /api/dashboard/filters:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. Static Files (Despues de las rutas de API dinamicas)
app.use(express.static(path.join(__dirname, 'public')));

// --- API RANGOS ---
app.get('/api/rangos', async (req, res) => {
    try {
        const rangos = await getRangos();
        res.json(rangos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/rangos', async (req, res) => {
    try {
        await createRango(req.body);
        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/rangos/:id', async (req, res) => {
    try {
        await updateRango(req.params.id, req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/rangos/:id', async (req, res) => {
    try {
        await deleteRango(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos', async (req, res) => {
    try {
        const pedidos = await getAllOrders();
        res.json(pedidos);
    } catch (err) {
        console.error('Error en /api/pedidos:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/:id', async (req, res) => {
    try {
        const pedido = await getOrderById(parseInt(req.params.id));
        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(pedido);
    } catch (err) {
        console.error(`Error en /api/pedidos/${req.params.id}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/:id/lineas', async (req, res) => {
    try {
        const lineas = await getOrderLines(parseInt(req.params.id));
        res.json(lineas);
    } catch (err) {
        console.error(`Error en /api/pedidos/${req.params.id}/lineas:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/cobros', async (req, res) => {
    try {
        const cobros = await getAllCobros();
        res.json(cobros);
    } catch (err) {
        console.error('Error en /api/cobros:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/tracking', async (req, res) => {
    try {
        const filters = {};
        if (req.query.fechaDesde) filters.fechaDesde = req.query.fechaDesde;
        if (req.query.fechaHasta) filters.fechaHasta = req.query.fechaHasta;
        if (req.query.vendedor_id) filters.vendedor_id = req.query.vendedor_id;
        if (req.query.action) filters.action = req.query.action;
        const tracking = await getTrackingLogs(filters);
        res.json(tracking);
    } catch (err) {
        console.error('Error en /api/tracking:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- API DYNAMICS ---

app.get('/api/dynamics/campos', async (req, res) => {
    try {
        const token = await getAccessToken();
        const base = process.env.RESOURCE_URL.replace(/\/$/, '') + '/data/';

        const [headerRes, linesRes] = await Promise.all([
            axios.get(base + 'SalesOrderHeadersV2?$top=1', {
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
            }),
            axios.get(base + 'SalesOrderLines?$top=1', {
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
            })
        ]);

        const mapFields = (record) => Object.keys(record)
            .filter(k => !k.startsWith('@'))
            .sort()
            .map(k => ({
                campo: k,
                valor_ejemplo: record[k],
                tipo: record[k] === null ? 'null' : typeof record[k]
            }));

        res.json({
            header: mapFields(headerRes.data.value[0] || {}),
            lines: mapFields(linesRes.data.value[0] || {})
        });
    } catch (err) {
        console.error('Error en /api/dynamics/campos:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/sql/columnas', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request().query(`
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME IN ('pedidos', 'pedidos_detalle')
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error en /api/sql/columnas:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- API SYNC ---

app.get('/api/sync/status', (req, res) => {
    res.json(getSyncStatus());
});

app.get('/api/sync/log', (req, res) => {
    res.json(getSyncLog());
});

app.post('/api/sync/trigger', async (req, res) => {
    try {
        await pollCycle();
        res.json({ ok: true, log: getSyncLog().slice(-10) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API CLIENTES EXTRA POR VENDEDOR ---

app.get('/api/vendedores', async (req, res) => {
    try {
        const vendedores = await getVendedores();
        res.json(vendedores);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clientes-buscar', async (req, res) => {
    try {
        const clientes = await buscarClientes(req.query.q || '');
        res.json(clientes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clientes', async (req, res) => {
    try {
        const clientes = await getAllClientes();
        res.json(clientes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clientes-extra', async (req, res) => {
    try {
        const vendedor = req.query.vendedor || null;
        const data = await getClientesExtra(vendedor);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clientes-extra', async (req, res) => {
    try {
        const { vendedor_nombre, cliente_accountnum, cliente_nombre } = req.body;
        if (!vendedor_nombre || !cliente_accountnum || !cliente_nombre) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }
        await addClienteExtra(vendedor_nombre, cliente_accountnum, cliente_nombre);
        res.status(201).json({ ok: true });
    } catch (err) {
        if (err.message && err.message.includes('UQ_vce_vendedor_cliente')) {
            return res.status(409).json({ error: 'Este cliente ya está asignado a ese vendedor' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clientes-extra/:id', async (req, res) => {
    try {
        await deleteClienteExtra(parseInt(req.params.id));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- HEALTH ---

app.get('/api/health', async (req, res) => {
    try {
        await getPool();
        res.json({ status: 'ok', db: 'connected', sync: getSyncStatus() });
    } catch (err) {
        res.status(500).json({ status: 'error', db: err.message });
    }
});

// CATCH-ALL / SPA Fallback - Usando middleware simple para evitar errores de Regex
app.use((req, res) => {
    // Si es una ruta de API que no existe, devolver 404 JSON
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: `Endpoint [${req.method}] ${req.url} no encontrado` });
    }
    // Para lo demás, servir el index (SPA)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIO ---
app.listen(PORT, async () => {
    console.log('====================================================');
    console.log(`  SERVIDOR INICIADO: http://localhost:${PORT}`);
    console.log(`  DB: ${process.env.DB_SERVER} / ${process.env.DB_NAME}`);
    console.log(`  Dynamics: ${process.env.RESOURCE_URL}`);
    console.log('====================================================');

    // Iniciar sync automatico
    try {
        await startSync();
        console.log('  Sync automatico activo');
    } catch (err) {
        console.error('  Error iniciando sync:', err.message);
    }
});
