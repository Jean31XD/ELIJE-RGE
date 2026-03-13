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

    // Tabla para clientes extra asignados a vendedores
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'vendedor_cliente_extra')
        BEGIN
            CREATE TABLE [dbo].[vendedor_cliente_extra] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                vendedor_nombre NVARCHAR(200) NOT NULL,
                empleado_responsable NVARCHAR(100) NOT NULL,
                cliente_accountnum NVARCHAR(50) NOT NULL,
                cliente_nombre NVARCHAR(300) NOT NULL,
                fecha_asignacion DATETIME DEFAULT GETDATE(),
                CONSTRAINT UQ_vce_emp_cliente UNIQUE (empleado_responsable, cliente_accountnum)
            );
        END
    `);
    // Si la tabla ya existia sin la columna empleado_responsable, agregarla
    await db.request().query(`
        IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'vendedor_cliente_extra')
        AND NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'vendedor_cliente_extra' AND COLUMN_NAME = 'empleado_responsable'
        )
        BEGIN
            ALTER TABLE [dbo].[vendedor_cliente_extra] ADD empleado_responsable NVARCHAR(100) NOT NULL DEFAULT '';
        END
    `);
}

async function getAllOrders() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT pedido_id, pedido_numero, cliente_nombre, cliente_rnc,
               vendedor_nombre, fecha_pedido, total,
               observaciones, cliente_direccion,
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
               p.observaciones,
               m.personnel_number AS vendedor_personnel_number,
               m.sales_group_id AS vendedor_sales_group_id,
               -- Priorizar custtable (RNC) y Cartera_cliente (Nombre) sobre p.cliente_cuenta para evitar datos basura
               COALESCE(ct.accountnum, c.accountnum, NULLIF(LTRIM(RTRIM(p.cliente_cuenta)), '')) AS cliente_accountnum,
               ld.directionname AS direccion_name
        FROM [dbo].[pedidos] p
        LEFT JOIN [dbo].[vendedor_dynamics_map] m
            ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
        LEFT JOIN [dbo].[custtable] ct
            ON (p.cliente_rnc IS NOT NULL AND LTRIM(RTRIM(p.cliente_rnc)) <> '' AND LTRIM(RTRIM(p.cliente_rnc)) = LTRIM(RTRIM(ct.RNC)))
        LEFT JOIN [dbo].[Cartera_cliente] c
            ON UPPER(LTRIM(RTRIM(p.cliente_nombre))) = UPPER(LTRIM(RTRIM(c.custname)))
        LEFT JOIN [dbo].[libreta_direcciones] ld
            ON COALESCE(ct.accountnum, c.accountnum, NULLIF(LTRIM(RTRIM(p.cliente_cuenta)), '')) = ld.accountnum
            AND LTRIM(RTRIM(p.cliente_direccion)) = LTRIM(RTRIM(ld.address))
            AND (ld.IsDelete IS NULL OR ld.IsDelete = 0)
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
                   p.observaciones,
                   m.personnel_number AS vendedor_personnel_number,
                   m.sales_group_id AS vendedor_sales_group_id,
                   COALESCE(ct.accountnum, c.accountnum, NULLIF(LTRIM(RTRIM(p.cliente_cuenta)), '')) AS cliente_accountnum,
                   ld.directionname AS direccion_name
            FROM [dbo].[pedidos] p
            LEFT JOIN [dbo].[vendedor_dynamics_map] m
                ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
            LEFT JOIN [dbo].[custtable] ct
                ON (p.cliente_rnc IS NOT NULL AND LTRIM(RTRIM(p.cliente_rnc)) <> '' AND LTRIM(RTRIM(p.cliente_rnc)) = LTRIM(RTRIM(ct.RNC)))
            LEFT JOIN [dbo].[Cartera_cliente] c
                ON UPPER(LTRIM(RTRIM(p.cliente_nombre))) = UPPER(LTRIM(RTRIM(c.custname)))
            LEFT JOIN [dbo].[libreta_direcciones] ld
                ON COALESCE(ct.accountnum, c.accountnum, NULLIF(LTRIM(RTRIM(p.cliente_cuenta)), '')) = ld.accountnum
                AND LTRIM(RTRIM(p.cliente_direccion)) = LTRIM(RTRIM(ld.address))
                AND (ld.IsDelete IS NULL OR ld.IsDelete = 0)
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

async function getDashboardData(filters = {}) {
    const db = await getPool();

    // Build WHERE clause based on filters
    const conditions = [];
    const request = db.request();

    if (filters.vendedor) {
        conditions.push("vendedor_nombre LIKE '%' + @vendedor + '%'");
        request.input('vendedor', filters.vendedor);
    }
    if (filters.cliente) {
        conditions.push("cliente_nombre LIKE '%' + @cliente + '%'");
        request.input('cliente', filters.cliente);
    }
    if (filters.desde) {
        conditions.push("CONVERT(DATE, fecha_pedido) >= @desde");
        request.input('desde', filters.desde);
    }
    if (filters.hasta) {
        conditions.push("CONVERT(DATE, fecha_pedido) <= @hasta");
        request.input('hasta', filters.hasta);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const andClause = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

    // For categories query which uses pedidos_detalle, we need a join
    const catConditions = [];
    const catRequest = db.request();
    if (filters.vendedor) {
        catConditions.push("p.vendedor_nombre LIKE '%' + @vendedor + '%'");
        catRequest.input('vendedor', filters.vendedor);
    }
    if (filters.cliente) {
        catConditions.push("p.cliente_nombre LIKE '%' + @cliente + '%'");
        catRequest.input('cliente', filters.cliente);
    }
    if (filters.desde) {
        catConditions.push("CONVERT(DATE, p.fecha_pedido) >= @desde");
        catRequest.input('desde', filters.desde);
    }
    if (filters.hasta) {
        catConditions.push("CONVERT(DATE, p.fecha_pedido) <= @hasta");
        catRequest.input('hasta', filters.hasta);
    }
    const catWhereClause = catConditions.length > 0 ? 'WHERE ' + catConditions.join(' AND ') : '';

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
        request.query(`
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
            ${whereClause}
        `),
        // Tendencia diaria (30 dias o rango filtrado)
        (function () {
            const r = db.request();
            if (filters.vendedor) r.input('vendedor', filters.vendedor);
            if (filters.cliente) r.input('cliente', filters.cliente);
            if (filters.desde) r.input('desde', filters.desde);
            if (filters.hasta) r.input('hasta', filters.hasta);
            const dailyCond = filters.desde || filters.hasta
                ? conditions.join(' AND ')
                : `fecha_pedido >= DATEADD(DAY, -30, GETDATE())` + (conditions.length ? ' AND ' + conditions.join(' AND ') : '');
            return r.query(`
                SELECT
                    CONVERT(VARCHAR(10), fecha_pedido, 120) AS fecha,
                    COUNT(*) AS cantidad,
                    ISNULL(SUM(total), 0) AS monto
                FROM [dbo].[pedidos]
                ${dailyCond ? 'WHERE ' + dailyCond : ''}
                GROUP BY CONVERT(VARCHAR(10), fecha_pedido, 120)
                ORDER BY fecha ASC
            `);
        })(),
        // Tendencia mensual (12 meses o rango filtrado)
        (function () {
            const r = db.request();
            if (filters.vendedor) r.input('vendedor', filters.vendedor);
            if (filters.cliente) r.input('cliente', filters.cliente);
            if (filters.desde) r.input('desde', filters.desde);
            if (filters.hasta) r.input('hasta', filters.hasta);
            const monthlyCond = filters.desde || filters.hasta
                ? conditions.join(' AND ')
                : `fecha_pedido >= DATEADD(MONTH, -12, GETDATE())` + (conditions.length ? ' AND ' + conditions.join(' AND ') : '');
            return r.query(`
                SELECT
                    FORMAT(fecha_pedido, 'yyyy-MM') AS mes,
                    COUNT(*) AS cantidad,
                    ISNULL(SUM(total), 0) AS monto
                FROM [dbo].[pedidos]
                ${monthlyCond ? 'WHERE ' + monthlyCond : ''}
                GROUP BY FORMAT(fecha_pedido, 'yyyy-MM')
                ORDER BY mes ASC
            `);
        })(),
        // Top 10 vendedores por monto
        (function () {
            const r = db.request();
            if (filters.vendedor) r.input('vendedor', filters.vendedor);
            if (filters.cliente) r.input('cliente', filters.cliente);
            return r.query(`
                SELECT TOP 10
                    vendedor_nombre,
                    COUNT(*) AS total_pedidos,
                    ISNULL(SUM(total), 0) AS monto_total
                FROM [dbo].[pedidos]
                ${whereClause}
                GROUP BY vendedor_nombre
                ORDER BY monto_total DESC
            `);
        })(),
        // Top 10 clientes por monto
        (function () {
            const r = db.request();
            if (filters.vendedor) r.input('vendedor', filters.vendedor);
            if (filters.cliente) r.input('cliente', filters.cliente);
            return r.query(`
                SELECT TOP 10
                    cliente_nombre,
                    COUNT(*) AS total_pedidos,
                    ISNULL(SUM(total), 0) AS monto_total
                FROM [dbo].[pedidos]
                ${whereClause}
                GROUP BY cliente_nombre
                ORDER BY monto_total DESC
            `);
        })(),
        // Top 10 categorias por monto
        (function () {
            if (catConditions.length > 0) {
                return catRequest.query(`
                    SELECT TOP 10
                        ISNULL(d.categoria, 'Sin Categoria') AS categoria,
                        COUNT(*) AS total_lineas,
                        ISNULL(SUM(d.subtotal_linea), 0) AS monto_total
                    FROM [dbo].[pedidos_detalle] d
                    INNER JOIN [dbo].[pedidos] p ON d.pedido_id = p.pedido_id
                    ${catWhereClause}
                    GROUP BY d.categoria
                    ORDER BY monto_total DESC
                `);
            } else {
                return catRequest.query(`
                    SELECT TOP 10
                        ISNULL(categoria, 'Sin Categoria') AS categoria,
                        COUNT(*) AS total_lineas,
                        ISNULL(SUM(subtotal_linea), 0) AS monto_total
                    FROM [dbo].[pedidos_detalle]
                    GROUP BY categoria
                    ORDER BY monto_total DESC
                `);
            }
        })(),
        // Ultimos 5 pedidos
        (function () {
            const r = db.request();
            if (filters.vendedor) r.input('vendedor', filters.vendedor);
            if (filters.cliente) r.input('cliente', filters.cliente);
            return r.query(`
                SELECT TOP 5
                    pedido_numero, cliente_nombre, vendedor_nombre,
                    fecha_pedido, total,
                    ISNULL(enviado_dynamics, 0) AS enviado_dynamics,
                    dynamics_order_number, sync_error
                FROM [dbo].[pedidos]
                ${whereClause}
                ORDER BY fecha_pedido DESC
            `);
        })()
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

// === Clientes Extra por Vendedor ===

async function getClientesExtra(vendedorEmpleado) {
    const db = await getPool();
    const req = db.request();
    let where = '';
    if (vendedorEmpleado) {
        where = "WHERE empleado_responsable = @emp";
        req.input('emp', sql.NVarChar(100), vendedorEmpleado);
    }
    const result = await req.query(`
        SELECT id, vendedor_nombre, empleado_responsable, cliente_accountnum, cliente_nombre, fecha_asignacion
        FROM [dbo].[vendedor_cliente_extra]
        ${where}
        ORDER BY vendedor_nombre, cliente_nombre
    `);
    return result.recordset;
}

async function addClienteExtra(vendedorNombre, empleadoResponsable, clienteAccountnum, clienteNombre) {
    const db = await getPool();
    await db.request()
        .input('vendedor', sql.NVarChar(200), vendedorNombre)
        .input('emp', sql.NVarChar(100), empleadoResponsable)
        .input('accountnum', sql.NVarChar(50), clienteAccountnum)
        .input('nombre', sql.NVarChar(300), clienteNombre)
        .query(`
            INSERT INTO [dbo].[vendedor_cliente_extra] (vendedor_nombre, empleado_responsable, cliente_accountnum, cliente_nombre)
            VALUES (@vendedor, @emp, @accountnum, @nombre)
        `);
}

async function deleteClienteExtra(id) {
    const db = await getPool();
    await db.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM [dbo].[vendedor_cliente_extra] WHERE id = @id');
}

async function getVendedores() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT DISTINCT
            LTRIM(RTRIM(Vendedor)) AS vendedor_nombre,
            LTRIM(RTRIM(Empleado_responsable)) AS empleado_responsable
        FROM [dbo].[cartera_cliente]
        WHERE Vendedor IS NOT NULL AND Vendedor <> ''
          AND Empleado_responsable IS NOT NULL AND Empleado_responsable <> ''
        ORDER BY vendedor_nombre
    `);
    return result.recordset;
}

