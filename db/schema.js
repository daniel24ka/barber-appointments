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
  // === Tenants table (multi-tenant core) ===
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      owner_name TEXT,
      owner_email TEXT,
      owner_phone TEXT,
      logo_url TEXT,
      primary_color TEXT DEFAULT '#4F46E5',
      plan TEXT DEFAULT 'trial' CHECK(plan IN ('trial','basic','premium')),
      active INTEGER DEFAULT 1,
      trial_ends_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'barber' CHECK(role IN ('super_admin','admin','barber','client')),
      display_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS barbers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
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
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      vip INTEGER DEFAULT 0,
      total_visits INTEGER DEFAULT 0,
      last_visit TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      description TEXT,
      duration INTEGER NOT NULL DEFAULT 30,
      price REAL NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#10B981',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
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
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
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
      tenant_id INTEGER NOT NULL DEFAULT 1,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (tenant_id, key),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consents (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER DEFAULT 1,
      consent_type TEXT NOT NULL CHECK(consent_type IN ('booking_privacy','terms_of_use','data_processing')),
      entity_type TEXT NOT NULL CHECK(entity_type IN ('client','user')),
      entity_id INTEGER,
      entity_name TEXT,
      entity_phone TEXT,
      ip_address TEXT,
      user_agent TEXT,
      consent_text TEXT NOT NULL,
      accepted INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // System config table (stores JWT_SECRET etc. so they persist across deploys)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // === Migration: add tenant_id to existing tables if missing ===
  await migrateMultiTenant();

  // Indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_barber ON appointments(barber_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)",
    "CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)",
    "CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
    "CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id, username)",
    "CREATE INDEX IF NOT EXISTS idx_services_active ON services(active, sort_order)",
    "CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_barbers_tenant ON barbers(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_days_off_barber_date ON days_off(barber_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_consents_type ON consents(consent_type, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_consents_entity ON consents(entity_type, entity_id)"
  ];
  for (const idx of indexes) {
    try { await pool.query(idx); } catch(e) {}
  }

  // Seed if empty
  const tenantCount = await db.prepare('SELECT COUNT(*) as c FROM tenants').get();
  if (parseInt(tenantCount.c) === 0) {
    await seedData();
  }

  // Update role CHECK constraint to include super_admin (existing DB may only allow admin/barber/client)
  try {
    await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('super_admin','admin','barber','client'))");
  } catch(e) {
    console.log('Role constraint update note:', e.message);
  }

  // Ensure super admin exists
  try {
    const superAdmin = await db.prepare("SELECT id FROM users WHERE username = 'danitech' LIMIT 1").get();
    const hashedPassword = bcrypt.hashSync(process.env.SUPER_ADMIN_PASSWORD || 'danitech2024', 10);
    if (!superAdmin) {
      await pool.query(`
        INSERT INTO users (tenant_id, username, password, role, display_name, email, active)
        VALUES (1, 'danitech', $1, 'super_admin', 'דניטק - מנהל ראשי', 'daniel@danitech.co.il', 1)
        ON CONFLICT DO NOTHING
      `, [hashedPassword]);
      console.log('Super admin created: danitech');
    } else {
      // Update existing user to super_admin and reset password
      await pool.query("UPDATE users SET role = 'super_admin', password = $1, active = 1 WHERE username = 'danitech'", [hashedPassword]);
      console.log('Super admin updated: danitech');
    }
  } catch(e) {
    console.error('Super admin creation error:', e.message);
  }

  console.log('Database initialized (PostgreSQL - Multi-tenant)');
  return db;
}

