/**
 * insertOrder.js - Inserta una Orden de Venta en Dynamics 365 F&O
 * 
 * Uso: node insertOrder.js
 * 
 * Este script:
 * 1. Se autentica con Azure AD
 * 2. Crea un encabezado de orden de venta (SalesOrderHeadersV2)
 * 3. Agrega líneas a la orden (SalesOrderLines)
 * 4. Verifica que la orden fue creada correctamente
 */
require('dotenv').config();
const { getAccessToken } = require('./auth');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURACIÓN DE LA ORDEN DE VENTA
// Modifique estos valores según sus necesidades
// ============================================================
const SALES_ORDER_CONFIG = {
    // --- Encabezado de la Orden ---
    header: {
        dataAreaId: 'maco',                                  // Empresa legal
        OrderingCustomerAccountNumber: 'CL-000001132',       // Número de cuenta del cliente
        InvoiceCustomerAccountNumber: 'CL-000001132',        // Cuenta de facturación
        CurrencyCode: 'DOP',                                 // Moneda (Peso Dominicano)
        RequestedShippingDate: new Date().toISOString().split('T')[0] + 'T12:00:00Z', // Fecha de envío
        CustomerRequisitionNumber: 'PED-TEST-001',           // Número de pedido (Referencia)
        CustomersOrderReference: 'VENDEDOR PRUEBA',          // Nombre del vendedor
    },

    // --- Líneas de la Orden ---
    lines: [
        {
            ItemNumber: 'MC-000019103',        // Número del artículo
            OrderedSalesQuantity: 5,           // Cantidad
            SalesPrice: 425,                   // Precio de venta unitario
            LineNumber: 1,                     // Número de línea
        }
    ]
};

// ============================================================
// FUNCIONES PRINCIPALES
// ============================================================

/**
 * Construye la URL base del API
 */
function getBaseUrl() {
    const resourceUrl = process.env.RESOURCE_URL.endsWith('/')
        ? process.env.RESOURCE_URL
        : `${process.env.RESOURCE_URL}/`;
    return `${resourceUrl}data/`;
}

/**
 * Crea el encabezado de la orden de venta
 */
async function createSalesOrderHeader(token, headerData) {
    const url = `${getBaseUrl()}SalesOrderHeadersV2`;

    console.log('');
    console.log('📋 Paso 1: Creando encabezado de orden de venta...');
    console.log(`   Cliente: ${headerData.OrderingCustomerAccountNumber}`);
    console.log(`   Moneda: ${headerData.CurrencyCode}`);
    console.log(`   Empresa: ${headerData.dataAreaId}`);
    console.log(`   URL: ${url}`);

    try {
        const response = await axios.post(url, headerData, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const salesOrderNumber = response.data.SalesOrderNumber;
        console.log(`   ✅ Encabezado creado exitosamente!`);
        console.log(`   📌 Número de Orden: ${salesOrderNumber}`);

        return response.data;
    } catch (error) {
        console.error('   ❌ Error creando encabezado:');
        if (error.response) {
            console.error(`      Status: ${error.response.status}`);
            const errData = error.response.data;
            if (errData && errData.error) {
                console.error(`      Mensaje: ${errData.error.message}`);
                if (errData.error.innererror) {
                    console.error(`      Detalle: ${errData.error.innererror.message || JSON.stringify(errData.error.innererror)}`);
                }
            } else {
                console.error(`      Respuesta: ${JSON.stringify(errData).substring(0, 500)}`);
            }
        } else {
            console.error(`      ${error.message}`);
        }
        throw error;
    }
}

/**
 * Agrega una línea a la orden de venta
 */
async function addSalesOrderLine(token, salesOrderNumber, dataAreaId, lineData) {
    const url = `${getBaseUrl()}SalesOrderLines`;

    const payload = {
        dataAreaId: dataAreaId,
        SalesOrderNumber: salesOrderNumber,
        ...lineData
    };

    console.log('');
    console.log(`📦 Paso 2: Agregando línea ${lineData.LineNumber}...`);
    console.log(`   Artículo: ${lineData.ItemNumber}`);
    console.log(`   Cantidad: ${lineData.OrderedSalesQuantity}`);
    console.log(`   Precio: ${lineData.SalesPrice}`);

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        console.log(`   ✅ Línea ${lineData.LineNumber} agregada exitosamente!`);
        return response.data;

    } catch (error) {
        console.error(`   ❌ Error agregando línea ${lineData.LineNumber}:`);
        if (error.response) {
            console.error(`      Status: ${error.response.status}`);
            const errData = error.response.data;
            if (errData && errData.error) {
                console.error(`      Mensaje: ${errData.error.message}`);
                if (errData.error.innererror) {
                    console.error(`      Detalle: ${errData.error.innererror.message || JSON.stringify(errData.error.innererror)}`);
                }
            } else {
                console.error(`      Respuesta: ${JSON.stringify(errData).substring(0, 500)}`);
            }
        } else {
            console.error(`      ${error.message}`);
        }
        throw error;
    }
}

