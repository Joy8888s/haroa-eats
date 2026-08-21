const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);

const db = new Database(path.join(__dirname, "haroa_eats.db"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   CONFIG
========================= */

const MSG91_WIDGET_ID =
  process.env.MSG91_WIDGET_ID ||
  "366870715254333435383332";

const MSG91_WIDGET_TOKEN =
  process.env.MSG91_WIDGET_TOKEN || "";

const MSG91_AUTHKEY =
  process.env.MSG91_AUTHKEY || "";

/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'customer'
);

CREATE TABLE IF NOT EXISTS restaurants(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  phone TEXT,
  approved INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  available INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  restaurant_id INTEGER NOT NULL,
  total REAL NOT NULL,
  address TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  delivery_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  menu_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  qty INTEGER NOT NULL
);
`);

/* =========================
   DEMO DATA
========================= */

function seed() {

  const admin = db
    .prepare("SELECT id FROM users WHERE phone=?")
    .get("9999999999");

  const rider = db
    .prepare("SELECT id FROM users WHERE phone=?")
    .get("8888888888");

  if (!rider) {

    db.prepare(`
      INSERT INTO users(name,phone,password,role)
      VALUES(?,?,?,'rider')
    `).run(
      "Haroa Rider",
      "8888888888",
      bcrypt.hashSync("rider123", 10)
    );
  }

  if (!admin) {

    db.prepare(`
      INSERT INTO users(name,phone,password,role)
      VALUES(?,?,?,'admin')
    `).run(
      "Haroa Eats Admin",
      "9999999999",
      bcrypt.hashSync("admin123", 10)
    );
  }

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM restaurants")
    .get().c;

  if (!count) {

    const restaurant = db.prepare(`
      INSERT INTO restaurants(name,area,phone,approved)
      VALUES(?,?,?,1)
    `);

    const a = restaurant.run(
      "Swagatam Restaurant",
      "Haroa",
      ""
    ).lastInsertRowid;

    const b = restaurant.run(
      "Fry Nation",
      "Haroa",
      ""
    ).lastInsertRowid;

    const c = restaurant.run(
      "A1 Haji Biryani",
      "Haroa",
      ""
    ).lastInsertRowid;

    const menu = db.prepare(`
      INSERT INTO menu(restaurant_id,name,price)
      VALUES(?,?,?)
    `);

    [
      ["Chicken Biryani", 160],
      ["Egg Roll", 70],
      ["Chicken Roll", 100],
      ["Fried Rice", 120]
    ].forEach(item => menu.run(a, ...item));

    [
      ["Chicken Fry", 140],
      ["French Fries", 80],
      ["Chicken Burger", 130],
      ["Momo", 100]
    ].forEach(item => menu.run(b, ...item));

    [
      ["Chicken Biryani", 150],
      ["Mutton Biryani", 220],
      ["Chicken Chaap", 140]
    ].forEach(item => menu.run(c, ...item));
  }
}

seed();

/* =========================
   HELPERS
========================= */

function auth(req, res, next) {

  if (!req.session.user) {

    return res.status(401).json({
      error: "Login required"
    });
  }

  next();
}

function role(...roles) {

  return (req, res, next) => {

    if (
      !req.session.user ||
      !roles.includes(req.session.user.role)
    ) {

      return res.status(403).json({
        error: "Not allowed"
      });
    }

    next();
  };
}

function normalizeIndianPhone(value) {

  let phone = String(value || "")
    .replace(/\D/g, "");

  if (
    phone.startsWith("91") &&
    phone.length === 12
  ) {
    phone = phone.slice(2);
  }

  if (
    phone.startsWith("0") &&
    phone.length === 11
  ) {
    phone = phone.slice(1);
  }

  return phone;
}

function findValueDeep(value, keys) {

  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  for (const key of keys) {

    if (
      Object.prototype.hasOwnProperty.call(
        value,
        key
      ) &&
      value[key] != null
    ) {

      return value[key];
    }
  }

  for (const child of Object.values(value)) {

    if (
      child &&
      typeof child === "object"
    ) {

      const found =
        findValueDeep(child, keys);

      if (found != null) {
        return found;
      }
    }
  }

  return null;
}

function decodeJwtPayload(token) {

  try {

    const parts =
      String(token || "").split(".");

    if (parts.length !== 3) {
      return {};
    }

    const payload =
      parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    return JSON.parse(
      Buffer
        .from(payload, "base64")
        .toString("utf8")
    );

  } catch (_) {

    return {};
  }
}

function extractMsg91Phone(data) {

  const value = findValueDeep(data, [
    "mobile",
    "mobile_number",
    "phone",
    "phone_number",
    "identifier",
    "number"
  ]);

  return normalizeIndianPhone(value);
}

/* =========================
   MSG91 VERIFY
========================= */

async function verifyMsg91AccessToken(accessToken) {

  if (!MSG91_AUTHKEY) {

    throw new Error(
      "MSG91_AUTHKEY is not configured on the server"
    );
  }

  const response = await fetch(
    "https://control.msg91.com/api/v5/widget/verifyAccessToken",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },

      body: new URLSearchParams({
        authkey: MSG91_AUTHKEY,
        "access-token": accessToken
      })
    }
  );

  let data = {};

  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {

    throw new Error(
      data.message ||
      data.error ||
      "MSG91 access-token verification failed"
    );
  }

  const status =
    String(
      data.type ||
      data.status ||
      data.message ||
      ""
    ).toLowerCase();

  if (
    data.success === false ||
    status.includes("fail") ||
    status.includes("invalid")
  ) {

    throw new Error(
      data.message ||
      "OTP verification failed"
    );
  }

  return data;
}

/* =========================
   OTP CONFIG
========================= */

app.get("/api/otp/config", (req, res) => {

  const widgetConfigured =
    Boolean(MSG91_WIDGET_ID);

  const tokenConfigured =
    Boolean(MSG91_WIDGET_TOKEN);

  res.set("Cache-Control", "no-store");

  res.json({

    enabled:
      widgetConfigured &&
      tokenConfigured,

    widgetId:
      widgetConfigured
        ? MSG91_WIDGET_ID
        : null,

    tokenAuth:
      tokenConfigured
        ? MSG91_WIDGET_TOKEN
        : null
  });
});

/* =========================
   OTP LOGIN / SIGNUP
========================= */

app.post(
  "/api/otp/verify",
  async (req, res) => {

    const accessToken =
      String(
        req.body.accessToken || ""
      ).trim();

    const requestedName =
      String(
        req.body.name || ""
      ).trim();

    const mode =
      req.body.mode === "signup"
        ? "signup"
        : "login";

    if (!accessToken) {

      return res.status(400).json({
        error: "OTP access token missing"
      });
    }

    try {

      const verified =
        await verifyMsg91AccessToken(
          accessToken
        );

      const tokenPayload =
        decodeJwtPayload(accessToken);

      const verifiedPhone =
        extractMsg91Phone(verified) ||
        extractMsg91Phone(tokenPayload);

      if (!/^\d{10}$/.test(verifiedPhone)) {

        return res.status(400).json({
          error:
            "MSG91 verified mobile number পাওয়া যায়নি"
        });
      }

      let user =
        db
          .prepare(
            "SELECT * FROM users WHERE phone=?"
          )
          .get(verifiedPhone);

      if (
        user &&
        user.role !== "customer"
      ) {

        return res.status(403).json({
          error:
            "Admin/Rider-এর জন্য password login ব্যবহার করুন"
        });
      }

      if (mode === "login" && !user) {

        return res.status(404).json({
          error:
            "এই মোবাইল নম্বরে account নেই। আগে OTP Signup করুন।"
        });
      }

      if (mode === "signup" && user) {

        return res.status(409).json({
          error:
            "এই মোবাইল নম্বর আগে থেকেই registered। OTP Login করুন।"
        });
      }

      if (!user) {

        const name =
          requestedName ||
          "Haroa Customer";

        const randomPassword =
          bcrypt.hashSync(
            crypto
              .randomBytes(32)
              .toString("hex"),
            10
          );

        const info =
          db.prepare(`
            INSERT INTO users(
              name,
              phone,
              password,
              role
            )
            VALUES(?,?,?,'customer')
          `).run(
            name,
            verifiedPhone,
            randomPassword
          );

        user =
          db
            .prepare(
              "SELECT * FROM users WHERE id=?"
            )
            .get(info.lastInsertRowid);

      } else if (
        requestedName &&
        user.name !== requestedName
      ) {

        db.prepare(`
          UPDATE users
          SET name=?
          WHERE id=?
        `).run(
          requestedName,
          user.id
        );

        user =
          db
            .prepare(
              "SELECT * FROM users WHERE id=?"
            )
            .get(user.id);
      }

      req.session.user = {

        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role

      };

      res.json({

        ok: true,

        user:
          req.session.user,

        msg91:
          verified
      });

    } catch (error) {

      console.error(
        "MSG91 OTP verify error:",
        error
      );

      res.status(401).json({

        error:
          error.message ||
          "OTP verification failed"
      });
    }
  }
);

/* =========================
   PASSWORD REGISTER
========================= */

app.post(
  "/api/register",
  async (req, res) => {

    const name =
      String(
        req.body.name || ""
      ).trim();

    const phone =
      normalizeIndianPhone(
        req.body.phone
      );

    const password =
      String(
        req.body.password || ""
      );

    if (
      !name ||
      !phone ||
      !password
    ) {

      return res.status(400).json({
        error: "সব তথ্য দিন"
      });
    }

    if (!/^\d{10}$/.test(phone)) {

      return res.status(400).json({
        error:
          "সঠিক 10 digit mobile number দিন"
      });
    }

    if (password.length < 6) {

      return res.status(400).json({
        error:
          "Password কমপক্ষে 6 character হতে হবে"
      });
    }

    try {

      const hash =
        await bcrypt.hash(
          password,
          10
        );

      const info =
        db.prepare(`
          INSERT INTO users(
            name,
            phone,
            password,
            role
          )
          VALUES(?,?,?,'customer')
        `).run(
          name,
          phone,
          hash
        );

      req.session.user = {

        id:
          info.lastInsertRowid,

        name,
        phone,

        role:
          "customer"
      };

      res.json({

        ok: true,

        user:
          req.session.user
      });

    } catch (error) {

      res.status(400).json({

        error:
          "এই মোবাইল নম্বর আগে ব্যবহার হয়েছে"
      });
    }
  }
);

/* =========================
   PASSWORD LOGIN
========================= */

app.post(
  "/api/login",
  async (req, res) => {

    const phone =
      normalizeIndianPhone(
        req.body.phone
      );

    const password =
      String(
        req.body.password || ""
      );

    const user =
      db
        .prepare(
          "SELECT * FROM users WHERE phone=?"
        )
        .get(phone);

    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(
        password,
        user.password
      ))
    ) {

      return res.status(401).json({
        error:
          "মোবাইল বা password ভুল"
      });
    }

    req.session.user = {

      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role

    };

    res.json({

      ok: true,

      user:
        req.session.user
    });
  }
);

/* =========================
   LOGOUT
========================= */

app.post(
  "/api/logout",
  (req, res) => {

    req.session.destroy(
      () => {

        res.json({
          ok: true
        });

      }
    );
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  (req, res) => {
      if (!req.session.user) {
    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    user: req.session.user
  });
});

/* =========================
   RESTAURANTS
========================= */

app.get(
  "/api/restaurants",
  (req, res) => {

    const restaurants =
      db.prepare(`
        SELECT *
        FROM restaurants
        WHERE approved=1
        ORDER BY id DESC
      `).all();

    res.json(restaurants);
  }
);

/* =========================
   RESTAURANT MENU
========================= */

app.get(
  "/api/restaurants/:id/menu",
  (req, res) => {

    const restaurantId =
      Number(req.params.id);

    if (!Number.isInteger(restaurantId)) {

      return res.status(400).json({
        error: "Invalid restaurant id"
      });
    }

    const menu =
      db.prepare(`
        SELECT *
        FROM menu
        WHERE restaurant_id=?
        AND available=1
        ORDER BY id
      `).all(restaurantId);

    res.json(menu);
  }
);

/* =========================
   CREATE ORDER
========================= */

app.post(
  "/api/orders",
  auth,
  role("customer"),
  (req, res) => {

    const restaurantId =
      Number(req.body.restaurant_id);

    const address =
      String(
        req.body.address || ""
      ).trim();

    const items =
      Array.isArray(req.body.items)
        ? req.body.items
        : [];

    if (
      !Number.isInteger(restaurantId) ||
      !address ||
      !items.length
    ) {

      return res.status(400).json({
        error:
          "Restaurant, address এবং items প্রয়োজন"
      });
    }

    const restaurant =
      db.prepare(`
        SELECT *
        FROM restaurants
        WHERE id=?
        AND approved=1
      `).get(restaurantId);

    if (!restaurant) {

      return res.status(404).json({
        error:
          "Restaurant পাওয়া যায়নি"
      });
    }

    let total = 0;

    const normalizedItems = [];

    for (const item of items) {

      const menuId =
        Number(item.menu_id);

      const qty =
        Number(item.qty);

      if (
        !Number.isInteger(menuId) ||
        !Number.isInteger(qty) ||
        qty < 1
      ) {
        continue;
      }

      const menu =
        db.prepare(`
          SELECT *
          FROM menu
          WHERE id=?
          AND restaurant_id=?
          AND available=1
        `).get(
          menuId,
          restaurantId
        );

      if (!menu) {
        continue;
      }

      total +=
        Number(menu.price) * qty;

      normalizedItems.push({

        menu_id:
          menu.id,

        name:
          menu.name,

        price:
          Number(menu.price),

        qty

      });
    }

    if (!normalizedItems.length) {

      return res.status(400).json({
        error:
          "Valid menu item পাওয়া যায়নি"
      });
    }

    const createOrder =
      db.transaction(() => {

        const order =
          db.prepare(`
            INSERT INTO orders(
              customer_id,
              restaurant_id,
              total,
              address,
              status
            )
            VALUES(?,?,?,?,?)
          `).run(
            req.session.user.id,
            restaurantId,
            total,
            address,
            "Pending"
          );

        const orderId =
          order.lastInsertRowid;

        const insertItem =
          db.prepare(`
            INSERT INTO order_items(
              order_id,
              menu_id,
              name,
              price,
              qty
            )
            VALUES(?,?,?,?,?)
          `);

        for (
          const item of normalizedItems
        ) {

          insertItem.run(
            orderId,
            item.menu_id,
            item.name,
            item.price,
            item.qty
          );
        }

        return orderId;
      });

    const orderId =
      createOrder();

    res.json({

      ok: true,

      orderId,

      total
    });
  }
);

/* =========================
   CUSTOMER ORDERS
========================= */

app.get(
  "/api/orders",
  auth,
  (req, res) => {

    let orders;

    if (
      req.session.user.role ===
      "customer"
    ) {

      orders =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant_name
          FROM orders o
          LEFT JOIN restaurants r
            ON r.id=o.restaurant_id
          WHERE o.customer_id=?
          ORDER BY o.id DESC
        `).all(
          req.session.user.id
        );

    } else if (
      req.session.user.role ===
      "rider"
    ) {

      orders =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant_name
          FROM orders o
          LEFT JOIN restaurants r
            ON r.id=o.restaurant_id
          WHERE o.delivery_id=?
          ORDER BY o.id DESC
        `).all(
          req.session.user.id
        );

    } else {

      orders =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant_name
          FROM orders o
          LEFT JOIN restaurants r
            ON r.id=o.restaurant_id
          ORDER BY o.id DESC
        `).all();
    }

    res.json(orders);
  }
);

