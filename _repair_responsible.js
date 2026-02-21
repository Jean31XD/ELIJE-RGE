/**
 * _repair_responsible.js
 * Repara órdenes existentes en D365 que tienen OrderResponsiblePersonnelNumber
 * incorrecto (el usuario del API en lugar del vendedor real).
 *
 * Uso: node _repair_responsible.js
 */
require('dotenv').config();
const { getAccessToken } = require('./auth');
const axios = require('axios');
const { getPool } = require('./dbConnection');

const API_USER_PERSONNEL = '40226548424'; // Personnel number del usuario API (el "insertador")

(async () => {
    const db = await getPool();

    // Obtener todos los pedidos enviados que tienen un vendedor mapeado
    const result = await db.request().query(`
        SELECT p.pedido_id, p.pedido_numero, p.vendedor_nombre, p.dynamics_order_number,
               m.personnel_number AS vendedor_personnel_number,
               m.secretario_personnel_number
        FROM [dbo].[pedidos] p
        JOIN [dbo].[vendedor_dynamics_map] m
            ON UPPER(LTRIM(RTRIM(p.vendedor_nombre))) = UPPER(LTRIM(RTRIM(m.vendedor_nombre)))
        WHERE p.enviado_dynamics = 1
          AND p.dynamics_order_number IS NOT NULL
          AND p.dynamics_order_number <> ''
        ORDER BY p.pedido_id DESC
    `);

    console.log(`\nPedidos a verificar: ${result.recordset.length}`);

    const token = await getAccessToken();
    const base = process.env.RESOURCE_URL.replace(/\/$/, '') + '/data/';
    const h = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    let reparados = 0;
    let correctos = 0;
    let errores = 0;

    for (const row of result.recordset) {
        try {
            const url = `${base}SalesOrderHeadersV2?$filter=SalesOrderNumber eq '${row.dynamics_order_number}'&$select=SalesOrderNumber,OrderResponsiblePersonnelNumber,CustomerRequisitionNumber,CustomersOrderReference`;
            const res = await axios.get(url, { headers: h });
            const o = res.data.value[0];

            if (!o) {
                console.log(`  [NO ENCONTRADA] ${row.dynamics_order_number} (${row.pedido_numero})`);
                errores++;
                continue;
            }

            const needsRepair =
                o.OrderResponsiblePersonnelNumber !== row.vendedor_personnel_number ||
                !o.CustomerRequisitionNumber ||
                !o.CustomersOrderReference;

            if (!needsRepair) {
                correctos++;
                continue;
            }

            console.log(`  [REPARANDO] ${row.dynamics_order_number} | Resp actual: ${o.OrderResponsiblePersonnelNumber || 'VACIO'} -> correcto: ${row.vendedor_personnel_number}`);

            const patchUrl = `${base}SalesOrderHeadersV2(dataAreaId='maco',SalesOrderNumber='${row.dynamics_order_number}')`;
            await axios.patch(patchUrl, {
                OrderResponsiblePersonnelNumber: row.vendedor_personnel_number,
                CustomerRequisitionNumber: row.pedido_numero,
                CustomersOrderReference: row.vendedor_nombre,
            }, {
                headers: { ...h, 'Content-Type': 'application/json' }
            });

            // Verificar
            const verify = await axios.get(url, { headers: h });
            const saved = verify.data.value[0];
            console.log(`    -> Guardado: Resp=${saved.OrderResponsiblePersonnelNumber} | CRN="${saved.CustomerRequisitionNumber}" | Ref="${saved.CustomersOrderReference}"`);
            reparados++;

        } catch (e) {
            console.log(`  [ERROR] ${row.dynamics_order_number}: ${e.response?.data?.error?.message || e.message}`);
            errores++;
        }
    }

    console.log(`\n=== RESUMEN ===`);
    console.log(`  Correctos (sin cambio): ${correctos}`);
    console.log(`  Reparados:             ${reparados}`);
    console.log(`  Errores:               ${errores}`);

    process.exit(0);
})().catch(e => {
    console.error(e.message);
    process.exit(1);
});
