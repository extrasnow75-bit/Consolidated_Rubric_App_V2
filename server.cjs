const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cors = require('cors');
require('dotenv').config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());

const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

app.post('/api/auth/google/callback', async (req, res) => {
    console.log("[DEBUG] Received login request from frontend");
    try {
        const { code } = req.body;
        const { tokens } = await client.getToken({
            code,
            redirect_uri: 'http://localhost:3001'
        });
        res.json({ success: true, tokens });
    } catch (error) {
        console.error("[ERROR] Google Exchange Failed:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log("🚀 Backend Server running on http://localhost:3000");
});