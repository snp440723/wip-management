// server.js (Node.js Backend)
const express = require('express');
const sql = require('mssql'); 
const cors = require('cors'); 

const app = express();
const port = 3000; 

app.use(cors());

app.use(express.json());


const dbConfig = {
    user: 'sa', // Example: 'SA'
    password: 'sa1234', // Example: 'yourStrongPassword'
    server: 'localhost', // Example: 'localhost' or 'YOUR_SERVER_IP'
    database: 'MaterialDB', // Example: 'MaterialDB'
    options: {
        encrypt: false, // Use true for Azure SQL Database, false for local SQL Server
        trustServerCertificate: true // Set to true for development on local machine / self-signed certs
    }
};

// Create a connection pool to the SQL Server database
let pool;

async function connectToDatabase() {
    try {
        // Attempt to connect to the SQL Server using the configuration from dbConfig
        pool = await new sql.ConnectionPool(dbConfig).connect();
        console.log('✅ Connected to SQL Server database: ' + dbConfig.database);

        // Call initDb to ensure tables exist
        await initDb();

    } catch (err) {
        // Log any errors that occur during database connection
        console.error('❌ Database connection failed:', err);
        // Do not exit here, let the caller (initDb().then().catch()) handle the exit
        throw err; // Re-throw the error so the promise chain can catch it
    }
}

async function initDb() {
    try {
        const request = pool.request();

        // Create RecivesTable for general stock movements (receive and issue)
        // This table will now store both positive quantities (receives) and negative quantities (issues)
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Recives' and xtype='U')
            CREATE TABLE Recives (
                id INT IDENTITY(1,1) PRIMARY KEY,
                sapid NVARCHAR(255),
                description NVARCHAR(255) NOT NULL,
                groupmat NVARCHAR(255),
                qty INT NOT NULL, -- Can be positive for receives, negative for issues
                unit NVARCHAR(50),
                location NVARCHAR(255),
                created_at DATETIME NOT NULL,
                joborder NVARCHAR(255), -- Re-added for issue tracking
                requester_name NVARCHAR(255), -- Re-added for issue tracking
                department NVARCHAR(255) -- Re-added for issue tracking
            );
        `);

        // Ensure sapid column in Recives table allows NULLs
        await request.query(`
            IF EXISTS (SELECT * FROM sys.columns WHERE Name = N'sapid' AND Object_ID = Object_ID(N'Recives'))
            BEGIN
                ALTER TABLE Recives ALTER COLUMN sapid NVARCHAR(255) NULL;
            END;
        `);

        // Add joborder column to Recives table if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'joborder' AND Object_ID = Object_ID(N'Recives'))
            BEGIN
                ALTER TABLE Recives ADD joborder NVARCHAR(255);
            END
        `);

        // Add requester_name column to Recives table if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'requester_name' AND Object_ID = Object_ID(N'Recives'))
            BEGIN
                ALTER TABLE Recives ADD requester_name NVARCHAR(255);
            END
        `);

        // Add department column to Recives table if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'department' AND Object_ID = Object_ID(N'Recives'))
            BEGIN
                ALTER TABLE Recives ADD department NVARCHAR(255);
            END
        `);


        // Create SuppliesTable for consumable supplies (for Accessory Dashboard)
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SuppliesTable' and xtype='U')
            CREATE TABLE SuppliesTable (
                id INT IDENTITY(1,1) PRIMARY KEY,
                sapid NVARCHAR(255) UNIQUE,
                description NVARCHAR(255) NOT NULL UNIQUE,
                qty INT NOT NULL DEFAULT 0,
                unit NVARCHAR(50),
                location NVARCHAR(255),
                ROP INT DEFAULT 0, -- Reorder Point
                created_at DATETIME DEFAULT GETDATE() -- Added created_at for consistency
            );
        `);

        // Create StocksTable for RM, SEMI, FG, COPPER (for individual tags and aggregated dashboard)
        // IMPORTANT: Added is_archived column
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='STOCKS' and xtype='U')
            CREATE TABLE STOCKS (
                [NO.] INT IDENTITY(1,1) PRIMARY KEY,
                SAP_ID NVARCHAR(255) NOT NULL,
                DESCRIPTION NVARCHAR(255) NOT NULL,
                GROUPMAT NVARCHAR(255) NOT NULL,
                Q_TY INT NOT NULL,
                [Unit] NVARCHAR(50) NOT NULL,
                [Location] NVARCHAR(255) NOT NULL,
                created_at DATETIME NOT NULL,
                is_archived BIT DEFAULT 0 -- Added is_archived column
            );
        `);

        // Add is_archived column to STOCKS table if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'is_archived' AND Object_ID = Object_ID(N'STOCKS'))
            BEGIN
                ALTER TABLE STOCKS ADD is_archived BIT DEFAULT 0;
            END
        `);


        // Create PendingRequestsTable for material requests (renamed from RequestHistoryTable)
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PendingRequestsTable' and xtype='U')
            CREATE TABLE PendingRequestsTable (
                [NO.] INT IDENTITY(1,1) PRIMARY KEY, -- Changed 'id' to '[NO.]'
                description NVARCHAR(255) NOT NULL,
                qty INT NOT NULL,
                unit NVARCHAR(50) NOT NULL,
                requester_name NVARCHAR(255) NOT NULL,
                department NVARCHAR(255) NOT NULL,
                request_date DATETIME NOT NULL,
                sapid NVARCHAR(255),
                location NVARCHAR(255),
                status NVARCHAR(50) DEFAULT 'pending' -- New status column
            );
        `);

        // Add sapid column to PendingRequestsTable if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'sapid' AND Object_ID = Object_ID(N'PendingRequestsTable'))
            BEGIN
                ALTER TABLE PendingRequestsTable ADD sapid NVARCHAR(255);
            END
        `);

        // Add location column to PendingRequestsTable if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'location' AND Object_ID = Object_ID(N'PendingRequestsTable'))
            BEGIN
                ALTER TABLE PendingRequestsTable ADD location NVARCHAR(255);
            END
        `);

        // Add status column to PendingRequestsTable if it doesn't exist
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'status' AND Object_ID = Object_ID(N'PendingRequestsTable'))
            BEGIN
                ALTER TABLE PendingRequestsTable ADD status NVARCHAR(50) DEFAULT 'pending';
            END
        `);

        // Removed IssueRecords table creation as per user request to revert

        console.log('Database schema initialized or already exists.');
    } catch (err) {
        console.error('Error initializing database schema:', err);
        throw err; // Re-throw the error so the promise chain can catch it
    }
}


// Call the function to connect to the database when the server starts
connectToDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Backend server running on http://localhost:${port}`);
    });
}).catch(err => {
    console.error('Failed to start backend server due to database connection error:', err);
    process.exit(1); // Exit the process if database connection fails at startup
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    if (pool) {
        try {
            await pool.close();
            console.log('SQL Server connection pool closed.');
        } catch (err) {
            console.error('Error closing SQL Server connection pool:', err);
        }
    }
    process.exit(0);
});


