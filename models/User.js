const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
    date: String,
    tir: Number,
    grade: String,
    hypos: Number,
    hypers: Number
});

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true },
    password: String,
    username: String,
    history: [historySchema],
    achievements: [String],
    highscore: {
        totalPoints: { type: Number, default: 0 },
        bestScore: { type: Number, default: 0 }
    },
    scores: [{
        date: String,
        bodyType: String,
        points: Number,
        grade: String
    }]
});

module.exports = mongoose.model("User", userSchema);