async function buscarClientes(query) {
    const db = await getPool();
    const result = await db.request()
        .input('q', sql.NVarChar(200), '%' + (query || '') + '%')
        .query(`
            SELECT TOP 30 accountnum, custname
            FROM [dbo].[custtable]
            WHERE (custname LIKE @q OR accountnum LIKE @q)
              AND accountnum IS NOT NULL AND accountnum <> ''
            ORDER BY custname
        `);
    return result.recordset;
}

async function getAllClientes() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT accountnum, custname
        FROM [dbo].[custtable]
        WHERE accountnum IS NOT NULL AND accountnum <> ''
          AND custname IS NOT NULL AND custname <> ''
        ORDER BY custname
    `);
    return result.recordset;
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

async function getTrackingLogs(filters = {}) {
    const db = await getPool();
    const req = db.request();

    let whereClause = '1=1';

    if (filters.fechaDesde) {
        whereClause += ` AND CAST(t.created_at AS DATE) >= @fechaDesde`;
        req.input('fechaDesde', sql.Date, new Date(filters.fechaDesde));
    }
    if (filters.fechaHasta) {
        whereClause += ` AND CAST(t.created_at AS DATE) <= @fechaHasta`;
        req.input('fechaHasta', sql.Date, new Date(filters.fechaHasta));
    }
    if (filters.vendedor_id) {
        whereClause += ` AND t.vendedor_id = @vendedorId`;
        req.input('vendedorId', sql.VarChar(100), filters.vendedor_id);
    }
    if (filters.action) {
        whereClause += ` AND t.[action] = @action`;
        req.input('action', sql.VarChar(50), filters.action);
    }

    const result = await req.query(`
        SELECT t.id, t.vendedor_id, t.vendedor_nombre, t.latitude, t.longitude, t.[action], t.created_at,
               (SELECT TOP 1 p.dynamics_order_number
                FROM [dbo].[pedidos] p
                WHERE p.vendedor_nombre = t.vendedor_nombre
                AND ABS(DATEDIFF(MINUTE, p.fecha_pedido, t.created_at)) < 15
                AND t.[action] = 'ORDER'
                ORDER BY ABS(DATEDIFF(SECOND, p.fecha_pedido, t.created_at))
               ) as dynamics_order_number,
               (SELECT TOP 1 p.pedido_id
                FROM [dbo].[pedidos] p
                WHERE p.vendedor_nombre = t.vendedor_nombre
                AND ABS(DATEDIFF(MINUTE, p.fecha_pedido, t.created_at)) < 15
                AND t.[action] = 'ORDER'
                ORDER BY ABS(DATEDIFF(SECOND, p.fecha_pedido, t.created_at))
               ) as pedido_id
        FROM [dbo].[tracking_logs] t
        WHERE ${whereClause}
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
    getTrackingLogs,
    getClientesExtra,
    addClienteExtra,
    deleteClienteExtra,
    getVendedores,
    buscarClientes,
    getAllClientes
};