// --- API Endpoints ---

app.post('/api/receive', async (req, res) => {
    const { sapid, description, groupmat, qty, unit, location, created_at } = req.body;

    // Validate incoming data
    if (!sapid || !description || !groupmat || !qty || qty <= 0 || !unit || !location || !created_at) {
        return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง: โปรดระบุ SAP ID, Description, Material Type, Quantity (ต้องมากกว่า 0), Unit, Location และ Created At' });
    }

    const createdAtDate = new Date(created_at);
    if (isNaN(createdAtDate.getTime())) {
        return res.status(400).json({ error:'รูปแบบวันที่ Created At ไม่ถูกต้อง'});
    }

    // Trim whitespace from string inputs to ensure accurate database queries
    const trimmedSapid = sapid.trim();
    const trimmedDescription = description.trim();
    const trimmedLocation = location.trim();
    const trimmedUnit = unit.trim();
    const trimmedGroupmat = groupmat.trim(); // Trim groupmat too

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // 1. Record history in the `Recives` table (only for positive quantities - receives)
        await transaction.request()
            .input('sapid', sql.NVarChar, trimmedSapid)
            .input('description', sql.NVarChar, trimmedDescription)
            .input('groupmat', sql.NVarChar, trimmedGroupmat)
            .input('qty', sql.Int, qty)
            .input('unit', sql.NVarChar, trimmedUnit)
            .input('location', sql.NVarChar, trimmedLocation)
            .input('created_at', sql.DateTime, createdAtDate)
            .input('joborder', sql.NVarChar, null) // Set null for receives
            .input('requester_name', sql.NVarChar, null) // Set null for receives
            .input('department', sql.NVarChar, null) // Set null for receives
            .query(`INSERT INTO Recives (sapid, description, groupmat, qty, unit, location, created_at, joborder, requester_name, department)
                    VALUES (@sapid, @description, @groupmat, @qty, @unit, @location, @created_at, @joborder, @requester_name, @department)`);

        // 2. If material group is RM, Semi, FG, or COPPER, update/insert into `STOCKS` table
        if (['RM', 'SEMI', 'FG', 'COPPEP'].includes(trimmedGroupmat.toUpperCase())) { // Changed 'COPPER' to 'COPPEP' to match frontend
            // Check if an active stock record exists with the same SAP_ID, Description, Unit, and Location
            const checkExistingStock = await transaction.request()
                .input('sapid', sql.NVarChar, trimmedSapid)
                .input('description', sql.NVarChar, trimmedDescription)
                .input('unit', sql.NVarChar, trimmedUnit)
                .input('location', sql.NVarChar, trimmedLocation)
                .query(`
                    SELECT [NO.] AS id, Q_TY, is_archived
                    FROM STOCKS
                    WHERE RTRIM(LTRIM(SAP_ID)) = @sapid
                        AND RTRIM(LTRIM(DESCRIPTION)) = @description
                        AND RTRIM(LTRIM([Unit])) = @unit
                        AND RTRIM(LTRIM([Location])) = @location
                `);

            if (checkExistingStock.recordset.length > 0) {
                const existingStock = checkExistingStock.recordset[0];
                // If an existing record is found, update its quantity and unarchive it if it was archived
                await transaction.request()
                    .input('id', sql.Int, existingStock.id)
                    .input('qtyToAdd', sql.Int, qty)
                    .query(`
                        UPDATE STOCKS
                        SET Q_TY = Q_TY + @qtyToAdd,
                            is_archived = 0 -- Unarchive if it was previously archived
                        WHERE [NO.] = @id
                    `);
            } else {
                // If no existing stock record was found, insert a new one
                await transaction.request()
                    .input('sapid', sql.NVarChar, trimmedSapid)
                    .input('description', sql.NVarChar, trimmedDescription)
                    .input('qty', sql.Int, qty)
                    .input('unit', sql.NVarChar, trimmedUnit)
                    .input('location', sql.NVarChar, trimmedLocation)
                    .input('rop', sql.Int, 2) // Default ROP (Reorder Point)
                    .input('created_at', sql.DateTime, createdAtDate) // Use provided created_at for consistency
                    .input('groupmat', sql.NVarChar, trimmedGroupmat)
                    .query(`
                        INSERT INTO STOCKS (SAP_ID, DESCRIPTION, Q_TY, [Unit], [Location], ROP, created_at, GROUPMAT, is_archived)
                        VALUES (@sapid, @description, @qty, @unit, @location, @rop, @created_at, @groupmat, 0) -- New tags are not archived
                    `);
            }
        }
        // 3. If material group is 'รายการของสิ้นเปลือง', update/insert into `SuppliesTable`
        else if (trimmedGroupmat === 'รายการของสิ้นเปลือง') {
            // ✅ ตรวจสอบจาก SAP ID + DESCRIPTION + UNIT
            const checkExistResult = await transaction.request()
                .input('sapid', sql.NVarChar, trimmedSapid)
                .input('description', sql.NVarChar, trimmedDescription)
                .input('unit', sql.NVarChar, trimmedUnit)
                .query(`
                    SELECT TOP 1 * FROM SuppliesTable
                    WHERE RTRIM(LTRIM(SAP_ID)) = @sapid
                    AND RTRIM(LTRIM(DESCRIPTION)) = @description
                    AND RTRIM(LTRIM([Unit])) = @unit
                `);

            const existing = checkExistResult.recordset[0];

            if (existing) {
        // ✅ รวม QTY + อัปเดต LOCATION + เก็บ ROP เดิมไว้
                await transaction.request()
                    .input('sapid', sql.NVarChar, trimmedSapid)
                    .input('description', sql.NVarChar, trimmedDescription)
                    .input('unit', sql.NVarChar, trimmedUnit)
                    .input('qty', sql.Int, qty)
                    .input('location', sql.NVarChar, trimmedLocation)
                    .query(`
                        UPDATE SuppliesTable
                        SET
                            Q_TY = ISNULL(Q_TY, 0) + @qty,
                            [Location] = @location,
                            [created_at] = GETDATE()
                        WHERE RTRIM(LTRIM(SAP_ID)) = @sapid
                        AND RTRIM(LTRIM(DESCRIPTION)) = @description
                        AND RTRIM(LTRIM([Unit])) = @unit
                    `);
            } else {
                // ✅ เพิ่มใหม่พร้อม ROP = 2 (หรือค่าที่กำหนด)
                await transaction.request()
                    .input('sapid', sql.NVarChar, trimmedSapid)
                    .input('description', sql.NVarChar, trimmedDescription)
                    .input('qty', sql.Int, qty)
                    .input('unit', sql.NVarChar, trimmedUnit)
                    .input('location', sql.NVarChar, trimmedLocation)
                    .input('rop', sql.Int, 2)
                    .query(`
                        INSERT INTO SuppliesTable (SAP_ID, DESCRIPTION, Q_TY, [Unit], [Location], ROP, created_at)
                        VALUES (@sapid, @description, @qty, @unit, @location, @rop, GETDATE())
                    `);
            }
        }
        await transaction.commit(); // Commit the transaction if all operations are successful
        res.status(200).json({ message: 'บันทึกสำเร็จ' });

    } catch (err) {
        await transaction.rollback(); // Rollback the transaction if any error occurs
        console.error('❌ SQL Error in /api/receive:', err);
        res.status(500).send(`บันทึกล้มเหลว: ${err.message}`);
    }
});


