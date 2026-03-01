
// --- Constants & Config ---
const CONFIG = {
    ISF: 40,
    ICR: 10,
    TIME_STEP: 5,
    TARGET_BG: 100,
    DEATH_LOW: 40,
    DEATH_HIGH: 600,
    WARN_LOW: 70,
    WARN_HIGH: 250,
    RANGE_MIN: 70,
    RANGE_MAX: 140,
    MEALS: {
        FAST: { label: "Süßigkeiten", duration: 90, peak: 30, multiplier: 1.2 },
        NORMAL: { label: "Mahlzeit", duration: 180, peak: 60, multiplier: 1.0 },
        SLOW: { label: "Vollkorn", duration: 300, peak: 120, multiplier: 0.8 }
    },
    SPORT: {
        LIGHT: { label: "Spaziergang", effect: 15, duration: 60 },
        MEDIUM: { label: "Joggen", effect: 40, duration: 45 },
        HEAVY: { label: "Intensiv", effect: 80, duration: 30 }
    },
    INSULIN: {
        BOLUS: { label: "Bolus", duration: 240, peak: 60 },
        BASAL: { label: "Basal", duration: 1440, peak: 360 }
    },
    EVENTS: [
        { id: 'stress', label: "Stress", probability: 0.015, effect: 15, msg: "Stress lässt den Zucker steigen! 😰" },
        { id: 'snack', label: "Snack", probability: 0.01, effect: 10, msg: "Heimlicher Snack ohne Insulin! 🍪" },
        { id: 'sick', label: "Infekt", probability: 0.005, effect: 30, msg: "Ein Infekt bahnt sich an... 🤒" },
        { id: 'forgot', label: "Sport?", probability: 0.008, effect: -15, msg: "Längere Laufwege als gedacht. 🚶" }
    ]
};

// --- Shared Classes ---
class SoundManager {
    constructor() {
        this.masterVolume = 0.7;
        this.sfxVolume = 0.8;
        this.sounds = {};
    }
    setMasterVolume(value) { this.masterVolume = value / 100; }
    setSfxVolume(value) { this.sfxVolume = value / 100; }
    play(name) {
        if (this.sounds[name]) {
            const sound = this.sounds[name].cloneNode();
            sound.volume = this.masterVolume * this.sfxVolume;
            sound.play().catch(e => console.warn("Sound play failed:", e));
        } else {
            console.log(`Sound placeholder: Playing ${name}...`);
        }
    }
}
const sounds = new SoundManager();

class InsulinEffect {
    constructor(amount, typeKey = 'BOLUS') {
        const type = CONFIG.INSULIN[typeKey];
        this.initialAmount = amount;
        this.amount = amount;
        this.typeKey = typeKey;
        this.duration = type.duration;
        this.elapsed = 0;
    }
    getEffect(minutes) {
        if (this.elapsed >= this.duration) return 0;
        const effectBase = (this.initialAmount * CONFIG.ISF) * (minutes / this.duration);
        this.elapsed += minutes;
        this.amount = Math.max(0, this.initialAmount * (1 - (this.elapsed / this.duration)));
        return effectBase;
    }
}

class MealEffect {
    constructor(carbs, typeKey = 'NORMAL') {
        const type = CONFIG.MEALS[typeKey];
        this.initialCarbs = carbs;
        this.carbs = carbs;
        this.typeKey = typeKey;
        this.duration = type.duration;
        this.peak = type.peak;
        this.elapsed = 0;
    }
    getEffect(minutes) {
        if (this.elapsed >= this.duration) return 0;
        const riseFactor = CONFIG.ISF / CONFIG.ICR;
        const totalRise = this.initialCarbs * riseFactor;
        let intensity = (this.elapsed < this.peak) ? (this.elapsed / this.peak) : (1 - ((this.elapsed - this.peak) / (this.duration - this.peak)));
        const effect = (totalRise / this.duration) * (intensity / 0.5) * (minutes / 1);
        this.elapsed += minutes;
        this.carbs = Math.max(0, this.initialCarbs * (1 - (this.elapsed / this.duration)));
        return effect;
    }
}

