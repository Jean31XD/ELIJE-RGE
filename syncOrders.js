/**
 * syncOrders.js - Sincronizacion automatica Azure SQL -> Dynamics 365
 * Se importa desde server.js y corre como parte del servidor
 */
const { getAccessToken } = require('./auth');
const axios = require('axios');
const {
    ensureColumnExists,
    getPendingOrders,
    getOrderLines,
    getOrderById,
    saveOrderNumber,
    markOrderAsSent,
    markOrderAsFailed
} = require('./dbConnection');

const POLL_INTERVAL_MS = 30 * 1000; // 30 segundos
let isProcessing = false;
let cycleCount = 0;
let syncLog = []; // Ultimos eventos para el frontend

function getBaseUrl() {
    const resourceUrl = process.env.RESOURCE_URL.endsWith('/')
        ? process.env.RESOURCE_URL
        : `${process.env.RESOURCE_URL}/`;
    return `${resourceUrl}data/`;
}

/**
 * Extrae el mensaje de error más detallado posible de la respuesta de Dynamics,
 * filtrando ruidos técnicos para mostrar solo lo relevante (ej: Infolog functional messages)
 */
function extractErrorMessage(error) {
    let msg = error.message;

    if (error.response?.data?.error) {
        const d365Error = error.response.data.error;
        // Priorizar innererror que suele traer el detalle de validación
        msg = d365Error.innererror?.message || d365Error.message || msg;
    }

    // Lógica para limpiar ruido de Dynamics (Infolog)
    if (msg.includes('Infolog:')) {
        // El formato suele ser: "Technical boilerplate. Infolog: Warning: Real message; Warning: Technical noise..."
        const parts = msg.split('Infolog:');
        if (parts.length > 1) {
            const infoLog = parts[1];
            // Buscar el primer Warning que no sea técnico (validateField suele ser ruido secundario)
            const warnings = infoLog.split(';').map(w => w.trim());
            const functionalWarning = warnings.find(w =>
                w.includes('Warning:') &&
                !w.toLowerCase().includes('validatefield') &&
                !w.toLowerCase().includes('write failed')
            );

            if (functionalWarning) {
                // Quitar el prefijo "Warning:" y limpiar
                return functionalWarning.replace(/^Warning:\s*/i, '').trim();
            }

            // Si no hay uno "funcional" claro, al menos devolvemos el primer warning limpio
            const firstWarning = warnings.find(w => w.includes('Warning:'));
            if (firstWarning) return firstWarning.replace(/^Warning:\s*/i, '').trim();

            return infoLog.trim();
        }
    }

    // Quitar ruidos comunes de cabecera si no hubo Infolog
    return msg.replace(/Write failed for table row of type.*?\.\s*/gi, '').trim();
}

function log(msg) {
    const timestamp = new Date().toLocaleTimeString('es-DO');
    const entry = `[${timestamp}] ${msg}`;
    console.log(entry);
    syncLog.push({ time: timestamp, msg });
    if (syncLog.length > 100) syncLog.shift();
}