/**
 * Endpoint to get aggregated stock data from the `STOCKS` table.
 * Aggregates by `SAP ID`, `DESCRIPTION`, `Unit`, and `Location`.
 */
app.get('/api/stock', async (req, res) => {
    try {
        if (!pool) { // Ensure database connection pool is active
            return res.status(500).send('Database not connected.');
        }
        const request = pool.request(); // Create a new request object
        const result = await request.query(`
            SELECT
                RTRIM(LTRIM(SAP_ID)) AS SAP_ID,
                MAX(RTRIM(LTRIM(DESCRIPTION))) AS DESCRIPTION, -- Use MAX to pick one description per group
                RTRIM(LTRIM([Unit])) AS UNIT,
                RTRIM(LTRIM([Location])) AS LOCATION,
                SUM(Q_TY) AS Q_TY,
                RTRIM(LTRIM(GROUPMAT)) AS GROUPMAT -- Include GROUPMAT for filtering on frontend
            FROM STOCKS
            WHERE is_archived = 0 -- Only show active (non-archived) stocks
            GROUP BY RTRIM(LTRIM(SAP_ID)), RTRIM(LTRIM([Unit])), RTRIM(LTRIM([Location])), RTRIM(LTRIM(GROUPMAT))
            ORDER BY RTRIM(LTRIM(SAP_ID)), RTRIM(LTRIM([Unit])), RTRIM(LTRIM([Location]))
        `);

        console.log("Backend sending Stock Dashboard data:", result.recordset);
        res.json(result.recordset);
    }
    catch (err) {
        console.error('Error fetching stock data:', err);
        res.status(500).json({ error: `เกิดข้อผิดพลาดในการดึงข้อมูลสต็อก: ${err.message}` });

    }
});

/**
 * Endpoint to get all individual stock data from the `STOCKS` table (non-aggregated).
 * This is used for displaying individual tags on the Receive page.
 */
