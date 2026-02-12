require('dotenv').config();
const axios = require('axios');
const qs = require('qs');

/**
 * Autenticación OAuth2 con Azure AD para Dynamics 365 F&O
 */
async function getAccessToken() {
    const tenantId = process.env.TENANT_ID;
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const data = {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'client_credentials',
        scope: `${process.env.RESOURCE_URL}/.default`
    };

    try {
        const response = await axios.post(url, qs.stringify(data), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('❌ Error obteniendo token:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { getAccessToken };
