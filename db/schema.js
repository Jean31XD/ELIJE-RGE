/**
 * db/schema.js - Auth schema initialization
 * Creates auth tables if they don't exist (SQL Server syntax)
 */
const { getPool } = require('../dbConnection');

async function ensureAuthSchema() {
    const db = await getPool();

    // app_users
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_users')
        BEGIN
            CREATE TABLE [dbo].[app_users] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                email NVARCHAR(255) NOT NULL,
                display_name NVARCHAR(255),
                ms_oid NVARCHAR(100) NOT NULL,
                role NVARCHAR(20) NOT NULL DEFAULT 'viewer' CONSTRAINT CHK_app_users_role CHECK (role IN ('admin','supervisor','viewer')),
                active BIT NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CAST(GETDATE() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Western Standard Time' AS DATETIME),
                last_login DATETIME NULL,
                CONSTRAINT UQ_app_users_email UNIQUE (email),
                CONSTRAINT UQ_app_users_ms_oid UNIQUE (ms_oid)
            );
        END
    `);

    // app_user_modules
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_user_modules')
        BEGIN
            CREATE TABLE [dbo].[app_user_modules] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                user_id INT NOT NULL,
                module NVARCHAR(50) NOT NULL,
                CONSTRAINT FK_app_user_modules_user FOREIGN KEY (user_id) REFERENCES [dbo].[app_users](id) ON DELETE CASCADE,
                CONSTRAINT UQ_app_user_modules UNIQUE (user_id, module)
            );
        END
    `);

    // app_vendor_groups
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_vendor_groups')
        BEGIN
            CREATE TABLE [dbo].[app_vendor_groups] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(100) NOT NULL,
                description NVARCHAR(255),
                created_at DATETIME NOT NULL DEFAULT CAST(GETDATE() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Western Standard Time' AS DATETIME),
                CONSTRAINT UQ_app_vendor_groups_name UNIQUE (name)
            );
        END
    `);

    // app_vendor_group_members
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_vendor_group_members')
        BEGIN
            CREATE TABLE [dbo].[app_vendor_group_members] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                group_id INT NOT NULL,
                vendedor_nombre NVARCHAR(200) NOT NULL,
                CONSTRAINT FK_app_vgm_group FOREIGN KEY (group_id) REFERENCES [dbo].[app_vendor_groups](id) ON DELETE CASCADE,
                CONSTRAINT UQ_app_vgm UNIQUE (group_id, vendedor_nombre)
            );
        END
    `);

    // app_user_vendor_groups
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_user_vendor_groups')
        BEGIN
            CREATE TABLE [dbo].[app_user_vendor_groups] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                user_id INT NOT NULL,
                group_id INT NOT NULL,
                CONSTRAINT FK_app_uvg_user FOREIGN KEY (user_id) REFERENCES [dbo].[app_users](id) ON DELETE CASCADE,
                CONSTRAINT FK_app_uvg_group FOREIGN KEY (group_id) REFERENCES [dbo].[app_vendor_groups](id),
                CONSTRAINT UQ_app_uvg UNIQUE (user_id, group_id)
            );
        END
    `);

    // app_user_vendors
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_user_vendors')
        BEGIN
            CREATE TABLE [dbo].[app_user_vendors] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                user_id INT NOT NULL,
                vendedor_nombre NVARCHAR(200) NOT NULL,
                CONSTRAINT FK_app_uv_user FOREIGN KEY (user_id) REFERENCES [dbo].[app_users](id) ON DELETE CASCADE,
                CONSTRAINT UQ_app_uv UNIQUE (user_id, vendedor_nombre)
            );
        END
    `);

    // app_audit_log
    await db.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'app_audit_log')
        BEGIN
            CREATE TABLE [dbo].[app_audit_log] (
                id INT IDENTITY(1,1) PRIMARY KEY,
                admin_id INT NOT NULL,
                admin_email NVARCHAR(255) NOT NULL,
                accion NVARCHAR(100) NOT NULL,
                objetivo NVARCHAR(255) NULL,
                detalle NVARCHAR(MAX) NULL,
                created_at DATETIME NOT NULL DEFAULT CAST(GETDATE() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Western Standard Time' AS DATETIME)
            );
        END
    `);

    console.log('  Auth schema OK');
}

module.exports = { ensureAuthSchema };
