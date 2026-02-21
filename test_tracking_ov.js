const axios = require('axios');

async function testTrackingOV() {
    try {
        console.log('Testing GET /api/tracking for OV number...');
        const res = await axios.get('http://localhost:3000/api/tracking');
        console.log('Status:', res.status);
        console.log('Data count:', res.data.length);

        const withOV = res.data.filter(t => t.dynamics_order_number);
        console.log('Records with OV:', withOV.length);

        if (withOV.length > 0) {
            console.log('Sample record with OV:', withOV[0]);
        } else if (res.data.length > 0) {
            console.log('Sample record (no OV found):', res.data[0]);
        }
    } catch (err) {
        console.error('Error testing API:', err.message);
    }
}

testTrackingOV();
