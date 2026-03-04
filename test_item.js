const { getAccessToken } = require('./auth');
const axios = require('axios');
const fs = require('fs');

async function main() {
    const token = await getAccessToken();
    const baseUrl = process.env.RESOURCE_URL.endsWith('/') ? process.env.RESOURCE_URL : `${process.env.RESOURCE_URL}/`;

    const itemId = 'MC-000019103';

    try {
        const res = await axios.get(`${baseUrl}data/ReleasedProductsV2?$filter=ItemNumber eq '${itemId}' and dataAreaId eq 'maco'`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        fs.writeFileSync('item_details.json', JSON.stringify(res.data.value[0], null, 2));
        console.log('Done!');
    } catch (e) {
        console.error(e.message);
    }
}

main();
