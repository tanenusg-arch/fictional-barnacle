// =========================== FULL NODE.JS BOT (FIXED DB) ===========================
const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const axios = require('axios');
const config = require('./config');

// =========================== EMOJIS ===========================
const emojiId = config.EMOJI_IDS || {};
function emojiTag(id, fallback) {
    return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
}
const EMOJI = {
    CHECK: emojiTag(emojiId.CHECK, '✅'),
    CROSS: emojiTag(emojiId.CROSS, '❌'),
    CONFIRM: emojiTag(emojiId.CONFIRM, '✔️'),
    CANCEL: emojiTag(emojiId.CANCEL, '✖️'),
    BACK: emojiTag(emojiId.BACK, '🔙'),
    DEPOSIT: emojiTag(emojiId.DEPOSIT, '💰'),
    WITHDRAW: emojiTag(emojiId.WITHDRAW, '💸'),
    PROFILE: emojiTag(emojiId.PROFILE, '👤'),
    ORDER: emojiTag(emojiId.ORDER, '📦'),
    HELP: emojiTag(emojiId.HELP, '❓'),
    HOME: emojiTag(emojiId.HOME, '🏠'),
    STAR: emojiTag(emojiId.STAR, '⭐'),
    PREMIUM: emojiTag(emojiId.PREMIUM, '💎'),
    TELEBIRR: emojiTag(emojiId.TELEBIRR, '📱'),
    CBE: emojiTag(emojiId.CBE, '🏦'),
    GAME: emojiTag(emojiId.GAME, '🎮'),
    MORE: emojiTag(emojiId.MORE, '➕'),
    SUPPORT: emojiTag(emojiId.SUPPORT, '💬'),
    WALLET: emojiTag(emojiId.WALLET, '👛'),
    SUCCESS: emojiTag(emojiId.SUCCESS, '✅'),
    FAIL: emojiTag(emojiId.FAIL, '❌'),
    INFO: emojiTag(emojiId.INFO, 'ℹ️'),
    WARNING: emojiTag(emojiId.WARNING, '⚠️'),
    USER: emojiTag(emojiId.USER, '👤'),
    CALENDAR: emojiTag(emojiId.CALENDAR, '📅'),
    MONEY: emojiTag(emojiId.MONEY, '💵'),
    // admin fallbacks
    BAN: '🚫', UNBAN: '✅', TOGGLE: '🔄', SETTINGS: '⚙️',
    MEGAPHONE: '📢', ADD: '➕', LIST: '📋', DELETE: '🗑️',
    CLOCK: '⏰', MAIL: '📧', SEARCH: '🔍'
};

// =========================== CONFIG ===========================
const ADMIN_PASSWORD = "EXYNOS39@#$%&*HSSH671S";
const REFERRAL_REWARD = 2.0;
const MAX_TXN_AGE_MINUTES = 15;
const ADMIN_CHAT_IDS = config.ADMIN_CHAT_ID || [];
const DB_PATH = config.DB_PATH || './bot.db';

let MAINTENANCE_MODE = false;
let WITHDRAWAL_FEE_PERCENT = 0.0;
let MAX_DEPOSIT_LIMIT = 100000;
let MAX_WITHDRAW_LIMIT = 50000;
let MAX_DAILY_ORDERS = 50;
let REPORT_EVENTS = true;
let TELEGRAM_STARS_MARKUP = 0.0;
let TELEGRAM_PREMIUM_MARKUP = 0.0;

// =========================== DATABASE (FIXED) ===========================
let db;
let run, get, all; // will be defined after db is opened

function openDb() {
    return new Promise((resolve, reject) => {
        const d = new sqlite3.Database(DB_PATH, (err) => {
            if (err) reject(err);
            else resolve(d);
        });
    });
}

async function initDB() {
    db = await openDb();
    // Now promisify after db is open
    run = promisify(db.run.bind(db));
    get = promisify(db.get.bind(db));
    all = promisify(db.all.bind(db));

    await run(`
        CREATE TABLE IF NOT EXISTS users (
            telegram_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            balance REAL DEFAULT 0.0,
            referral_balance REAL DEFAULT 0.0,
            banned INTEGER DEFAULT 0,
            daily_order_count INTEGER DEFAULT 0,
            last_order_date TEXT,
            registered_at TEXT
        );
        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            method TEXT,
            amount REAL,
            currency TEXT,
            proof_file_id TEXT,
            status TEXT DEFAULT 'pending',
            admin_note TEXT,
            created_at TEXT,
            resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            method TEXT,
            amount REAL,
            fee REAL DEFAULT 0,
            currency TEXT,
            account TEXT,
            nickname TEXT,
            status TEXT DEFAULT 'pending',
            admin_note TEXT,
            created_at TEXT,
            resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER,
            order_id TEXT,
            status TEXT,
            game TEXT,
            service TEXT,
            player_id TEXT,
            nickname TEXT,
            package_name TEXT,
            api_price REAL,
            charged_price REAL,
            markup_percent REAL DEFAULT 0,
            api_response TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER,
            referred_id INTEGER UNIQUE,
            status TEXT DEFAULT 'completed',
            reward_given INTEGER DEFAULT 1,
            reward_amount REAL DEFAULT 0,
            created_at TEXT,
            rewarded_at TEXT
        );
        CREATE TABLE IF NOT EXISTS promo_codes (
            code TEXT PRIMARY KEY,
            amount REAL,
            max_uses INTEGER DEFAULT 1,
            used_count INTEGER DEFAULT 0,
            expires_at TEXT,
            user_restricted_id INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS promo_code_uses (
            code TEXT,
            user_id INTEGER,
            used_at TEXT,
            PRIMARY KEY (code, user_id)
        );
        CREATE TABLE IF NOT EXISTS game_config (
            game_code TEXT PRIMARY KEY,
            markup_percent REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS used_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT UNIQUE,
            user_id INTEGER,
            amount REAL,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS product_prices (
            product_id TEXT PRIMARY KEY,
            game_code TEXT DEFAULT 'Telegram',
            type TEXT,
            price_override REAL,
            updated_at TEXT
        );
    `);
    await loadSettings();
}

async function loadSettings() {
    const rows = await all("SELECT * FROM settings");
    for (const row of rows) {
        const { key, value } = row;
        switch (key) {
            case 'maintenance_mode': MAINTENANCE_MODE = value === '1'; break;
            case 'withdrawal_fee_percent': WITHDRAWAL_FEE_PERCENT = parseFloat(value); break;
            case 'max_deposit_limit': MAX_DEPOSIT_LIMIT = parseFloat(value); break;
            case 'max_withdraw_limit': MAX_WITHDRAW_LIMIT = parseFloat(value); break;
            case 'max_daily_orders': MAX_DAILY_ORDERS = parseInt(value); break;
            case 'report_events': REPORT_EVENTS = value === '1'; break;
            case 'telegram_stars_markup': TELEGRAM_STARS_MARKUP = parseFloat(value); break;
            case 'telegram_premium_markup': TELEGRAM_PREMIUM_MARKUP = parseFloat(value); break;
        }
    }
}
async function saveSetting(key, value) {
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, String(value));
    await loadSettings();
}

