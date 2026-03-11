const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'barber.db');

let db = null;
let rawDb = null;
let SQL = null;
let saveTimer = null;

// Save database to file (debounced)
function saveDb() {
  if (!rawDb) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = rawDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) { console.error('DB save error:', e); }
  }, 100);
}

function saveDbSync() {
  if (!rawDb) return;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = rawDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) { console.error('DB save error:', e); }
}

// sql.js wrapper to mimic better-sqlite3 API
function createWrapper(database) {
  return {
    prepare(sql) {
      return {
        run(...params) {
          database.run(sql, params);
          saveDb();
          const lastId = database.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] || 0;
          const changes = database.getRowsModified();
          return { lastInsertRowid: lastId, changes };
        },
        get(...params) {
          const stmt = database.prepare(sql);
          if (params.length) stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((c, i) => { row[c] = vals[i]; });
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const results = [];
          const stmt = database.prepare(sql);
          if (params.length) stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => { row[c] = vals[i]; });
            results.push(row);
          }
          stmt.free();
          return results;
        }
      };
    },
    exec(sql) {
      database.run(sql);
      saveDb();
    },
    pragma(str) {
      try { database.run(`PRAGMA ${str}`); } catch(e) {}
    },
    transaction(fn) {
      return (...args) => {
        database.run('BEGIN TRANSACTION');
        try {
          fn(...args);
          database.run('COMMIT');
          saveDb();
        } catch(e) {
          database.run('ROLLBACK');
          throw e;
        }
      };
    }
  };
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

async function initDatabase() {
  SQL = await initSqlJs();

  // Load existing DB or create new
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  rawDb.run("PRAGMA foreign_keys = ON");

  db = createWrapper(rawDb);

  // Create tables
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'barber' CHECK(role IN ('admin','barber','client')),
      display_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS barbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      specialty TEXT,
      work_start_time TEXT DEFAULT '09:00',
      work_end_time TEXT DEFAULT '18:00',
      work_days TEXT DEFAULT '0,1,2,3,4',
      slot_duration INTEGER DEFAULT 30,
      color TEXT DEFAULT '#4F46E5',
      active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      vip INTEGER DEFAULT 0,
      total_visits INTEGER DEFAULT 0,
      last_visit DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      duration INTEGER NOT NULL DEFAULT 30,
      price REAL NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#10B981',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      barber_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled','no_show')),
      notes TEXT,
      reminder_sent INTEGER DEFAULT 0,
      price REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (barber_id) REFERENCES barbers(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    )
  `);
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS days_off (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      reason TEXT,
      FOREIGN KEY (barber_id) REFERENCES barbers(id),
      UNIQUE(barber_id, date)
    )
  `);
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Indexes
  try { rawDb.run("CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date)"); } catch(e) {}
  try { rawDb.run("CREATE INDEX IF NOT EXISTS idx_appointments_barber ON appointments(barber_id, date)"); } catch(e) {}
  try { rawDb.run("CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id)"); } catch(e) {}
  try { rawDb.run("CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)"); } catch(e) {}
  try { rawDb.run("CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)"); } catch(e) {}
  try { rawDb.run("CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)"); } catch(e) {}

  // Seed if empty
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (userCount.c === 0) {
    seedData(db);
    saveDbSync();
  }

  console.log('Database initialized at', DB_PATH);
  return db;
}

function seedData(db) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);

  // Admin user
  db.prepare("INSERT INTO users (username, password, role, display_name, email) VALUES (?, ?, 'admin', ?, ?)").run(
    'admin', hashedPassword, 'מנהל המערכת', 'admin@barber.co.il'
  );

  // Barbers
  const b1 = db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'barber', ?)").run('yossi', hashedPassword, 'יוסי');
  const b2 = db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'barber', ?)").run('david', hashedPassword, 'דוד');
  const b3 = db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'barber', ?)").run('moshe', hashedPassword, 'משה');

  db.prepare("INSERT INTO barbers (user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?)").run(b1.lastInsertRowid, 'יוסי כהן', '050-1234567', 'תספורות גברים', '#4F46E5', '0,1,2,3,4');
  db.prepare("INSERT INTO barbers (user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?)").run(b2.lastInsertRowid, 'דוד לוי', '050-7654321', 'עיצוב זקן', '#EF4444', '0,1,2,3,4,5');
  db.prepare("INSERT INTO barbers (user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?)").run(b3.lastInsertRowid, 'משה ישראלי', '050-9876543', 'צבע שיער', '#F59E0B', '0,1,2,4');

  // Services
  const services = [
    ['תספורת גברים', 'תספורת קלאסית לגברים', 30, 60, '#4F46E5', 1],
    ['תספורת + זקן', 'תספורת גברים כולל עיצוב זקן', 45, 90, '#10B981', 2],
    ['עיצוב זקן', 'עיצוב וטיפוח זקן', 20, 40, '#F59E0B', 3],
    ['צבע שיער', 'צביעת שיער מקצועית', 60, 120, '#EF4444', 4],
    ['תספורת ילדים', 'תספורת לילדים עד גיל 12', 20, 45, '#8B5CF6', 5],
    ['גילוח חלק', 'גילוח עם סכין ומגבת חמה', 25, 50, '#EC4899', 6],
    ['טיפול פנים', 'טיפול פנים מרענן לגברים', 40, 80, '#06B6D4', 7],
    ['חבילת חתן', 'תספורת + זקן + טיפול פנים', 90, 200, '#D97706', 8],
  ];
  for (const s of services) {
    db.prepare('INSERT INTO services (name, description, duration, price, color, sort_order) VALUES (?,?,?,?,?,?)').run(...s);
  }

  // Clients
  const clients = [
    ['אבי כהן', '052-1111111', 'avi@email.com', 'לקוח קבוע, מעדיף יום שלישי', 1],
    ['משה לוי', '052-2222222', 'moshe@email.com', '', 0],
    ['יעקב ישראלי', '052-3333333', 'yakov@email.com', 'אלרגיה לחומרי צביעה', 0],
    ['דני אברהם', '052-4444444', 'dani@email.com', 'VIP - לקוח מהתחלה', 1],
    ['רון גולן', '052-5555555', 'ron@email.com', '', 0],
  ];
  for (const c of clients) {
    db.prepare('INSERT INTO clients (name, phone, email, notes, vip) VALUES (?,?,?,?,?)').run(...c);
  }

  // Sample appointments
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ds = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const appts = [
    [1, 1, 1, ds, '09:00', '09:30', 30, 'confirmed', 60],
    [2, 1, 2, ds, '10:00', '10:45', 45, 'confirmed', 90],
    [3, 2, 3, ds, '11:00', '11:20', 20, 'pending', 40],
    [4, 2, 1, ds, '14:00', '14:30', 30, 'pending', 60],
    [5, 3, 5, ds, '09:30', '09:50', 20, 'confirmed', 45],
  ];
  for (const a of appts) {
    db.prepare('INSERT INTO appointments (client_id, barber_id, service_id, date, start_time, end_time, duration, status, price) VALUES (?,?,?,?,?,?,?,?,?)').run(...a);
  }

  // Settings
  const settings = [
    ['shop_name', 'הספרייה של יוסי'],
    ['shop_phone', '03-1234567'],
    ['shop_address', 'רחוב הרצל 10, תל אביב'],
    ['open_time', '09:00'],
    ['close_time', '20:00'],
    ['slot_interval', '15'],
    ['allow_self_booking', 'false'],
  ];
  for (const s of settings) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(...s);
  }
}

module.exports = { getDb, initDatabase };