async function migrateMultiTenant() {
  // Check if tenants table has data; if not but users exist, migrate
  const tenantCheck = await pool.query('SELECT COUNT(*) as c FROM tenants');
  const userCheck = await pool.query('SELECT COUNT(*) as c FROM users');

  if (parseInt(tenantCheck.rows[0].c) === 0 && parseInt(userCheck.rows[0].c) > 0) {
    console.log('Migrating existing data to multi-tenant...');

    // Create default tenant
    await pool.query(`
      INSERT INTO tenants (id, slug, name, owner_name, plan, active)
      VALUES (1, 'default', 'מספרה ראשית', 'מנהל', 'premium', 1)
      ON CONFLICT (id) DO NOTHING
    `);

    // Add tenant_id columns if they don't exist yet
    const tables = ['users', 'barbers', 'clients', 'services', 'appointments', 'consents'];
    for (const table of tables) {
      try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1 REFERENCES tenants(id)`);
        await pool.query(`UPDATE ${table} SET tenant_id = 1 WHERE tenant_id IS NULL`);
      } catch(e) { /* column might already exist */ }
    }

    // Migrate settings table if it has old format (key as PK without tenant_id)
    try {
      await pool.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1');
      await pool.query('UPDATE settings SET tenant_id = 1 WHERE tenant_id IS NULL');
    } catch(e) {}

    // Reset sequence for tenants
    await pool.query("SELECT setval('tenants_id_seq', (SELECT COALESCE(MAX(id), 1) FROM tenants))");

    console.log('Migration complete.');
  }
}

async function seedData() {
  // Create default tenant
  await pool.query(`
    INSERT INTO tenants (slug, name, owner_name, owner_email, plan, active, trial_ends_at)
    VALUES ('default', 'הספרייה של יוסי', 'מנהל', 'admin@barber.co.il', 'premium', 1, NOW() + INTERVAL '365 days')
  `);

  const tenant = await db.prepare("SELECT id FROM tenants WHERE slug = 'default'").get();
  const tid = tenant.id;

  const hashedPassword = bcrypt.hashSync('admin123', 10);

  // Admin user
  await db.prepare("INSERT INTO users (tenant_id, username, password, role, display_name, email) VALUES (?, ?, ?, 'admin', ?, ?)").run(
    tid, 'admin', hashedPassword, 'מנהל המערכת', 'admin@barber.co.il'
  );

  // Barbers
  const b1 = await db.prepare("INSERT INTO users (tenant_id, username, password, role, display_name) VALUES (?, ?, ?, 'barber', ?)").run(tid, 'yossi', hashedPassword, 'יוסי');
  const b2 = await db.prepare("INSERT INTO users (tenant_id, username, password, role, display_name) VALUES (?, ?, ?, 'barber', ?)").run(tid, 'david', hashedPassword, 'דוד');
  const b3 = await db.prepare("INSERT INTO users (tenant_id, username, password, role, display_name) VALUES (?, ?, ?, 'barber', ?)").run(tid, 'moshe', hashedPassword, 'משה');

  await db.prepare("INSERT INTO barbers (tenant_id, user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?, ?)").run(tid, b1.lastInsertRowid, 'יוסי כהן', '050-1234567', 'תספורות גברים', '#4F46E5', '0,1,2,3,4');
  await db.prepare("INSERT INTO barbers (tenant_id, user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?, ?)").run(tid, b2.lastInsertRowid, 'דוד לוי', '050-7654321', 'עיצוב זקן', '#EF4444', '0,1,2,3,4,5');
  await db.prepare("INSERT INTO barbers (tenant_id, user_id, name, phone, specialty, color, work_days) VALUES (?, ?, ?, ?, ?, ?, ?)").run(tid, b3.lastInsertRowid, 'משה ישראלי', '050-9876543', 'צבע שיער', '#F59E0B', '0,1,2,4');

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
    await db.prepare('INSERT INTO services (tenant_id, name, description, duration, price, color, sort_order) VALUES (?,?,?,?,?,?,?)').run(tid, ...s);
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
    await pool.query('INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value', [tid, ...s]);
  }
}

// Helper: create a new tenant with admin user
async function createTenant({ slug, name, ownerName, ownerEmail, ownerPhone, adminUsername, adminPassword }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create tenant
    const tenantRes = await client.query(
      `INSERT INTO tenants (slug, name, owner_name, owner_email, owner_phone, plan, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5, 'trial', NOW() + INTERVAL '30 days') RETURNING id`,
      [slug, name, ownerName, ownerEmail, ownerPhone]
    );
    const tid = tenantRes.rows[0].id;

    // Create admin user for tenant
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);
    await client.query(
      `INSERT INTO users (tenant_id, username, password, role, display_name, email, phone)
       VALUES ($1, $2, $3, 'admin', $4, $5, $6)`,
      [tid, adminUsername, hashedPassword, ownerName, ownerEmail, ownerPhone]
    );

    // Default settings
    const defaultSettings = [
      ['shop_name', name],
      ['shop_phone', ownerPhone || ''],
      ['shop_address', ''],
      ['open_time', '09:00'],
      ['close_time', '20:00'],
      ['slot_interval', '30'],
      ['allow_self_booking', 'true'],
    ];
    for (const [key, value] of defaultSettings) {
      await client.query(
        'INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)',
        [tid, key, value]
      );
    }

    await client.query('COMMIT');
    return { id: tid, slug };
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Get or create a persistent JWT_SECRET in the database
async function getOrCreateJwtSecret() {
  // If set in environment, always use that
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  try {
    // Try to get existing secret from DB
    const row = await pool.query("SELECT value FROM system_config WHERE key = 'jwt_secret'");
    if (row.rows[0]) {
      console.log('JWT_SECRET loaded from database (persistent)');
      return row.rows[0].value;
    }

    // Generate and store a new one
    const crypto = require('crypto');
    const newSecret = crypto.randomBytes(64).toString('hex');
    await pool.query(
      "INSERT INTO system_config (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP",
      [newSecret]
    );
    console.log('JWT_SECRET generated and stored in database (will persist across deploys)');
    return newSecret;
  } catch(e) {
    console.error('Failed to get/create JWT_SECRET from DB:', e.message);
    // Fallback to random (will reset on restart, but at least won't crash)
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
process.on('SIGINT', async () => { await pool.end(); process.exit(0); });

module.exports = { getDb, initDatabase, createTenant, getOrCreateJwtSecret };