// ---------- DB methods (use run, get, all) ----------
const DB = {
    async addUser(telegram_id, username, first_name) {
        await run(`INSERT INTO users (telegram_id, username, first_name, registered_at)
                   VALUES (?, ?, ?, datetime('now')) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name`,
                   telegram_id, username, first_name);
    },
    async getUser(telegram_id) {
        return get("SELECT * FROM users WHERE telegram_id = ?", telegram_id);
    },
    async isBanned(telegram_id) {
        const user = await this.getUser(telegram_id);
        return user ? user.banned === 1 : false;
    },
    async banUser(telegram_id) {
        await run("UPDATE users SET banned = 1 WHERE telegram_id = ?", telegram_id);
        const row = await get("SELECT changes()");
        if (!row || row['changes()'] === 0) {
            await run("INSERT INTO users (telegram_id, username, first_name, balance, banned, registered_at) VALUES (?, '', '', 0.0, 1, datetime('now'))", telegram_id);
        }
    },
    async unbanUser(telegram_id) {
        await run("UPDATE users SET banned = 0 WHERE telegram_id = ?", telegram_id);
    },
    async updateBalance(telegram_id, amount) {
        await run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", amount, telegram_id);
    },
    async setBalance(telegram_id, amount) {
        await run("UPDATE users SET balance = ? WHERE telegram_id = ?", amount, telegram_id);
    },
    async getReferralBalance(telegram_id) {
        const user = await this.getUser(telegram_id);
        return user ? user.referral_balance || 0 : 0;
    },
    async updateReferralBalance(telegram_id, amount) {
        await run("UPDATE users SET referral_balance = referral_balance + ? WHERE telegram_id = ?", amount, telegram_id);
    },
    async canPlaceOrder(user_id) {
        const today = new Date().toISOString().slice(0,10);
        const row = await get("SELECT daily_order_count, last_order_date FROM users WHERE telegram_id = ?", user_id);
        if (!row) return true;
        if (row.last_order_date !== today) {
            await run("UPDATE users SET daily_order_count = 0, last_order_date = ? WHERE telegram_id = ?", today, user_id);
            return true;
        }
        return row.daily_order_count < MAX_DAILY_ORDERS;
    },
    async incrementOrderCount(user_id) {
        const today = new Date().toISOString().slice(0,10);
        await run("UPDATE users SET daily_order_count = daily_order_count + 1, last_order_date = ? WHERE telegram_id = ?", today, user_id);
    },
    async getPendingDeposits() {
        return all("SELECT * FROM deposits WHERE status = 'pending' ORDER BY id");
    },
    async getDepositById(id) {
        return get("SELECT * FROM deposits WHERE id = ?", id);
    },
    async approveDeposit(id, note = '') {
        const deposit = await this.getDepositById(id);
        if (!deposit || deposit.status !== 'pending') return false;
        await run(`UPDATE deposits SET status = 'approved', admin_note = ?, resolved_at = datetime('now') WHERE id = ?`, note, id);
        await this.updateBalance(deposit.user_id, deposit.amount);
        return true;
    },
    async rejectDeposit(id, reason = '') {
        const deposit = await this.getDepositById(id);
        if (!deposit || deposit.status !== 'pending') return false;
        await run(`UPDATE deposits SET status = 'rejected', admin_note = ?, resolved_at = datetime('now') WHERE id = ?`, reason, id);
        return true;
    },
    async createDeposit(user_id, method, amount, currency, proof_file_id) {
        const result = await run(`INSERT INTO deposits (user_id, method, amount, currency, proof_file_id, status, created_at)
                                  VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
                                  user_id, method, amount, currency, proof_file_id);
        return result.lastID;
    },
    async getPendingWithdrawals() {
        return all("SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY id");
    },
    async getWithdrawalById(id) {
        return get("SELECT * FROM withdrawals WHERE id = ?", id);
    },
    async approveWithdrawal(id, note = '') {
        const w = await this.getWithdrawalById(id);
        if (!w || w.status !== 'pending') return false;
        await run(`UPDATE withdrawals SET status = 'approved', admin_note = ?, resolved_at = datetime('now') WHERE id = ?`, note, id);
        return true;
    },
    async rejectWithdrawal(id, reason = '') {
        const w = await this.getWithdrawalById(id);
        if (!w || w.status !== 'pending') return false;
        await run(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`, w.amount, w.user_id);
        await run(`UPDATE withdrawals SET status = 'rejected', admin_note = ?, resolved_at = datetime('now') WHERE id = ?`, reason, id);
        return true;
    },
    async createWithdrawal(user_id, method, amount, currency, account, nickname, fee = 0) {
        await run("UPDATE users SET balance = balance - ? WHERE telegram_id = ?", amount, user_id);
        const result = await run(`INSERT INTO withdrawals (user_id, method, amount, currency, account, nickname, fee, status, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
                                  user_id, method, amount, currency, account, nickname, fee);
        return result.lastID;
    },
    async createOrder(telegram_id, order_id, status, game, service, player_id, nickname, package_name, api_price, charged_price, markup, api_response) {
        await run(`INSERT INTO orders (telegram_id, order_id, status, game, service, player_id, nickname, package_name, api_price, charged_price, markup_percent, api_response, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                   telegram_id, order_id, status, game, service, player_id, nickname, package_name, api_price, charged_price, markup, api_response);
    },
    async getUserOrders(telegram_id, limit = 5) {
        return all("SELECT * FROM orders WHERE telegram_id = ? ORDER BY id DESC LIMIT ?", telegram_id, limit);
    },
    async getUserProfile(telegram_id) {
        const user = await this.getUser(telegram_id);
        if (!user) return null;
        const stats = await get("SELECT COUNT(*) as total_orders, SUM(charged_price) as total_spent FROM orders WHERE telegram_id = ? AND status = 'COMPLETED'", telegram_id);
        return {
            ...user,
            total_orders: stats.total_orders || 0,
            total_spent: stats.total_spent || 0.0
        };
    },
    async getDashboardStats() {
        const total_users = (await get("SELECT COUNT(*) as cnt FROM users WHERE banned=0")).cnt;
        const td = await get("SELECT COUNT(*) as cnt, SUM(amount) as total FROM deposits WHERE status='approved'");
        const pd = (await get("SELECT COUNT(*) as cnt FROM deposits WHERE status='pending'")).cnt;
        const tw = await get("SELECT COUNT(*) as cnt, SUM(amount) as total FROM withdrawals WHERE status='approved'");
        const pw = (await get("SELECT COUNT(*) as cnt FROM withdrawals WHERE status='pending'")).cnt;
        const total_orders = (await get("SELECT COUNT(*) as cnt FROM orders WHERE status='COMPLETED'")).cnt;
        const today = new Date().toISOString().slice(0,10);
        const revenue_today = (await get("SELECT SUM(charged_price) as rev FROM orders WHERE status='COMPLETED' AND created_at >= ?", today)).rev || 0;
        return {
            total_users,
            total_deposits: td.cnt || 0,
            total_deposit_amount: td.total || 0,
            pending_deposits: pd,
            total_withdrawals: tw.cnt || 0,
            total_withdrawal_amount: tw.total || 0,
            pending_withdrawals: pw,
            total_orders,
            revenue_today
        };
    },
    async getOrderByNumericId(id) {
        return get("SELECT * FROM orders WHERE id = ?", id);
    },
    async getOrderById(orderId) {
        return get("SELECT * FROM orders WHERE order_id = ? OR id = ?", orderId, orderId);
    },
    async getUsername(telegram_id) {
        const row = await get("SELECT username FROM users WHERE telegram_id = ?", telegram_id);
        return row ? row.username : null;
    },
    async getAllUsers() {
        const rows = await all("SELECT telegram_id FROM users WHERE banned = 0");
        return rows.map(r => r.telegram_id);
    },
    async createReferral(referrer_id, referred_id) {
        try {
            const reward = REFERRAL_REWARD;
            await run(`INSERT INTO referrals (referrer_id, referred_id, status, created_at)
                       VALUES (?, ?, 'completed', datetime('now'))`, referrer_id, referred_id);
            await run(`UPDATE users SET balance = balance + ?, referral_balance = referral_balance + ? WHERE telegram_id = ?`, reward, reward, referrer_id);
            await run(`UPDATE referrals SET reward_given = 1, reward_amount = ?, rewarded_at = datetime('now') WHERE referred_id = ?`, reward, referred_id);
            return true;
        } catch (e) {
            return false;
        }
    },
    async getReferralStats(user_id) {
        const total = (await get("SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ?", user_id)).cnt;
        const rewarded = (await get("SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ? AND reward_given = 1", user_id)).cnt;
        const total_reward = (await get("SELECT SUM(reward_amount) as total FROM referrals WHERE referrer_id = ? AND reward_given = 1", user_id)).total || 0;
        return { total, rewarded, total_reward };
    },
    async getReferralList(user_id, limit = 20) {
        return all("SELECT referred_id, status, reward_given, created_at FROM referrals WHERE referrer_id = ? ORDER BY id DESC LIMIT ?", user_id, limit);
    },
    async createPromoCode(code, amount, max_uses = 1, expires_days = 365, user_restricted_id = 0) {
        const expires_at = new Date(Date.now() + expires_days * 86400000).toISOString();
        try {
            await run(`INSERT INTO promo_codes (code, amount, max_uses, used_count, expires_at, user_restricted_id)
                       VALUES (?, ?, ?, 0, ?, ?)`, code.toUpperCase(), amount, max_uses, expires_at, user_restricted_id);
            return true;
        } catch (e) {
            return false;
        }
    },
    async getPromoCode(code) {
        return get("SELECT * FROM promo_codes WHERE code = ?", code.toUpperCase());
    },
    async hasUserUsedCode(code, user_id) {
        const row = await get("SELECT 1 FROM promo_code_uses WHERE code = ? AND user_id = ?", code.toUpperCase(), user_id);
        return !!row;
    },
    async recordPromoCodeUse(code, user_id) {
        await run("INSERT INTO promo_code_uses (code, user_id, used_at) VALUES (?, ?, datetime('now'))", code.toUpperCase(), user_id);
    },
    async usePromoCode(code, user_id) {
        const promo = await this.getPromoCode(code);
        if (!promo) return { success: false, amount: 0, msg: "Invalid code." };
        if (promo.used_count >= promo.max_uses) return { success: false, amount: 0, msg: "Code already fully used." };
        if (promo.expires_at && new Date() > new Date(promo.expires_at)) return { success: false, amount: 0, msg: "Code expired." };
        if (promo.user_restricted_id && promo.user_restricted_id !== user_id) return { success: false, amount: 0, msg: "This code is not for you." };
        if (await this.hasUserUsedCode(code, user_id)) return { success: false, amount: 0, msg: "You have already redeemed this code." };
        await run("UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?", code.toUpperCase());
        await this.recordPromoCodeUse(code, user_id);
        return { success: true, amount: promo.amount, msg: "" };
    },
    async deletePromoCode(code) {
        await run("DELETE FROM promo_code_uses WHERE code = ?", code.toUpperCase());
        await run("DELETE FROM promo_codes WHERE code = ?", code.toUpperCase());
    },
    async listPromoCodes() {
        return all("SELECT * FROM promo_codes ORDER BY amount DESC");
    },
    async getProductPriceOverride(product_id) {
        const row = await get("SELECT price_override FROM product_prices WHERE product_id = ?", product_id);
        return row ? row.price_override : null;
    },
    async setProductPriceOverride(product_id, price, type = 'stars') {
        if (price === null || price <= 0) {
            await run("DELETE FROM product_prices WHERE product_id = ?", product_id);
        } else {
            await run(`INSERT OR REPLACE INTO product_prices (product_id, game_code, type, price_override, updated_at)
                       VALUES (?, 'Telegram', ?, ?, datetime('now'))`, product_id, type, price);
        }
    },
    async getAllProductOverrides() {
        return all("SELECT * FROM product_prices ORDER BY type, product_id");
    },
    async isTransactionUsed(txid) {
        const row = await get("SELECT 1 FROM used_transactions WHERE transaction_id = ?", txid.toUpperCase());
        return !!row;
    },
    async recordTransactionUse(txid, user_id, amount) {
        await run("INSERT INTO used_transactions (transaction_id, user_id, amount, created_at) VALUES (?, ?, ?, datetime('now'))", txid.toUpperCase(), user_id, amount);
    }
};

// =========================== API CLIENT ===========================
const G2BulkAPI = {
    async _request(method, endpoint, data = null, requiresAuth = true, retries = 3) {
        const url = `${config.G2BULK_BASE_URL}/${endpoint}`;
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (requiresAuth) headers['X-API-Key'] = config.G2BULK_API_KEY;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await axios({ method, url, headers, data, timeout: 15000 });
                return response.data;
            } catch (error) {
                if (error.response && error.response.status === 429) {
                    const wait = Math.pow(2, attempt) + 1;
                    await new Promise(resolve => setTimeout(resolve, wait * 1000));
                    continue;
                }
                if (attempt === retries - 1) {
                    return { success: false, message: error.message };
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        return { success: false, message: "Network error" };
    },
    async getGames() {
        return this._request('GET', 'games', null, false);
    },
    async getGameCatalogue(gameCode) {
        return this._request('GET', `games/${gameCode}/catalogue`, null, false);
    },
    async checkPlayerId(gameCode, playerId) {
        return this._request('POST', 'games/checkPlayerId', { game: gameCode, user_id: playerId }, true);
    },
    async placeOrder(gameCode, catalogueName, playerId, idempotencyKey) {
        const headers = {
            'X-API-Key': config.G2BULK_API_KEY,
            'Content-Type': 'application/json'
        };
        if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
        const url = `${config.G2BULK_BASE_URL}/games/${gameCode}/order`;
        try {
            const response = await axios.post(url, { catalogue_name: catalogueName, player_id: playerId }, { headers });
            return response.data;
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
};

// =========================== PAYMENT VERIFICATION ===========================
async function verifyPayment(reference, method) {
    try {
        const response = await axios.post(`${config.VERIFY_API_BASE_URL}/verify`, { reference }, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': config.VERIFY_API_KEY },
            timeout: 60000
        });
        const data = response.data;
        let amount = null, receiver_name = '', payment_date = '', txn_ref = '', receiver_account = '';
        const inner = data.data || data;
        amount = parseFloat(inner.settledAmount || inner.amount || inner.Amount);
        receiver_name = inner.receiverName || inner.receiver || '';
        payment_date = inner.paymentDate || inner.transactionDate || inner.date || '';
        txn_ref = inner.transactionNumber || inner.reference || reference;
        receiver_account = inner.receiverAccount || inner.creditedPartyAccount || inner.receiver;
        if (amount === null) return null;
        const expectedAccount = method === 'telebirr' ? config.TELEBIRR_PHONE : config.CBE_PHONE;
        if (expectedAccount && receiver_account) {
            const last4 = (s) => s.replace(/\D/g,'').slice(-4);
            if (last4(receiver_account) !== last4(expectedAccount)) return null;
        }
        const expectedName = method === 'telebirr' ? config.EXPECTED_RECEIVER_NAME : config.CBE_RECEIVER_NAME;
        if (expectedName && receiver_name) {
            if (receiver_name.trim().toUpperCase() !== expectedName.trim().toUpperCase()) return null;
        }
        if (payment_date) {
            const txnDate = new Date(payment_date);
            if (!isNaN(txnDate)) {
                const age = (Date.now() - txnDate.getTime()) / 60000;
                if (age > MAX_TXN_AGE_MINUTES) return null;
            }
        }
        return { amount, receiver_name, payment_date, reference: txn_ref, receiver_account };
    } catch (e) {
        return null;
    }
}

// =========================== UTILITY ===========================
function apiPriceToBirr(apiPrice, markup = 0) {
    return apiPrice * config.EXCHANGE_RATE + markup;
}
function parseAmount(s) {
    s = s.toLowerCase().replace(/,/g,'');
    if (s.endsWith('k')) return parseInt(parseFloat(s) * 1000);
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
}
function parseTelegramName(name) {
    const s = name.toLowerCase();
    const starsMatch = s.match(/(\S+)\s*stars?/);
    if (starsMatch) {
        const amount = parseAmount(starsMatch[1]);
        if (amount !== null) return { type: 'stars', amount };
    }
    const premiumMatch = s.match(/(\S+)\s*(?:months?|month|year|yr)\s*premium/);
    if (premiumMatch) {
        let amount = parseAmount(premiumMatch[1]);
        if (amount !== null) {
            if (s.includes('year') || s.includes('yr')) amount *= 12;
            return { type: 'premium', amount };
        }
    }
    return null;
}
function formatTelegramDisplay(name, birrPrice) {
    const parsed = parseTelegramName(name);
    if (parsed) {
        if (parsed.type === 'stars') return `${parsed.amount} stars - ${Math.round(birrPrice)}ETB`;
        if (parsed.type === 'premium') return `${parsed.amount} Months premium - ${Math.round(birrPrice)}ETB`;
    }
    return `${name} - ${Math.round(birrPrice)}ETB`;
}
function getCleanTelegramName(name) {
    const parsed = parseTelegramName(name);
    if (parsed) {
        if (parsed.type === 'stars') return `${parsed.amount} stars`;
        if (parsed.type === 'premium') return `${parsed.amount} Months premium`;
    }
    return name;
}
function formatDepositId(id) { return `EX${id+100}`; }
function formatWithdrawalId(id) { return `EX${id+200}`; }
function parseFormattedId(formatted) {
    const m = formatted.match(/^EX(\d+)$/);
    if (!m) return null;
    const num = parseInt(m[1]);
    if (num >= 101 && num <= 199) return num - 100;
    if (num >= 201 && num <= 299) return num - 200;
    return null;
}
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
async function reportEvent(ctx, text) {
    if (!REPORT_EVENTS || !config.REPORT_CHANNEL_ID) return;
    try {
        await ctx.telegram.sendMessage(config.REPORT_CHANNEL_ID, text, { parse_mode: 'HTML' });
    } catch (e) {}
}
async function safeEdit(ctx, newText, extra = {}) {
    try {
        await ctx.editMessageText(newText, extra);
    } catch (e) {
        if (!e.message.includes('Message is not modified')) throw e;
    }
}
function isMediaMessage(ctx) {
    return !!(ctx.message && (ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.animation));
}

// =========================== KEYBOARDS ===========================
function mainKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Profile', 'menu_profile'), Markup.button.callback('Service', 'menu_service')], [Markup.button.callback('Deposit', 'menu_deposit')], [Markup.button.callback('My Orders', 'menu_orders'), Markup.button.callback('Withdraw', 'menu_withdraw')], [Markup.button.callback('Support', 'menu_support')] ]); }
function profileKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('My Profile', 'profile_show'), Markup.button.callback('Referral', 'profile_referral')], [Markup.button.callback('Redeem', 'profile_redeem')], [Markup.button.callback('Back to Main', 'back_to_main')] ]); }
function serviceKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Telegram Stars', 'svc_telegram_stars')], [Markup.button.callback('Telegram Premium', 'svc_telegram_premium')], [Markup.button.callback('Back to main menu', 'back_to_main')] ]); }
function confirmKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Confirm', 'order_confirm'), Markup.button.callback('Cancel', 'order_cancel')], [Markup.button.callback('Back', 'order_back')] ]); }
function depositKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Telebirr (ETB)', 'dep_method:telebirr'), Markup.button.callback('CBE (ETB)', 'dep_method:cbe')], [Markup.button.callback('Cancel', 'cancel_action')] ]); }
function withdrawKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Telebirr (ETB)', 'withdraw_method:telebirr')], [Markup.button.callback('Cancel', 'cancel_action')] ]); }
function supportKeyboard() { const buttons = [ [Markup.button.url('Contact Admin', 'https://t.me/el_bicho14'), Markup.button.url('Updates Channel', `https://t.me/${config.UPDATES_CHANNEL}`)] ]; if (config.SUPPORT_WEBSITE) buttons.push([Markup.button.url('Visit Website', config.SUPPORT_WEBSITE)]); buttons.push([Markup.button.callback('Back to main menu', 'back_to_main')]); return Markup.inlineKeyboard(buttons); }
function adminKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Dashboard', 'admin_dashboard')], [Markup.button.callback('Pending Deposits', 'admin_deposits')], [Markup.button.callback('Pending Withdrawals', 'admin_withdrawals')], [Markup.button.callback('Promo Codes', 'admin_promo')], [Markup.button.callback('Referral Lookup', 'admin_referral')], [Markup.button.callback('Search by ID', 'admin_search_by_id')], [Markup.button.callback('Settings & Tools', 'admin_settings')], [Markup.button.callback('Broadcast', 'admin_broadcast')], [Markup.button.callback('Close', 'admin_close')] ]); }
function adminPromoKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Create Code', 'admin_promo_create')], [Markup.button.callback('List Codes', 'admin_promo_list')], [Markup.button.callback('Delete Code', 'admin_promo_delete')], [Markup.button.callback('Back', 'admin_back')] ]); }
function adminSettingsKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('User Management', 'admin_user_manage')], [Markup.button.callback('Telegram Stars Markup', 'admin_stars_markup')], [Markup.button.callback('Telegram Premium Markup', 'admin_premium_markup')], [Markup.button.callback('Set Product Price', 'admin_set_product_price')], [Markup.button.callback('Toggle Maintenance', 'admin_toggle_maintenance')], [Markup.button.callback('Toggle Reports', 'admin_toggle_reports')], [Markup.button.callback('Back', 'admin_back')] ]); }
function userManageKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Ban User', 'admin_ban')], [Markup.button.callback('Unban User', 'admin_unban')], [Markup.button.callback('Set Balance', 'admin_set_balance')], [Markup.button.callback('Back', 'admin_settings')] ]); }
function searchByIdKeyboard() { return Markup.inlineKeyboard([ [Markup.button.callback('Order', 'admin_search_id:order')], [Markup.button.callback('Deposit', 'admin_search_id:deposit')], [Markup.button.callback('Withdrawal', 'admin_search_id:withdrawal')], [Markup.button.callback('Back', 'admin_back')] ]); }
function cancelKeyboard() { return Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'cancel_action')]]); }