async function createSalesOrderHeader(token, objPedido) {
    const baseUrl = getBaseUrl();

    // El campo cliente_accountnum ya viene procesado desde SQL con la prioridad:
    // 1. Cuenta en el objPedido, 2. Mapeo por nombre, 3. Mapeo por RNC
    const customerAccount = objPedido.cliente_accountnum;

    if (!customerAccount) {
        throw new Error(`No se pudo determinar una cuenta de cliente (AccountNum) para el objPedido ${objPedido.pedido_numero}`);
    }

    // Verificar en D365 si ya existe una OV con este número de objPedido para evitar duplicados
    if (objPedido.pedido_numero) {
        const checkUrl = `${baseUrl}SalesOrderHeadersV2?$filter=CustomerRequisitionNumber eq '${objPedido.pedido_numero}' and dataAreaId eq 'maco'&$select=SalesOrderNumber,CustomerRequisitionNumber`;
        const checkRes = await axios.get(checkUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        if (checkRes.data.value.length > 0) {
            const existingOV = checkRes.data.value[0].SalesOrderNumber;
            log(`  [D365 DUPLICADO EVITADO] Ya existe ${existingOV} con pedido_numero=${objPedido.pedido_numero}. Usando OV existente.`);
            return existingOV;
        }
    }

    const headerData = {
        dataAreaId: 'maco',
        OrderingCustomerAccountNumber: customerAccount,
        InvoiceCustomerAccountNumber: customerAccount,
        SalesOrderName: (objPedido.cliente_nombre || '').substring(0, 60), // Límite de D365
        CurrencyCode: 'DOP',
        RequestedShippingDate: new Date(objPedido.fecha_pedido).toISOString().split('T')[0] + 'T12:00:00Z',
        CustomersOrderReference: (objPedido.vendedor_nombre || '').substring(0, 60),
        CommissionSalesRepresentativeGroupId: objPedido.vendedor_sales_group_id || '',
    };

    if (objPedido.pedido_numero) {
        headerData.CustomerRequisitionNumber = objPedido.pedido_numero.substring(0, 50);
    }

    if (objPedido.vendedor_personnel_number) {
        headerData.OrderResponsiblePersonnelNumber = objPedido.vendedor_personnel_number;
    }

    // Secretario o vendedor como OrderTaker
    const taker = objPedido.vendedor_personnel_number; // Desactivamos secretario temporalmente por error SQL
    if (taker) {
        headerData.OrderTakerPersonnelNumber = taker;
    }

    log(`  Creando header -> Cliente: ${customerAccount} | Pedido: ${objPedido.pedido_numero} | Resp: ${objPedido.vendedor_personnel_number || '-'} | Ref: ${objPedido.vendedor_nombre}`);

    const response = await axios.post(baseUrl + 'SalesOrderHeadersV2', headerData, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    return response.data.SalesOrderNumber;
}

/**
 * Obtiene el almacén y sitio predeterminado de ventas para un artículo desde D365.
 */
async function getItemDefaultSettings(token, itemId) {
    const baseUrl = getBaseUrl();
    const urlDefaults = `${baseUrl}ProductDefaultOrderSettings?$filter=ItemNumber eq '${itemId}' and dataAreaId eq 'maco'&$select=SalesWarehouseId,SalesSiteId`;
    const urlProduct = `${baseUrl}ReleasedProductsV2?$filter=ItemNumber eq '${itemId}' and dataAreaId eq 'maco'&$select=SalesUnitSymbol`;

    try {
        const [resDefs, resProd] = await Promise.all([
            axios.get(urlDefaults, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }),
            axios.get(urlProduct, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } })
        ]);

        let result = {};
        if (resDefs.data.value.length > 0) {
            result.warehouse = resDefs.data.value[0].SalesWarehouseId;
            result.site = resDefs.data.value[0].SalesSiteId;
        }
        if (resProd.data.value.length > 0) {
            result.salesUnit = resProd.data.value[0].SalesUnitSymbol;
        }

        return Object.keys(result).length > 0 ? result : null;
    } catch (err) {
        console.error(`  [WARN] No se pudieron obtener los settings para ${itemId}: ${err.message}`);
    }
    return null;
}