app.get('/api/stock/raw', async (req, res) => {
    console.log('Received request for /api/stock/raw'); // Debugging log
    try {
        if (!pool) { // Ensure database connection pool is active
            return res.status(500).send('Database not connected.');
        }
        const request = pool.request();
        // Select all relevant columns for individual tags, aliasing [NO.] to 'id'
        const result = await request.query(`
            SELECT
                [NO.] as id,
                RTRIM(LTRIM(SAP_ID)) AS SAP_ID,
                RTRIM(LTRIM(DESCRIPTION)) AS DESCRIPTION,
                Q_TY,
                RTRIM(LTRIM([Unit])) AS UNIT,
                RTRIM(LTRIM([Location])) AS LOCATION,
                created_at,
                RTRIM(LTRIM(groupmat)) AS GROUPMAT,
                is_archived -- Include is_archived
            FROM STOCKS
            ORDER BY created_at DESC
        `);
        console.log("Backend sending Raw Stock data for tags:", result.recordset);
        res.json(result.recordset);
    }
    catch (err) {
        console.error('Error fetching raw stock data:', err);
        res.status(500).send(`เกิดข้อผิดพลาดในการดึงข้อมูลสต็อกดิบ: ${err.message}`);
    }
});

/**
 * NEW ENDPOINT: Archives a stock tag by setting is_archived to 1 and Q_TY to 0.
 * This directly supports the frontend's "✖" button functionality.
 */
app.put('/api/stocks/archive/:id', async (req, res) => {
    const tagId = parseInt(req.params.id);

    if (isNaN(tagId) || tagId <= 0) {
        return res.status(400).json({ message: 'ID แท็กไม่ถูกต้องสำหรับการซ่อน', error: 'Invalid tag ID' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        const updateResult = await transaction.request()
            .input('tagId', sql.Int, tagId)
            .query(`
                UPDATE STOCKS
                SET Q_TY = 0, is_archived = 1
                WHERE [NO.] = @tagId
            `);

        if (updateResult.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: 'ไม่พบแท็กที่ต้องการซ่อน', error: 'Tag not found' });
        }

        await transaction.commit();
        res.status(200).json({ message: `ซ่อนแท็ก ID ${tagId} สำเร็จ` });

    } catch (err) {
        await transaction.rollback();
        console.error('SQL Transaction error during tag archiving:', err);
        res.status(500).json({ message: `เกิดข้อผิดพลาดในการซ่อนแท็ก: ${err.message}`, error: err.message });
    }
});

app.put('/api/stocks/hide-tag/:id', async (req, res) => {
    const tagId = parseInt(req.params.id);

    if (isNaN(tagId) || tagId <= 0) {
        return res.status(400).json({ message: 'ID แท็กไม่ถูกต้องสำหรับการซ่อน', error: 'Invalid tag ID' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        const updateResult = await transaction.request()
            .input('tagId', sql.Int, tagId)
            .query(`
                UPDATE STOCKS
                SET is_archived = 1
                WHERE [NO.] = @tagId
            `);

        if (updateResult.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: 'ไม่พบแท็กที่ต้องการซ่อน', error: 'Tag not found' });
        }

        await transaction.commit();
        res.status(200).json({ message: `ซ่อนแท็ก ID ${tagId} จากหน้าจอสำเร็จ (สต็อกคงเดิม)` });

    } catch (err) {
        await transaction.rollback();
        console.error('SQL Transaction error during tag hiding (no qty change):', err);
        res.status(500).json({ message: `เกิดข้อผิดพลาดในการซ่อนแท็ก: ${err.message}`, error: err.message });
    }
});



app.put('/api/stocks/update-qty', async (req, res) => {
    const { id, newQty, sapid, description, groupmat, unit, location } = req.body;

    // Validate input parameters
    if (isNaN(parseInt(id)) || parseInt(id) <= 0 || typeof newQty !== 'number' || newQty < 0) {
        return res.status(400).json({ message: 'ID หรือ จำนวนใหม่ไม่ถูกต้องสำหรับการอัปเดตสต็อก', error: 'Invalid input' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // 1. Retrieve the current quantity of the stock item using its ID ([NO.])
        const currentQtyResult = await transaction.request()
            .input('id', sql.Int, id)
            .query(`SELECT Q_TY FROM STOCKS WHERE [NO.] = @id`);

        // If the stock item is not found, rollback and send 404
        if (currentQtyResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: 'ไม่พบรายการสต็อกที่จะแก้ไข', error: 'Stock item not found' });
        }

        const oldQty = currentQtyResult.recordset[0].Q_TY || 0; // Default to 0 if Q_TY is null

        // 2. Handle archiving if new quantity is 0 or less
        if (newQty <= 0) {
            await transaction.request()
                .input('id', sql.Int, id)
                .input('newQty', sql.Int, 0) // Ensure Q_TY is 0
                .query(`UPDATE STOCKS SET Q_TY = @newQty, is_archived = 1 WHERE [NO.] = @id`); // Archive the record
            await transaction.commit();
            return res.status(200).json({ message: 'อัปเดตจำนวนสต็อกเป็น 0 และซ่อนแท็กแล้ว' });
        }

        // 3. Handle splitting into a new tag if new quantity is less than the old quantity
        if (newQty < oldQty) {
            const remainingQty = oldQty - newQty;

            // Update the quantity of the original tag
            await transaction.request()
                .input('id', sql.Int, id)
                .input('newQty', sql.Int, newQty)
                .query(`UPDATE STOCKS SET Q_TY = @newQty WHERE [NO.] = @id`);

            // Insert a new tag for the remaining quantity
            await transaction.request()
                .input('sapid', sql.NVarChar, sapid)
                .input('description', sql.NVarChar, description)
                .input('qty', sql.Int, remainingQty)
                .input('unit', sql.NVarChar, unit)
                .input('location', sql.NVarChar, location)
                .input('rop', sql.Int, 2) // Default ROP for the new tag
                .input('created_at', sql.DateTime, new Date()) // Use current date for the new split tag
                .input('groupmat', sql.NVarChar, groupmat)
                .query(`
                    INSERT INTO STOCKS (SAP_ID, DESCRIPTION, Q_TY, [Unit], [Location], ROP, created_at, GROUPMAT, is_archived)
                    VALUES (@sapid, @description, @qty, @unit, @location, @rop, @created_at, @groupmat, 0) -- New split tags are not archived
                `);

            await transaction.commit();
            return res.status(200).json({ message: 'อัปเดตและแยกแท็กใหม่สำเร็จ' });
        }

        // 4. Handle normal update (newQty is greater than or equal to oldQty)
        await transaction.request()
            .input('id', sql.Int, id)
            .input('newQty', sql.Int, newQty)
            .query(`UPDATE STOCKS SET Q_TY = @newQty WHERE [NO.] = @id`);

        await transaction.commit();
        return res.status(200).json({ message: 'อัปเดตจำนวนสต็อกสำเร็จ' });

    } catch (err) {
        await transaction.rollback(); // Rollback if any error occurs during the transaction
        console.error('SQL Transaction error during stock quantity update:', err);
        res.status(500).json({ message: `เกิดข้อผิดพลาดในการทำรายการแก้ไขสต็อก: ${err.message}`, error: err.message });
    }
});