// =========================== CATALOG SERVICE ===========================
class CatalogService {
    constructor() { this._telegramCode = null; }
    async _getTelegramGameCode() {
        if (this._telegramCode) return this._telegramCode;
        const knownCodes = ['Telegram', 'telegram', 'topup', 'game_topup'];
        for (const code of knownCodes) {
            const res = await G2BulkAPI.getGameCatalogue(code);
            if (res && res.success && res.catalogues && res.catalogues.length) {
                this._telegramCode = code;
                return code;
            }
        }
        const games = await G2BulkAPI.getGames();
        if (games && games.success) {
            for (const game of games.games || []) {
                const name = (game.name || '').toLowerCase();
                const code = game.code || '';
                if (name.includes('telegram') || name.includes('topup') || code.toLowerCase().includes('telegram')) {
                    this._telegramCode = code;
                    return code;
                }
            }
        }
        return null;
    }
    async getTelegramCatalogue() {
        const gameCode = await this._getTelegramGameCode();
        if (!gameCode) return [];
        const res = await G2BulkAPI.getGameCatalogue(gameCode);
        if (!res || !res.success) return [];
        const items = res.catalogues || [];
        const annotated = [];
        for (const it of items) {
            const n = (it.name || '').toLowerCase();
            let kind = null;
            if (n.includes('star')) kind = 'stars';
            else if (n.includes('premium')) kind = 'premium';
            const newItem = { ...it, _kind: kind, _game_code: gameCode };
            const productId = it.id || it.code || it.name;
            if (productId) {
                const override = await DB.getProductPriceOverride(productId);
                if (override !== null) newItem._override_price = override;
            }
            annotated.push(newItem);
        }
        return annotated;
    }
    async getTelegramStarsPackages() {
        const all = await this.getTelegramCatalogue();
        return all.filter(p => p._kind === 'stars');
    }
    async getTelegramPremiumPlans() {
        const all = await this.getTelegramCatalogue();
        return all.filter(p => p._kind === 'premium');
    }
    async getTelegramStarsMarkup() { return TELEGRAM_STARS_MARKUP; }
    async getTelegramPremiumMarkup() { return TELEGRAM_PREMIUM_MARKUP; }
}

// =========================== BOT SETUP ===========================
const bot = new Telegraf(config.BOT_TOKEN);
bot.use(session());
bot.use(async (ctx, next) => {
    ctx.db = DB;
    ctx.EMOJI = EMOJI;
    ctx.ADMIN_CHAT_IDS = ADMIN_CHAT_IDS;
    if (!ctx.session) ctx.session = {};
    if (MAINTENANCE_MODE && ctx.from && !ADMIN_CHAT_IDS.includes(ctx.from.id)) {
        await ctx.reply(`${EMOJI.WARNING} Bot is under maintenance. Please try again later.`);
        return;
    }
    return next();
});

// =========================== COMMANDS ===========================
bot.start(async (ctx) => {
    const user = ctx.from;
    if (await DB.isBanned(user.id)) return ctx.reply(`${EMOJI.CROSS} You are banned.`);
    await DB.addUser(user.id, user.username, user.first_name);
    const args = ctx.message.text.split(' ');
    if (args.length > 1 && args[1].startsWith('ref')) {
        const referrerId = parseInt(args[1].slice(3));
        if (!isNaN(referrerId) && referrerId !== user.id) {
            const success = await DB.createReferral(referrerId, user.id);
            if (success) {
                try { await ctx.telegram.sendMessage(referrerId, `${EMOJI.USER} ${user.first_name} joined using your referral link! You earned ${REFERRAL_REWARD} ETB!`, { parse_mode: 'HTML' }); } catch (e) {}
            }
        }
    }
    const caption = `${EMOJI.HOME} <b>Welcome, ${user.first_name}!</b>\n\n🛒 Top‑up Telegram Stars & Premium at the best rates.\n${EMOJI.MONEY} 10% service fee applied.\n\n👇 Tap a colored button below:`;
    const videoUrl = "https://www.image2url.com/r2/default/videos/1786262674020-a5d7c711-2219-469a-b7b8-733775a278ea.mp4";
    try {
        await ctx.replyWithVideo(videoUrl, { caption, parse_mode: 'HTML', ...mainKeyboard() });
    } catch (e) {
        await ctx.replyWithPhoto({ url: "https://i.ibb.co/9HbZmPRm/x.jpg" }, { caption, parse_mode: 'HTML', ...mainKeyboard() });
    }
});

bot.command('admin', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.reply('Unauthorized.');
    ctx.session.state = 'ADMIN_LOGIN';
    await ctx.reply('🔐 Enter admin password:');
});

// =========================== ACTIONS ===========================
// Main menu
bot.action('menu_profile', async (ctx) => {
    const userData = await DB.getUserProfile(ctx.from.id);
    if (!userData) return ctx.reply('Profile not found.');
    const regDate = new Date(userData.registered_at).toISOString().slice(0,10);
    const text = `${EMOJI.PROFILE} <b>User Profile</b>\n\n${EMOJI.USER} <b>Name:</b> ${userData.first_name}\n${EMOJI.USER} <b>Username:</b> @${userData.username || 'N/A'}\n🆔 <b>ID:</b> <code>${userData.telegram_id}</code>\n${EMOJI.MONEY} <b>Balance:</b> ${Math.round(userData.balance)} ETB\n${EMOJI.MONEY} <b>Referral Balance:</b> ${Math.round(userData.referral_balance)} ETB\n${EMOJI.CALENDAR} <b>Registered:</b> ${regDate}\n━━━━━━━━━━━━━━━━━━━━━━\n${EMOJI.ORDER} <b>Completed Orders:</b> ${userData.total_orders}\n${EMOJI.MONEY} <b>Total Spent:</b> ${Math.round(userData.total_spent)} ETB`;
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...profileKeyboard() });
});
bot.action('menu_orders', async (ctx) => {
    const orders = await DB.getUserOrders(ctx.from.id, 5);
    let text = orders.length ? `${EMOJI.ORDER} <b>Last 5 Orders:</b>\n\n` : `${EMOJI.ORDER} <b>No orders yet.</b>`;
    for (const order of orders) {
        text += `${EMOJI.ORDER} <b>Order ID:</b> <code>${order.order_id}</code>\n${EMOJI.GAME} <b>Product:</b> ${order.game}\n${EMOJI.MONEY} <b>Package:</b> ${order.package_name}\n${EMOJI.MONEY} <b>Charged:</b> ${Math.round(order.charged_price)} ETB\n${EMOJI.SUCCESS} <b>Status:</b> ${order.status}\n${EMOJI.CALENDAR} <b>Date:</b> ${order.created_at.slice(0,10)}\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    }
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...mainKeyboard() });
});
bot.action('menu_support', async (ctx) => {
    ctx.session = {};
    const helpMsg = `${EMOJI.SUPPORT} <b>Support & Help</b>\n\n<b>🚀 Quick start:</b>\n1. Use the <b>inline buttons</b> in the message below the keyboard to navigate.\n2. Most flows guide you step by step — just follow the prompts.\n\n${EMOJI.MONEY} <b>Deposit (Telebirr / CBE):</b>\n1. Tap <b>Deposit</b> in the main menu.\n2. Choose <b>Telebirr (ETB)</b> or <b>CBE (ETB)</b>.\n3. Enter the amount (min ${config.MIN_DEPOSIT_BIRR} ETB, max ${MAX_DEPOSIT_LIMIT} ETB).\n4. Send the money to the number shown.\n5. After paying, <b>type the Transaction ID</b> (Telebirr) or <b>Transaction Link</b> (CBE).\n6. Once verified, the ETB is added to your balance automatically.\n\n${EMOJI.MONEY} <b>Withdraw (Telebirr):</b>\n1. Tap <b>Withdraw</b> in the main menu.\n2. Enter your Telebirr phone number and a nickname.\n3. Enter the amount (min ${config.MIN_WITHDRAW_BIRR} ETB, max ${MAX_WITHDRAW_LIMIT} ETB).\n4. Confirm — admin will review and send the money.\n\n${EMOJI.STAR} <b>Telegram Services:</b>\n1. Tap <b>Service</b> in the main menu.\n2. Choose <b>Telegram Stars</b> or <b>Telegram Premium</b>.\n3. Pick a package.\n4. Enter your Telegram <b>@username</b> (must start with @).\n5. Choose payment method: <b>Wallet</b> (deduct from balance), <b>CBE</b>, or <b>Telebirr</b>.\n6. For external payments, you'll see the account details and amount to pay, then provide the transaction reference.\n   If you pay more than the order total, the extra is added to your wallet balance.\n\n${EMOJI.USER} <b>Referral:</b>\nTap Referral in Profile to get your invite link. Each friend earns you ${REFERRAL_REWARD} ETB instantly.\n\nNeed more help? Contact @el_bicho14`;
    await safeEdit(ctx, helpMsg, { parse_mode: 'HTML', ...supportKeyboard() });
});
bot.action('back_to_main', async (ctx) => {
    ctx.session = {};
    if (isMediaMessage(ctx)) {
        await ctx.deleteMessage();
        await ctx.reply(`${EMOJI.HOME} <b>Main Menu</b>`, { parse_mode: 'HTML', ...mainKeyboard() });
    } else {
        await safeEdit(ctx, `${EMOJI.HOME} <b>Main Menu</b>`, { parse_mode: 'HTML', ...mainKeyboard() });
    }
});

// Profile sub-menus
bot.action('profile_referral', async (ctx) => {
    const stats = await DB.getReferralStats(ctx.from.id);
    const list = await DB.getReferralList(ctx.from.id);
    const refLink = `https://t.me/${ctx.botInfo.username}?start=ref${ctx.from.id}`;
    let msg = `${EMOJI.USER} <b>Your Referral Stats</b>\n\n${EMOJI.USER} <b>Your Link:</b> <code>${refLink}</code>\n${EMOJI.USER} <b>Total Invites:</b> ${stats.total}\n${EMOJI.MONEY} <b>Rewarded:</b> ${stats.rewarded}\n${EMOJI.MONEY} <b>Total Earned:</b> ${Math.round(stats.total_reward)} ETB\n${EMOJI.MONEY} <b>Reward per invite:</b> ${REFERRAL_REWARD} ETB (instant, not withdrawable)\n\n<i>Share your link. Each new user who joins gives you an instant reward!</i>`;
    const kb = Markup.inlineKeyboard([[Markup.button.callback('Back to Profile', 'menu_profile')]]);
    await safeEdit(ctx, msg, { parse_mode: 'HTML', ...kb });
});
bot.action('profile_redeem', async (ctx) => {
    ctx.session.state = 'PROFILE_REDEEM';
    const kb = Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'cancel_action')]]);
    await safeEdit(ctx, `${EMOJI.MONEY} <b>Enter your promo code:</b>`, { parse_mode: 'HTML', ...kb });
});
bot.action('cancel_action', async (ctx) => {
    ctx.session = {};
    await ctx.deleteMessage();
    await ctx.reply(`${EMOJI.CROSS} Action cancelled.`, { ...mainKeyboard() });
});

