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
 * Extrae el mensaje de error más detallado posible de la respuesta de Dynamics
 */
function extractErrorMessage(error) {
    if (error.response?.data?.error) {
        const d365Error = error.response.data.error;
        // Si hay un innererror, suele ser el mensaje real (ej: validación)
        if (d365Error.innererror?.message) {
            return d365Error.innererror.message;
        }
        return d365Error.message || "Error desconocido en Dynamics";
    }
    return error.message;
}

function log(msg) {
    const timestamp = new Date().toLocaleTimeString('es-DO');
    const entry = `[${timestamp}] ${msg}`;
    console.log(entry);
    syncLog.push({ time: timestamp, msg });
    if (syncLog.length > 100) syncLog.shift();
}

async function createSalesOrderHeader(token, pedido) {
    const url = `${getBaseUrl()}SalesOrderHeadersV2`;
    const customerAccount = pedido.cliente_accountnum || pedido.cliente_rnc;

    const headerData = {
        dataAreaId: 'maco',
        OrderingCustomerAccountNumber: customerAccount,
        InvoiceCustomerAccountNumber: customerAccount,
        CurrencyCode: 'DOP',
        RequestedShippingDate: new Date(pedido.fecha_pedido).toISOString().split('T')[0] + 'T12:00:00Z',
    };

    if (pedido.vendedor_personnel_number) {
        headerData.OrderResponsiblePersonnelNumber = pedido.vendedor_personnel_number;
        headerData.OrderTakerPersonnelNumber = pedido.vendedor_personnel_number;
    }

    log(`  Creando header -> Cliente: ${customerAccount} | Vendedor: ${pedido.vendedor_personnel_number || '-'}`);

    const response = await axios.post(url, headerData, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    return response.data.SalesOrderNumber;
}

async function addSalesOrderLine(token, salesOrderNumber, line, lineNumber) {
    const url = `${getBaseUrl()}SalesOrderLines`;

    const payload = {
        dataAreaId: 'maco',
        SalesOrderNumber: salesOrderNumber,
        ItemNumber: line.item_id,
        OrderedSalesQuantity: line.cantidad,
        SalesPrice: line.precio_unitario,
        SalesUnitSymbol: 'UND',
        LineNumber: lineNumber,
    };

    const response = await axios.post(url, payload, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    return response.data;
}

async function processOrder(token, pedido) {
    log(`--- Pedido ${pedido.pedido_numero} | ${pedido.cliente_nombre} | $${pedido.total}`);

    const salesOrderNumber = await createSalesOrderHeader(token, pedido);
    log(`  Header creado -> ${salesOrderNumber}`);

    const lines = await getOrderLines(pedido.pedido_id);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].cantidad <= 0) continue;
        await addSalesOrderLine(token, salesOrderNumber, lines[i], i + 1);
    }
    log(`  ${lines.length} linea(s) insertadas`);

    await markOrderAsSent(pedido.pedido_id, salesOrderNumber);
    log(`  COMPLETADO -> ${pedido.pedido_numero} = ${salesOrderNumber}`);

    return salesOrderNumber;
}

async function pollCycle() {
    if (isProcessing) return;
    isProcessing = true;
    cycleCount++;

    try {
        const allPending = await getPendingOrders();
        const pendingOrders = allPending.filter(p => p.cliente_accountnum);
        const sinCuenta = allPending.length - pendingOrders.length;

        if (pendingOrders.length === 0) {
            isProcessing = false;
            return;
        }

        log(`CICLO #${cycleCount}: ${pendingOrders.length} pedido(s) para enviar${sinCuenta ? ' (' + sinCuenta + ' sin cuenta CL-)' : ''}`);

        const token = await getAccessToken();
        let exitosos = 0;
        let fallidos = 0;

        for (const pedido of pendingOrders) {
            try {
                await processOrder(token, pedido);
                exitosos++;
            } catch (error) {
                fallidos++;
                const errMsg = extractErrorMessage(error);
                log(`  ERROR en ${pedido.pedido_numero}: ${errMsg}`);

                // Guardar error en la base de datos para visibilidad en el portal
                try {
                    await markOrderAsFailed(pedido.pedido_id, errMsg);
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
