const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Convert ? placeholders to $1, $2, etc.
function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

// Check if SQL is a plain INSERT (not ON CONFLICT / RETURNING)
function isPlainInsert(sql) {
  return /^\s*INSERT/i.test(sql) && !/ON\s+CONFLICT/i.test(sql) && !/RETURNING/i.test(sql);
}

// Database wrapper - mimics the old sync API but all methods are async
const db = {
  prepare(sql) {
    const pgSql = convertPlaceholders(sql);
    const addReturning = isPlainInsert(sql);

    return {
      async run(...params) {
        let querySql = pgSql;
        if (addReturning) {
          querySql += ' RETURNING id';
        }
        const result = await pool.query(querySql, params);
        return {
          lastInsertRowid: result.rows[0]?.id || 0,
          changes: result.rowCount
        };
      },
      async get(...params) {
        const result = await pool.query(pgSql, params);
        return result.rows[0] || undefined;
      },
      async all(...params) {
        const result = await pool.query(pgSql, params);
        return result.rows;
      }
    };
  },
  async query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result;
  },
  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb = {
          prepare(sql) {
            const pgSql = convertPlaceholders(sql);
            return {
              async run(...params) {
                const result = await client.query(pgSql, params);
                return { lastInsertRowid: result.rows[0]?.id || 0, changes: result.rowCount };
              },
              async get(...params) {
                const result = await client.query(pgSql, params);
                return result.rows[0] || undefined;
              },
              async all(...params) {
                const result = await client.query(pgSql, params);
                return result.rows;
              }
            };
          }
        };
        await fn(txDb, ...args);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  }
};

function getDb() {
  return db;
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'barber' CHECK(role IN ('admin','barber','client')),
      display_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS barbers (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      vip INTEGER DEFAULT 0,
      total_visits INTEGER DEFAULT 0,
      last_visit TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      duration INTEGER NOT NULL DEFAULT 30,
      price REAL NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#10B981',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (barber_id) REFERENCES barbers(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS days_off (
      id SERIAL PRIMARY KEY,
      barber_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      reason TEXT,
      FOREIGN KEY (barber_id) REFERENCES barbers(id),
      UNIQUE(barber_id, date)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_barber ON appointments(barber_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)",
    "CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)",
    "CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)",
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
    "CREATE INDEX IF NOT EXISTS idx_services_active ON services(active, sort_order)",
    "CREATE INDEX IF NOT EXISTS idx_days_off_barber_date ON days_off(barber_id, date)"
  ];
  for (const idx of indexes) {
    try { await pool.query(idx); } catch(e) {}
  }

  // Seed if empty
  const userCount = await db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (parseInt(userCount.c) === 0) {
    await seedData();
  }

  console.log('Database initialized (PostgreSQL)');
  return db;
}

async function seedData() {
  const hashedPassword = bcrypt.hashSync('admin123', 10);

  // Admin user
  await db.prepare("INSERT INTO users (username, password, role, display_name, email) VALUES (?, ?, 'admin', ?, ?)").run(
    'admin', hashedPassword, 'מנהל המערכת', 'admin@barber.co.il'
  );

  // Barbers
  const b1 = await db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'barber', ?)").run('yossi', hashedPassword, 'יוסי');
  const b2 = await db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'barber', ?)").run('david', hashedPassword, 'דוד');
  const b3 = await db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'barber', ?)").run('moshe', hashedPassword, 'משה');

  await db.prepare("INSERT INTO barbers (user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?)").run(b1.lastInsertRowid, 'יוסי כהן', '050-1234567', 'תספורות גברים', '#4F46E5', '0,1,2,3,4');
  await db.prepare("INSERT INTO barbers (user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?)").run(b2.lastInsertRowid, 'דוד לוי', '050-7654321', 'עיצוב זקן', '#EF4444', '0,1,2,3,4,5');
  await db.prepare("INSERT INTO barbers (user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?)").run(b3.lastInsertRowid, 'משה ישראלי', '050-9876543', 'צבע שיער', '#F59E0B', '0,1,2,4');

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
    await db.prepare('INSERT INTO services (name, description, duration, price, color, sort_order) VALUES (?,?,?,?,?,?)').run(...s);
  }

  // Settings
  const settings = [
    ['shop_name', 'הספרייה של יוסי'],
    ['shop_phone', '03-1234567'],
    ['shop_address', 'רחוב הרצל 10, תל אביב'],
    ['open_time', '09:00'],
    ['close_time', '20:00'],
    ['slot_interval', '30'],
    ['allow_self_booking', 'false'],
  ];
  for (const s of settings) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', s);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
process.on('SIGINT', async () => { await pool.end(); process.exit(0); });

module.exports = { getDb, initDatabase };
