const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const {
  DB_HOST = 'localhost',
  DB_PORT = '3306',
  DB_USER = 'root',
  DB_PASS = '',
  DB_NAME = 'guardias_db',
  JWT_SECRET = 'cambia-esto-en-produccion',
  PORT = 4000,
} = process.env;

let pool;

async function initDb() {
  pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    connectionLimit: 10,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      pass_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','user') NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendars (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      template_type ENUM('mon_sun','wed_tue') NOT NULL,
      start_year INT NOT NULL,
      years_span INT NOT NULL,
      week_start_js INT NOT NULL DEFAULT 1,
      region_code VARCHAR(20) NOT NULL DEFAULT 'ES',
      theme_json JSON NOT NULL,
      owner_id INT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      calendar_id INT NOT NULL,
      user_id INT NOT NULL,
      can_edit TINYINT(1) NOT NULL DEFAULT 0,
      UNIQUE KEY uniq_cal_user (calendar_id, user_id),
      FOREIGN KEY (calendar_id) REFERENCES calendars(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      calendar_id INT NOT NULL,
      year INT NOT NULL,
      data_json JSON NOT NULL,
      UNIQUE KEY uniq_cal_year (calendar_id, year),
      FOREIGN KEY (calendar_id) REFERENCES calendars(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`ALTER TABLE calendars ADD COLUMN IF NOT EXISTS week_start_js INT NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE calendars ADD COLUMN IF NOT EXISTS region_code VARCHAR(20) NOT NULL DEFAULT 'ES'`);

  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM users`);
  if (rows[0].c === 0) {
    const hash = await bcrypt.hash('admin', 10);
    await pool.query(`INSERT INTO users (username, pass_hash, role) VALUES (?,?,?)`, ['admin', hash, 'admin']);
    console.log('Usuario admin/admin creado en MariaDB');
  }
}

// ---- Helpers ----
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [, token] = header.split(' ');
  if (!token) return res.status(401).json({ error: 'Sin token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Prohibido' });
    }
    next();
  };
}

function calendarAccess(mode) {
  return async (req, res, next) => {
    const calendarId = Number(req.params.id);
    if (!req.user) return res.status(401).json({ error: 'No auth' });
    if (req.user.role === 'admin') {
      req.calendarAccess = { canEdit: true };
      return next();
    }
    try {
      const [rows] = await pool.query(
        `SELECT can_edit FROM calendar_assignments WHERE calendar_id = ? AND user_id = ?`,
        [calendarId, req.user.id]
      );
      if (!rows.length) return res.status(403).json({ error: 'Sin acceso a este calendario' });
      const canEdit = !!rows[0].can_edit;
      if (mode === 'edit' && !canEdit) return res.status(403).json({ error: 'Solo lectura' });
      req.calendarAccess = { canEdit };
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'DB error' });
    }
  };
}

function generateRandomSlug() {
  return 'cal-' + Math.random().toString(36).substring(2, 10);
}

// ---- Festivos ----
function getRegionalHolidays(year, regionCode) {
  const region = regionCode.toUpperCase();
  const fixed = {
    'ES-MD': [{ month: 5,  day: 2,  name: 'Fiesta de la Comunidad de Madrid' }],
    'ES-CT': [
      { month: 4,  day: 23, name: 'Sant Jordi' },
      { month: 6,  day: 24, name: 'Sant Joan' },
      { month: 9,  day: 11, name: 'Diada Nacional de Catalunya' },
      { month: 12, day: 26, name: 'Sant Esteve' },
    ],
    'ES-AN': [{ month: 2,  day: 28, name: 'Día de Andalucía' }],
    'ES-VC': [
      { month: 3,  day: 19, name: 'San José' },
      { month: 10, day: 9,  name: 'Día de la Comunitat Valenciana' },
    ],
    'ES-GA': [{ month: 7,  day: 25, name: 'Día Nacional de Galicia' }],
    'ES-PV': [{ month: 7,  day: 25, name: 'Día del País Vasco' }],
    'ES-AR': [{ month: 4,  day: 23, name: 'San Jorge' }],
    'ES-AS': [{ month: 9,  day: 8,  name: 'Día de Asturias' }],
    'ES-IB': [{ month: 3,  day: 1,  name: 'Dia de les Illes Balears' }],
    'ES-CN': [{ month: 5,  day: 30, name: 'Día de Canarias' }],
    'ES-CB': [
      { month: 7,  day: 28, name: 'Día de las Instituciones de Cantabria' },
      { month: 9,  day: 15, name: 'La Bien Aparecida' },
    ],
    'ES-CM': [{ month: 5,  day: 31, name: 'Día de Castilla-La Mancha' }],
    'ES-CL': [{ month: 4,  day: 23, name: 'Día de Castilla y León' }],
    'ES-EX': [{ month: 9,  day: 8,  name: 'Día de Extremadura' }],
    'ES-RI': [{ month: 6,  day: 9,  name: 'Día de La Rioja' }],
    'ES-NA': [
      { month: 7,  day: 25, name: 'San Santiago' },
      { month: 9,  day: 27, name: 'Día de Navarra' },
    ],
    'ES-MU': [{ month: 6,  day: 9,  name: 'Día de la Región de Murcia' }],
    'ES-CE': [{ month: 9,  day: 2,  name: 'Día de Ceuta' }],
    'ES-ML': [{ month: 9,  day: 17, name: 'Día de Melilla' }],
  };

  const list = fixed[region] || [];
  return list.map(function(h) {
    const mm = String(h.month).padStart(2, '0');
    const dd = String(h.day).padStart(2, '0');
    return { date: year + '-' + mm + '-' + dd, name: h.name };
  });
}

async function fetchHolidays(year, regionCode) {
  try {
    const url = 'https://date.nager.at/api/v3/PublicHolidays/' + year + '/ES';
    const resp = await fetch(url);
    let nationals = [];
    if (resp.ok) {
      const data = await resp.json();
      nationals = (data || []).map(function(h) {
        return { date: h.date, name: h.localName || h.name };
      });
    } else {
      console.error('Error Nager.Date', resp.status);
    }

    const regionals = getRegionalHolidays(year, regionCode);
    const allMap = new Map();
    nationals.forEach(function(h)  { allMap.set(h.date, h.name); });
    regionals.forEach(function(h)  { allMap.set(h.date, h.name); });

    const result = [];
    allMap.forEach(function(name, date) { result.push({ date, name }); });
    result.sort(function(a, b) { return a.date.localeCompare(b.date); });
    return result;
  } catch (e) {
    console.error('Error obteniendo festivos', e);
    return [];
  }
}

// ---- Swagger ----
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'C4lendar API',
      version: '1.0.0',
      description: 'Documentación interactiva de la API de C4lendar',
    },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./server.js'],
});

// ---- App ----
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---- Auth ----

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login y obtención de token JWT
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 example: admin
 *     responses:
 *       200:
 *         description: Login correcto
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     username: { type: string }
 *                     role: { type: string, enum: [admin, user] }
 *       401:
 *         description: Credenciales inválidas
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.pass_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Obtener usuario autenticado actual
 *     responses:
 *       200:
 *         description: Datos del usuario
 *       401:
 *         description: Sin token o token inválido
 */
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ---- Users ----

/**
 * @swagger
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Crear usuario (solo admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password, role]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *               role: { type: string, enum: [admin, user] }
 *     responses:
 *       201:
 *         description: Usuario creado
 *       400:
 *         description: Datos incompletos o usuario ya existe
 *       403:
 *         description: Prohibido
 */
app.post('/api/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Datos incompletos' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`INSERT INTO users (username, pass_hash, role) VALUES (?,?,?)`, [username, hash, role]);
    res.status(201).json({ username, role });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'No se pudo crear usuario', detail: e.message });
  }
});

/**
 * @swagger
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: Listar todos los usuarios (solo admin)
 *     responses:
 *       200:
 *         description: Lista de usuarios
 *       403:
 *         description: Prohibido
 */
app.get('/api/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, username, role FROM users ORDER BY username`);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /users/me/password:
 *   put:
 *     tags: [Users]
 *     summary: Cambiar contraseña del usuario actual
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [old_password, new_password]
 *             properties:
 *               old_password: { type: string }
 *               new_password: { type: string }
 *     responses:
 *       200:
 *         description: Contraseña actualizada
 *       401:
 *         description: Contraseña actual incorrecta
 */
app.put('/api/users/me/password', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ error: 'Faltan campos' });
  try {
    const [rows] = await pool.query(`SELECT pass_hash FROM users WHERE id = ?`, [userId]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ok = await bcrypt.compare(old_password, rows[0].pass_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query(`UPDATE users SET pass_hash = ? WHERE id = ?`, [newHash, userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Actualizar rol o contraseña de un usuario (solo admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role: { type: string, enum: [admin, user] }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *       403:
 *         description: Prohibido
 */
app.put('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const { role, password } = req.body || {};
  if (!role && !password) return res.status(400).json({ error: 'Nada que actualizar' });
  if (role && !['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    const updates = [];
    const params = [];
    if (role) { updates.push('role = ?'); params.push(role); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('pass_hash = ?');
      params.push(hash);
    }
    params.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Eliminar usuario (solo admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Usuario eliminado
 *       403:
 *         description: Prohibido
 */
app.delete('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  try {
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---- Calendars ----

/**
 * @swagger
 * /calendars:
 *   post:
 *     tags: [Calendars]
 *     summary: Crear calendario (solo admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, template_type, start_year, years_span]
 *             properties:
 *               name: { type: string }
 *               slug: { type: string }
 *               template_type: { type: string, enum: [mon_sun, wed_tue] }
 *               start_year: { type: integer }
 *               years_span: { type: integer }
 *               week_start_js: { type: integer }
 *               region_code: { type: string, example: ES-MD }
 *               theme: { type: object }
 *     responses:
 *       201:
 *         description: Calendario creado
 *       403:
 *         description: Prohibido
 */
app.post('/api/calendars', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, slug, template_type, start_year, years_span, week_start_js, region_code, theme } = req.body || {};
  if (!name || !template_type || !start_year || !years_span) return res.status(400).json({ error: 'Datos incompletos' });
  if (!['mon_sun', 'wed_tue'].includes(template_type)) return res.status(400).json({ error: 'template_type inválido' });

  const finalSlug = slug && slug.trim() ? slug.trim() : generateRandomSlug();
  const finalWeekStart = typeof week_start_js === 'number' ? week_start_js : 1;
  const finalRegion = region_code || 'ES';

  try {
    const [result] = await pool.query(
      `INSERT INTO calendars (name, slug, template_type, start_year, years_span, week_start_js, region_code, theme_json, owner_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, finalSlug, template_type, Number(start_year), Number(years_span), finalWeekStart, finalRegion, JSON.stringify(theme || {}), req.user.id]
    );
    await pool.query(
      `INSERT INTO calendar_assignments (calendar_id, user_id, can_edit) VALUES (?,?,1)
       ON DUPLICATE KEY UPDATE can_edit = VALUES(can_edit)`,
      [result.insertId, req.user.id]
    );
    res.status(201).json({ id: result.insertId, slug: finalSlug });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'No se pudo crear calendario', detail: e.message });
  }
});

/**
 * @swagger
 * /calendars:
 *   get:
 *     tags: [Calendars]
 *     summary: Listar calendarios accesibles por el usuario
 *     responses:
 *       200:
 *         description: Lista de calendarios
 */
app.get('/api/calendars', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const [rows] = await pool.query(`SELECT * FROM calendars ORDER BY id DESC`);
      res.json(rows);
    } else {
      const [rows] = await pool.query(
        `SELECT c.* FROM calendars c
         JOIN calendar_assignments a ON a.calendar_id = c.id
         WHERE a.user_id = ? ORDER BY c.id DESC`,
        [req.user.id]
      );
      res.json(rows);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /calendars/{id}:
 *   get:
 *     tags: [Calendars]
 *     summary: Obtener un calendario por ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Calendario encontrado
 *       403:
 *         description: Sin acceso
 *       404:
 *         description: No encontrado
 */
app.get('/api/calendars/:id', authMiddleware, calendarAccess('read'), async (req, res) => {
  const calendarId = Number(req.params.id);
  try {
    const [rows] = await pool.query(`SELECT * FROM calendars WHERE id = ?`, [calendarId]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /calendars/{id}:
 *   delete:
 *     tags: [Calendars]
 *     summary: Eliminar calendario (solo admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Calendario eliminado
 *       403:
 *         description: Prohibido
 */
app.delete('/api/calendars/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const calendarId = Number(req.params.id);
  try {
    await pool.query(`DELETE FROM calendars WHERE id = ?`, [calendarId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---- Assignments ----

/**
 * @swagger
 * /calendars/{id}/assignments:
 *   get:
 *     tags: [Assignments]
 *     summary: Listar asignaciones de un calendario (solo admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Lista de asignaciones
 */
app.get('/api/calendars/:id/assignments', authMiddleware, requireRole('admin'), async (req, res) => {
  const calendarId = Number(req.params.id);
  try {
    const [rows] = await pool.query(
      `SELECT user_id, can_edit FROM calendar_assignments WHERE calendar_id = ?`,
      [calendarId]
    );
    res.json(rows.map(r => ({ user_id: r.user_id, can_edit: !!r.can_edit })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /calendars/{id}/assignments:
 *   put:
 *     tags: [Assignments]
 *     summary: Reemplazar asignaciones de un calendario (solo admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assignments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     user_id: { type: integer }
 *                     can_edit: { type: boolean }
 *     responses:
 *       200:
 *         description: Asignaciones actualizadas
 */
app.put('/api/calendars/:id/assignments', authMiddleware, requireRole('admin'), async (req, res) => {
  const calendarId = Number(req.params.id);
  const { assignments } = req.body || {};
  if (!Array.isArray(assignments)) return res.status(400).json({ error: 'Formato inválido' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM calendar_assignments WHERE calendar_id = ?`, [calendarId]);
    for (const a of assignments) {
      await conn.query(
        `INSERT INTO calendar_assignments (calendar_id, user_id, can_edit) VALUES (?,?,?)`,
        [calendarId, a.user_id, a.can_edit ? 1 : 0]
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Error guardando asignaciones' });
  } finally {
    conn.release();
  }
});

// ---- Year data ----

/**
 * @swagger
 * /calendars/{id}/year/{year}:
 *   get:
 *     tags: [Calendar Data]
 *     summary: Obtener datos de un año de un calendario
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Datos del año
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Sin acceso
 */
app.get('/api/calendars/:id/year/:year', authMiddleware, calendarAccess('read'), async (req, res) => {
  const calendarId = Number(req.params.id);
  const year = Number(req.params.year);
  try {
    const [rows] = await pool.query(
      `SELECT data_json FROM calendar_data WHERE calendar_id = ? AND year = ?`,
      [calendarId, year]
    );

    const [calRows] = await pool.query(
      `SELECT name, week_start_js, region_code FROM calendars WHERE id = ?`, [calendarId]
    );
    const calName       = calRows.length ? calRows[0].name : ('Calendario ' + calendarId);
    const week_start_js = calRows.length ? (calRows[0].week_start_js ?? 1) : 1;
    const region_code   = calRows.length ? (calRows[0].region_code || 'ES') : 'ES';

    let canEdit = false;
    if (req.user.role === 'admin') {
      canEdit = true;
    } else {
      const [aRows] = await pool.query(
        `SELECT can_edit FROM calendar_assignments WHERE calendar_id = ? AND user_id = ?`,
        [calendarId, req.user.id]
      );
      canEdit = aRows.length ? !!aRows[0].can_edit : false;
    }

    if (rows.length) {
      const data = JSON.parse(rows[0].data_json);
      data.calendarName = calName;
      data.can_edit     = canEdit;
      if (!data.holidays || !data.holidays.length) {
        data.holidays = await fetchHolidays(year, region_code);
      }
      return res.json(data);
    }

    const holidays = await fetchHolidays(year, region_code);
    return res.json({ year, week_start_js, region_code, calendarName: calName, can_edit: canEdit, people: [], weeks: [], holidays });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /calendars/{id}/year/{year}:
 *   put:
 *     tags: [Calendar Data]
 *     summary: Guardar datos de un año de un calendario
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Datos guardados
 *       403:
 *         description: Solo lectura
 */
app.put('/api/calendars/:id/year/:year', authMiddleware, calendarAccess('edit'), async (req, res) => {
  const calendarId = Number(req.params.id);
  const year = Number(req.params.year);
  const payload = req.body || {};
  try {
    await pool.query(
      `INSERT INTO calendar_data (calendar_id, year, data_json) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)`,
      [calendarId, year, JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /calendars/{id}/year/{year}/export:
 *   get:
 *     tags: [Calendar Data]
 *     summary: Exportar datos de un año como fichero JSON
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Fichero JSON descargado
 */
app.get('/api/calendars/:id/year/:year/export', authMiddleware, calendarAccess('read'), async (req, res) => {
  const calendarId = Number(req.params.id);
  const year = Number(req.params.year);
  try {
    const [rows] = await pool.query(
      `SELECT data_json FROM calendar_data WHERE calendar_id = ? AND year = ?`,
      [calendarId, year]
    );
    const json = rows.length ? rows[0].data_json : { year, people: [], weeks: [], holidays: [] };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="calendario-${calendarId}-${year}.json"`);
    res.send(JSON.stringify(json, null, 2));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

/**
 * @swagger
 * /calendars/{id}/year/{year}/import:
 *   post:
 *     tags: [Calendar Data]
 *     summary: Importar datos de un año (solo admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Datos importados
 */
app.post('/api/calendars/:id/year/:year/import', authMiddleware, requireRole('admin'), async (req, res) => {
  const calendarId = Number(req.params.id);
  const year = Number(req.params.year);
  const payload = req.body || {};
  try {
    await pool.query(
      `INSERT INTO calendar_data (calendar_id, year, data_json) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)`,
      [calendarId, year, JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---- iCal proxy ----

/**
 * @swagger
 * /ical/fetch:
 *   get:
 *     tags: [iCal]
 *     summary: Proxy para obtener un calendario iCal externo
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *         description: URL del fichero .ics a obtener
 *     responses:
 *       200:
 *         description: Contenido del fichero iCal
 *       400:
 *         description: URL requerida
 *       500:
 *         description: Error obteniendo el calendario
 */
app.get('/api/ical/fetch', authMiddleware, async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida' });
  }
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (e) {
    console.error('iCal fetch error', e);
    res.status(500).json({ error: 'No se pudo obtener el calendario: ' + e.message });
  }
});

// ---- Start ----
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log('API escuchando en http://0.0.0.0:' + PORT);
      console.log('Swagger UI en http://0.0.0.0:' + PORT + '/api-docs');
    });
  })
  .catch((err) => {
    console.error('Error inicializando DB', err);
    process.exit(1);
  });
