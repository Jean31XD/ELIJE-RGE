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
        // Si hay secretario asignado, él es quien toma el pedido; si no, cae en el vendedor
        headerData.OrderTakerPersonnelNumber = pedido.secretario_personnel_number || pedido.vendedor_personnel_number;
    }

    log(`  Creando header -> Cliente: ${customerAccount} | Responsable: ${pedido.vendedor_personnel_number || '-'} | Secretario: ${pedido.secretario_personnel_number || '(mismo vendedor)'}`);

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

    // Re-verificar contra DB para evitar race conditions (especialmente si hay varios procesos node)
    const freshPedido = await getOrderById(pedido.pedido_id);
    if (freshPedido && freshPedido.dynamics_order_number) {
        log(`  [PREVENCIÓN] El pedido ya tiene SO asignado en DB (${freshPedido.dynamics_order_number}). Omitiendo creación de header.`);
        pedido.dynamics_order_number = freshPedido.dynamics_order_number;
    }

    let salesOrderNumber = pedido.dynamics_order_number;

    if (salesOrderNumber) {
        log(`  Header ya existe -> ${salesOrderNumber} (procediendo con lineas si es necesario)`);
    } else {
        log(`  Iniciando creación de header en Dynamics...`);
        if (pedido.vendedor_personnel_number) {
            log(`  Responsable: ${pedido.vendedor_nombre} -> ${pedido.vendedor_personnel_number}`);
            if (pedido.secretario_personnel_number) {
                log(`  Secretario de ventas: ${pedido.secretario_personnel_number}`);
            } else {
                log(`  ADVERTENCIA: No hay secretario asignado para ${pedido.vendedor_nombre}. Se usará el mismo vendedor como OrderTaker.`);
            }
        } else {
            log(`  ADVERTENCIA: No se encontró mapeo de PersonnelNumber para el vendedor: ${pedido.vendedor_nombre}`);
        }

        salesOrderNumber = await createSalesOrderHeader(token, pedido);
        log(`  Header creado con éxito -> ${salesOrderNumber}`);

        // Guardar inmediatamente para evitar duplicados si las lineas fallan en el siguiente paso
        await saveOrderNumber(pedido.pedido_id, salesOrderNumber);
    }

    const lines = await getOrderLines(pedido.pedido_id);
    log(`  Insertando ${lines.length} linea(s)...`);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].cantidad <= 0) continue;
        await addSalesOrderLine(token, salesOrderNumber, lines[i], i + 1);
    }
    log(`  Líneas insertadas exitosamente.`);

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
        const procesadosParaPatch = []; // OVs que necesitan PATCH de responsable después

        for (const pedido of pendingOrders) {
            try {
                const salesOrderNumber = await processOrder(token, pedido);
                exitosos++;
                if (pedido.vendedor_personnel_number) {
                    procesadosParaPatch.push({ salesOrderNumber, pedido });
                }
            } catch (error) {
                fallidos++;
                const errMsg = extractErrorMessage(error);
                log(`  ERROR en ${pedido.pedido_numero}: ${errMsg}`);

                try {
                    await markOrderAsFailed(pedido.pedido_id, errMsg);
                } catch (dbErr) {
                    log(`  Error guardando fallo en BD: ${dbErr.message}`);
                }
            }
        }

        log(`Resumen: ${exitosos} exitosos, ${fallidos} fallidos`);

        // PATCH diferido: esperar 15s para que D365 termine su procesamiento interno
        // y luego sobrescribir el responsable con el vendedor correcto
        if (procesadosParaPatch.length > 0) {
            setTimeout(async () => {
                try {
                    const freshToken = await getAccessToken();
                    for (const { salesOrderNumber, pedido } of procesadosParaPatch) {
                        const patchUrl = `${getBaseUrl()}SalesOrderHeadersV2(dataAreaId='maco',SalesOrderNumber='${salesOrderNumber}')`;
                        await axios.patch(patchUrl, {
                            OrderResponsiblePersonnelNumber: pedido.vendedor_personnel_number,
                            OrderTakerPersonnelNumber: pedido.secretario_personnel_number || pedido.vendedor_personnel_number,
                            CustomerRequisitionNumber: pedido.pedido_numero,
                        }, {
                            headers: {
                                'Authorization': `Bearer ${freshToken}`,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            }
                        });
                        // Verificar inmediatamente si el PATCH persistió
                        const verifyRes = await axios.get(patchUrl, {
                            headers: { 'Authorization': `Bearer ${freshToken}`, 'Accept': 'application/json' }
                        });
                        const saved = verifyRes.data;
                        log(`  [PATCH] ${salesOrderNumber} -> enviado: ${pedido.vendedor_personnel_number} | D365 guardó: ${saved.OrderResponsiblePersonnelNumber} | CRN: "${saved.CustomerRequisitionNumber}"`);
                    }
                } catch (err) {
                    log(`  [PATCH] Error: ${err.message}`);
                }
            }, 15000);
        }
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