app.get('/api/supplies-dashboard', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).send('Database not connected.');
        }
        const request = pool.request(); // Create a new request object
        const result = await request.query(`
            SELECT
                RTRIM(LTRIM(SAP_ID)) AS SAP_ID,
                MIN(RTRIM(LTRIM(DESCRIPTION))) AS DESCRIPTION, -- Using MIN as description should be consistent per SAP_ID/Unit
                RTRIM(LTRIM([Unit])) AS UNIT,
                SUM(Q_TY) AS Q_TY,
                MIN(RTRIM(LTRIM([Location]))) AS LOCATION, -- Using MIN as location should be consistent per SAP_ID/Unit
                MAX(ROP) AS ROP -- Using MAX as ROP should be consistent per SAP_ID/Unit
            FROM SuppliesTable
            GROUP BY RTRIM(LTRIM(SAP_ID)), RTRIM(LTRIM([Unit]))
            ORDER BY RTRIM(LTRIM(SAP_ID)), RTRIM(LTRIM([Unit]))
        `);
        console.log("Backend sending Supplies Dashboard data:", result.recordset);
        res.json(result.recordset);
    }
    catch (err) {
        console.error("Error fetching Supplies Dashboard data:", err);
        res.status(500).send(`เกิดข้อผิดพลาดในการดึงข้อมูลรายการของสิ้นเปลือง: ${err.message}`);
    }
});


app.put('/api/supplies/:id', async (req, res) => {
    const { id } = req.params; // The primary key 'id' of the SuppliesTable entry
    const { qtyChange } = req.body; // The amount to add or subtract

    // Validate input parameters
    if (isNaN(parseInt(id)) || parseInt(id) <= 0 || typeof qtyChange !== 'number') {
        res.status(400).json({ error: 'โอนย้ายล้มเหลว: วัสดุคงเหลือไม่เพียงพอ' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // 1. Get current quantity of the item
        const currentQtyResult = await transaction.request()
            .input('id', sql.Int, id)
            .query(`SELECT Q_TY FROM SuppliesTable WHERE id = @id`);

        if (currentQtyResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).send('ไม่พบรายการของสิ้นเปลืองที่จะแก้ไข');
        }

        const currentQty = currentQtyResult.recordset[0].Q_TY || 0;
        const newQty = currentQty + qtyChange;

        // Prevent negative stock
        if (newQty < 0) {
            await transaction.rollback();
            return res.status(400).send(`ไม่สามารถลดจำนวนได้ต่ำกว่า 0. สต็อกปัจจุบัน: ${currentQty}`);
        }

        // 2. Update the quantity
        const updateResult = await transaction.request()
            .input('id', sql.Int, id)
            .input('newQty', sql.Int, newQty)
            .query(`
                UPDATE SuppliesTable
                SET Q_TY = @newQty
                WHERE id = @id
            `);

        if (updateResult.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).send('ไม่พบรายการของสิ้นเปลืองที่จะแก้ไข (หลังการตรวจสอบ)');
        }

        await transaction.commit();
        res.status(200).send('แก้ไขจำนวนสำเร็จ');

    } catch (err) {
        await transaction.rollback();
        console.error("SQL Transaction error during supplies update:", err);
        res.status(500).send(`เกิดข้อผิดพลาดในการทำรายการแก้ไขรายการของสิ้นเปลือง: ${err.message}`);
    }
});


