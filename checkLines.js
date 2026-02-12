/**
 * checkLines.js - Busca el nombre correcto de la entidad de líneas de orden
 */
require('dotenv').config();
const { getAccessToken } = require('./auth');
const axios = require('axios');
const fs = require('fs');

async function checkLines() {
    const token = await getAccessToken();
    const resourceUrl = process.env.RESOURCE_URL.endsWith('/')
        ? process.env.RESOURCE_URL
        : `${process.env.RESOURCE_URL}/`;

    const entities = [
        'SalesOrderLinesV2',
        'SalesOrderLines',
        'CDSSalesOrderLines',
        'SalesOrderLineV2Entity',
        'SalesOrderLine'
    ];

    const results = {};

    for (const entity of entities) {
        try {
            const url = `${resourceUrl}data/${entity}?$top=1`;
            const resp = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });
            results[entity] = { success: true, count: resp.data.value.length, sample: resp.data.value[0] || null };
        } catch (e) {
            results[entity] = { success: false, status: e.response ? e.response.status : 'N/A', error: e.response ? (e.response.data.error ? e.response.data.error.message : JSON.stringify(e.response.data).substring(0, 200)) : e.message };
        }
    }

    fs.writeFileSync('lines_result.json', JSON.stringify(results, null, 2), 'utf8');
    console.log('Done');
}

checkLines();
