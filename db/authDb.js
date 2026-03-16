/**
 * db/authDb.js - Database functions for auth and user management
 */
const { getPool } = require('../dbConnection');
const sql = require('mssql');

const ALL_MODULES = ['dashboard', 'pedidos', 'cobros', 'sync', 'logs', 'rangos', 'tracking', 'clientes-extra'];

async function findUserByOid(msOid) {
    const db = await getPool();
    const result = await db.request()
        .input('oid', sql.NVarChar(100), msOid)
        .query(`SELECT id, email, display_name, ms_oid, role, active, created_at, last_login FROM [dbo].[app_users] WHERE ms_oid = @oid`);
    return result.recordset[0] || null;
}

async function findUserByEmail(email) {
    const db = await getPool();
    const result = await db.request()
        .input('email', sql.NVarChar(255), email)
        .query(`SELECT id, email, display_name, ms_oid, role, active, created_at, last_login FROM [dbo].[app_users] WHERE email = @email`);
    return result.recordset[0] || null;
}

async function createUser(email, displayName, msOid, role) {
    const db = await getPool();
    const result = await db.request()
        .input('email', sql.NVarChar(255), email)
        .input('display_name', sql.NVarChar(255), displayName)
        .input('ms_oid', sql.NVarChar(100), msOid)
        .input('role', sql.NVarChar(20), role)
        .query(`
            INSERT INTO [dbo].[app_users] (email, display_name, ms_oid, role)
            VALUES (@email, @display_name, @ms_oid, @role);
            SELECT SCOPE_IDENTITY() AS id;
        `);
    return result.recordset[0].id;
}

async function updateUserLastLogin(userId) {
    const db = await getPool();
    await db.request()
        .input('id', sql.Int, userId)
        .query(`UPDATE [dbo].[app_users] SET last_login = GETDATE() WHERE id = @id`);
}

async function getUserWithPermissions(userId) {
    const db = await getPool();

    // Get user row
    const userResult = await db.request()
        .input('id', sql.Int, userId)
        .query(`SELECT id, email, display_name, ms_oid, role, active, created_at, last_login FROM [dbo].[app_users] WHERE id = @id`);

    const user = userResult.recordset[0];
    if (!user) return null;

    // Get modules
    const modulesResult = await db.request()
        .input('id', sql.Int, userId)
        .query(`SELECT module FROM [dbo].[app_user_modules] WHERE user_id = @id`);
    user.modules = modulesResult.recordset.map(r => r.module);

    // Get vendors: UNION of individual vendors + all members of user's vendor groups
    const vendorsResult = await db.request()
        .input('id', sql.Int, userId)
        .query(`
            SELECT DISTINCT vendedor_nombre FROM (
                SELECT vendedor_nombre FROM [dbo].[app_user_vendors] WHERE user_id = @id
                UNION
                SELECT m.vendedor_nombre
                FROM [dbo].[app_vendor_group_members] m
                INNER JOIN [dbo].[app_user_vendor_groups] uvg ON m.group_id = uvg.group_id
                WHERE uvg.user_id = @id
            ) AS v
            ORDER BY vendedor_nombre
        `);
    user.vendors = vendorsResult.recordset.map(r => r.vendedor_nombre);

    return user;
}

async function isFirstUser() {
    const db = await getPool();
    const result = await db.request().query(`SELECT COUNT(*) AS cnt FROM [dbo].[app_users]`);
    return result.recordset[0].cnt === 0;
}

