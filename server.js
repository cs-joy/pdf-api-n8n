const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const path = require("path");
const { stat } = require("fs");
const { error } = require("console");

const app = express();

const port = 9999;

// Configure Middleware
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed', false));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB limits
    }
});

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || "9999",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "password",
    database: process.env.DB_NAME || "pdfdb"
};

// Create PostgreSQL connection pool
const pool = new Pool(dbConfig);

// Test database connection
pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.log('Database connection error: ', err)
})

// GET method -> to check if api is running or not
app.get('/status', async (req, res) => {
    res.json({
        status: 'running',
        message: 'PDF API is running succesfully',
        timestamp: new Date().toISOString(),
        database: 'connected'
    });

    try {
        // Test database connection
        const client = await pool.connect();
        const dbResult = await client.query('SELECT NOW() as current_time');
        client.release();

        res.json({
            status: 'running',
            message: 'PDF API is running successfully',
            timestamp: new Date().toISOString(),
            database: {
                status: 'connected',
                current_time: dbResult.rows[0].current_time
            }
        });
    } catch (error) {
        res.json({
            status: 'running',
            message: 'PDF API is running but database connection failed',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message
        });
    }
});

// PST -> upload pdf file to our database
app.post('/upload', upload.single('pdf'), async (req, res) => {
    let client;
    try {
        console.log('Upload endpoint hit');
        console.log('Request file: ', req.file ? 'File received' : 'No file');
        console.log('Request body: ', req.body);

        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded. Make sure to use form-data with field name "pdf"' });
        }

        const { originalname, buffer, mimetype, size } = req.file;

        console.log(`File details: ${originalname}, ${mimetype}, ${size} bytes`);

        if (mimetype !== 'application/pdf') {
            return res.status(400).json({ error: 'Only PDF files are allowed' });
        }

        const query = `
            INSERT INTO pdf_files (filename, file_data) 
            VALUES ($1, $2) 
            RETURNING id, filename, uploaded_at
        `;

        // Get a result from the pool
        client = await pool.connect();

        const result = await client.query(query, [originalname, buffer]);

        console.log('PDF uploaded successfully with ID: ', result.rows[0].id);

        res.json({
            message: 'PDF uploaded successfully',
            file: {
                id: result.rows[0].id,
                filename: result.rows[0].filename,
                uploaded_at: result.rows[0].uploaded_at,
                size: size
            }
        });

    } catch (error) {
        console.error('Upload error details:', error);
        res.status(500).json({ error: 'Failed to upload PDF', details: error.message });
    } finally {
        // Always release the client back to the pool
        if (client) {
            client.release();
        }
    }
});



// GET method -> download pdf file from database using the specific id
app.get('/download/:id', async (req, res) => {
    let client;
    try {
        const fileId = parseInt(req.params.id);

        if (isNaN(fileId)) {
            return res.status(400).json({
                error: 'Invalid file ID'
            });
        }

        const query = `SELECT filename, file_data FROM pdf_files WHERE id = $1`;

        client = await pool.connect();

        const result = await client.query(query, [fileId]);

        if (result.rows.length == 0) {
            return res.status(400).json({
                error: 'File not found!'
            });
        }

        const { filename, file_data } = result.rows[0];

        // Set headers for file download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', file_data.length);

        // Send the file buffer
        res.send(file_data);

        res.json({
            files: result.rows
        });
    } catch (error) {
        console.log('Download error: ', error);
        res.status(500).json({
            error: 'Failed to downlaod PDF'
        });
    } finally {
        if (client) client.release();
    }
});

// GET -> 
app.get('/files', async (req, res) => {
    let client;
    try {
        const query = `SELECT id, filename, uploaded_at FROM pdf_files ORDER BY uploaded_at DESC`;
        client = await pool.connect();
        const result = await client.query(query);

        res.json({
            files: result.rows
        });
    } catch (error) {
        console.log('Files list error: ', error);
        res.status(500).json({
            error: 'Failed to retrieve files list'
        });
    } finally {
        if (client) client.release();
    }
});


// Start server
app.listen(port, () => {
    console.log(`PDF API server is running on port ${port}`);
    console.log(`Status: http://localhost:${port}/status`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await pool.end();
    process.exit(0);
});
