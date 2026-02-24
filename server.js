const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Ensure users.json exists
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: {} }, null, 2));
}

// API to get all accounts
app.get('/api/accounts', (req, res) => {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({ error: "Fehler beim Lesen der Benutzerdaten." });
    }
});

// API to save/sync accounts
app.post('/api/accounts', (req, res) => {
    try {
        const accounts = req.body.accounts;
        if (!accounts) return res.status(400).json({ error: "Keine Daten empfangen." });

        fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts }, null, 2));
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Fehler beim Speichern der Benutzerdaten." });
    }
});

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    console.log(`Benutzerdaten werden in ${DATA_FILE} gespeichert.`);
});
