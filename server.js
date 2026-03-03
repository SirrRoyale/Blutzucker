require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const User = require("./models/User");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(__dirname));
app.use((req, res, next) => {
    console.log("➡️", req.method, req.url);
    next();
});

/* ---------------- MONGODB CONNECT ---------------- */

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.log(err));

/* ---------------- REGISTER ---------------- */

app.post("/api/register", async (req, res) => {
    try {
        const { email, password } = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            email,
            password: hashedPassword,
            username: "",
            history: [],
            achievements: []
        });

        const savedUser = await user.save();
        const token = jwt.sign({ id: savedUser._id }, process.env.JWT_SECRET);

        res.json({ message: "User erstellt", token, user: savedUser });
    } catch (err) {
        res.status(400).json({ error: "User existiert bereits" });
    }
});

/* ---------------- LOGIN ---------------- */

app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User nicht gefunden" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Falsches Passwort" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    res.json({ token, user });
});

/* ---------------- ADD HISTORY ---------------- */

app.post("/api/history", async (req, res) => {
    try {
        const { userId, entry } = req.body;
        console.log("➡️ /api/history called -> userId:", userId, "entry:", entry);

        if (!userId) {
            return res.status(400).json({ error: "Missing userId" });
        }

        const result = await User.findByIdAndUpdate(
            userId,
            { $push: { history: entry } },
            { new: true }
        );

        if (!result) {
            console.log("⚠️ /api/history - User not found in DB with ID:", userId);
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ success: true, user: result });
    } catch (err) {
        console.error("❌ /api/history ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- ADD ACHIEVEMENT ---------------- */

app.post("/api/achievement", async (req, res) => {
    try {
        const { userId, achievement } = req.body;
        console.log("➡️ /api/achievement called -> userId:", userId, "achievement:", achievement);

        if (!userId) {
            return res.status(400).json({ error: "Missing userId" });
        }

        const result = await User.findByIdAndUpdate(
            userId,
            { $addToSet: { achievements: achievement } },
            { new: true }
        );

        if (!result) {
            console.log("⚠️ /api/achievement - User not found in DB with ID:", userId);
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ success: true, user: result });
    } catch (err) {
        console.error("❌ /api/achievement ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- UPDATE AVATAR ---------------- */

app.post("/api/avatar", async (req, res) => {
    try {
        const { userId, avatar } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "Missing userId" });
        }

        const result = await User.findByIdAndUpdate(
            userId,
            { avatar },
            { new: true }
        );

        if (!result) return res.status(404).json({ error: "User not found" });

        res.json({ success: true, user: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- DEBUG MONGODB ---------------- */

app.get("/api/debug", async (req, res) => {
    try {
        const users = await User.find({}).lean();
        const debugInfo = users.map(u => ({
            id: u._id,
            email: u.email,
            histLen: u.history ? u.history.length : 0,
            achLen: u.achievements ? u.achievements.length : 0
        }));
        res.json({ debugInfo, users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- SERVER START ---------------- */

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});