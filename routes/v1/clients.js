const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken } = require('../../middleware/auth');

router.use(authenticateToken);

// Get all clients
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search, vip } = req.query;

    let sql = 'SELECT * FROM clients WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (vip !== undefined) {
      sql += ' AND vip = ?';
      params.push(vip);
    }

    sql += ' ORDER BY name';
    const clients = db.prepare(sql).all(...params);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת לקוחות' });
  }
});

// Get single client with history
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const history = db.prepare(`
      SELECT a.*, b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.client_id = ?
      ORDER BY a.date DESC, a.start_time DESC
      LIMIT 50
    `).all(req.params.id);

    res.json({ ...client, history });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת לקוח' });
  }
});

// Create client
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, phone, email, notes, vip } = req.body;
    if (!name) return res.status(400).json({ error: 'שם הלקוח הוא שדה חובה' });

    const result = db.prepare('INSERT INTO clients (name, phone, email, notes, vip) VALUES (?, ?, ?, ?, ?)').run(
      name, phone || '', email || '', notes || '', vip ? 1 : 0
    );

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(client);
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת לקוח' });
  }
});

// Update client
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { name, phone, email, notes, vip } = req.body;

    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'לקוח לא נמצא' });

    db.prepare(`
      UPDATE clients SET name = ?, phone = ?, email = ?, notes = ?, vip = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name || existing.name, phone ?? existing.phone, email ?? existing.email, notes ?? existing.notes, vip !== undefined ? (vip ? 1 : 0) : existing.vip, req.params.id);

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון לקוח' });
  }
});

// Delete client
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const apptCount = db.prepare('SELECT COUNT(*) as c FROM appointments WHERE client_id = ? AND status IN (\'pending\',\'confirmed\')').get(req.params.id);

    if (apptCount.c > 0) {
      return res.status(400).json({ error: 'לא ניתן למחוק לקוח עם תורים פעילים' });
    }

    db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ message: 'הלקוח נמחק בהצלחה' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה במחיקת לקוח' });
  }
});

module.exports = router;
