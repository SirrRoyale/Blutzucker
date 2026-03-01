require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const User = require("./models/User");

const app = express();
const PORT = 3000;

app.use(express.json());
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

        await user.save();

        res.json({ message: "User erstellt" });
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
    const { userId, entry } = req.body;

    await User.findByIdAndUpdate(
        userId,
        { $push: { history: entry } }
    );

    res.json({ success: true });
});

/* ---------------- ADD ACHIEVEMENT ---------------- */

app.post("/api/achievement", async (req, res) => {
    const { userId, achievement } = req.body;

    await User.findByIdAndUpdate(
        userId,
        { $addToSet: { achievements: achievement } }
    );

    res.json({ success: true });
});

/* ---------------- SERVER START ---------------- */

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});