require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    let user = await User.findOne({});
    if (!user) {
        console.log("No users found.");
        process.exit(1);
    }

    console.log("Testing with User:", user.email);
    console.log("Initial Achievements:", user.achievements);
    console.log("Initial History:", user.history.length);

    await User.findByIdAndUpdate(user._id, {
        $addToSet: { achievements: "test_ach" }
    });

    await User.findByIdAndUpdate(user._id, {
        $push: { history: { date: new Date().toISOString(), tir: 100, grade: 'A', hypos: 0, hypers: 0 } }
    });

    user = await User.findById(user._id);

    console.log("Updated Achievements:", user.achievements);
    console.log("Updated History:", user.history.length);
    process.exit(0);
}

run().catch(console.error);
