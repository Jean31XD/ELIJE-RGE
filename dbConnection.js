/**
 * dbConnection.js - Conexion a Azure SQL Database
 * SQL Authentication con usuario/contraseña (igual que Catalogolocal)
 */
require('dotenv').config();
const sql = require('mssql');

const sqlConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: true,
        trustServerCertificate: true,
        connectTimeout: 30000,
        requestTimeout: 30000
    }
};

let pool = null;

async function getPool() {
    if (pool && pool.connected) {
        return pool;
    }
    console.log('   Conectando a Azure SQL...');
    pool = await sql.connect(sqlConfig);
    console.log('   Conexion a Azure SQL establecida.');
    return pool;
}

async function ensureColumnExists() {
    const db = await getPool();
    await db.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'enviado_dynamics'
        )
        BEGIN
            ALTER TABLE [dbo].[pedidos] ADD enviado_dynamics BIT DEFAULT 0;
        END
    `);
    await db.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'dynamics_order_number'
        )
        BEGIN
            ALTER TABLE [dbo].[pedidos] ADD dynamics_order_number NVARCHAR(50) NULL;
        END
    `);
    await db.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'sync_error'
        )
        BEGIN
            ALTER TABLE [dbo].[pedidos] ADD sync_error NVARCHAR(MAX) NULL;
        END
    `);
}

async function getAllOrders() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT pedido_id, pedido_numero, cliente_nombre, cliente_rnc,
               vendedor_nombre, fecha_pedido, total,
               ISNULL(enviado_dynamics, 0) AS enviado_dynamics,
               dynamics_order_number, sync_error
        FROM [dbo].[pedidos]
        ORDER BY fecha_pedido DESC
    `);
    return result.recordset;
}

async function getPendingOrders() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT p.pedido_id, p.pedido_numero, p.cliente_nombre, p.cliente_rnc,
               p.vendedor_nombre, p.fecha_pedido, p.total,
               m.personnel_number AS vendedor_personnel_number,
               c.accountnum AS cliente_accountnum
        FROM [dbo].[pedidos] p
        LEFT JOIN [dbo].[vendedor_dynamics_map] m
            ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
        LEFT JOIN [dbo].[Cartera_cliente] c
            ON UPPER(LTRIM(RTRIM(p.cliente_nombre))) = UPPER(LTRIM(RTRIM(c.custname)))
        WHERE ISNULL(p.enviado_dynamics, 0) = 0
        ORDER BY p.fecha_pedido ASC
    `);
    return result.recordset;
}

async function getOrderById(pedidoId) {
    const db = await getPool();
    const result = await db.request()
        .input('pedidoId', sql.Int, pedidoId)
        .query(`
            SELECT p.pedido_id, p.pedido_numero, p.cliente_nombre, p.cliente_rnc,
                   p.vendedor_nombre, p.fecha_pedido, p.total,
                   m.personnel_number AS vendedor_personnel_number,
                   c.accountnum AS cliente_accountnum
            FROM [dbo].[pedidos] p
            LEFT JOIN [dbo].[vendedor_dynamics_map] m
                ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
            LEFT JOIN [dbo].[Cartera_cliente] c
                ON UPPER(LTRIM(RTRIM(p.cliente_nombre))) = UPPER(LTRIM(RTRIM(c.custname)))
            WHERE p.pedido_id = @pedidoId
        `);
    return result.recordset[0];
}

async function getOrderLines(pedidoId) {
    const db = await getPool();
    const result = await db.request()
        .input('pedidoId', sql.Int, pedidoId)
        .query(`
            SELECT item_id, producto_nombre, categoria, marca,
                   cantidad, precio_unitario, subtotal_linea
            FROM [dbo].[pedidos_detalle]
            WHERE pedido_id = @pedidoId
        `);
    return result.recordset;
}

async function markOrderAsSent(pedidoId, dynamicsOrderNumber) {
    const db = await getPool();
    await db.request()
        .input('pedidoId', sql.Int, pedidoId)
        .input('orderNum', sql.NVarChar(50), dynamicsOrderNumber)
        .query(`
            UPDATE [dbo].[pedidos]
            SET enviado_dynamics = 1,
                dynamics_order_number = @orderNum,
                sync_error = NULL
            WHERE pedido_id = @pedidoId
        `);
}

async function markOrderAsFailed(pedidoId, errorMsg) {
    const db = await getPool();
    await db.request()
        .input('pedidoId', sql.Int, pedidoId)
        .input('errorMsg', sql.NVarChar(sql.MAX), errorMsg)
        .query(`
            UPDATE [dbo].[pedidos]
            SET enviado_dynamics = 0,
                sync_error = @errorMsg
            WHERE pedido_id = @pedidoId
        `);
}

async function resetOrderSyncStatus(pedidoId) {
    const db = await getPool();
    await db.request()
        .input('pedidoId', sql.Int, pedidoId)
        .query(`
            UPDATE [dbo].[pedidos]
            SET enviado_dynamics = 0,
                sync_error = NULL
            WHERE pedido_id = @pedidoId
        `);
}

async function closePool() {
    if (pool) {
        await pool.close();
        pool = null;
    }
}

module.exports = {
    getPool,
    ensureColumnExists,
    getAllOrders,
    getPendingOrders,
    getOrderById,
    getOrderLines,
    markOrderAsSent,
    markOrderAsFailed,
    resetOrderSyncStatus,
    closePool
};