/**
 * Verifica que la orden fue creada consultándola
 */
async function verifySalesOrder(token, salesOrderNumber, dataAreaId) {
    const url = `${getBaseUrl()}SalesOrderHeadersV2?$filter=SalesOrderNumber eq '${salesOrderNumber}' and dataAreaId eq '${dataAreaId}'`;

    console.log('');
    console.log('🔍 Paso 3: Verificando la orden creada...');

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (response.data.value.length > 0) {
            const order = response.data.value[0];
            console.log('   ✅ Orden verificada en el sistema!');
            console.log(`   Número: ${order.SalesOrderNumber}`);
            console.log(`   Estado: ${order.SalesOrderStatus}`);
            console.log(`   Cliente: ${order.OrderingCustomerAccountNumber}`);
            return order;
        } else {
            console.log('   ⚠️ La orden no se encontró en la verificación.');
            return null;
        }
    } catch (error) {
        console.error('   ⚠️ Error en la verificación:', error.message);
        return null;
    }
}

// ============================================================
// EJECUCIÓN PRINCIPAL
// ============================================================

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  INSERCIÓN DE ORDEN DE VENTA - Dynamics 365 F&O');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Entorno: ${process.env.RESOURCE_URL}`);
    console.log(`  Fecha:   ${new Date().toLocaleString()}`);

    const results = { success: false, salesOrderNumber: null, errors: [] };

    try {
        // 1. Autenticación
        console.log('');
        console.log('🔐 Autenticando con Azure AD...');
        const token = await getAccessToken();
        console.log('   ✅ Token obtenido exitosamente.');

        // 2. Crear encabezado
        const headerResult = await createSalesOrderHeader(token, SALES_ORDER_CONFIG.header);
        const salesOrderNumber = headerResult.SalesOrderNumber;
        results.salesOrderNumber = salesOrderNumber;

        // 3. Agregar líneas
        for (const line of SALES_ORDER_CONFIG.lines) {
            await addSalesOrderLine(token, salesOrderNumber, SALES_ORDER_CONFIG.header.dataAreaId, line);
        }

        // 4. Verificar
        await verifySalesOrder(token, salesOrderNumber, SALES_ORDER_CONFIG.header.dataAreaId);

        results.success = true;

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log(`  ✅ ORDEN DE VENTA CREADA EXITOSAMENTE`);
        console.log(`  📌 Número: ${salesOrderNumber}`);
        console.log('═══════════════════════════════════════════════════');

    } catch (error) {
        results.errors.push(error.message);
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('  ❌ ERROR AL CREAR LA ORDEN DE VENTA');
        console.log('═══════════════════════════════════════════════════');
    }

    // Guardar resultado
    fs.writeFileSync(
        path.join(__dirname, 'insert_result.json'),
        JSON.stringify(results, null, 2),
        'utf8'
    );
}

main();