async function listUsers() {
    const db = await getPool();

    const usersResult = await db.request().query(`
        SELECT id, email, display_name, role, active, created_at, last_login
        FROM [dbo].[app_users]
        ORDER BY created_at ASC
    `);

    const users = usersResult.recordset;
    if (users.length === 0) return [];

    // Get all modules
    const modulesResult = await db.request().query(`SELECT user_id, module FROM [dbo].[app_user_modules]`);
    const modulesByUser = {};
    modulesResult.recordset.forEach(r => {
        if (!modulesByUser[r.user_id]) modulesByUser[r.user_id] = [];
        modulesByUser[r.user_id].push(r.module);
    });

    // Get all vendor group assignments
    const groupsResult = await db.request().query(`SELECT user_id, group_id FROM [dbo].[app_user_vendor_groups]`);
    const groupsByUser = {};
    groupsResult.recordset.forEach(r => {
        if (!groupsByUser[r.user_id]) groupsByUser[r.user_id] = [];
        groupsByUser[r.user_id].push(r.group_id);
    });

    users.forEach(u => {
        u.modules = modulesByUser[u.id] || [];
        u.vendorGroupIds = groupsByUser[u.id] || [];
    });

    return users;
}

async function updateUser(id, { role, active }) {
    const db = await getPool();
    const fields = [];
    const req = db.request().input('id', sql.Int, id);

    if (role !== undefined) {
        fields.push('role = @role');
        req.input('role', sql.NVarChar(20), role);
    }
    if (active !== undefined) {
        fields.push('active = @active');
        req.input('active', sql.Bit, active ? 1 : 0);
    }

    if (fields.length === 0) return;
    await req.query(`UPDATE [dbo].[app_users] SET ${fields.join(', ')} WHERE id = @id`);
}