async function addSalesOrderLine(token, salesOrderNumber, line, lineNumber, defaults, salesGroupId) {
    const url = `${getBaseUrl()}SalesOrderLines`;

    const payload = {
        dataAreaId: 'maco',
        SalesOrderNumber: salesOrderNumber,
        ItemNumber: line.item_id,
        OrderedSalesQuantity: line.cantidad,
        SalesPrice: line.precio_unitario,
        LineNumber: lineNumber,
        CommissionSalesRepresentativeGroupId: salesGroupId || '',
    };

    if (defaults) {
        if (defaults.warehouse) payload.ShippingWarehouseId = defaults.warehouse;
        if (defaults.site) payload.ShippingSiteId = defaults.site;
        if (defaults.salesUnit) payload.SalesUnitSymbol = defaults.salesUnit;
    }

    const response = await axios.post(url, payload, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    return response.data;
}

async function processOrder(token, objPedido) {
    log(`--- Pedido ${objPedido.pedido_numero} | ${objPedido.cliente_nombre} | $${objPedido.total}`);

    // Re-verificar contra DB para evitar race conditions (especialmente si hay varios procesos node)
    const freshPedido = await getOrderById(objPedido.pedido_id);
    if (freshPedido && freshPedido.dynamics_order_number) {
        log(`  [PREVENCIÓN] El objPedido ya tiene SO asignado en DB (${freshPedido.dynamics_order_number}). Omitiendo creación de header.`);
        objPedido.dynamics_order_number = freshPedido.dynamics_order_number;
    }

    let salesOrderNumber = objPedido.dynamics_order_number;

    if (salesOrderNumber) {
        log(`  Header ya existe -> ${salesOrderNumber} (procediendo con lineas si es necesario)`);
    } else {
        log(`  Iniciando creación de header en Dynamics...`);
        if (objPedido.vendedor_personnel_number) {
            log(`  Responsable: ${objPedido.vendedor_nombre} -> ${objPedido.vendedor_personnel_number}`);
            if (objPedido.secretario_personnel_number) {
                log(`  Secretario de ventas: ${objPedido.secretario_personnel_number}`);
            } else {
                log(`  ADVERTENCIA: No hay secretario asignado para ${objPedido.vendedor_nombre}. Se usará el mismo vendedor como OrderTaker.`);
            }
        } else {
            log(`  ADVERTENCIA: No se encontró mapeo de PersonnelNumber para el vendedor: ${objPedido.vendedor_nombre}`);
        }

        salesOrderNumber = await createSalesOrderHeader(token, objPedido);
        log(`  Header creado con éxito -> ${salesOrderNumber}`);

        // Guardar inmediatamente para evitar duplicados si las lineas fallan en el siguiente paso
        await saveOrderNumber(objPedido.pedido_id, salesOrderNumber);
    }

    const lines = await getOrderLines(objPedido.pedido_id);
    log(`  Insertando ${lines.length} linea(s)...`);

    // Caché local de settings por artículo para este objPedido
    const itemSettingsCache = new Map();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.cantidad <= 0) continue;

        if (!itemSettingsCache.has(line.item_id)) {
            const defaults = await getItemDefaultSettings(token, line.item_id);
            itemSettingsCache.set(line.item_id, defaults);
            if (defaults) {
                log(`    Item ${line.item_id}: Almacén ${defaults.warehouse}, Sitio ${defaults.site}`);
            }
        }

        await addSalesOrderLine(token, salesOrderNumber, line, i + 1, itemSettingsCache.get(line.item_id), objPedido.vendedor_sales_group_id);
    }
    log(`  Líneas insertadas exitosamente.`);

    // PATCH garantizado: espera 2s (D365 necesita procesar internamente) y luego
    // sobrescribe el responsable y los campos de referencia ANTES de marcar como enviado.
    // Esto asegura que si el servidor se reinicia, el objPedido no queda marcado como enviado
    // sin tener los datos correctos en D365.
    await new Promise(resolve => setTimeout(resolve, 2000));

    const patchUrl = `${getBaseUrl()}SalesOrderHeadersV2(dataAreaId='maco',SalesOrderNumber='${salesOrderNumber}')`;
    const patchData = {
        CustomersOrderReference: (objPedido.vendedor_nombre || '').substring(0, 60),
        SalesOrderName: (objPedido.cliente_nombre || '').substring(0, 60),
    };

    if (objPedido.pedido_numero) {
        patchData.CustomerRequisitionNumber = objPedido.pedido_numero.substring(0, 50);
    }

    if (objPedido.vendedor_personnel_number) {
        patchData.OrderResponsiblePersonnelNumber = objPedido.vendedor_personnel_number;
    }

    const taker = objPedido.vendedor_personnel_number;
    if (taker) {
        patchData.OrderTakerPersonnelNumber = taker;
    }

    try {
        await axios.patch(patchUrl, patchData, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        log(`  [PATCH OK] Resp: ${objPedido.vendedor_personnel_number || '-'} | Ref: ${objPedido.vendedor_nombre}`);
    } catch (patchErr) {
        log(`  [PATCH ERROR] ${patchErr.message} (el objPedido se marcará como enviado de todas formas)`);
    }

    await markOrderAsSent(objPedido.pedido_id, salesOrderNumber);
    log(`  COMPLETADO -> ${objPedido.pedido_numero} = ${salesOrderNumber}`);

    return salesOrderNumber;
}


