// ============================================================
// config/db.js - إعداد قاعدة البيانات
// ============================================================

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const config = require('./index');

let db;

async function initDatabase() {
    try {
        db = await mysql.createConnection({
            host: config.DB_HOST,
            user: config.DB_USER,
            password: config.DB_PASSWORD,
            database: config.DB_NAME,
            port: config.DB_PORT,
            multipleStatements: true
        });
        console.log('✅ تم الاتصال بقاعدة البيانات MySQL');

        // ====================== إنشاء الجداول ======================
        await db.execute(`CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            fullName VARCHAR(100),
            email VARCHAR(100) UNIQUE NOT NULL,
            origin VARCHAR(100),
            currentLocation VARCHAR(100),
            currentJob VARCHAR(100),
            work VARCHAR(100),
            profession VARCHAR(100),
            balance DECIMAL(10,2) DEFAULT 0,
            profit DECIMAL(10,2) DEFAULT 0,
            level VARCHAR(20) DEFAULT 'برونزي',
            createdAt DATETIME,
            isVerified TINYINT DEFAULT 0,
            twoFactorSecret VARCHAR(255),
            twoFactorEnabled TINYINT DEFAULT 0,
            levelRewards_silver TINYINT DEFAULT 0,
            levelRewards_gold TINYINT DEFAULT 0,
            levelRewards_diamond TINYINT DEFAULT 0,
            referrerId VARCHAR(50),
            referralCode VARCHAR(50) UNIQUE,
            refreshToken VARCHAR(255),
            dailyDepositCount INT DEFAULT 0,
            dailyWithdrawCount INT DEFAULT 0,
            lastDepositDate DATE,
            lastWithdrawDate DATE,
            loginAttempts INT DEFAULT 0,
            lockUntil DATETIME
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS deposits_history (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            date DATETIME NOT NULL,
            withdrawn TINYINT DEFAULT 0,
            withdrawnAmount DECIMAL(10,2) DEFAULT 0,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS deposit_requests (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            method VARCHAR(50),
            status VARCHAR(20) DEFAULT 'pending',
            screenshotPath VARCHAR(255),
            date DATETIME NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            walletAddress VARCHAR(255) NOT NULL,
            status VARCHAR(20) DEFAULT 'pending',
            date DATETIME NOT NULL,
            confirmationCode VARCHAR(10),
            confirmed TINYINT DEFAULT 0,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS investments (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            projectType VARCHAR(20) NOT NULL,
            startDate DATETIME NOT NULL,
            lastProfitDate DATETIME,
            withdrawnProfit DECIMAL(10,2) DEFAULT 0,
            withdrawnPrincipal TINYINT DEFAULT 0,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS casino_profits (
            id VARCHAR(50) PRIMARY KEY,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            date DATETIME NOT NULL,
            details TEXT
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS referrals (
            id VARCHAR(50) PRIMARY KEY,
            referrerId VARCHAR(50) NOT NULL,
            referredId VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            createdAt DATETIME NOT NULL,
            FOREIGN KEY (referrerId) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (referredId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS activity_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            userId VARCHAR(50),
            action VARCHAR(255),
            details TEXT,
            ip VARCHAR(45),
            timestamp DATETIME,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            isRead TINYINT DEFAULT 0,
            createdAt DATETIME NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS wheel_wins (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            betAmount DECIMAL(10,2) NOT NULL,
            winAmount DECIMAL(10,2) NOT NULL,
            multiplier DECIMAL(5,2) NOT NULL,
            date DATETIME NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS withdrawal_codes (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            code VARCHAR(10) NOT NULL,
            expiresAt DATETIME NOT NULL,
            used TINYINT DEFAULT 0,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS admin_actions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            adminId VARCHAR(50) NOT NULL,
            adminUsername VARCHAR(50) NOT NULL,
            actionType VARCHAR(50) NOT NULL,
            targetUserId VARCHAR(50),
            targetUsername VARCHAR(50),
            details TEXT,
            ip VARCHAR(45),
            timestamp DATETIME,
            FOREIGN KEY (adminId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // ====================== إدراج المستخدم الإداري (freeze) ======================
        const freezeHash = await bcrypt.hash('MHDFREEZE0619', config.SALT_ROUNDS);
        await db.execute(`DELETE FROM users WHERE username IN ('admin', 'ali_dev', 'freeze')`); // تنظيف أي بيانات قديمة
        await db.execute(`INSERT INTO users (
            id, username, password, role, email, fullName, level, isVerified, createdAt, referralCode, balance, profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            'FREEZE_ADMIN_ID', 'freeze', freezeHash, 'admin', 'freeze@bestdeal.com', 'Freeze Admin', 'ألماسي', 1, new Date(), 'freeze_ref_999', 50000, 0
        ]);

        console.log('✅ تم إنشاء جميع الجداول وإدراج المستخدم freeze');
    } catch (err) {
        console.error('❌ فشل تهيئة قاعدة البيانات:', err.message);
        process.exit(1);
    }
}

function getDb() {
    if (!db) throw new Error('Database not initialized');
    return db;
}

module.exports = { initDatabase, getDb };