class SportEffect {
    constructor(typeKey) {
        const type = CONFIG.SPORT[typeKey];
        this.typeKey = typeKey;
        this.effect = type.effect;
        this.duration = type.duration;
        this.elapsed = 0;
    }
    getEffect(minutes, currentIOB) {
        if (this.elapsed >= this.duration) return 0;
        let multiplier = (currentIOB > 0.5) ? 1.5 : 1.0;
        const drop = (this.effect / this.duration) * minutes * multiplier;
        this.elapsed += minutes;
        return drop;
    }
}

class DayTracker {
    constructor() { this.reset(); }
    reset() {
        this.totalSteps = 0;
        this.inRangeSteps = 0;
        this.hypos = 0;
        this.hypers = 0;
        this.lastState = 'normal';
    }
    track(bg) {
        this.totalSteps++;
        if (bg >= CONFIG.RANGE_MIN && bg <= CONFIG.RANGE_MAX) this.inRangeSteps++;
        if (bg < CONFIG.WARN_LOW) {
            if (this.lastState !== 'hypo') this.hypos++;
            this.lastState = 'hypo';
        } else if (bg > CONFIG.WARN_HIGH) {
            if (this.lastState !== 'hyper') this.hypers++;
            this.lastState = 'hyper';
        } else {
            this.lastState = 'normal';
        }
    }
    getScore() {
        const tir = (this.inRangeSteps / this.totalSteps) * 100;
        let grade = 'F';
        if (tir > 90 && this.hypos === 0) grade = 'A';
        else if (tir > 75) grade = 'B';
        else if (tir > 50) grade = 'C';
        else if (tir > 25) grade = 'D';
        return { tir: Math.round(tir), hypos: this.hypos, hypers: this.hypers, grade };
    }
}

class AuthManager {
    constructor(simulation) {
        this.sim = simulation;
        this.users = {};
        this.currentUser = JSON.parse(localStorage.getItem('sim_current_user') || 'null');
        this.achievements = [
            { id: 'persistent', icon: '🤝', title: 'Dranbleiber', desc: 'Erstelle ein Konto und melde dich an.', category: 'Arcade' },
            { id: 'survive_day', icon: '🏆', title: 'Überlebenskünstler', desc: 'Überlebe einen vollen Tag in der Simulation.', category: 'Arcade' },
            { id: 'perfect_tir', icon: '🎯', title: 'Meister der Zeit', desc: 'Erreiche 100% Time in Range für einen Tag.', category: 'Arcade' },
            { id: 'grade_a', icon: '📜', title: 'Musterschüler', desc: 'Erreiche die Bestnote A bei der Tagesauswertung.', category: 'Arcade' },
            { id: 'sporty', icon: '🏃', title: 'Sportskanone', desc: 'Schließe insgesamt 5 sportliche Aktivitäten ab.', category: 'Arcade' },
            { id: 'platinum', icon: '💎', title: 'Platin-Trophäe', desc: 'Sammle alle anderen Erfolge.', category: 'Spezial' },
            { id: 'story_lvl1', icon: '📖', title: 'Grundlagen', desc: 'Schließe Story Level 1 ab.', category: 'Story' },
            { id: 'story_lvl2', icon: '📖', title: 'Mahlzeiten-Meister', desc: 'Schließe Story Level 2 ab.', category: 'Story' },
            { id: 'story_lvl3', icon: '📖', title: 'Sportler', desc: 'Schließe Story Level 3 ab.', category: 'Story' },
            { id: 'story_lvl4', icon: '📖', title: 'Diszipliniert', desc: 'Schließe Story Level 4 ab.', category: 'Story' },
            { id: 'story_lvl5', icon: '📖', title: 'Die Legende', desc: 'Schließe Story Level 5 ab.', category: 'Story' }
        ];
        this.init();
    }