async function repatchRecentOrders(token) {
    const { getPool } = require('./dbConnection');
    const db = await getPool();

    // Pedidos enviados en las últimas 4 horas con vendedor mapeado
    const result = await db.request().query(`
        SELECT TOP 30 p.dynamics_order_number, p.pedido_numero, p.vendedor_nombre, p.cliente_nombre,
               m.personnel_number AS vendedor_personnel_number,
               m.sales_group_id AS vendedor_sales_group_id,
               m.secretario_personnel_number
        FROM [dbo].[pedidos] p
        JOIN [dbo].[vendedor_dynamics_map] m
            ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
        WHERE p.enviado_dynamics = 1
          AND p.dynamics_order_number IS NOT NULL
          AND p.fecha_pedido >= DATEADD(HOUR, -4, GETDATE())
        ORDER BY p.fecha_pedido DESC
    `);

    if (result.recordset.length === 0) return;

    const baseUrl = getBaseUrl();
    let corregidos = 0;

    for (const row of result.recordset) {
        try {
            const checkRes = await axios.get(
                `${baseUrl}SalesOrderHeadersV2?$filter=SalesOrderNumber eq '${row.dynamics_order_number}' and dataAreaId eq 'maco'&$select=SalesOrderNumber,OrderResponsiblePersonnelNumber,CustomersOrderReference,SalesOrderName`,
                { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
            );
            const ov = checkRes.data.value[0];

            const isCorrect = ov &&
                ov.OrderResponsiblePersonnelNumber === row.vendedor_personnel_number &&
                ov.CustomersOrderReference === row.vendedor_nombre &&
                ov.SalesOrderName === row.cliente_nombre &&
                ov.CommissionSalesRepresentativeGroupId === (row.vendedor_sales_group_id || '');

            if (isCorrect) continue;

            const patchData = {
                OrderResponsiblePersonnelNumber: row.vendedor_personnel_number,
                CustomersOrderReference: row.vendedor_nombre,
                CustomerRequisitionNumber: row.pedido_numero,
                SalesOrderName: row.cliente_nombre,
                CommissionSalesRepresentativeGroupId: row.vendedor_sales_group_id || '',
            };

            const taker = row.secretario_personnel_number || row.vendedor_personnel_number;
            if (taker) {
                patchData.SalesOrderTakerPersonnelNumber = taker;
            }

            await axios.patch(
                `${baseUrl}SalesOrderHeadersV2(dataAreaId='maco',SalesOrderNumber='${row.dynamics_order_number}')`,
                patchData,
                { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
            );
            log(`  [RE-PATCH] ${row.dynamics_order_number}: corregido -> Resp=${row.vendedor_personnel_number}, Ref=${row.vendedor_nombre}`);
            corregidos++;
        } catch (e) {
            log(`  [RE-PATCH ERROR] ${row.dynamics_order_number}: ${e.message}`);
        }
    }

    if (corregidos > 0) log(`  Re-patch completado: ${corregidos} OV(s) corregida(s)`);
}

async function pollCycle() {
    if (isProcessing) return;
    isProcessing = true;
    cycleCount++;

    try {
        const allPending = await getPendingOrders();
        // Un objPedido es procesable si tiene un número de cuenta (AccountNum) válido
        const pendingOrders = allPending.filter(p => p.cliente_accountnum);
        const sinCuenta = allPending.length - pendingOrders.length;

        const token = await getAccessToken();

        // Cada 10 ciclos (~5 min): re-verificar OVs recientes y corregir responsable si D365 lo sobrescribió
        if (cycleCount % 10 === 1) {
            await repatchRecentOrders(token);
        }

        if (pendingOrders.length === 0) {
            isProcessing = false;
            return;
        }

        log(`CICLO #${cycleCount}: ${pendingOrders.length} objPedido(s) para enviar${sinCuenta ? ' (' + sinCuenta + ' sin AccountNum válido)' : ''}`);

        let exitosos = 0;
        let fallidos = 0;

        for (const objPedido of pendingOrders) {
            try {
                await processOrder(token, objPedido);
                exitosos++;
            } catch (error) {
                fallidos++;
                const errMsg = extractErrorMessage(error);
                log(`  ERROR en ${objPedido.pedido_numero}: ${errMsg}`);

                try {
                    await markOrderAsFailed(objPedido.pedido_id, errMsg);
                } catch (dbErr) {
                    log(`  Error guardando fallo en BD: ${dbErr.message}`);
                }
            }
        }

        log(`Resumen: ${exitosos} exitosos, ${fallidos} fallidos`);
    } catch (error) {
        log(`Error general: ${error.message}`);
    } finally {
        isProcessing = false;
    }
}

async function startSync() {
    log('Verificando estructura de la BD...');
    await ensureColumnExists();
    log('Estructura verificada. Sync activo cada ' + (POLL_INTERVAL_MS / 1000) + 's');

    // Primer ciclo inmediato
    await pollCycle();

    // Polling continuo
    setInterval(pollCycle, POLL_INTERVAL_MS);
}

function getSyncLog() {
    return syncLog;
}

function getSyncStatus() {
    return { isProcessing, cycleCount, interval: POLL_INTERVAL_MS };
}

module.exports = { startSync, getSyncLog, getSyncStatus, pollCycle, processOrder, extractErrorMessage };
