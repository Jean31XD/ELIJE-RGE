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
    // Columna para el secretario de ventas asignado al vendedor
    await db.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'vendedor_dynamics_map' AND COLUMN_NAME = 'secretario_personnel_number'
        )
        BEGIN
            ALTER TABLE [dbo].[vendedor_dynamics_map] ADD secretario_personnel_number NVARCHAR(50) NULL;
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
               p.cliente_cuenta as pedido_cliente_cuenta,
               p.dynamics_order_number,
               m.personnel_number AS vendedor_personnel_number,
               -- Priorizar custtable (RNC) y Cartera_cliente (Nombre) sobre p.cliente_cuenta para evitar datos basura
               COALESCE(ct.accountnum, c.accountnum, NULLIF(LTRIM(RTRIM(p.cliente_cuenta)), '')) AS cliente_accountnum
        FROM [dbo].[pedidos] p
        LEFT JOIN [dbo].[vendedor_dynamics_map] m
            ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
        LEFT JOIN [dbo].[custtable] ct
            ON (p.cliente_rnc IS NOT NULL AND LTRIM(RTRIM(p.cliente_rnc)) <> '' AND LTRIM(RTRIM(p.cliente_rnc)) = LTRIM(RTRIM(ct.RNC)))
        LEFT JOIN [dbo].[Cartera_cliente] c
            ON UPPER(LTRIM(RTRIM(p.cliente_nombre))) = UPPER(LTRIM(RTRIM(c.custname)))
        WHERE ISNULL(p.enviado_dynamics, 0) = 0
          AND (p.estado IS NULL OR p.estado <> 'CANCELADO')
          AND (p.sync_error IS NULL OR p.sync_error = '')
          AND (p.dynamics_order_number IS NULL OR p.dynamics_order_number = '')
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
                   p.cliente_cuenta as pedido_cliente_cuenta,
                   p.dynamics_order_number,
                   m.personnel_number AS vendedor_personnel_number,
                   COALESCE(ct.accountnum, c.accountnum, NULLIF(LTRIM(RTRIM(p.cliente_cuenta)), '')) AS cliente_accountnum
            FROM [dbo].[pedidos] p
            LEFT JOIN [dbo].[vendedor_dynamics_map] m
                ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
            LEFT JOIN [dbo].[custtable] ct
                ON (p.cliente_rnc IS NOT NULL AND LTRIM(RTRIM(p.cliente_rnc)) <> '' AND LTRIM(RTRIM(p.cliente_rnc)) = LTRIM(RTRIM(ct.RNC)))
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

