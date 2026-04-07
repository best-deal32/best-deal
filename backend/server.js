const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'mySecretKey';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

let db;
async function initDB() {
    db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'bestdeal',
        port: process.env.DB_PORT || 3306
    });
    console.log('✅ DB connected');
    const [rows] = await db.execute('SELECT id FROM users WHERE username = ?', ['freeze']);
    if (rows.length === 0) {
        const hashed = await bcrypt.hash('MHDFREEZE0619', 10);
        await db.execute(`INSERT INTO users (id, username, password, role, email, fullName, balance, createdAt, isVerified, referralCode)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1, ?)`,
            ['FREEZE_ID', 'freeze', hashed, 'admin', 'freeze@bestdeal.com', 'Freeze Admin', 50000, 'freeze_ref']
        );
    }
}
initDB();

async function getQuery(sql, params) {
    const [rows] = await db.execute(sql, params);
    return rows[0];
}

app.post('/api/users/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: 'مطلوب' });
        const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 15 * 60 * 1000 });
        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (err) {
        res.status(500).json({ success: false, message: 'خطأ' });
    }
});

app.get('/api/users/me', async (req, res) => {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ success: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getQuery('SELECT id, username, role, fullName, email, balance FROM users WHERE id = ?', [decoded.id]);
        res.json(user);
    } catch (err) { res.status(401).json({ success: false }); }
});

app.get('/api/test', (req, res) => { res.json({ message: 'Server is working' }); });

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
console.log(`✅ Serving static from ${publicPath}`);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`👑 Admin: freeze / MHDFREEZE0619`);
});