app.post('/api/transfer-deduct-stock', async (req, res) => {
    const { date, sapid, description, qty, unit, partfg, joborder, location } = req.body;

    if (!date || !sapid || !description || !qty || qty <= 0 || !unit || !joborder || !location) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง: โปรดระบุ Date, SAP ID, ...' });
    }

    const trimmedSapid = sapid.trim();
    const trimmedDescription = description.trim();
    const trimmedLocation = location.trim();
    const trimmedUnit = unit.trim();
    const transferDate = new Date(date);

    if (isNaN(transferDate.getTime())) {
        return res.status(400).json({ success: false, message: 'รูปแบบวันที่ Date ไม่ถูกต้อง' });

    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        let currentLiveStock = null;
        let targetTable = null;
        let itemSapid = trimmedSapid;
        let itemLocation = trimmedLocation;
        let itemUnit = trimmedUnit;
        let itemGroupmat = ''; // To store the groupmat for Recives table

        // 1. Try to find the item in STOCKS first by SAP ID, Unit and Location
        const checkStocks = await transaction.request()
            .input('sapid', sql.NVarChar, itemSapid)
            .input('unit', sql.NVarChar, itemUnit)
            .input('location', sql.NVarChar, itemLocation)
            .query(`SELECT TOP 1 [NO.] AS id, Q_TY AS Q_TY, SAP_ID AS SAP_ID, [Unit] AS Unit, GROUPMAT FROM STOCKS WHERE RTRIM(LTRIM(SAP_ID)) = @sapid AND RTRIM(LTRIM([Unit])) = @unit AND RTRIM(LTRIM([Location])) = @location AND is_archived = 0 ORDER BY created_at ASC`); // Only consider active stocks

        if (checkStocks.recordset.length > 0) {
            currentLiveStock = checkStocks.recordset[0].Q_TY;
            targetTable = 'STOCKS';
            itemSapid = checkStocks.recordset[0].SAP_ID;
            itemUnit = checkStocks.recordset[0].Unit;
            itemGroupmat = checkStocks.recordset[0].GROUPMAT; // Get groupmat from STOCKS
        } else {
            // 2. If not in STOCKS, try to find in SuppliesTable by SAP ID, Description and Unit
            const checkSupplies = await transaction.request()
                .input('sapid', sql.NVarChar, itemSapid)
                .input('description', sql.NVarChar, trimmedDescription)
                .input('unit', sql.NVarChar, itemUnit)
                .query(`SELECT TOP 1 id, Q_TY AS Q_TY, SAP_ID AS SAP_ID, [Unit] AS Unit FROM SuppliesTable WHERE RTRIM(LTRIM(SAP_ID)) = @sapid AND RTRIM(LTRIM(DESCRIPTION)) = @description AND RTRIM(LTRIM([Unit])) = @unit`);

            if (checkSupplies.recordset.length > 0) {
                currentLiveStock = checkSupplies.recordset[0].Q_TY;
                targetTable = 'SuppliesTable';
                itemSapid = checkSupplies.recordset[0].SAP_ID;
                itemUnit = checkSupplies.recordset[0].Unit;
                itemGroupmat = 'รายการของสิ้นเปลือง'; // Explicitly set for SuppliesTable
            }
        }

        // Check if item was found in either table
        if (targetTable === null) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบวัสดุในสต็อก' });

        }

        // Check for sufficient stock
        if (currentLiveStock < qty) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: `โอนย้ายล้มเหลว: วัสดุคงเหลือไม่เพียงพอ (มีอยู่: ${currentLiveStock} ${itemUnit}, ต้องการ: ${qty} ${itemUnit})` });
        }

        // Deduct stock based on the target table
        if (targetTable === 'STOCKS') {
            // Find the specific tag to deduct from (oldest first, or by location if multiple tags exist at location)
            // For simplicity, let's deduct from the first active tag found matching criteria
            const getTagToDeduct = await transaction.request()
                .input('sapid', sql.NVarChar, itemSapid)
                .input('unit', sql.NVarChar, itemUnit)
                .input('location', sql.NVarChar, itemLocation)
                .query(`SELECT TOP 1 [NO.] AS id, Q_TY FROM STOCKS WHERE RTRIM(LTRIM(SAP_ID)) = @sapid AND RTRIM(LTRIM([Unit])) = @unit AND RTRIM(LTRIM([Location])) = @location AND is_archived = 0 ORDER BY created_at ASC`);

            if (getTagToDeduct.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: 'ไม่พบแท็กสต็อกที่ใช้งานอยู่สำหรับหักลบ' });

            }

            const tagIdToUpdate = getTagToDeduct.recordset[0].id;
            const tagCurrentQty = getTagToDeduct.recordset[0].Q_TY;

            if (tagCurrentQty < qty) {
                 // This case should ideally be caught by the overall currentLiveStock check,
                 // but good to have a specific check for the chosen tag.
                await transaction.rollback();
                return res.status(400).json({ success: false, message: `โอนย้ายล้มเหลว: จำนวนในแท็กไม่เพียงพอ (มีอยู่: ${tagCurrentQty} ${itemUnit}, ต้องการ: ${qty} ${itemUnit})` });
            }

            const newTagQty = tagCurrentQty - qty;

            if (newTagQty === 0) {
                // If quantity becomes 0, archive the tag
                await transaction.request()
                    .input('tagId', sql.Int, tagIdToUpdate)
                    .query(`UPDATE STOCKS SET Q_TY = 0, is_archived = 1 WHERE [NO.] = @tagId`);
            } else {
                // Otherwise, just update the quantity
                await transaction.request()
                    .input('tagId', sql.Int, tagIdToUpdate)
                    .input('newQty', sql.Int, newTagQty)
                    .query(`UPDATE STOCKS SET Q_TY = @newQty WHERE [NO.] = @tagId`);
            }

        } else if (targetTable === 'SuppliesTable') {
            // Deduct from SuppliesTable
            await transaction.request()
                .input('sapid', sql.NVarChar, itemSapid)
                .input('description', sql.NVarChar, trimmedDescription)
                .input('unit', sql.NVarChar, itemUnit)
                .input('qtyToDeduct', sql.Int, qty)
                .query(`
                    UPDATE SuppliesTable
                    SET Q_TY = Q_TY - @qtyToDeduct
                    WHERE RTRIM(LTRIM(SAP_ID)) = @sapid
                    AND RTRIM(LTRIM(DESCRIPTION)) = @description
                    AND RTRIM(LTRIM([Unit])) = @unit
                `);
        }

        await transaction.request()
            .input('sapid', sql.NVarChar, trimmedSapid)
            .input('description', sql.NVarChar, trimmedDescription)
            .input('groupmat', sql.NVarChar, itemGroupmat) // Use the determined groupmat
            .input('qty', sql.Int, -qty) // Store as negative for issues
            .input('unit', sql.NVarChar, trimmedUnit)
            .input('location', sql.NVarChar, trimmedLocation)
            .input('created_at', sql.DateTime, transferDate)
            .input('joborder', sql.NVarChar, joborder)
            .input('requester_name', sql.NVarChar, req.body.requester_name || null) // Add requester_name if available
            .input('department', sql.NVarChar, req.body.department || null) // Add department if available
            .query(`INSERT INTO Recives (sapid, description, groupmat, qty, unit, location, created_at, joborder, requester_name, department)
                    VALUES (@sapid, @description, @groupmat, @qty, @unit, @location, @created_at, @joborder, @requester_name, @department)`);

        await transaction.commit();
        res.status(200).json({ success: true, message: 'เบิกวัสดุสำเร็จ' });

    } catch (err) {
        await transaction.rollback();
        console.error('SQL Transaction error during stock transfer/deduction:', err);
        res.status(500).json({ success: false, message: `เบิกวัสดุล้มเหลว: ${err.message}` });

    }
});


