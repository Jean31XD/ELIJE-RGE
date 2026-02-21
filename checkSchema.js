const { getPool } = require('./dbConnection');

async function checkDatabase() {
    try {
        const pool = await getPool();

        console.log('--- START TABLES ---');
        const tables = await pool.request().query("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
        tables.recordset.forEach(t => console.log(`${t.TABLE_SCHEMA}.${t.TABLE_NAME}`));
        console.log('--- END TABLES ---');

        const tableName = 'esquemas_rangos';
        console.log(`\n--- START COLUMNS ${tableName} ---`);
        const columns = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = '${tableName}'
        `);

        if (columns.recordset.length === 0) {
            console.log(`No se encontro la tabla ${tableName}`);
        } else {
            columns.recordset.forEach(c => {
                console.log(`${c.COLUMN_NAME}|${c.DATA_TYPE}|${c.CHARACTER_MAXIMUM_LENGTH}|${c.IS_NULLABLE}`);
            });
        }
        console.log(`--- END COLUMNS ${tableName} ---`);

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkDatabase();