    async init() {
        this.users = JSON.parse(localStorage.getItem('sim_users') || '{}');
    }

    async hashPassword(password) {
        if (!password) return '';
        const msgUint8 = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async saveUsers() {
        localStorage.setItem('sim_users', JSON.stringify(this.users));
    }

    async saveCurrentUserChange() {
        if (!this.currentUser) return;
        this.users[this.currentUser.email] = this.currentUser;
        await this.saveUsers();
        localStorage.setItem('sim_current_user', JSON.stringify(this.currentUser));
    }

    async register(email, password) {
        if (this.users[email]) throw new Error("Benutzer existiert bereits.");
        const hashedPassword = await this.hashPassword(password);
        this.users[email] = {
            email,
            pass: hashedPassword,
            username: '',
            history: [],
            achievements: ['persistent'],
            isHashed: true
        };
        await this.saveUsers();
        return this.users[email];
    }

    async login(email, password) {
        const user = this.users[email];
        if (!user) return null;

        if (!user.isHashed) {
            if (user.pass === password) {
                user.pass = await this.hashPassword(password);
                user.isHashed = true;
                await this.saveUsers();
            } else return null;
        } else {
            const hashed = await this.hashPassword(password);
            if (user.pass !== hashed) return null;
        }

        this.currentUser = user;
        localStorage.setItem('sim_current_user', JSON.stringify(this.currentUser));
        return user;
    }

    async saveResult(stats) {
        if (!this.currentUser) return;
        const result = {
            date: new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            tir: stats.tir,
            grade: stats.grade,
            hypos: stats.hypos,
            hypers: stats.hypers
        };
        if (!this.currentUser.history) this.currentUser.history = [];
        this.currentUser.history.push(result);
        await this.saveCurrentUserChange();
    }

    async deleteResult(index) {
        if (!this.currentUser || !this.currentUser.history) return;
        this.currentUser.history.splice(index, 1);
        await this.saveCurrentUserChange();
    }

    async updateUsername(newName) {
        if (!this.currentUser) return;
        this.currentUser.username = newName;
        await this.saveCurrentUserChange();
    }

    async updatePassword(newPass) {
        if (!this.currentUser) return;
        this.currentUser.pass = await this.hashPassword(newPass);
        this.currentUser.isHashed = true;
        await this.saveCurrentUserChange();
    }

    async removeAvatar() {
        if (!this.currentUser) return;
        delete this.currentUser.avatar;
        await this.saveCurrentUserChange();
    }

    async unlockAchievement(id) {
        if (!this.currentUser) return;
        if (!this.currentUser.achievements) this.currentUser.achievements = [];
        if (!this.currentUser.achievements.includes(id)) {
            this.currentUser.achievements.push(id);
            await this.saveCurrentUserChange();
            const ach = this.achievements.find(a => a.id === id);
            if (ach && this.sim && this.sim.showNotification) {
                this.sim.showNotification(`ERFOLG FREIGESCHALTET: ${ach.icon} ${ach.title}`);
            }
            this.checkPlatinum();
        }
    }

    checkPlatinum() {
        if (!this.currentUser || this.currentUser.achievements.includes('platinum')) return;
        const normalAchIds = this.achievements.filter(a => a.id !== 'platinum').map(a => a.id);
        const earnedIds = this.currentUser.achievements;
        if (normalAchIds.every(id => earnedIds.includes(id))) {
            this.unlockAchievement('platinum');
        }
    }
}

// Make them available globally
window.CONFIG = CONFIG;
window.sounds = sounds;
window.InsulinEffect = InsulinEffect;
window.MealEffect = MealEffect;
window.SportEffect = SportEffect;
window.DayTracker = DayTracker;
window.AuthManager = AuthManager;