app.get('/api/all-recives', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).send('Database not connected.');
        }
        const request = pool.request();
        const result = await request.query(`
            SELECT
                id,
                RTRIM(LTRIM(sapid)) AS sapid,
                RTRIM(LTRIM(description)) AS description,
                RTRIM(LTRIM(groupmat)) AS groupmat,
                qty,
                RTRIM(LTRIM(unit)) AS unit,
                RTRIM(LTRIM(location)) AS location,
                created_at,
                RTRIM(LTRIM(joborder)) AS joborder,
                RTRIM(LTRIM(requester_name)) AS requester_name,
                RTRIM(LTRIM(department)) AS department
            FROM Recives
            ORDER BY created_at DESC
        `);
        res.json(result.recordset);
    }
    catch (err) {
        console.error("Error fetching all recives data:", err);
        res.status(500).send(`เกิดข้อผิดพลาดในการดึงประวัติการรับ/เบิก: ${err.message}`);
    }
});

app.post('/api/request-material', async (req, res) => {
    const { description, qty, unit, requester_name, department, request_date, sapid, location } = req.body;

    if (!description || !qty || qty <= 0 || !unit || !requester_name || !department || !request_date) {
        return res.status(400).json({ error: 'ข้อมูลคำขอไม่ครบถ้วนหรือไม่ถูกต้อง: โปรดระบุ Description, Quantity (ต้องมากกว่า 0), Unit, Requester Name, Department และ Request Date' });
    }

    const requestDateObj = new Date(request_date);
    if (isNaN(requestDateObj.getTime())) {
        return res.status(400).json({ error: 'รูปแบบวันที่ Request Date ไม่ถูกต้อง' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // Use null for optional fields if they are empty strings or undefined
        // IMPORTANT FIX: Explicitly check for null before trimming
        const finalSapid = (sapid === null || sapid === undefined || sapid === '') ? null : sapid.trim();
        const finalLocation = (location === null || location === undefined || location === '') ? null : location.trim();

        await transaction.request()
            .input('description', sql.NVarChar, (description || '').trim()) // Added || '' for robustness
            .input('qty', sql.Int, qty)
            .input('unit', sql.NVarChar, (unit || '').trim()) // Added || '' for robustness
            .input('requester_name', sql.NVarChar, (requester_name || '').trim()) // Added || '' for robustness
            .input('department', sql.NVarChar, (department || '').trim()) // Added || '' for robustness
            .input('request_date', sql.DateTime, requestDateObj)
            .input('sapid', sql.NVarChar, finalSapid)
            .input('location', sql.NVarChar, finalLocation)
            .input('status', sql.NVarChar, 'pending') // Default status
            .query(`
                INSERT INTO PendingRequestsTable (description, qty, unit, requester_name, department, request_date, sapid, location, status)
                VALUES (@description, @qty, @unit, @requester_name, @department, @request_date, @sapid, @location, @status)
            `);

        await transaction.commit();
        res.status(200).json({ message: 'ส่งคำขอวัสดุสำเร็จ!' });

    } catch (err) {
        await transaction.rollback();
        console.error('SQL Transaction error during material request:', err);
        res.status(500).json({ message: `ส่งคำขอวัสดุล้มเหลว: ${err.message}`, error: err.message });
    }
});


/**
 * Endpoint to get all pending and processed requests from `PendingRequestsTable`.
 */
app.get('/api/pending-requests', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).send('Database not connected.');
        }
        const request = pool.request();
        const result = await request.query(`
            SELECT
                [NO.] AS id, -- Alias [NO.] to 'id' for frontend compatibility
                RTRIM(LTRIM(description)) AS description,
                qty,
                RTRIM(LTRIM(unit)) AS unit,
                RTRIM(LTRIM(requester_name)) AS requester_name,
                RTRIM(LTRIM(department)) AS department,
                request_date,
                RTRIM(LTRIM(sapid)) AS sapid,
                RTRIM(LTRIM(location)) AS location,
                RTRIM(LTRIM(status)) AS status
            FROM PendingRequestsTable
            ORDER BY request_date DESC
        `);
        res.json(result.recordset);
    }
    catch (err) {
        console.error("Error fetching pending requests:", err);
        res.status(500).send(`เกิดข้อผิดพลาดในการดึงรายการคำขอ: ${err.message}`);
    }
});