async function setUserModules(userId, modules) {
    const db = await getPool();
    const t = new sql.Transaction(db);
    await t.begin();
    try {
        await t.request()
            .input('uid', sql.Int, userId)
            .query(`DELETE FROM [dbo].[app_user_modules] WHERE user_id = @uid`);

        for (const module of (modules || [])) {
            await t.request()
                .input('uid', sql.Int, userId)
                .input('mod', sql.NVarChar(50), module)
                .query(`INSERT INTO [dbo].[app_user_modules] (user_id, module) VALUES (@uid, @mod)`);
        }
        await t.commit();
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

async function setUserVendors(userId, vendors) {
    const db = await getPool();
    const t = new sql.Transaction(db);
    await t.begin();
    try {
        await t.request()
            .input('uid', sql.Int, userId)
            .query(`DELETE FROM [dbo].[app_user_vendors] WHERE user_id = @uid`);

        for (const vendor of (vendors || [])) {
            await t.request()
                .input('uid', sql.Int, userId)
                .input('v', sql.NVarChar(200), vendor)
                .query(`INSERT INTO [dbo].[app_user_vendors] (user_id, vendedor_nombre) VALUES (@uid, @v)`);
        }
        await t.commit();
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

async function setUserVendorGroups(userId, groupIds) {
    const db = await getPool();
    const t = new sql.Transaction(db);
    await t.begin();
    try {
        await t.request()
            .input('uid', sql.Int, userId)
            .query(`DELETE FROM [dbo].[app_user_vendor_groups] WHERE user_id = @uid`);

        for (const gid of (groupIds || [])) {
            await t.request()
                .input('uid', sql.Int, userId)
                .input('gid', sql.Int, gid)
                .query(`INSERT INTO [dbo].[app_user_vendor_groups] (user_id, group_id) VALUES (@uid, @gid)`);
        }
        await t.commit();
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

async function listVendorGroups() {
    const db = await getPool();

    const groupsResult = await db.request().query(`
        SELECT id, name, description, created_at
        FROM [dbo].[app_vendor_groups]
        ORDER BY name
    `);
    const groups = groupsResult.recordset;
    if (groups.length === 0) return [];

    const membersResult = await db.request().query(`
        SELECT group_id, vendedor_nombre
        FROM [dbo].[app_vendor_group_members]
        ORDER BY vendedor_nombre
    `);

    const membersByGroup = {};
    membersResult.recordset.forEach(r => {
        if (!membersByGroup[r.group_id]) membersByGroup[r.group_id] = [];
        membersByGroup[r.group_id].push(r.vendedor_nombre);
    });

    groups.forEach(g => {
        g.vendors = membersByGroup[g.id] || [];
    });

    return groups;
}

async function createVendorGroup(name, description, vendors) {
    const db = await getPool();
    const t = new sql.Transaction(db);
    await t.begin();
    try {
        const res = await t.request()
            .input('name', sql.NVarChar(100), name)
            .input('desc', sql.NVarChar(255), description || null)
            .query(`
                INSERT INTO [dbo].[app_vendor_groups] (name, description)
                VALUES (@name, @desc);
                SELECT SCOPE_IDENTITY() AS id;
            `);
        const groupId = res.recordset[0].id;

        for (const v of (vendors || [])) {
            await t.request()
                .input('gid', sql.Int, groupId)
                .input('v', sql.NVarChar(200), v)
                .query(`INSERT INTO [dbo].[app_vendor_group_members] (group_id, vendedor_nombre) VALUES (@gid, @v)`);
        }
        await t.commit();
        return groupId;
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

async function updateVendorGroup(id, name, description, vendors) {
    const db = await getPool();
    const t = new sql.Transaction(db);
    await t.begin();
    try {
        await t.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar(100), name)
            .input('desc', sql.NVarChar(255), description || null)
            .query(`UPDATE [dbo].[app_vendor_groups] SET name = @name, description = @desc WHERE id = @id`);

        await t.request()
            .input('gid', sql.Int, id)
            .query(`DELETE FROM [dbo].[app_vendor_group_members] WHERE group_id = @gid`);

        for (const v of (vendors || [])) {
            await t.request()
                .input('gid', sql.Int, id)
                .input('v', sql.NVarChar(200), v)
                .query(`INSERT INTO [dbo].[app_vendor_group_members] (group_id, vendedor_nombre) VALUES (@gid, @v)`);
        }
        await t.commit();
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

async function deleteVendorGroup(id) {
    const db = await getPool();
    await db.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM [dbo].[app_vendor_groups] WHERE id = @id`);
}

async function getAvailableVendors() {
    const db = await getPool();
    const result = await db.request().query(`
        SELECT DISTINCT vendedor_nombre
        FROM [dbo].[vendedor_dynamics_map]
        WHERE vendedor_nombre IS NOT NULL AND vendedor_nombre <> ''
        ORDER BY vendedor_nombre
    `);
    return result.recordset.map(r => r.vendedor_nombre);
}

async function getUserDetail(id) {
    const db = await getPool();

    const userResult = await db.request()
        .input('id', sql.Int, id)
        .query(`SELECT id, email, display_name, ms_oid, role, active, created_at, last_login FROM [dbo].[app_users] WHERE id = @id`);
    const user = userResult.recordset[0];
    if (!user) return null;

    const modulesResult = await db.request()
        .input('id', sql.Int, id)
        .query(`SELECT module FROM [dbo].[app_user_modules] WHERE user_id = @id`);
    user.modules = modulesResult.recordset.map(r => r.module);

    const vendorsResult = await db.request()
        .input('id', sql.Int, id)
        .query(`SELECT vendedor_nombre FROM [dbo].[app_user_vendors] WHERE user_id = @id ORDER BY vendedor_nombre`);
    user.vendors = vendorsResult.recordset.map(r => r.vendedor_nombre);

    const groupsResult = await db.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT uvg.group_id, vg.name, vg.description
            FROM [dbo].[app_user_vendor_groups] uvg
            INNER JOIN [dbo].[app_vendor_groups] vg ON uvg.group_id = vg.id
            WHERE uvg.user_id = @id
            ORDER BY vg.name
        `);
    user.vendorGroups = groupsResult.recordset;

    return user;
}

module.exports = {
    ALL_MODULES,
    findUserByOid,
    findUserByEmail,
    createUser,
    updateUserLastLogin,
    getUserWithPermissions,
    isFirstUser,
    listUsers,
    updateUser,
    setUserModules,
    setUserVendors,
    setUserVendorGroups,
    listVendorGroups,
    createVendorGroup,
    updateVendorGroup,
    deleteVendorGroup,
    getAvailableVendors,
    getUserDetail
};