// Service flow
bot.action('menu_service', async (ctx) => {
    ctx.session.state = 'SERVICE_SELECT';
    const text = `${EMOJI.GAME} <b>Choose a Telegram service:</b>`;
    if (isMediaMessage(ctx)) {
        await ctx.deleteMessage();
        await ctx.reply(text, { parse_mode: 'HTML', ...serviceKeyboard() });
    } else {
        await safeEdit(ctx, text, { parse_mode: 'HTML', ...serviceKeyboard() });
    }
});
bot.action('back_to_service', async (ctx) => {
    ctx.session.state = 'SERVICE_SELECT';
    await safeEdit(ctx, `${EMOJI.GAME} <b>Choose a Telegram service:</b>`, { parse_mode: 'HTML', ...serviceKeyboard() });
});
bot.action(/^svc_telegram_(stars|premium)$/, async (ctx) => {
    const selection = ctx.match[1];
    ctx.session.telegram_kind = selection;
    ctx.session.game_name = selection === 'stars' ? 'Telegram Stars' : 'Telegram Premium';
    ctx.session.flow_type = 'telegram';
    const emoji = selection === 'stars' ? EMOJI.STAR : EMOJI.PREMIUM;
    const msg = await ctx.reply(`${emoji} <b>${ctx.session.game_name}</b>`, { parse_mode: 'HTML' });
    ctx.session.last_photo = { chat_id: ctx.chat.id, message_id: msg.message_id };
    const loading = await ctx.reply('🔄 Loading packages...');
    const catalog = new CatalogService();
    let packages, markup;
    try {
        if (selection === 'stars') {
            packages = await catalog.getTelegramStarsPackages();
            markup = await catalog.getTelegramStarsMarkup();
        } else {
            packages = await catalog.getTelegramPremiumPlans();
            markup = await catalog.getTelegramPremiumMarkup();
        }
    } catch (e) {
        await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `${EMOJI.CROSS} Failed to load plans.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: 'back_to_service' }]] } });
        return;
    }
    if (!packages || packages.length === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `${EMOJI.CROSS} No plans found.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: 'back_to_service' }]] } });
        return;
    }
    ctx.session.active_packages = packages;
    ctx.session.telegram_markup = markup;
    ctx.session.telegram_game_code = packages[0]._game_code || 'Telegram';
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id);
    const rawNames = {};
    const buttons = [];
    for (let idx = 0; idx < packages.length; idx++) {
        const pkg = packages[idx];
        const rawName = pkg.name || pkg.title || 'Package';
        const override = pkg._override_price;
        let birrPrice = override !== undefined && override !== null ? override : apiPriceToBirr(pkg.unit_price || pkg.price || pkg.amount || 0, markup);
        rawNames[idx] = rawName;
        const display = formatTelegramDisplay(rawName, birrPrice);
        buttons.push([{ text: display, callback_data: `pkg_idx:${idx}` }]);
    }
    ctx.session.package_raw_names = rawNames;
    let grid = [];
    if (selection === 'premium') {
        grid = buttons.map(b => [b[0]]);
    } else {
        for (let i = 0; i < buttons.length; i += 2) {
            const row = buttons.slice(i, i+2);
            grid.push(row);
        }
    }
    grid.push([{ text: 'Back', callback_data: 'back_to_service' }]);
    await ctx.reply(`${EMOJI.ORDER} <b>Select a package:</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: grid } });
    ctx.session.state = 'SELECT_PKG';
});
bot.action(/^pkg_idx:(\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    const packages = ctx.session.active_packages;
    if (!packages || idx >= packages.length) {
        await ctx.reply(`${EMOJI.CROSS} Package unavailable.`, { ...mainKeyboard() });
        return;
    }
    const pkg = packages[idx];
    const rawName = ctx.session.package_raw_names ? ctx.session.package_raw_names[idx] : (pkg.name || 'Item');
    const apiPrice = pkg.unit_price || pkg.price || pkg.amount || 0;
    const markup = ctx.session.telegram_markup || 0;
    const chargedPrice = ctx.session.pkg_price ? ctx.session.pkg_price[idx] : apiPriceToBirr(apiPrice, markup);
    const cleanName = getCleanTelegramName(rawName);
    ctx.session.package_name = rawName;
    ctx.session.package_display_name = cleanName;
    ctx.session.api_price = apiPrice;
    ctx.session.charged_price = chargedPrice;
    ctx.session.markup = markup;
    ctx.session.service_name = pkg.service || 'Direct Top-Up';
    await safeEdit(ctx, `${EMOJI.USER} <b>Enter recipient's Telegram username</b> (with @) for <b>${cleanName}</b>:\n<i>The API will verify it and return their Telegram name.</i>`, { parse_mode: 'HTML', ...cancelKeyboard() });
    ctx.session.state = 'ENTER_UID';
});
bot.action('order_confirm', async (ctx) => {
    ctx.session.state = 'PAYMENT_METHOD';
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Pay from Wallet', 'pay_method:wallet')],
        [Markup.button.callback('CBE', 'pay_method:cbe'), Markup.button.callback('Telebirr', 'pay_method:telebirr')],
        [Markup.button.callback('Cancel', 'order_cancel')]
    ]);
    await safeEdit(ctx, `${EMOJI.WALLET} <b>Choose a payment method</b>`, { parse_mode: 'HTML', ...kb });
});
bot.action('order_cancel', async (ctx) => {
    ctx.session = {};
    await ctx.reply(`${EMOJI.CROSS} Order cancelled.`, { ...mainKeyboard() });
    await ctx.deleteMessage();
});
bot.action('order_back', async (ctx) => {
    const clean = ctx.session.package_display_name || 'package';
    await safeEdit(ctx, `${EMOJI.USER} Enter recipient's username for ${clean}:`, { parse_mode: 'HTML', ...cancelKeyboard() });
    ctx.session.state = 'ENTER_UID';
});
bot.action(/^pay_method:(wallet|cbe|telebirr)$/, async (ctx) => {
    const method = ctx.match[1];
    ctx.session.pay_method = method;
    if (method === 'wallet') {
        await processWalletPurchase(ctx);
    } else {
        const charged = ctx.session.charged_price || 0;
        let accountName, accountNumber, instructions, example, img;
        if (method === 'cbe') {
            accountName = config.CBE_RECEIVER_NAME;
            accountNumber = config.CBE_PHONE;
            instructions = 'After the payment, reply with the <b>Transaction Link</b> (URL) from your CBE payment.';
            example = 'Example: <code>https://... </code>';
            img = config.IMG_CBE_TRANSACTION_ID || "https://img-mom.bitibiti.workers.dev/img/AgACAgQAAxkBAAIs3mp2IUPoCLWCk0Kyv3rGBw9iGRuWAAKHDGsbM5axUzJRjYwRt86KAQADAgADeQADPQQ";
        } else {
            accountName = config.EXPECTED_RECEIVER_NAME;
            accountNumber = config.TELEBIRR_PHONE;
            instructions = 'After the payment, reply with the <b>Transaction ID</b>.';
            example = 'Example: <code>DG56K96NIK</code>';
            img = config.IMG_TRANSACTION_ID || "https://i.ibb.co/qMts3xr8/Tb-SINTAYEHU.jpg";
        }
        const caption = `${EMOJI.WALLET} <b>Pay ${Math.round(charged)} ETB via ${method.toUpperCase()}</b>\n\nSend <b>${Math.round(charged)} ETB</b> to:\nName: <b>${accountName}</b>\nNumber: <code>${accountNumber}</code>\n\n${instructions}\n${example}`;
        const sent = await ctx.replyWithPhoto({ url: img }, { caption, parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.last_photo = { chat_id: ctx.chat.id, message_id: sent.message_id };
        ctx.session.state = 'PAYMENT_TXN';
    }
});

// Withdraw confirmation
bot.action('withdraw_confirm', async (ctx) => {
    const user = ctx.from;
    const amount = ctx.session.withdraw_amount;
    const fee = ctx.session.withdraw_fee || 0;
    const method = ctx.session.withdraw_method || 'telebirr';
    const account = ctx.session.withdraw_account;
    const nickname = ctx.session.withdraw_nickname || 'N/A';
    const profile = await DB.getUserProfile(user.id);
    const available = profile.balance - profile.referral_balance;
    if (Math.round(amount + fee) > Math.round(available)) {
        await ctx.reply(`${EMOJI.CROSS} Balance changed.`, { ...mainKeyboard() });
        await ctx.deleteMessage();
        return;
    }
    const wId = await DB.createWithdrawal(user.id, method, amount, 'ETB', account, nickname, fee);
    const caption = `${EMOJI.WITHDRAW} <b>New Withdrawal Request</b>\n${EMOJI.USER} User: ${user.first_name}\n${EMOJI.TELEBIRR} Account: ${account}\n${EMOJI.USER} Nickname: ${nickname}\n${EMOJI.MONEY} Amount: ${Math.round(amount)} ETB\n${EMOJI.MONEY} Fee: ${Math.round(fee)} ETB\n🆔 Withdrawal ID: <code>${formatWithdrawalId(wId)}</code>`;
    const adminKb = Markup.inlineKeyboard([
        [Markup.button.callback('Approve', `admin_approve_wth:${wId}`), Markup.button.callback('Decline', `admin_decline_wth:${wId}`)]
    ]);
    for (const adminId of ADMIN_CHAT_IDS) {
        try {
            await ctx.telegram.sendMessage(adminId, caption, { parse_mode: 'HTML', ...adminKb });
        } catch (e) {}
    }
    await ctx.reply(`${EMOJI.SUCCESS} Withdrawal request submitted!\nAmount: ${Math.round(amount)} ETB to ${account}`, { ...mainKeyboard() });
    await ctx.deleteMessage();
    await reportEvent(ctx, `${EMOJI.WITHDRAW} <b>New Withdrawal Request</b>\n${EMOJI.USER} ${user.first_name} (ID: <code>${user.id}</code>)\n${EMOJI.MONEY} Amount: ${Math.round(amount)} ETB\n${EMOJI.TELEBIRR} Account: ${account}\n🆔 Withdrawal ID: <code>${formatWithdrawalId(wId)}</code>`);
    ctx.session = {};
});
bot.action('withdraw_cancel', async (ctx) => {
    ctx.session = {};
    await ctx.reply(`${EMOJI.CROSS} Withdrawal cancelled.`, { ...mainKeyboard() });
    await ctx.deleteMessage();
});

// Deposit methods
bot.action('menu_deposit', async (ctx) => {
    ctx.session.state = 'DEPOSIT_AMOUNT';
    const text = `${EMOJI.DEPOSIT} <b>Choose a deposit method</b>\n\nSelect how you'd like to add funds to your balance.`;
    if (isMediaMessage(ctx)) {
        await ctx.deleteMessage();
        await ctx.reply(text, { parse_mode: 'HTML', ...depositKeyboard() });
    } else {
        await safeEdit(ctx, text, { parse_mode: 'HTML', ...depositKeyboard() });
    }
});
bot.action(/^dep_method:(telebirr|cbe)$/, async (ctx) => {
    const method = ctx.match[1];
    ctx.session.dep_method = method;
    const text = method === 'cbe' ?
        `${EMOJI.CBE} <b>Deposit via CBE</b>\n\nPlease enter the amount (in ETB) you wish to deposit.\nMinimum: <b>${config.MIN_DEPOSIT_BIRR} ETB</b>\nMaximum: <b>${MAX_DEPOSIT_LIMIT} ETB</b>` :
        `${EMOJI.DEPOSIT} <b>Deposit via Telebirr</b>\n\nPlease enter the amount (in ETB) you wish to deposit.\nMinimum: <b>${config.MIN_DEPOSIT_BIRR} ETB</b>\nMaximum: <b>${MAX_DEPOSIT_LIMIT} ETB</b>`;
    if (isMediaMessage(ctx)) {
        await ctx.deleteMessage();
        await ctx.reply(text, { parse_mode: 'HTML', ...cancelKeyboard() });
    } else {
        await safeEdit(ctx, text, { parse_mode: 'HTML', ...cancelKeyboard() });
    }
    ctx.session.state = 'DEPOSIT_AMOUNT';
});

// Withdraw start
bot.action('menu_withdraw', async (ctx) => {
    const profile = await DB.getUserProfile(ctx.from.id);
    const available = profile.balance - profile.referral_balance;
    if (Math.round(available) < config.MIN_WITHDRAW_BIRR) {
        const msg = `${EMOJI.CROSS} Minimum withdrawal is ${config.MIN_WITHDRAW_BIRR} ETB.\nYour withdrawable balance (non-referral) is ${Math.round(available)} ETB.`;
        if (isMediaMessage(ctx)) {
            await ctx.deleteMessage();
            await ctx.reply(msg, { ...mainKeyboard() });
        } else {
            await safeEdit(ctx, msg, { ...mainKeyboard() });
        }
        return;
    }
    ctx.session.state = 'WITHDRAW_ACCOUNT';
    const text = `${EMOJI.TELEBIRR} <b>Enter your Telebirr account number / phone:</b>\n(e.g., 0967197797)`;
    if (isMediaMessage(ctx)) {
        await ctx.deleteMessage();
        await ctx.reply(text, { parse_mode: 'HTML', ...cancelKeyboard() });
    } else {
        await safeEdit(ctx, text, { parse_mode: 'HTML', ...cancelKeyboard() });
    }
});

// =========================== ADMIN PANEL ===========================
bot.action(/^admin_/, async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.answerCbQuery('Unauthorized.', true);
    const data = ctx.match[0];

    // Approve deposit
    if (data.startsWith('admin_approve_dep:')) {
        const id = parseInt(data.split(':')[1]);
        const success = await DB.approveDeposit(id);
        if (success) {
            const dep = await DB.getDepositById(id);
            await ctx.telegram.sendMessage(dep.user_id, `${EMOJI.SUCCESS} Deposit of ${Math.round(dep.amount)} ETB approved!`);
            await safeEdit(ctx, `✅ Deposit ${formatDepositId(id)} approved.`);
            await reportEvent(ctx, `✅ <b>Deposit Approved</b>\n👤 User ID: <code>${dep.user_id}</code>\n💵 Amount: ${Math.round(dep.amount)} ETB\n🆔 Deposit: <code>${formatDepositId(id)}</code>\n🛡️ By admin: ${ctx.from.first_name}`);
        } else {
            await ctx.answerCbQuery('Deposit not found or already processed.', true);
        }
        return;
    }

    // Decline deposit (opens reason input)
    if (data.startsWith('admin_decline_dep:')) {
        const id = parseInt(data.split(':')[1]);
        ctx.session.pending_decline = `dep_${id}`;
        await ctx.reply(`📝 Reply with the reason for declining deposit ${formatDepositId(id)}:`);
        await safeEdit(ctx, `❌ Deposit ${formatDepositId(id)} declined (pending reason).`);
        return;
    }

    // Approve withdrawal
    if (data.startsWith('admin_approve_wth:')) {
        const id = parseInt(data.split(':')[1]);
        const success = await DB.approveWithdrawal(id);
        if (success) {
            const w = await DB.getWithdrawalById(id);
            await ctx.telegram.sendMessage(w.user_id, `${EMOJI.SUCCESS} Withdrawal of ${Math.round(w.amount)} ETB to ${w.account} approved!`);
            await safeEdit(ctx, `✅ Withdrawal ${formatWithdrawalId(id)} approved.`);
            await reportEvent(ctx, `✅ <b>Withdrawal Approved</b>\n👤 User ID: <code>${w.user_id}</code>\n💵 Amount: ${Math.round(w.amount)} ETB\n📱 Account: ${w.account}\n🆔 Withdrawal: <code>${formatWithdrawalId(id)}</code>\n🛡️ By admin: ${ctx.from.first_name}`);
        } else {
            await ctx.answerCbQuery('Withdrawal not found or already processed.', true);
        }
        return;
    }

    // Decline withdrawal (opens reason input)
    if (data.startsWith('admin_decline_wth:')) {
        const id = parseInt(data.split(':')[1]);
        ctx.session.pending_decline = `wth_${id}`;
        await ctx.reply(`📝 Reply with the reason for declining withdrawal ${formatWithdrawalId(id)}:`);
        await safeEdit(ctx, `❌ Withdrawal ${formatWithdrawalId(id)} declined (pending reason).`);
        return;
    }

    // Dashboard
    if (data === 'admin_dashboard') {
        const stats = await DB.getDashboardStats();
        const text = `${EMOJI.INFO} <b>Dashboard</b>\n\n${EMOJI.USER} Total Users: ${stats.total_users}\n${EMOJI.MONEY} Total Deposits: ${stats.total_deposits} (Amount: ${Math.round(stats.total_deposit_amount)} ETB)\n⏳ Pending Deposits: ${stats.pending_deposits}\n${EMOJI.MONEY} Total Withdrawals: ${stats.total_withdrawals} (Amount: ${Math.round(stats.total_withdrawal_amount)} ETB)\n⏳ Pending Withdrawals: ${stats.pending_withdrawals}\n${EMOJI.ORDER} Total Orders: ${stats.total_orders}\n${EMOJI.MONEY} Today's Revenue: ${Math.round(stats.revenue_today)} ETB\n🛡️ Maintenance: ${MAINTENANCE_MODE ? 'ON' : 'OFF'}`;
        await safeEdit(ctx, text, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // Pending Deposits
    if (data === 'admin_deposits') {
        const pending = await DB.getPendingDeposits();
        if (!pending.length) {
            await safeEdit(ctx, 'No pending deposits.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        let text = `${EMOJI.MONEY} <b>Pending Deposits</b>\n\n`;
        for (const dep of pending) {
            text += `🆔 <code>${formatDepositId(dep.id)}</code> | User: ${dep.user_id}\nAmount: ${Math.round(dep.amount)} ETB | Method: ${dep.method}\nDate: ${dep.created_at.slice(0,10)}\n\n`;
        }
        const kb = [];
        for (const dep of pending) {
            kb.push([
                { text: `✅ Approve ${formatDepositId(dep.id)}`, callback_data: `admin_approve_dep:${dep.id}` },
                { text: `❌ Decline ${formatDepositId(dep.id)}`, callback_data: `admin_decline_dep:${dep.id}` }
            ]);
        }
        kb.push([{ text: 'Back', callback_data: 'admin_back' }]);
        await safeEdit(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        ctx.session.state = 'ADMIN_MANAGE_DEPOSITS';
        return;
    }

    // Pending Withdrawals
    if (data === 'admin_withdrawals') {
        const pending = await DB.getPendingWithdrawals();
        if (!pending.length) {
            await safeEdit(ctx, 'No pending withdrawals.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        let text = `${EMOJI.MONEY} <b>Pending Withdrawals</b>\n\n`;
        for (const w of pending) {
            text += `🆔 <code>${formatWithdrawalId(w.id)}</code> | User: ${w.user_id}\nAmount: ${Math.round(w.amount)} ETB | Account: ${w.account}\nNickname: ${w.nickname} | Fee: ${Math.round(w.fee || 0)} ETB\nDate: ${w.created_at.slice(0,10)}\n\n`;
        }
        const kb = [];
        for (const w of pending) {
            kb.push([
                { text: `✅ Approve ${formatWithdrawalId(w.id)}`, callback_data: `admin_approve_wth:${w.id}` },
                { text: `❌ Decline ${formatWithdrawalId(w.id)}`, callback_data: `admin_decline_wth:${w.id}` }
            ]);
        }
        kb.push([{ text: 'Back', callback_data: 'admin_back' }]);
        await safeEdit(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        ctx.session.state = 'ADMIN_MANAGE_WITHDRAWALS';
        return;
    }

    // Promo Codes
    if (data === 'admin_promo') {
        await safeEdit(ctx, `${EMOJI.MONEY} <b>Promo Codes Management</b>`, { parse_mode: 'HTML', ...adminPromoKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }
    if (data === 'admin_promo_create') {
        await ctx.reply(`➕ <b>Create Promo Code</b>\n\nFormat: amount [max_uses] [code]`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_CREATE_CODE';
        return;
    }
    if (data === 'admin_promo_list') {
        const codes = await DB.listPromoCodes();
        let text = codes.length ? `${EMOJI.MONEY} <b>Active Promo Codes</b>\n\n` : 'No active promo codes.';
        for (const c of codes) {
            text += `<code>${c.code}</code>: ${Math.round(c.amount)} ETB | ${c.used_count}/${c.max_uses} used\n`;
        }
        await ctx.reply(text, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }
    if (data === 'admin_promo_delete') {
        await ctx.reply(`🗑 <b>Delete Promo Code</b>\n\nReply with the code:`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_DELETE_CODE';
        return;
    }

    // Referral Lookup
    if (data === 'admin_referral') {
        await ctx.reply(`🔍 <b>Referral Lookup</b>\n\nEnter the user's Telegram ID:`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_REFERRAL_INPUT';
        return;
    }

    // Search by ID
    if (data === 'admin_search_by_id') {
        await safeEdit(ctx, `${EMOJI.SEARCH} <b>Search by ID</b>\n\nSelect the type:`, { parse_mode: 'HTML', ...searchByIdKeyboard() });
        ctx.session.state = 'ADMIN_SEARCH_BY_ID';
        return;
    }
    if (data.startsWith('admin_search_id:')) {
        const type = data.split(':')[1];
        ctx.session.admin_search_type = type;
        await safeEdit(ctx, `🔍 <b>Search ${type.charAt(0).toUpperCase() + type.slice(1)}</b>\n\nEnter the ID (numeric or formatted like EX101):`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_SEARCH_BY_ID';
        return;
    }

    // Settings
    if (data === 'admin_settings') {
        await safeEdit(ctx, `${EMOJI.SETTINGS} <b>Settings & Tools</b>`, { parse_mode: 'HTML', ...adminSettingsKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // User Management
    if (data === 'admin_user_manage') {
        await safeEdit(ctx, `${EMOJI.USER} <b>User Management</b>`, { parse_mode: 'HTML', ...userManageKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // Ban
    if (data === 'admin_ban') {
        await ctx.reply(`🚫 <b>Ban User</b>\n\nEnter the user's Telegram ID:`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_BAN';
        return;
    }

    // Unban
    if (data === 'admin_unban') {
        await ctx.reply(`✅ <b>Unban User</b>\n\nEnter the user's Telegram ID:`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_UNBAN';
        return;
    }

    // Set Balance
    if (data === 'admin_set_balance') {
        await ctx.reply(`💰 <b>Set Balance</b>\n\nEnter: <code>user_id amount</code>`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_SETBALANCE';
        return;
    }

    // Toggle Maintenance
    if (data === 'admin_toggle_maintenance') {
        MAINTENANCE_MODE = !MAINTENANCE_MODE;
        await saveSetting('maintenance_mode', MAINTENANCE_MODE ? '1' : '0');
        await ctx.reply(`🔄 Maintenance mode has been ${MAINTENANCE_MODE ? 'ENABLED' : 'DISABLED'}.`, { ...adminSettingsKeyboard() });
        await ctx.deleteMessage();
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // Toggle Reports
    if (data === 'admin_toggle_reports') {
        REPORT_EVENTS = !REPORT_EVENTS;
        await saveSetting('report_events', REPORT_EVENTS ? '1' : '0');
        await ctx.reply(`🔔 Reports have been ${REPORT_EVENTS ? 'ENABLED' : 'DISABLED'}.`, { ...adminSettingsKeyboard() });
        await ctx.deleteMessage();
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // Stars Markup
    if (data === 'admin_stars_markup') {
        await ctx.reply(`⭐ <b>Set Telegram Stars Markup</b>\n\nCurrent: <b>${Math.round(TELEGRAM_STARS_MARKUP)} ETB</b>\nEnter the fixed markup amount in ETB (e.g., 10):`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_STARS_MARKUP';
        return;
    }

    // Premium Markup
    if (data === 'admin_premium_markup') {
        await ctx.reply(`💎 <b>Set Telegram Premium Markup</b>\n\nCurrent: <b>${Math.round(TELEGRAM_PREMIUM_MARKUP)} ETB</b>\nEnter the fixed markup amount in ETB (e.g., 10):`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_PREMIUM_MARKUP';
        return;
    }

    // Set Product Price
    if (data === 'admin_set_product_price') {
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('Telegram Stars', 'admin_price_type:stars')],
            [Markup.button.callback('Telegram Premium', 'admin_price_type:premium')],
            [Markup.button.callback('Back', 'admin_back')]
        ]);
        await safeEdit(ctx, 'Select product type to set price:', { parse_mode: 'HTML', ...kb });
        ctx.session.state = 'ADMIN_SET_PRICE_TYPE';
        return;
    }
    if (data.startsWith('admin_price_type:')) {
        const ptype = data.split(':')[1];
        ctx.session.admin_price_type = ptype;
        const catalog = new CatalogService();
        const packages = ptype === 'stars' ? await catalog.getTelegramStarsPackages() : await catalog.getTelegramPremiumPlans();
        if (!packages.length) {
            await ctx.reply('No packages found.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const buttons = [];
        for (const pkg of packages) {
            const name = pkg.name || pkg.title || 'Package';
            let price = pkg._override_price;
            if (price === undefined || price === null) {
                const apiPrice = pkg.unit_price || pkg.price || pkg.amount || 0;
                const markup = ptype === 'stars' ? TELEGRAM_STARS_MARKUP : TELEGRAM_PREMIUM_MARKUP;
                price = apiPriceToBirr(apiPrice, markup);
            }
            const productId = pkg.id || pkg.code || pkg.name;
            buttons.push([{ text: `${name} - ${Math.round(price)} ETB`, callback_data: `admin_price_select:${productId}` }]);
        }
        buttons.push([{ text: 'Back', callback_data: 'admin_back' }]);
        await safeEdit(ctx, 'Select package to set price:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
        ctx.session.state = 'ADMIN_SET_PRICE_SELECT';
        return;
    }
    if (data.startsWith('admin_price_select:')) {
        const productId = data.split(':')[1];
        ctx.session.admin_price_product_id = productId;
        await safeEdit(ctx, 'Enter new price in ETB for this product (or 0 to remove override):', { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_SET_PRICE_INPUT';
        return;
    }

    // Broadcast
    if (data === 'admin_broadcast') {
        await ctx.reply(`📢 <b>Broadcast Message</b>\n\nReply with the message you want to send to all users:`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'ADMIN_BROADCAST';
        return;
    }

    // Back
    if (data === 'admin_back') {
        await safeEdit(ctx, `${EMOJI.INFO} <b>Admin Panel</b>`, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // Close
    if (data === 'admin_close') {
        await ctx.deleteMessage();
        ctx.session = {};
        return;
    }

    await ctx.answerCbQuery('Not implemented yet.', true);
});

// =========================== GENERAL DECLINE REASON ===========================
bot.on('text', async (ctx) => {
    if (!ctx.session.pending_decline) return;
    if (!ctx.message.reply_to_message) return;
    const key = ctx.session.pending_decline;
    const reason = ctx.message.text.trim() || 'No reason given';
    if (key.startsWith('dep_')) {
        const depositId = parseInt(key.replace('dep_', ''));
        const success = await DB.rejectDeposit(depositId, reason);
        if (success) {
            const dep = await DB.getDepositById(depositId);
            await ctx.telegram.sendMessage(dep.user_id, `${EMOJI.CROSS} Deposit rejected: ${reason}`);
            await ctx.reply('❌ Deposit rejected.');
            await reportEvent(ctx, `❌ <b>Deposit Declined</b>\n🆔 Deposit: <code>${formatDepositId(depositId)}</code>\n📝 Reason: ${reason}\n🛡️ By admin: ${ctx.from.first_name}`);
        } else {
            await ctx.reply('Failed.');
        }
    } else if (key.startsWith('wth_')) {
        const wId = parseInt(key.replace('wth_', ''));
        const success = await DB.rejectWithdrawal(wId, reason);
        if (success) {
            const w = await DB.getWithdrawalById(wId);
            await ctx.telegram.sendMessage(w.user_id, `${EMOJI.CROSS} Withdrawal of ${Math.round(w.amount)} ETB rejected: ${reason}`);
            await ctx.reply('❌ Withdrawal rejected.');
            await reportEvent(ctx, `❌ <b>Withdrawal Declined</b>\n🆔 Withdrawal: <code>${formatWithdrawalId(wId)}</code>\n📝 Reason: ${reason}\n🛡️ By admin: ${ctx.from.first_name}`);
        } else {
            await ctx.reply('Failed.');
        }
    }
    ctx.session.pending_decline = null;
});

// =========================== TEXT HANDLER (all states) ===========================
// This handles all user text inputs (deposit amount, withdrawal account, promo code, admin commands, etc.)
// We'll integrate it after the actions.

// Since the actions handle most callbacks, the text handler is for states like ENTER_UID, DEPOSIT_AMOUNT, WITHDRAW_ACCOUNT, etc.

bot.on('text', async (ctx) => {
    const state = ctx.session.state;
    if (!state) return;

    // ENTER_UID (for order)
    if (state === 'ENTER_UID') {
        const input = ctx.message.text.trim();
        if (!input.startsWith('@') && input.length < 4) {
            await ctx.reply(`${EMOJI.WARNING} Invalid username. Must start with @.`);
            return;
        }
        ctx.session.player_id = input;
        ctx.session.nickname = input;
        const gameCode = ctx.session.telegram_game_code || 'Telegram';
        const checking = await ctx.reply('🔍 Resolving Telegram username...');
        let resolved = null;
        try {
            const check = await G2BulkAPI.checkPlayerId(gameCode, input);
            if (check && (check.valid === 'valid' || check.success)) {
                resolved = check.name || check.nickname || input.slice(1);
            }
        } catch (e) {}
        if (!resolved) resolved = input.slice(1);
        ctx.session.nickname = resolved;
        await ctx.telegram.deleteMessage(ctx.chat.id, checking.message_id);
        const summary = `━━━━━━━━━━━━━━━━━━━━━━\n${EMOJI.ORDER} <b>Order Summary</b>\n\n${EMOJI.GAME} <b>Product:</b> ${ctx.session.game_name}\n${EMOJI.ORDER} <b>Service:</b> ${ctx.session.service_name}\n${EMOJI.USER} <b>Name:</b> ${resolved}\n${EMOJI.USER} <b>Username:</b> ${input}\n${EMOJI.MONEY} <b>Package:</b> ${ctx.session.package_display_name}\n${EMOJI.MONEY} <b>Price:</b> ${Math.round(ctx.session.charged_price)}ETB\n━━━━━━━━━━━━━━━━━━━━━━`;
        await ctx.reply(summary, { parse_mode: 'HTML', ...confirmKeyboard() });
        ctx.session.state = 'CONFIRM';
        return;
    }

    // DEPOSIT_AMOUNT
    if (state === 'DEPOSIT_AMOUNT') {
        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount < config.MIN_DEPOSIT_BIRR || amount > MAX_DEPOSIT_LIMIT) {
            await ctx.reply(`❌ Invalid amount. Min ${config.MIN_DEPOSIT_BIRR} ETB, max ${MAX_DEPOSIT_LIMIT} ETB.`);
            return;
        }
        ctx.session.intended_amount = amount;
        const method = ctx.session.dep_method || 'telebirr';
        const caption = method === 'cbe' ?
            `${EMOJI.CBE} <b>Send ${Math.round(amount)} ETB to:</b>\nAccount: <b>CBE</b>\nNumber: <code>${config.CBE_PHONE}</code>\nName: <b>${config.CBE_RECEIVER_NAME}</b>\n\nAfter the payment, reply with the <b>Transaction Link</b> (URL) from your CBE payment.\nExample: <code>https://... </code>` :
            `${EMOJI.TELEBIRR} <b>Send ${Math.round(amount)} ETB to:</b>\nName: <b>${config.EXPECTED_RECEIVER_NAME}</b>\nNumber: <code>${config.TELEBIRR_PHONE}</code>\n\nAfter the payment, reply with the <b>Transaction ID</b>.\nExample: <code>DG56K96NIK</code>`;
        const img = method === 'cbe' ? config.IMG_CBE_TRANSACTION_ID : config.IMG_TRANSACTION_ID;
        const sent = await ctx.replyWithPhoto({ url: img }, { caption, parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.last_photo = { chat_id: ctx.chat.id, message_id: sent.message_id };
        ctx.session.state = 'DEPOSIT_TXN';
        return;
    }

    // DEPOSIT_TXN
    if (state === 'DEPOSIT_TXN') {
        const ref = ctx.message.text.trim();
        if (!ref) return ctx.reply('Please enter a valid reference.');
        if (await DB.isTransactionUsed(ref)) {
            return ctx.reply(`${EMOJI.CROSS} This reference has already been used.`);
        }
        const verifying = await ctx.reply('⏳ Verifying your payment...');
        const method = ctx.session.dep_method || 'telebirr';
        const result = await verifyPayment(ref, method);
        if (result) {
            const amount = result.amount;
            const intended = ctx.session.intended_amount || amount;
            if (amount < config.MIN_DEPOSIT_BIRR) {
                await ctx.telegram.editMessageText(ctx.chat.id, verifying.message_id, null, `${EMOJI.CROSS} Amount too low.`);
                return;
            }
            const depositId = await DB.createDeposit(ctx.from.id, method, amount, 'ETB', '');
            await DB.approveDeposit(depositId, `Auto-approved Ref: ${ref}`);
            await DB.recordTransactionUse(ref, ctx.from.id, amount);
            await ctx.telegram.editMessageText(ctx.chat.id, verifying.message_id, null, `${EMOJI.SUCCESS} Payment verified! <b>${Math.round(amount)} ETB</b> added.`, { parse_mode: 'HTML' });
            if (amount > intended) {
                await ctx.reply(`⚠️ You deposited more than you specified (<b>${Math.round(intended)} ETB</b>). The extra <b>${Math.round(amount - intended)} ETB</b> has also been added to your balance.`);
            }
            await ctx.reply('📸 You may send a screenshot for records.', { ...mainKeyboard() });
            for (const adminId of ADMIN_CHAT_IDS) {
                try {
                    await ctx.telegram.sendMessage(adminId, `${EMOJI.MONEY} <b>Auto‑Approved Deposit</b>\n${EMOJI.USER} User: ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)\n${EMOJI.MONEY} Amount: <b>${Math.round(amount)} ETB</b>\n🔢 Ref: <code>${ref}</code>\n${EMOJI.CALENDAR} ${new Date().toISOString()} UTC`, { parse_mode: 'HTML' });
                } catch (e) {}
            }
            await reportEvent(ctx, `${EMOJI.MONEY} <b>Deposit (Auto)</b>\n${EMOJI.USER} ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)\n${EMOJI.MONEY} Amount: ${Math.round(amount)} ETB\n🔢 Ref: <code>${ref}</code>`);
            ctx.session.state = null;
            return;
        } else {
            await ctx.telegram.deleteMessage(ctx.chat.id, verifying.message_id);
            const attempts = (ctx.session.verify_attempts || 0) + 1;
            ctx.session.verify_attempts = attempts;
            if (attempts >= 3) {
                ctx.session.verify_attempts = 0;
                await ctx.reply(`${EMOJI.CROSS} Could not verify automatically after 3 tries. Please double‑check the reference and try again later, or contact support.`, { ...mainKeyboard() });
                ctx.session.state = null;
                return;
            } else {
                await ctx.reply(`${EMOJI.CROSS} Not found. ${3 - attempts} tries left.\nRe‑enter the reference.`, cancelKeyboard());
                return;
            }
        }
    }

    // WITHDRAW_ACCOUNT
    if (state === 'WITHDRAW_ACCOUNT') {
        const account = ctx.message.text.trim();
        if (!account) return ctx.reply('Please enter a valid account.');
        ctx.session.withdraw_account = account;
        await ctx.reply(`${EMOJI.USER} <b>Enter your nickname (shown to admin):</b>`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'WITHDRAW_NICKNAME';
        return;
    }

    // WITHDRAW_NICKNAME
    if (state === 'WITHDRAW_NICKNAME') {
        const nickname = ctx.message.text.trim();
        if (!nickname) return ctx.reply('Please enter your nickname.');
        ctx.session.withdraw_nickname = nickname;
        const profile = await DB.getUserProfile(ctx.from.id);
        const available = profile.balance - profile.referral_balance;
        await ctx.reply(`${EMOJI.WITHDRAW} <b>Withdraw via Telebirr</b>\nWithdrawable balance: ${Math.round(available)} ETB\nMinimum: ${config.MIN_WITHDRAW_BIRR} ETB\nFee: ${(WITHDRAWAL_FEE_PERCENT || 0) * 100}%\nEnter the amount to withdraw:`, { parse_mode: 'HTML', ...cancelKeyboard() });
        ctx.session.state = 'WITHDRAW_AMOUNT';
        return;
    }

    // WITHDRAW_AMOUNT
    if (state === 'WITHDRAW_AMOUNT') {
        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount < config.MIN_WITHDRAW_BIRR || amount > MAX_WITHDRAW_LIMIT) {
            return ctx.reply(`Invalid amount. Min ${config.MIN_WITHDRAW_BIRR} ETB, max ${MAX_WITHDRAW_LIMIT} ETB.`);
        }
        const profile = await DB.getUserProfile(ctx.from.id);
        const available = profile.balance - profile.referral_balance;
        const fee = amount * (WITHDRAWAL_FEE_PERCENT || 0);
        if (Math.round(amount + fee) > Math.round(available)) {
            return ctx.reply(`Insufficient withdrawable balance (need ${Math.round(amount + fee)} with fee).`);
        }
        ctx.session.withdraw_amount = amount;
        ctx.session.withdraw_fee = fee;
        ctx.session.withdraw_method = 'telebirr';
        await ctx.reply(`<b>Confirm withdrawal of ${Math.round(amount)} ETB (fee ${Math.round(fee)} ETB) to ${ctx.session.withdraw_account}</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([ [Markup.button.callback('Confirm', 'withdraw_confirm'), Markup.button.callback('Cancel', 'withdraw_cancel')] ]) });
        ctx.session.state = 'WITHDRAW_CONFIRM';
        return;
    }

    // PROFILE_REDEEM
    if (state === 'PROFILE_REDEEM') {
        const code = ctx.message.text.trim();
        const result = await DB.usePromoCode(code, ctx.from.id);
        if (!result.success) {
            await ctx.reply(`${EMOJI.CROSS} ${result.msg}`, { ...mainKeyboard() });
            ctx.session.state = null;
            return;
        }
        await DB.updateBalance(ctx.from.id, result.amount);
        await ctx.reply(`${EMOJI.SUCCESS} Promo code accepted! <b>${Math.round(result.amount)} ETB</b> added to your balance.`, { parse_mode: 'HTML', ...mainKeyboard() });
        await reportEvent(ctx, `${EMOJI.MONEY} <b>Promo Code Redeemed</b>\n${EMOJI.USER} ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)\n🏷 Code: <code>${code.toUpperCase()}</code>\n${EMOJI.MONEY} Amount added: ${Math.round(result.amount)} ETB`);
        ctx.session.state = null;
        return;
    }

    // PAYMENT_TXN
    if (state === 'PAYMENT_TXN') {
        const ref = ctx.message.text.trim();
        if (!ref) return ctx.reply('Please enter a valid reference.');
        if (await DB.isTransactionUsed(ref)) {
            return ctx.reply(`${EMOJI.CROSS} This reference has already been used.`);
        }
        const verifying = await ctx.reply('⏳ Verifying your payment...');
        const method = ctx.session.pay_method || 'telebirr';
        const charged = ctx.session.charged_price || 0;
        const result = await verifyPayment(ref, method);
        if (result) {
            const amount = result.amount;
            if (amount < charged) {
                await ctx.telegram.editMessageText(ctx.chat.id, verifying.message_id, null, `${EMOJI.CROSS} Payment amount (${Math.round(amount)} ETB) is less than the order total (${Math.round(charged)} ETB).`);
                return;
            }
            await DB.recordTransactionUse(ref, ctx.from.id, amount);
            await ctx.telegram.deleteMessage(ctx.chat.id, verifying.message_id);
            await placeOrderAfterVerification(ctx, method, ref, amount);
            ctx.session.state = null;
        } else {
            await ctx.telegram.deleteMessage(ctx.chat.id, verifying.message_id);
            const attempts = (ctx.session.verify_attempts || 0) + 1;
            ctx.session.verify_attempts = attempts;
            if (attempts >= 3) {
                ctx.session.verify_attempts = 0;
                await ctx.reply(`${EMOJI.CROSS} Verification failed after 3 attempts. Please try again later or contact support.`, { ...mainKeyboard() });
                ctx.session.state = null;
            } else {
                await ctx.reply(`${EMOJI.CROSS} Not found. ${3 - attempts} tries left.\nRe‑enter the reference.`, cancelKeyboard());
            }
        }
        return;
    }

    // ADMIN LOGIN
    if (state === 'ADMIN_LOGIN') {
        if (ctx.message.text === ADMIN_PASSWORD) {
            ctx.session.admin_authenticated = true;
            await ctx.reply('✅ Access granted.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
        } else {
            await ctx.reply('❌ Incorrect password. Try again or /cancel.');
        }
        return;
    }

    // ADMIN BROADCAST
    if (state === 'ADMIN_BROADCAST') {
        const text = ctx.message.text;
        if (text.toLowerCase() === 'cancel' || text.toLowerCase() === 'back') {
            await ctx.reply('Cancelled.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const users = await DB.getAllUsers();
        let success = 0;
        for (const uid of users) {
            try {
                await ctx.telegram.sendMessage(uid, text);
                success++;
            } catch (e) {}
        }
        await ctx.reply(`✅ Broadcast sent to ${success}/${users.length} users.`, { ...adminKeyboard() });
        await reportEvent(ctx, `📢 <b>Broadcast Sent</b>\n📨 Delivered: ${success}/${users.length}\n🛡️ By admin: ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)\n\n<b>Message:</b>\n${text.slice(0,600)}`);
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN CREATE CODE
    if (state === 'ADMIN_CREATE_CODE') {
        const args = ctx.message.text.trim().split(/\s+/);
        if (args.length < 1) {
            await ctx.reply('Invalid format. Usage: amount [max_uses] [code]', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const amount = parseFloat(args[0]);
        if (isNaN(amount)) {
            await ctx.reply('Invalid amount.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const max_uses = args.length > 1 ? parseInt(args[1]) : 1;
        const code = args.length > 2 ? args[2].toUpperCase() : uuidv4().slice(0,8).toUpperCase();
        const success = await DB.createPromoCode(code, amount, max_uses);
        if (success) {
            await ctx.reply(`✅ Code <b>${code}</b> created for ${Math.round(amount)} ETB, uses: ${max_uses}`, { parse_mode: 'HTML', ...adminKeyboard() });
            await reportEvent(ctx, `🎟️ <b>Promo Code Created</b>\n🏷 Code: <code>${code}</code>\n💵 Amount: ${Math.round(amount)} ETB\n🔢 Max uses: ${max_uses}\n🛡️ By admin: ${ctx.from.first_name}`);
        } else {
            await ctx.reply('❌ Code already exists.', { ...adminKeyboard() });
        }
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN DELETE CODE
    if (state === 'ADMIN_DELETE_CODE') {
        const code = ctx.message.text.trim().toUpperCase();
        if (!code) {
            await ctx.reply('Please provide a code.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        await DB.deletePromoCode(code);
        await ctx.reply(`✅ Code <b>${code}</b> deleted.`, { parse_mode: 'HTML', ...adminKeyboard() });
        await reportEvent(ctx, `🎟️ <b>Promo Code Deleted</b>\n🏷 Code: <code>${code}</code>\n🛡️ By admin: ${ctx.from.first_name}`);
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN REFERRAL LOOKUP
    if (state === 'ADMIN_REFERRAL_INPUT') {
        const text = ctx.message.text.trim();
        if (text.toLowerCase() === 'cancel' || text.toLowerCase() === 'back') {
            await ctx.reply('Cancelled.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const userId = parseInt(text);
        if (isNaN(userId)) {
            await ctx.reply('Invalid ID.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const stats = await DB.getReferralStats(userId);
        const list = await DB.getReferralList(userId);
        let msg = `${EMOJI.INFO} <b>Referral Stats for ID <code>${userId}</code></b>\n\n${EMOJI.USER} Total invited: <b>${stats.total}</b>\n${EMOJI.MONEY} Rewarded: <b>${stats.rewarded}</b>\n${EMOJI.MONEY} Total earned: <b>${Math.round(stats.total_reward)} ETB</b>\n\n`;
        if (list.length) {
            msg += '<b>Recent invites:</b>\n';
            for (const r of list) {
                const icon = r.reward_given ? EMOJI.SUCCESS : EMOJI.CLOCK;
                msg += `${icon} <code>${r.referred_id}</code> (${r.status}) – ${r.created_at.slice(0,10)}\n`;
            }
        } else {
            msg += '<i>No invites yet.</i>';
        }
        await ctx.reply(msg, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN SEARCH BY ID
    if (state === 'ADMIN_SEARCH_BY_ID') {
        const input = ctx.message.text.trim();
        const searchType = ctx.session.admin_search_type;
        let resultText = '';
        if (searchType === 'order') {
            let order = null;
            const numericId = parseInt(input);
            if (!isNaN(numericId)) {
                order = await DB.getOrderByNumericId(numericId);
            }
            if (!order) {
                order = await DB.getOrderById(input);
            }
            if (!order) {
                await ctx.reply(`${EMOJI.CROSS} Order not found.`, { ...adminKeyboard() });
                ctx.session.state = 'ADMIN_MAIN';
                return;
            }
            const username = await DB.getUsername(order.telegram_id) || 'Unknown';
            resultText = `${EMOJI.ORDER} <b>Order Details</b>\n\n🆔 Order ID: <code>${order.order_id}</code> (numeric: ${order.id})\n${EMOJI.USER} User: <code>${order.telegram_id}</code> (@${username})\n${EMOJI.GAME} Game: ${order.game}\n${EMOJI.ORDER} Package: ${order.package_name}\n${EMOJI.MONEY} Charged: ${Math.round(order.charged_price)} ETB\n${EMOJI.SUCCESS} Status: ${order.status}\n${EMOJI.CALENDAR} Created: ${order.created_at}`;
        } else if (searchType === 'deposit') {
            const numericId = parseFormattedId(input) || parseInt(input);
            if (isNaN(numericId)) {
                await ctx.reply('Invalid deposit ID.', { ...adminKeyboard() });
                ctx.session.state = 'ADMIN_MAIN';
                return;
            }
            const deposit = await DB.getDepositById(numericId);
            if (!deposit) {
                await ctx.reply(`${EMOJI.CROSS} Deposit not found.`, { ...adminKeyboard() });
                ctx.session.state = 'ADMIN_MAIN';
                return;
            }
            const username = await DB.getUsername(deposit.user_id) || 'Unknown';
            resultText = `${EMOJI.MONEY} <b>Deposit Details</b>\n\n🆔 Deposit ID: <code>${formatDepositId(deposit.id)}</code>\n${EMOJI.USER} User: <code>${deposit.user_id}</code> (@${username})\n${EMOJI.MONEY} Amount: ${Math.round(deposit.amount)} ${deposit.currency}\n${EMOJI.TELEBIRR} Method: ${deposit.method}\n${EMOJI.SUCCESS} Status: ${deposit.status}\n${EMOJI.CALENDAR} Created: ${deposit.created_at}\n${EMOJI.INFO} Admin Note: ${deposit.admin_note || 'N/A'}`;
        } else if (searchType === 'withdrawal') {
            const numericId = parseFormattedId(input) || parseInt(input);
            if (isNaN(numericId)) {
                await ctx.reply('Invalid withdrawal ID.', { ...adminKeyboard() });
                ctx.session.state = 'ADMIN_MAIN';
                return;
            }
            const withdrawal = await DB.getWithdrawalById(numericId);
            if (!withdrawal) {
                await ctx.reply(`${EMOJI.CROSS} Withdrawal not found.`, { ...adminKeyboard() });
                ctx.session.state = 'ADMIN_MAIN';
                return;
            }
            const username = await DB.getUsername(withdrawal.user_id) || 'Unknown';
            resultText = `${EMOJI.MONEY} <b>Withdrawal Details</b>\n\n🆔 Withdrawal ID: <code>${formatWithdrawalId(withdrawal.id)}</code>\n${EMOJI.USER} User: <code>${withdrawal.user_id}</code> (@${username})\n${EMOJI.MONEY} Amount: ${Math.round(withdrawal.amount)} ${withdrawal.currency}\n${EMOJI.TELEBIRR} Account: ${withdrawal.account}\n${EMOJI.USER} Nickname: ${withdrawal.nickname}\n${EMOJI.MONEY} Fee: ${Math.round(withdrawal.fee || 0)} ETB\n${EMOJI.SUCCESS} Status: ${withdrawal.status}\n${EMOJI.CALENDAR} Created: ${withdrawal.created_at}\n${EMOJI.INFO} Admin Note: ${withdrawal.admin_note || 'N/A'}`;
        } else {
            await ctx.reply('Invalid search type.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        await ctx.reply(resultText, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN BAN
    if (state === 'ADMIN_BAN') {
        const uid = parseInt(ctx.message.text.trim());
        if (isNaN(uid)) {
            await ctx.reply('Invalid ID.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        await DB.banUser(uid);
        await ctx.reply(`🚫 User <code>${uid}</code> banned.`, { parse_mode: 'HTML', ...adminKeyboard() });
        await reportEvent(ctx, `🚫 <b>User Banned</b>\n👤 User ID: <code>${uid}</code>\n🛡️ By admin: ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)`);
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN UNBAN
    if (state === 'ADMIN_UNBAN') {
        const uid = parseInt(ctx.message.text.trim());
        if (isNaN(uid)) {
            await ctx.reply('Invalid ID.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        await DB.unbanUser(uid);
        await ctx.reply(`✅ User <code>${uid}</code> unbanned.`, { parse_mode: 'HTML', ...adminKeyboard() });
        await reportEvent(ctx, `✅ <b>User Unbanned</b>\n👤 User ID: <code>${uid}</code>\n🛡️ By admin: ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)`);
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN SET BALANCE
    if (state === 'ADMIN_SETBALANCE') {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length !== 2) {
            await ctx.reply('Format: user_id amount', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        const uid = parseInt(parts[0]);
        const amount = parseFloat(parts[1]);
        if (isNaN(uid) || isNaN(amount)) {
            await ctx.reply('Invalid numbers.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        await DB.setBalance(uid, amount);
        await ctx.reply(`💰 Balance of <code>${uid}</code> set to <b>${Math.round(amount)} ETB</b>.`, { parse_mode: 'HTML', ...adminKeyboard() });
        await reportEvent(ctx, `💰 <b>Balance Set by Admin</b>\n👤 User ID: <code>${uid}</code>\n💵 New balance: <b>${Math.round(amount)} ETB</b>\n🛡️ By admin: ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)`);
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN STARS MARKUP
    if (state === 'ADMIN_STARS_MARKUP') {
        const amount = parseFloat(ctx.message.text.trim());
        if (isNaN(amount) || amount < 0) {
            await ctx.reply('Invalid amount. Enter 0 or greater.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        TELEGRAM_STARS_MARKUP = amount;
        await saveSetting('telegram_stars_markup', amount);
        await ctx.reply(`✅ Telegram Stars markup set to <b>${Math.round(amount)} ETB</b>.`, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN PREMIUM MARKUP
    if (state === 'ADMIN_PREMIUM_MARKUP') {
        const amount = parseFloat(ctx.message.text.trim());
        if (isNaN(amount) || amount < 0) {
            await ctx.reply('Invalid amount. Enter 0 or greater.', { ...adminKeyboard() });
            ctx.session.state = 'ADMIN_MAIN';
            return;
        }
        TELEGRAM_PREMIUM_MARKUP = amount;
        await saveSetting('telegram_premium_markup', amount);
        await ctx.reply(`✅ Telegram Premium markup set to <b>${Math.round(amount)} ETB</b>.`, { parse_mode: 'HTML', ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // ADMIN SET PRODUCT PRICE INPUT
    if (state === 'ADMIN_SET_PRICE_INPUT') {
        const newPrice = parseFloat(ctx.message.text.trim());
        if (isNaN(newPrice)) {
            await ctx.reply('Invalid number. Please enter a valid amount.');
            return;
        }
        const productId = ctx.session.admin_price_product_id;
        const ptype = ctx.session.admin_price_type || 'stars';
        if (newPrice <= 0) {
            await DB.setProductPriceOverride(productId, null, ptype);
            await ctx.reply(`✅ Price override removed for product.`, { ...adminKeyboard() });
        } else {
            await DB.setProductPriceOverride(productId, newPrice, ptype);
            await ctx.reply(`✅ Price set to ${Math.round(newPrice)} ETB for product.`, { ...adminKeyboard() });
        }
        await ctx.reply('Returning to admin panel.', { ...adminKeyboard() });
        ctx.session.state = 'ADMIN_MAIN';
        return;
    }

    // fallback
    console.warn('Unhandled text in state:', state);
});

// =========================== LEGACY COMMANDS ===========================
bot.command('broadcast', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return;
    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply('Usage: /broadcast <message>');
    const users = await DB.getAllUsers();
    let success = 0;
    for (const uid of users) {
        try {
            await ctx.telegram.sendMessage(uid, text);
            success++;
        } catch (e) {}
    }
    await ctx.reply(`✅ Broadcast sent to ${success}/${users.length} users.`);
});

bot.command('gencode', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 1) return ctx.reply('Usage: /gencode <amount> [max_uses] [code]');
    const amount = parseFloat(args[0]);
    if (isNaN(amount)) return ctx.reply('Invalid amount.');
    const max_uses = args.length > 1 ? parseInt(args[1]) : 1;
    const code = args.length > 2 ? args[2].toUpperCase() : uuidv4().slice(0,8).toUpperCase();
    const success = await DB.createPromoCode(code, amount, max_uses);
    if (success) {
        await ctx.reply(`✅ Code <b>${code}</b> created for ${Math.round(amount)} ETB, uses: ${max_uses}`, { parse_mode: 'HTML' });
    } else {
        await ctx.reply('❌ Code already exists.');
    }
});

bot.command('listcodes', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return;
    const codes = await DB.listPromoCodes();
    if (!codes.length) return ctx.reply('No promo codes found.');
    let msg = '🎟️ <b>Active Promo Codes</b>\n\n';
    for (const c of codes) {
        msg += `<code>${c.code}</code>: ${Math.round(c.amount)} ETB | ${c.used_count}/${c.max_uses} used\n`;
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('delcode', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (!args.length) return ctx.reply('Usage: /delcode <code>');
    const code = args[0].toUpperCase();
    await DB.deletePromoCode(code);
    await ctx.reply(`✅ Code <b>${code}</b> deleted.`, { parse_mode: 'HTML' });
});

bot.command('refer', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (!args.length) return ctx.reply('Usage: /refer <user_id>');
    const userId = parseInt(args[0]);
    if (isNaN(userId)) return ctx.reply('Invalid ID.');
    const stats = await DB.getReferralStats(userId);
    const list = await DB.getReferralList(userId);
    let msg = `${EMOJI.INFO} <b>Referral Stats for ID <code>${userId}</code></b>\n\n${EMOJI.USER} Total invited: <b>${stats.total}</b>\n${EMOJI.MONEY} Rewarded: <b>${stats.rewarded}</b>\n${EMOJI.MONEY} Total earned: <b>${Math.round(stats.total_reward)} ETB</b>\n\n`;
    if (list.length) {
        msg += '<b>Recent invites:</b>\n';
        for (const r of list) {
            const icon = r.reward_given ? EMOJI.SUCCESS : EMOJI.CLOCK;
            msg += `${icon} <code>${r.referred_id}</code> (${r.status}) – ${r.created_at.slice(0,10)}\n`;
        }
    } else {
        msg += '<i>No invites yet.</i>';
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('listgames', async (ctx) => {
    if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return;
    const games = await G2BulkAPI.getGames();
    if (!games || !games.success) return ctx.reply('No games found.');
    let msg = `${EMOJI.GAME} <b>Game Codes</b>\n\n`;
    for (const g of games.games || []) {
        msg += `<code>${g.code}</code> – ${g.name}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
});

// =========================== WALLET PURCHASE & ORDER PLACEMENT ===========================
async function processWalletPurchase(ctx) {
    try {
        const user = ctx.from;
        if (await DB.isBanned(user.id)) return ctx.reply(`${EMOJI.CROSS} You are banned.`);
        const profile = await DB.getUserProfile(user.id);
        const balance = profile.balance;
        const charged = ctx.session.charged_price || 0;
        if (Math.round(balance * 100) / 100 < Math.round(charged * 100) / 100) {
            await ctx.reply(`${EMOJI.CROSS} <b>Insufficient Balance</b>\nRequired: ${Math.round(charged)}ETB\nYour Balance: ${Math.round(balance)}ETB`, { parse_mode: 'HTML', ...mainKeyboard() });
            await ctx.deleteMessage();
            return;
        }
        if (!(await DB.canPlaceOrder(user.id))) {
            await ctx.reply(`${EMOJI.CROSS} You have reached the daily order limit.`, { ...mainKeyboard() });
            await ctx.deleteMessage();
            return;
        }
        await safeEdit(ctx, '⏳ Processing order...', { parse_mode: 'HTML' });
        await placeOrderAfterVerification(ctx, 'wallet');
    } catch (e) {
        console.error(e);
        await ctx.reply(`${EMOJI.WARNING} An internal error occurred. Please try again.`, { ...mainKeyboard() });
        await ctx.deleteMessage();
    }
}

async function placeOrderAfterVerification(ctx, paymentMethod, txnId = '', verifiedAmount = 0) {
    try {
        const user = ctx.from;
        const db = DB;
        const charged = ctx.session.charged_price || 0;
        if (paymentMethod !== 'wallet' && verifiedAmount > 0 && verifiedAmount > charged) {
            const surplus = verifiedAmount - charged;
            await db.updateBalance(user.id, surplus);
            await ctx.reply(`${EMOJI.MONEY} <b>Overpayment detected!</b>\nYou sent <b>${Math.round(verifiedAmount)} ETB</b>, but the order only costs <b>${Math.round(charged)} ETB</b>.\nThe surplus <b>${Math.round(surplus)} ETB</b> has been added to your wallet balance.`, { parse_mode: 'HTML' });
        }
        if (paymentMethod === 'wallet') {
            await db.updateBalance(user.id, -charged);
            const refBal = await db.getReferralBalance(user.id);
            if (refBal > 0) {
                const deduct = Math.min(refBal, charged);
                await db.updateReferralBalance(user.id, -deduct);
            }
        }
        const gameCode = ctx.session.telegram_game_code || 'Telegram';
        const packageName = ctx.session.package_name;
        const displayName = ctx.session.package_display_name || packageName;
        const playerId = ctx.session.player_id;
        const nickname = ctx.session.nickname || playerId;
        const apiPrice = ctx.session.api_price || 0;
        const gameName = ctx.session.game_name || 'Telegram';
        const serviceName = ctx.session.service_name || 'Direct Top-Up';
        const markup = ctx.session.markup || 0;
        const idempotencyKey = uuidv4();
        const pid = (playerId || '').trim();
        if (!pid) {
            await ctx.reply(`${EMOJI.CROSS} Missing recipient. Please re-enter your Telegram username.`, { ...mainKeyboard() });
            return;
        }
        const orderRes = await G2BulkAPI.placeOrder(gameCode, packageName, pid, idempotencyKey);
        if (orderRes && orderRes.success) {
            const apiOrder = orderRes.order || {};
            const apiOrderId = apiOrder.order_id || orderRes.order_id || uuidv4().slice(0,8);
            let codesDelivered = '';
            if (orderRes.codes) {
                if (Array.isArray(orderRes.codes)) {
                    codesDelivered = orderRes.codes.map(c => `🔑 <code>${c}</code>`).join('\n');
                } else {
                    codesDelivered = `🔑 <code>${orderRes.codes}</code>`;
                }
            } else if (orderRes.pin) {
                codesDelivered = `🔑 <code>${orderRes.pin}</code>`;
            } else if (orderRes.code) {
                codesDelivered = `🔑 <code>${orderRes.code}</code>`;
            }
            await db.createOrder(user.id, apiOrderId, 'COMPLETED', gameName, serviceName, playerId, nickname, packageName, apiPrice, charged, markup, JSON.stringify(orderRes));
            await db.incrementOrderCount(user.id);
            const deliveredDirectly = !codesDelivered;
            let successMsg = `${EMOJI.SUCCESS} <b>Purchase Successful!</b>\n\n${EMOJI.ORDER} <b>Order ID:</b> <code>${apiOrderId}</code>\n${EMOJI.USER} <b>Nickname:</b> <code>${nickname}</code>\n${EMOJI.USER} <b>Username:</b> <code>${playerId}</code>\n${EMOJI.GAME} <b>Product:</b> ${gameName}\n${EMOJI.ORDER} <b>Service:</b> ${serviceName}\n${EMOJI.MONEY} <b>Package:</b> ${displayName}\n${EMOJI.MONEY} <b>Charged:</b> ${Math.round(charged)}ETB\n${EMOJI.CALENDAR} <b>Date:</b> ${new Date().toISOString()} UTC\n${EMOJI.SUCCESS} <b>Status:</b> Completed`;
            if (deliveredDirectly) {
                successMsg += `\n\n✨ <b>Delivered directly</b> to <code>${playerId}</code>'s Telegram account.`;
            } else if (codesDelivered) {
                successMsg += `\n\n🎁 <b>Redeem Code:</b>\n${codesDelivered}\n\n_Redeem this code in your Telegram account to activate._`;
            }
            if (paymentMethod !== 'wallet') {
                successMsg += `\n\n${EMOJI.WALLET} <b>Paid via:</b> ${paymentMethod.toUpperCase()} (Ref: ${txnId})`;
            }
            await ctx.reply(successMsg, { parse_mode: 'HTML', ...mainKeyboard() });
            await ctx.deleteMessage();
            const proofText = `${EMOJI.ORDER} <b>New Purchase</b>\n${EMOJI.USER} ${user.first_name} (ID: <code>${user.id}</code>)\n${EMOJI.GAME} ${gameName}\n${EMOJI.MONEY} ${displayName} – ${Math.round(charged)}ETB\n🆔 Order: <code>${apiOrderId}</code>\n${EMOJI.WALLET} Payment: ${paymentMethod.toUpperCase()}`;
            await reportEvent(ctx, proofText);
        } else {
            const errMsg = orderRes.message || 'Gateway failed.';
            if (paymentMethod === 'wallet') {
                await db.updateBalance(user.id, charged);
            }
            await ctx.reply(`${EMOJI.CROSS} <b>Purchase Failed</b>\n\n⚠️ ${errMsg}`, { parse_mode: 'HTML', ...mainKeyboard() });
            await ctx.deleteMessage();
            await reportEvent(ctx, `${EMOJI.CROSS} <b>Order Failed</b>\n${EMOJI.USER} ${user.first_name} (ID: <code>${user.id}</code>)\n${EMOJI.GAME} ${gameName} / ${displayName}\n🆔 Player: <code>${playerId}</code>\n${EMOJI.MONEY} Charged: ${Math.round(charged)} ETB\n⚠️ Error: ${errMsg}`);
        }
        ctx.session = {};
    } catch (e) {
        console.error(e);
        await ctx.reply(`${EMOJI.WARNING} An internal error occurred. Please try again.`, { ...mainKeyboard() });
        await ctx.deleteMessage();
        await reportEvent(ctx, `${EMOJI.WARNING} <b>Order Internal Error</b>\n${EMOJI.USER} ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)\n💥 ${e.message}`);
    }
}

// =========================== LAUNCH ===========================
(async () => {
    await initDB();
    const settings = await all("SELECT key FROM settings");
    const setIfMissing = async (key, val) => {
        if (!settings.find(s => s.key === key)) await saveSetting(key, val);
    };
    await setIfMissing('maintenance_mode', '0');
    await setIfMissing('withdrawal_fee_percent', '0');
    await setIfMissing('max_deposit_limit', '100000');
    await setIfMissing('max_withdraw_limit', '50000');
    await setIfMissing('max_daily_orders', '50');
    await setIfMissing('report_events', '1');
    await setIfMissing('telegram_stars_markup', '0');
    await setIfMissing('telegram_premium_markup', '0');

    console.log('Bot started successfully.');
    await bot.launch();
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));