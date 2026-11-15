"use strict";

require("dotenv").config();
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 12);
const databasePath = path.resolve(process.env.DATABASE_PATH || "library-data/libris.sqlite");
if (SESSION_SECRET.length < 32 || SESSION_SECRET.startsWith("replace-")) throw new Error("Set SESSION_SECRET to a unique random value of at least 32 characters.");
if (ADMIN_PASSWORD.length < 12 || Buffer.byteLength(ADMIN_PASSWORD, "utf8") > 72 || ADMIN_PASSWORD.startsWith("replace-")) throw new Error("Set ADMIN_PASSWORD to a unique password of 12 or more characters and no more than 72 UTF-8 bytes.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) throw new Error("Set ADMIN_EMAIL to a valid administrator email address.");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'librarian')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    isbn TEXT NOT NULL,
    isbn_key TEXT NOT NULL UNIQUE,
    year INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    checkout_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    return_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_loan_per_book ON loans(book_id) WHERE return_date IS NULL;
  CREATE INDEX IF NOT EXISTS loans_checkout_date ON loans(checkout_date);
  CREATE TABLE IF NOT EXISTS web_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
`);
const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')").run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 12));
} else if (!db.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL)) {
  console.warn(`Configured ADMIN_EMAIL (${ADMIN_EMAIL}) does not match an existing user; existing accounts were left unchanged.`);
}

class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.getRow = database.prepare("SELECT sess, expired_at FROM web_sessions WHERE sid = ?");
    this.putRow = database.prepare("INSERT INTO web_sessions (sid, sess, expired_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired_at = excluded.expired_at");
    this.deleteRow = database.prepare("DELETE FROM web_sessions WHERE sid = ?");
    this.prune = database.prepare("DELETE FROM web_sessions WHERE expired_at <= ?");
    this.timer = setInterval(() => this.prune.run(Date.now()), 60 * 60 * 1000);
    this.timer.unref();
  }
  get(sid, callback) {
    try {
      const row = this.getRow.get(sid);
      if (!row || row.expired_at <= Date.now()) {
        if (row) this.deleteRow.run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try {
      const expiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.putRow.run(sid, JSON.stringify(value), expiry);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { this.deleteRow.run(sid); callback(null); } catch (error) { callback(error); }
  }
  touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], fontSrc: ["'self'", "https://fonts.gstatic.com"], scriptSrc: ["'self'"], imgSrc: ["'self'", "data:"] } } }));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "libris.sid",
  secret: SESSION_SECRET,
  store: new SqliteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many sign-in attempts. Try again in 15 minutes." } });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const addDays = (date, days) => {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
};
const clean = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const publicUser = (user) => ({ id: user.id, email: user.email, role: user.role });
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Sign in to continue." });
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.user?.role !== "admin") return res.status(req.session.user ? 403 : 401).json({ error: "Administrator access is required." });
  next();
}
function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token") || "";
  const expected = req.session.csrfToken || "";
  const valid = /^[a-f0-9]{64}$/.test(token) && token.length === expected.length && /^[a-f0-9]{64}$/.test(expected) && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!valid) return res.status(403).json({ error: "Request verification failed. Refresh the page and try again." });
  next();
}
function validateBook(body) {
  const title = clean(body.title); const author = clean(body.author); const isbn = clean(body.isbn, 32); const year = Number(body.year);
  if (!title || !author || !isbn || !Number.isInteger(year) || year < 1000 || year > new Date().getFullYear()) return null;
  return { title, author, isbn, isbnKey: isbn.toLowerCase().replace(/[\s-]/g, ""), year };
}
function validateMember(body) {
  const name = clean(body.name); const email = clean(body.email, 254).toLowerCase(); const phone = clean(body.phone, 40);
  if (!name || !validEmail(email) || !phone) return null;
  return { name, email, phone };
}
const bookSelect = `SELECT b.id, b.title, b.author, b.isbn, b.year,
  CASE WHEN EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.return_date IS NULL) THEN 0 ELSE 1 END AS available,
  (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS loan_count
  FROM books b`;
const memberSelect = `SELECT m.id, m.name, m.email, m.phone,
  (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.return_date IS NULL) AS active_loans
  FROM members m`;

app.get("/api/auth/session", (req, res) => {
  req.session.csrfToken ||= crypto.randomBytes(32).toString("hex");
  res.json({ user: req.session.user || null, csrfToken: req.session.csrfToken });
});
app.post("/api/auth/login", loginLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase(); const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT id, email, password_hash, role FROM users WHERE email = ?").get(email);
  const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !valid) return res.status(401).json({ error: "Email or password is incorrect." });
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "Could not start a secure session." });
    req.session.user = publicUser(user);
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "Could not save the session." });
      res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
    });
  });
}));
app.post("/api/auth/logout", requireAuth, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("libris.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.status(204).end();
  });
});
app.get("/api/users", requireAuth, requireAdmin, (_req, res) => res.json(db.prepare("SELECT id, email, role, created_at AS createdAt FROM users ORDER BY email").all()));
app.post("/api/users", requireAuth, requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase(); const password = typeof req.body.password === "string" ? req.body.password : ""; const role = req.body.role;
  if (!validEmail(email) || password.length < 12 || Buffer.byteLength(password, "utf8") > 72 || !["admin", "librarian"].includes(role)) return res.status(400).json({ error: "Enter a valid email, a password of 12 or more characters and no more than 72 UTF-8 bytes, and a role." });
  const result = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run(email, await bcrypt.hash(password, 12), role);
  res.status(201).json({ id: result.lastInsertRowid, email, role });
}));

app.get("/api/books", requireAuth, (req, res) => {
  const query = `%${clean(req.query.q, 100)}%`;
  res.json(db.prepare(`${bookSelect} WHERE b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ? ORDER BY b.title COLLATE NOCASE`).all(query, query, query));
});
app.post("/api/books", requireAuth, requireCsrf, (req, res) => {
  const book = validateBook(req.body);
  if (!book) return res.status(400).json({ error: "Enter a title, author, ISBN, and valid publication year." });
  try {
    const result = db.prepare("INSERT INTO books (title, author, isbn, isbn_key, year) VALUES (?, ?, ?, ?, ?)").run(book.title, book.author, book.isbn, book.isbnKey, book.year);
    res.status(201).json(db.prepare(`${bookSelect} WHERE b.id = ?`).get(result.lastInsertRowid));
  } catch (error) { if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That ISBN is already in the catalog." }); throw error; }
});
app.put("/api/books/:id", requireAuth, requireCsrf, (req, res) => {
  const book = validateBook(req.body);
  if (!book) return res.status(400).json({ error: "Enter a title, author, ISBN, and valid publication year." });
  try {
    const result = db.prepare("UPDATE books SET title = ?, author = ?, isbn = ?, isbn_key = ?, year = ? WHERE id = ?").run(book.title, book.author, book.isbn, book.isbnKey, book.year, req.params.id);
    if (!result.changes) return res.status(404).json({ error: "Book not found." });
    res.json(db.prepare(`${bookSelect} WHERE b.id = ?`).get(req.params.id));
  } catch (error) { if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That ISBN is already in the catalog." }); throw error; }
});
app.delete("/api/books/:id", requireAuth, requireCsrf, (req, res) => {
  const result = db.prepare("DELETE FROM books WHERE id = ? AND NOT EXISTS (SELECT 1 FROM loans WHERE book_id = books.id)").run(req.params.id);
  if (!result.changes) return res.status(409).json({ error: "Book not found or it has loan history and cannot be removed." });
  res.status(204).end();
});
app.get("/api/members", requireAuth, (req, res) => {
  const query = `%${clean(req.query.q, 100)}%`;
  res.json(db.prepare(`${memberSelect} WHERE m.name LIKE ? OR m.email LIKE ? OR m.phone LIKE ? ORDER BY m.name COLLATE NOCASE`).all(query, query, query));
});
app.post("/api/members", requireAuth, requireCsrf, (req, res) => {
  const member = validateMember(req.body);
  if (!member) return res.status(400).json({ error: "Enter a name, valid email address, and phone number." });
  try {
    const result = db.prepare("INSERT INTO members (name, email, phone) VALUES (?, ?, ?)").run(member.name, member.email, member.phone);
    res.status(201).json(db.prepare(`${memberSelect} WHERE m.id = ?`).get(result.lastInsertRowid));
  } catch (error) { if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "A member with that email already exists." }); throw error; }
});
app.put("/api/members/:id", requireAuth, requireCsrf, (req, res) => {
  const member = validateMember(req.body);
  if (!member) return res.status(400).json({ error: "Enter a name, valid email address, and phone number." });
  try {
    const result = db.prepare("UPDATE members SET name = ?, email = ?, phone = ? WHERE id = ?").run(member.name, member.email, member.phone, req.params.id);
    if (!result.changes) return res.status(404).json({ error: "Member not found." });
    res.json(db.prepare(`${memberSelect} WHERE m.id = ?`).get(req.params.id));
  } catch (error) { if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "A member with that email already exists." }); throw error; }
});
app.delete("/api/members/:id", requireAuth, requireCsrf, (req, res) => {
  const result = db.prepare("DELETE FROM members WHERE id = ? AND NOT EXISTS (SELECT 1 FROM loans WHERE member_id = members.id)").run(req.params.id);
  if (!result.changes) return res.status(409).json({ error: "Member not found or has loan history and cannot be removed." });
  res.status(204).end();
});
app.get("/api/loans", requireAuth, (req, res) => {
  const filter = req.query.status;
  const conditions = { active: "l.return_date IS NULL", overdue: "l.return_date IS NULL AND l.due_date < date('now','localtime')", returned: "l.return_date IS NOT NULL" };
  const where = conditions[filter] ? `WHERE ${conditions[filter]}` : "";
  res.json(db.prepare(`SELECT l.id, l.book_id AS bookId, l.member_id AS memberId, b.title AS bookTitle, m.name AS memberName, l.checkout_date AS checkoutDate, l.due_date AS dueDate, l.return_date AS returnDate FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id ${where} ORDER BY l.checkout_date DESC, l.id DESC`).all());
});
app.post("/api/loans", requireAuth, requireCsrf, (req, res) => {
  const bookId = Number(req.body.bookId); const memberId = Number(req.body.memberId);
  if (!Number.isInteger(bookId) || !Number.isInteger(memberId) || !db.prepare("SELECT id FROM books WHERE id = ?").get(bookId) || !db.prepare("SELECT id FROM members WHERE id = ?").get(memberId)) return res.status(400).json({ error: "Choose an existing book and member." });
  try {
    const checkoutDate = today(); const dueDate = addDays(checkoutDate, 14);
    const result = db.prepare("INSERT INTO loans (book_id, member_id, checkout_date, due_date) VALUES (?, ?, ?, ?)").run(bookId, memberId, checkoutDate, dueDate);
    res.status(201).json({ id: result.lastInsertRowid, bookId, memberId, checkoutDate, dueDate, returnDate: null });
  } catch (error) { if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That book is already on loan." }); throw error; }
});
app.post("/api/loans/:id/return", requireAuth, requireCsrf, (req, res) => {
  const result = db.prepare("UPDATE loans SET return_date = ? WHERE id = ? AND return_date IS NULL").run(today(), req.params.id);
  if (!result.changes) return res.status(409).json({ error: "Loan not found or already returned." });
  res.json({ message: "Book returned." });
});
app.get("/api/reports", requireAuth, (_req, res) => {
  const summary = db.prepare(`SELECT (SELECT COUNT(*) FROM books) AS totalBooks,
    (SELECT COUNT(*) FROM books b WHERE NOT EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.return_date IS NULL)) AS availableBooks,
    (SELECT COUNT(*) FROM members) AS totalMembers,
    (SELECT COUNT(*) FROM loans WHERE return_date IS NULL) AS activeLoans,
    (SELECT COUNT(*) FROM loans WHERE return_date IS NULL AND due_date < date('now','localtime')) AS overdueLoans`).get();
  const monthly = db.prepare("SELECT strftime('%Y-%m', checkout_date) AS month, COUNT(*) AS count FROM loans WHERE checkout_date >= date('now','start of month','-11 months') GROUP BY month ORDER BY month").all();
  const popular = db.prepare("SELECT b.id, b.title, b.author, COUNT(l.id) AS loanCount FROM books b LEFT JOIN loans l ON l.book_id = b.id GROUP BY b.id ORDER BY loanCount DESC, b.title COLLATE NOCASE LIMIT 5").all();
  res.json({ summary, monthly, popular });
});
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function sendCsv(res, filename, headers, rows) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" }).send(`\uFEFF${content}`);
}
app.get("/api/export/books.csv", requireAuth, (_req, res) => {
  const rows = db.prepare(`${bookSelect} ORDER BY b.title COLLATE NOCASE`).all().map((book) => [book.id, book.title, book.author, book.isbn, book.year, book.available ? "Available" : "On loan", book.loan_count]);
  sendCsv(res, "libris-books.csv", ["ID", "Title", "Author", "ISBN", "Year", "Availability", "Loan count"], rows);
});
app.get("/api/export/members.csv", requireAuth, (_req, res) => {
  const rows = db.prepare(`${memberSelect} ORDER BY m.name COLLATE NOCASE`).all().map((member) => [member.id, member.name, member.email, member.phone, member.active_loans]);
  sendCsv(res, "libris-members.csv", ["ID", "Name", "Email", "Phone", "Active loans"], rows);
});
app.get("/api/export/loans.csv", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT l.id, b.title AS book, m.name AS member, l.checkout_date, l.due_date, l.return_date, CASE WHEN l.return_date IS NOT NULL THEN 'Returned' WHEN l.due_date < date('now','localtime') THEN 'Overdue' ELSE 'Active' END AS status FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id ORDER BY l.checkout_date DESC").all().map((loan) => [loan.id, loan.book, loan.member, loan.checkout_date, loan.due_date, loan.return_date || "", loan.status]);
  sendCsv(res, "libris-loans.csv", ["ID", "Book", "Member", "Checkout date", "Due date", "Return date", "Status"], rows);
});

app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], index: "index.html", maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
app.use((error, _req, res, _next) => {
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must contain valid JSON." });
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That value is already in use." });
  console.error(error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});
const server = app.listen(PORT, () => console.log(`Libris is running at http://localhost:${PORT}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