/* =========================
   ORDER DETAILS
========================= */

app.get(
  "/api/orders/:id",
  auth,
  (req, res) => {

    const orderId =
      Number(req.params.id);

    if (!Number.isInteger(orderId)) {

      return res.status(400).json({
        error:
          "Invalid order id"
      });
    }

    const order =
      db.prepare(`
        SELECT
          o.*,
          r.name AS restaurant_name
        FROM orders o
        LEFT JOIN restaurants r
          ON r.id=o.restaurant_id
        WHERE o.id=?
      `).get(orderId);

    if (!order) {

      return res.status(404).json({
        error:
          "Order পাওয়া যায়নি"
      });
    }

    if (
      req.session.user.role ===
      "customer" &&
      order.customer_id !==
        req.session.user.id
    ) {

      return res.status(403).json({
        error:
          "Not allowed"
      });
    }

    const items =
      db.prepare(`
        SELECT *
        FROM order_items
        WHERE order_id=?
        ORDER BY id
      `).all(orderId);

    res.json({

      order,

      items
    });
  }
);

/* =========================
   UPDATE ORDER STATUS
========================= */

app.patch(
  "/api/orders/:id/status",
  auth,
  role("admin", "rider"),
  (req, res) => {

    const orderId =
      Number(req.params.id);

    const status =
      String(
        req.body.status || ""
      ).trim();

    const allowed = [

      "Pending",
      "Accepted",
      "Preparing",
      "Ready",
      "Picked Up",
      "Out for Delivery",
      "Delivered",
      "Cancelled"

    ];

    if (
      !Number.isInteger(orderId) ||
      !allowed.includes(status)
    ) {

      return res.status(400).json({
        error:
          "Invalid order status"
      });
    }

    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `).get(orderId);

    if (!order) {

      return res.status(404).json({
        error:
          "Order পাওয়া যায়নি"
      });
    }

    if (
      req.session.user.role ===
      "rider" &&
      order.delivery_id !==
        req.session.user.id
    ) {

      return res.status(403).json({
        error:
          "এই order আপনার assigned নয়"
      });
    }

    db.prepare(`
      UPDATE orders
      SET status=?
      WHERE id=?
    `).run(
      status,
      orderId
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   RIDER - AVAILABLE ORDERS
========================= */

app.get(
  "/api/rider/orders",
  auth,
  role("rider"),
  (req, res) => {

    const orders =
      db.prepare(`
        SELECT
          o.*,
          r.name AS restaurant_name
        FROM orders o
        LEFT JOIN restaurants r
          ON r.id=o.restaurant_id
        WHERE
          o.delivery_id IS NULL
          AND o.status IN(
            'Pending',
            'Accepted',
            'Preparing',
            'Ready'
          )
        ORDER BY o.id ASC
      `).all();

    res.json(orders);
  }
);

/* =========================
   RIDER - ACCEPT ORDER
========================= */

app.post(
  "/api/rider/orders/:id/accept",
  auth,
  role("rider"),
  (req, res) => {

    const orderId =
      Number(req.params.id);

    if (!Number.isInteger(orderId)) {

      return res.status(400).json({
        error:
          "Invalid order id"
      });
    }

    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `).get(orderId);

    if (!order) {

      return res.status(404).json({
        error:
          "Order পাওয়া যায়নি"
      });
    }

    if (order.delivery_id) {

      return res.status(409).json({
        error:
          "এই order already assigned"
      });
    }

    db.prepare(`
      UPDATE orders
      SET
        delivery_id=?,
        status='Accepted'
      WHERE id=?
    `).run(
      req.session.user.id,
      orderId
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   ADMIN - ALL USERS
========================= */

app.get(
  "/api/admin/users",
  auth,
  role("admin"),
  (req, res) => {

    const users =
      db.prepare(`
        SELECT
          id,
          name,
          phone,
          role
        FROM users
        ORDER BY id DESC
      `).all();

    res.json(users);
  }
);

/* =========================
   ADMIN - ALL ORDERS
========================= */

app.get(
  "/api/admin/orders",
  auth,
  role("admin"),
  (req, res) => {

    const orders =
      db.prepare(`
        SELECT
          o.*,
          c.name AS customer_name,
          c.phone AS customer_phone,
          r.name AS restaurant_name,
          d.name AS rider_name
        FROM orders o

        LEFT JOIN users c
          ON c.id=o.customer_id

        LEFT JOIN restaurants r
          ON r.id=o.restaurant_id

        LEFT JOIN users d
          ON d.id=o.delivery_id

        ORDER BY o.id DESC
      `).all();

    res.json(orders);
  }
);

/* =========================
   ADMIN - RIDERS
========================= */

app.get(
  "/api/admin/riders",
  auth,
  role("admin"),
  (req, res) => {

    const riders =
      db.prepare(`
        SELECT
          id,
          name,
          phone
        FROM users
        WHERE role='rider'
        ORDER BY id DESC
      `).all();

    res.json(riders);
  }
);

/* =========================
   ADMIN - ASSIGN RIDER
========================= */

app.post(
  "/api/admin/orders/:id/assign-rider",
  auth,
  role("admin"),
  (req, res) => {

    const orderId =
      Number(req.params.id);

    const riderId =
      Number(req.body.rider_id);

    if (
      !Number.isInteger(orderId) ||
      !Number.isInteger(riderId)
    ) {

      return res.status(400).json({
        error:
          "Invalid order বা rider"
      });
    }

    const rider =
      db.prepare(`
        SELECT id
        FROM users
        WHERE id=?
        AND role='rider'
      `).get(riderId);

    if (!rider) {

      return res.status(404).json({
        error:
          "Rider পাওয়া যায়নি"
      });
    }

    const order =
      db.prepare(`
        SELECT id
        FROM orders
        WHERE id=?
      `).get(orderId);

    if (!order) {

      return res.status(404).json({
        error:
          "Order পাওয়া যায়নি"
      });
    }

    db.prepare(`
      UPDATE orders
      SET
        delivery_id=?,
        status='Accepted'
      WHERE id=?
    `).run(
      riderId,
      orderId
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   ADMIN - RESTAURANTS
========================= */

app.get(
  "/api/admin/restaurants",
  auth,
  role("admin"),
  (req, res) => {

    const restaurants =
      db.prepare(`
        SELECT *
        FROM restaurants
        ORDER BY id DESC
      `).all();

    res.json(restaurants);
  }
);

/* =========================
   ADMIN - APPROVE RESTAURANT
========================= */

app.patch(
  "/api/admin/restaurants/:id/approve",
  auth,
  role("admin"),
  (req, res) => {

    const restaurantId =
      Number(req.params.id);

    if (
      !Number.isInteger(restaurantId)
    ) {

      return res.status(400).json({
        error:
          "Invalid restaurant id"
      });
    }

    db.prepare(`
      UPDATE restaurants
      SET approved=1
      WHERE id=?
    `).run(restaurantId);

    res.json({
      ok: true
    });
  }
);

/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok: true,

      service:
        "Haroa Eats",

      msg91Widget:
        Boolean(MSG91_WIDGET_ID),

      msg91WidgetToken:
        Boolean(MSG91_WIDGET_TOKEN),

      msg91AuthKey:
        Boolean(MSG91_AUTHKEY),

      time:
        new Date().toISOString()
    });
  }
);

/* =========================
   404 API
========================= */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      error:
        "API endpoint not found"
    });
  }
);

/* =========================
   ERROR HANDLER
========================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "Server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({

      error:
        "Internal server error"
    });
  }
);

/* =========================
   START SERVER
========================= */

const PORT =
  Number(
    process.env.PORT || 10000
  );

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Haroa Eats running on port ${PORT}`
    );

    console.log(
      `MSG91 widget configured: ${
        Boolean(MSG91_WIDGET_ID)
      }`
    );

    console.log(
      `MSG91 widget token configured: ${
        Boolean(MSG91_WIDGET_TOKEN)
      }`
    );

    console.log(
      `MSG91 authkey configured: ${
        Boolean(MSG91_AUTHKEY)
      }`
    );
  }
);