async function saveOrderNumber(pedidoId, dynamicsOrderNumber) {
    const db = await getPool();
    await db.request()
        .input('pedidoId', sql.Int, pedidoId)
        .input('orderNum', sql.NVarChar(50), dynamicsOrderNumber)
        .query(`
            UPDATE [dbo].[pedidos]
            SET dynamics_order_number = @orderNum
            WHERE pedido_id = @pedidoId
        `);
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

// === Dashboard ===

async function getDashboardData() {
    const db = await getPool();

    const [
        kpisResult,
        dailyTrendResult,
        monthlyTrendResult,
        topVendedoresResult,
        topClientesResult,
        topCategoriasResult,
        recentOrdersResult
    ] = await Promise.all([
        // KPIs generales
        db.request().query(`
            SELECT
                COUNT(*) AS total_pedidos,
                ISNULL(SUM(total), 0) AS monto_total,
                ISNULL(AVG(total), 0) AS promedio_pedido,
                SUM(CASE WHEN ISNULL(enviado_dynamics, 0) = 1 THEN 1 ELSE 0 END) AS enviados_dynamics,
                SUM(CASE WHEN ISNULL(enviado_dynamics, 0) = 0 AND (sync_error IS NULL OR sync_error = '') THEN 1 ELSE 0 END) AS pendientes,
                SUM(CASE WHEN sync_error IS NOT NULL AND sync_error <> '' THEN 1 ELSE 0 END) AS con_error,
                COUNT(DISTINCT vendedor_nombre) AS total_vendedores,
                COUNT(DISTINCT cliente_nombre) AS total_clientes
            FROM [dbo].[pedidos]
        `),
        // Tendencia diaria (30 dias)
        db.request().query(`
            SELECT
                CONVERT(VARCHAR(10), fecha_pedido, 120) AS fecha,
                COUNT(*) AS cantidad,
                ISNULL(SUM(total), 0) AS monto
            FROM [dbo].[pedidos]
            WHERE fecha_pedido >= DATEADD(DAY, -30, GETDATE())
            GROUP BY CONVERT(VARCHAR(10), fecha_pedido, 120)
            ORDER BY fecha ASC
        `),
        // Tendencia mensual (12 meses)
        db.request().query(`
            SELECT
                FORMAT(fecha_pedido, 'yyyy-MM') AS mes,
                COUNT(*) AS cantidad,
                ISNULL(SUM(total), 0) AS monto
            FROM [dbo].[pedidos]
            WHERE fecha_pedido >= DATEADD(MONTH, -12, GETDATE())
            GROUP BY FORMAT(fecha_pedido, 'yyyy-MM')
            ORDER BY mes ASC
        `),
        // Top 10 vendedores por monto
        db.request().query(`
            SELECT TOP 10
                vendedor_nombre,
                COUNT(*) AS total_pedidos,
                ISNULL(SUM(total), 0) AS monto_total
            FROM [dbo].[pedidos]
            GROUP BY vendedor_nombre
            ORDER BY monto_total DESC
        `),
        // Top 10 clientes por monto
        db.request().query(`
            SELECT TOP 10
                cliente_nombre,
                COUNT(*) AS total_pedidos,
                ISNULL(SUM(total), 0) AS monto_total
            FROM [dbo].[pedidos]
            GROUP BY cliente_nombre
            ORDER BY monto_total DESC
        `),
        // Top 10 categorias por monto
        db.request().query(`
            SELECT TOP 10
                ISNULL(categoria, 'Sin Categoria') AS categoria,
                COUNT(*) AS total_lineas,
                ISNULL(SUM(subtotal_linea), 0) AS monto_total
            FROM [dbo].[pedidos_detalle]
            GROUP BY categoria
            ORDER BY monto_total DESC
        `),
        // Ultimos 5 pedidos
        db.request().query(`
            SELECT TOP 5
                pedido_numero, cliente_nombre, vendedor_nombre,
                fecha_pedido, total,
                ISNULL(enviado_dynamics, 0) AS enviado_dynamics,
                dynamics_order_number, sync_error
            FROM [dbo].[pedidos]
            ORDER BY fecha_pedido DESC
        `)
    ]);

    return {
        kpis: kpisResult.recordset[0],
        dailyTrend: dailyTrendResult.recordset,
        monthlyTrend: monthlyTrendResult.recordset,
        topVendedores: topVendedoresResult.recordset,
        topClientes: topClientesResult.recordset,
        topCategorias: topCategoriasResult.recordset,
        recentOrders: recentOrdersResult.recordset
    };
}

async function closePool() {
    if (pool) {
        await pool.close();
        pool = null;
    }
}

// === Rangos (esquemas_rangos) ===

async function getRangos() {
    const db = await getPool();
    const result = await db.request().query('SELECT * FROM [dbo].[esquemas_rangos] ORDER BY categoria, rango_min');
    return result.recordset;
}

async function getAllCobros() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT id, invoice, accountnum, custname, monto_cobrado,
               saldo_anterior, saldo_nuevo, fecha_cobro, cobrador,
               metodo_pago, notas
        FROM [dbo].[cobros_realizados]
        ORDER BY fecha_cobro DESC
    `);
    return result.recordset;
}

async function getTrackingLogs() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT t.id, t.vendedor_id, t.vendedor_nombre, t.latitude, t.longitude, t.[action], t.created_at,
               (SELECT TOP 1 p.dynamics_order_number 
                FROM [dbo].[pedidos] p 
                WHERE p.vendedor_nombre = t.vendedor_nombre 
                AND ABS(DATEDIFF(MINUTE, p.fecha_pedido, t.created_at)) < 15
                AND t.[action] = 'ORDER'
                ORDER BY ABS(DATEDIFF(SECOND, p.fecha_pedido, t.created_at))
               ) as dynamics_order_number
        FROM [dbo].[tracking_logs] t
        ORDER BY t.created_at DESC
    `);
    return result.recordset;
}

async function createRango(rango) {
    const db = await getPool();
    await db.request()
        .input('cat', sql.VarChar(100), rango.categoria)
        .input('min', sql.Int, rango.rango_min)
        .input('max', sql.Int, rango.rango_max)
        .input('val', sql.Decimal(18, 4), rango.valor)
        .query(`
            INSERT INTO [dbo].[esquemas_rangos] (categoria, rango_min, rango_max, valor)
            VALUES (@cat, @min, @max, @val)
        `);
}

async function updateRango(id, rango) {
    const db = await getPool();
    await db.request()
        .input('id', sql.Int, id)
        .input('cat', sql.VarChar(100), rango.categoria)
        .input('min', sql.Int, rango.rango_min)
        .input('max', sql.Int, rango.rango_max)
        .input('val', sql.Decimal(18, 4), rango.valor)
        .query(`
            UPDATE [dbo].[esquemas_rangos]
            SET categoria = @cat,
                rango_min = @min,
                rango_max = @max,
                valor = @val
            WHERE id = @id
        `);
}

async function deleteRango(id) {
    const db = await getPool();
    await db.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM [dbo].[esquemas_rangos] WHERE id = @id');
}

module.exports = {
    getPool,
    ensureColumnExists,
    getAllOrders,
    getPendingOrders,
    getOrderById,
    getOrderLines,
    saveOrderNumber,
    markOrderAsSent,
    markOrderAsFailed,
    resetOrderSyncStatus,
    closePool,
    getRangos,
    createRango,
    updateRango,
    deleteRango,
    getDashboardData,
    getAllCobros,
    getTrackingLogs
};