/**
 * Endpoint to process a material request (mark as processed and potentially update quantity).
 * Also records the issue in the `Recives` table.
 *
 * Expected Request Body (JSON):
 * {
 * "requestId": "number" (the [NO.] of the request),
 * "newQty": "number" (optional, if the quantity is being adjusted during processing)
 * }
 */
app.post('/api/requests/process-issue', async (req, res) => {
    const { requestId, newQty } = req.body;

    if (isNaN(parseInt(requestId)) || parseInt(requestId) <= 0) {
        return res.status(400).json({ error: 'ID คำขอไม่ถูกต้อง' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // 1. Get request details
        const requestDetailsResult = await transaction.request()
            .input('requestId', sql.Int, requestId)
            .query(`SELECT description, qty, unit, requester_name, department, sapid, location FROM PendingRequestsTable WHERE [NO.] = @requestId AND status = 'pending'`);

        if (requestDetailsResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: 'ไม่พบคำขอที่รอดำเนินการหรือถูกดำเนินการไปแล้ว' });
        }

        const requestDetails = requestDetailsResult.recordset[0];
        const actualQtyToIssue = (newQty !== undefined && newQty > 0) ? newQty : requestDetails.qty;

        if (actualQtyToIssue <= 0) {
            await transaction.rollback();
            return res.status(400).json({ message: 'จำนวนที่ต้องการเบิกต้องมากกว่า 0' });
        }

         // 2.1 Get SAP_ID, Location, Unit from SuppliesTable by description
        const supplyLookupResult = await transaction.request()
            .input('description', sql.NVarChar, requestDetails.description)
            .query(`
                SELECT TOP 1 SAP_ID, Location, Unit
                FROM SuppliesTable
                WHERE DESCRIPTION = @description
            `);

        if (supplyLookupResult.recordset.length === 0) {
            throw new Error(`ไม่พบวัสดุใน SuppliesTable ที่ตรงกับ: ${requestDetails.description}`);
        }

        const { SAP_ID, Location, Unit } = supplyLookupResult.recordset[0];

        // 2.2 หักสต๊อกจาก SuppliesTable
        await transaction.request()
            .input('sapid', sql.NVarChar, SAP_ID)
            .input('location', sql.NVarChar, Location)
            .input('unit', sql.NVarChar, Unit)
            .input('deductQty', sql.Int, actualQtyToIssue)
            .query(`
                UPDATE SuppliesTable
                SET Q_TY = Q_TY - @deductQty
                WHERE SAP_ID = @sapid AND Location = @location AND Unit = @unit AND Q_TY >= @deductQty
            `);

        // 3. Record the issue in Recives table (as a negative quantity)
        await transaction.request()
            .input('sapid', sql.NVarChar, SAP_ID)
            .input('description', sql.NVarChar, requestDetails.description)
            .input('groupmat', sql.NVarChar, 'FROM_REQUEST')
            .input('qty', sql.Int, -actualQtyToIssue)
            .input('unit', sql.NVarChar, Unit)
            .input('location', sql.NVarChar, Location)
            .input('created_at', sql.DateTime, new Date())
            .input('joborder', sql.NVarChar, 'FROM_REQUEST')
            .input('requester_name', sql.NVarChar, requestDetails.requester_name)
            .input('department', sql.NVarChar, requestDetails.department)
            .query(`
                INSERT INTO Recives (sapid, description, groupmat, qty, unit, location, created_at, joborder, requester_name, department)
                VALUES (@sapid, @description, @groupmat, @qty, @unit, @location, @created_at, @joborder, @requester_name, @department)
            `);

        // 4. Update request status
        await transaction.request()
            .input('requestId', sql.Int, requestId)
            .input('actualQtyToIssue', sql.Int, actualQtyToIssue)
            .query(`
                UPDATE PendingRequestsTable
                SET status = 'processed', qty = @actualQtyToIssue
                WHERE [NO.] = @requestId
            `);

        await transaction.commit();
        res.status(200).json({ message: 'ดำเนินการคำขอและเบิกสต็อกสำเร็จ!' });

    } catch (err) {
        await transaction.rollback();
        console.error('❌ SQL Error in /api/requests/process-issue:', err);
        res.status(500).json({ message: `ดำเนินการคำขอล้มเหลว: ${err.message}`, error: err.message });
    }
});


/**
 * Endpoint to get all unique descriptions from STOCKS and SuppliesTable for datalist suggestions.
 */
app.get('/api/descriptions', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).send('Database not connected.');
        }
        const request = pool.request();
        const result = await request.query(`
            SELECT DISTINCT RTRIM(LTRIM(DESCRIPTION)) AS DESCRIPTION FROM STOCKS
            UNION
            SELECT DISTINCT RTRIM(LTRIM(DESCRIPTION)) AS DESCRIPTION FROM SuppliesTable;
        `);
        const descriptions = result.recordset.map(row => row.DESCRIPTION);
        res.json(descriptions);
    }
    catch (err) {
        console.error("Error fetching descriptions for datalist:", err);
        res.status(500).send(`เกิดข้อผิดพลาดในการดึงรายการคำอธิบาย: ${err.message}`);
    }
});
