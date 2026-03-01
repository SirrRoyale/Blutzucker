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
    achievements: [String]
});

module.exports = mongoose.model("User", userSchema);