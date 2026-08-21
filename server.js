const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "CHANGE_THIS_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

const db = new Database(
  path.join(__dirname, "haroa_eats.db")
);

/* =====================================================
   DATABASE
===================================================== */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'customer'
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  phone TEXT,
  approved INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  available INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  restaurant_id INTEGER NOT NULL,
  total REAL NOT NULL,
  address TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  delivery_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  menu_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  qty INTEGER NOT NULL
);
`);

/* =====================================================
   ENVIRONMENT
===================================================== */

const MSG91_AUTHKEY =
  process.env.MSG91_AUTHKEY || "";

const MSG91_TEMPLATE_ID =
  process.env.MSG91_TEMPLATE_ID || "";

/* =====================================================
   HELPERS
===================================================== */

function normalizePhone(value) {
  let phone = String(value || "")
    .replace(/\D/g, "");

  if (phone.startsWith("91") && phone.length === 12) {
    phone = phone.substring(2);
  }

  if (phone.startsWith("0") && phone.length === 11) {
    phone = phone.substring(1);
  }

  return phone;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Login required"
    });
  }

  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (
      !req.session.user ||
      !roles.includes(req.session.user.role)
    ) {
      return res.status(403).json({
        error: "Access denied"
      });
    }

    next();
  };
}

async function msg91(url, options = {}) {
  const response = await fetch(url, options);

  let data = {};

  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      "MSG91 request failed"
    );
  }

  const statusText = String(
    data.message ||
    data.type ||
    data.status ||
    ""
  ).toLowerCase();

  if (
    data.success === false ||
    data.type === "error" ||
    statusText.includes("fail") ||
    statusText.includes("invalid")
  ) {
    throw new Error(
      data.message ||
      "MSG91 request failed"
    );
  }

  return data;
}

/* =====================================================
   DEMO STAFF
===================================================== */

function seedStaff() {
  const admin = db
    .prepare(
      "SELECT id FROM users WHERE phone=?"
    )
    .get("9999999999");

  if (!admin) {
    db.prepare(`
      INSERT INTO users
      (name, phone, password, role)
      VALUES (?, ?, ?, ?)
    `).run(
      "Haroa Eats Admin",
      "9999999999",
      bcrypt.hashSync("admin123", 10),
      "admin"
    );
  }

  const rider = db
    .prepare(
      "SELECT id FROM users WHERE phone=?"
    )
    .get("8888888888");

  if (!rider) {
    db.prepare(`
      INSERT INTO users
      (name, phone, password, role)
      VALUES (?, ?, ?, ?)
    `).run(
      "Haroa Rider",
      "8888888888",
      bcrypt.hashSync("rider123", 10),
      "rider"
    );
  }
}

seedStaff();

/* =====================================================
   DEMO RESTAURANTS
===================================================== */

function seedRestaurants() {
  const count = db
    .prepare(
      "SELECT COUNT(*) AS c FROM restaurants"
    )
    .get().c;

  if (count > 0) return;

  const insertRestaurant = db.prepare(`
    INSERT INTO restaurants
    (name, area, phone, approved)
    VALUES (?, ?, ?, 1)
  `);

  const r1 = insertRestaurant.run(
    "Swagatam Restaurant",
    "Haroa",
    ""
  ).lastInsertRowid;

  const r2 = insertRestaurant.run(
    "Fry Nation",
    "Haroa",
    ""
  ).lastInsertRowid;

  const r3 = insertRestaurant.run(
    "A1 Haji Biryani",
    "Haroa",
    ""
  ).lastInsertRowid;

  const insertMenu = db.prepare(`
    INSERT INTO menu
    (restaurant_id, name, price, available)
    VALUES (?, ?, ?, 1)
  `);

  [
    [r1, "Chicken Biryani", 160],
    [r1, "Egg Roll", 70],
    [r1, "Chicken Roll", 100],
    [r1, "Fried Rice", 120],

    [r2, "Chicken Fry", 140],
    [r2, "French Fries", 80],
    [r2, "Chicken Burger", 130],
    [r2, "Momo", 100],

    [r3, "Chicken Biryani", 150],
    [r3, "Mutton Biryani", 220],
    [r3, "Chicken Chaap", 140]
  ].forEach(item => {
    insertMenu.run(...item);
  });
}

seedRestaurants();

/* =====================================================
   OTP CONFIG
===================================================== */

app.get("/api/otp/config", (req, res) => {
  res.json({
    enabled:
      Boolean(
        MSG91_AUTHKEY &&
        MSG91_TEMPLATE_ID
      )
  });
});

/* =====================================================
   SEND OTP
===================================================== */

app.post("/api/otp/send", async (req, res) => {
  const phone = normalizePhone(
    req.body.phone
  );

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({
      error:
        "সঠিক 10 digit Indian mobile number দিন"
    });
  }

  if (
    !MSG91_AUTHKEY ||
    !MSG91_TEMPLATE_ID
  ) {
    return res.status(500).json({
      error:
        "Render Environment-এ MSG91_AUTHKEY এবং MSG91_TEMPLATE_ID সেট করুন"
    });
  }

  try {
    const url =
      new URL(
        "https://control.msg91.com/api/v5/otp"
      );

    url.searchParams.set(
      "template_id",
      MSG91_TEMPLATE_ID
    );

    url.searchParams.set(
      "mobile",
      "91" + phone
    );

    url.searchParams.set(
      "authkey",
      MSG91_AUTHKEY
    );

    const data = await msg91(
      url.toString(),
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },
        body: JSON.stringify({})
      }
    );

    req.session.pendingPhone = phone;
    req.session.otpSentAt = Date.now();

    return res.json({
      ok: true,
      message:
        data.message ||
        "OTP sent successfully"
    });

  } catch (error) {
    console.error(
      "MSG91 SEND OTP:",
      error
    );

    return res.status(400).json({
      error:
        error.message ||
        "OTP পাঠানো যায়নি"
    });
  }
});

/* =====================================================
   RESEND OTP
===================================================== */

app.post(
  "/api/otp/resend",
  async (req, res) => {
    const phone = normalizePhone(
      req.body.phone
    );

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({
        error:
          "সঠিক mobile number দিন"
      });
    }

    if (!MSG91_AUTHKEY) {
      return res.status(500).json({
        error:
          "MSG91_AUTHKEY missing"
      });
    }

    try {
      const url =
        new URL(
          "https://control.msg91.com/api/v5/otp/retry"
        );

      url.searchParams.set(
        "authkey",
        MSG91_AUTHKEY
      );

      url.searchParams.set(
        "mobile",
        "91" + phone
      );

      url.searchParams.set(
        "retrytype",
        "text"
      );

      const data = await msg91(
        url.toString(),
        {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          }
        }
      );

      req.session.pendingPhone = phone;
      req.session.otpSentAt = Date.now();

      res.json({
        ok: true,
        message:
          data.message ||
          "OTP resent successfully"
      });

    } catch (error) {
      console.error(
        "MSG91 RESEND OTP:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "OTP resend করা যায়নি"
      });
    }
  }
);

/* =====================================================
   VERIFY OTP
===================================================== */

app.post(
  "/api/otp/verify",
  async (req, res) => {
    const phone = normalizePhone(
      req.body.phone
    );

    const otp = String(
      req.body.otp || ""
    ).replace(/\D/g, "");

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({
        error:
          "সঠিক mobile number দিন"
      });
    }

    if (!/^\d{4,9}$/.test(otp)) {
      return res.status(400).json({
        error:
          "সঠিক OTP দিন"
      });
    }

    if (!MSG91_AUTHKEY) {
      return res.status(500).json({
        error:
          "MSG91_AUTHKEY missing"
      });
    }

    if (
      req.session.pendingPhone &&
      req.session.pendingPhone !== phone
    ) {
      return res.status(400).json({
        error:
          "এই OTP অন্য mobile number-এর জন্য"
      });
    }

    try {
      const url =
        new URL(
          "https://control.msg91.com/api/v5/otp/verify"
        );

      url.searchParams.set(
        "otp",
        otp
      );

      url.searchParams.set(
        "mobile",
        "91" + phone
      );

      const data = await msg91(
        url.toString(),
        {
          method: "GET",
          headers: {
            authkey:
              MSG91_AUTHKEY,
            Accept:
              "application/json"
          }
        }
      );

      console.log(
        "MSG91 VERIFY:",
        data
      );

      let user =
        db
          .prepare(
            "SELECT * FROM users WHERE phone=?"
          )
          .get(phone);

      if (
        user &&
        user.role !== "customer"
      ) {
        return res.status(403).json({
          error:
            "Admin/Rider-এর জন্য Staff Login ব্যবহার করুন"
        });
      }

      if (!user) {
        const result =
          db.prepare(`
            INSERT INTO users
            (name, phone, password, role)
            VALUES (?, ?, NULL, 'customer')
          `).run(
            "Haroa Customer",
            phone
          );

        user =
          db
            .prepare(
              "SELECT * FROM users WHERE id=?"
            )
            .get(
              result.lastInsertRowid
            );
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role
      };

      delete req.session.pendingPhone;
      delete req.session.otpSentAt;

      return res.json({
        ok: true,
        user: req.session.user
      });

    } catch (error) {
      console.error(
        "MSG91 VERIFY OTP:",
        error
      );

      return res.status(400).json({
        error:
          error.message ||
          "OTP verification failed"
      });
    }
  }
);

/* =====================================================
   STAFF LOGIN
===================================================== */

app.post(
  "/api/staff/login",
  async (req, res) => {
    const phone = normalizePhone(
      req.body.phone
    );

    const password =
      String(
        req.body.password || ""
      );

    if (
      !phone ||
      !password
    ) {
      return res.status(400).json({
        error:
          "Phone এবং password দিন"
      });
    }

    const user =
      db
        .prepare(
          "SELECT * FROM users WHERE phone=?"
        )
        .get(phone);

    if (
      !user ||
      !user.password
    ) {
      return res.status(401).json({
        error:
          "Staff account পাওয়া যায়নি"
      });
    }

    if (
      user.role !== "admin" &&
      user.role !== "rider"
    ) {
      return res.status(403).json({
        error:
          "Customer-এর জন্য OTP Login ব্যবহার করুন"
      });
    }

    const valid =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!valid) {
      return res.status(401).json({
        error:
          "Wrong password"
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
      user: req.session.user
    });
  }
);

/* =====================================================
   ME
===================================================== */

app.get(
  "/api/me",
  (req, res) => {
    res.json({
      loggedIn:
        Boolean(
          req.session.user
        ),
      user:
        req.session.user ||
        null
    });
  }
);

/* =====================================================
   LOGOUT
===================================================== */

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

/* =====================================================
   RESTAURANTS
===================================================== */

app.get(
  "/api/restaurants",
  (req, res) => {
    const restaurants =
      db.prepare(`
        SELECT
          id,
          name,
          area,
          phone
        FROM restaurants
        WHERE approved=1
        ORDER BY id DESC
      `).all();

    res.json(restaurants);
  }
);

/* =====================================================
   RESTAURANT MENU
===================================================== */

app.get(
  "/api/restaurants/:id/menu",
  (req, res) => {
    const restaurantId =
      Number(req.params.id);

    if (!restaurantId) {
      return res.status(400).json({
        error:
          "Invalid restaurant"
      });
    }

    const menu =
      db.prepare(`
        SELECT
          id,
          restaurant_id,
          name,
          price,
          available
        FROM menu
        WHERE restaurant_id=?
        AND available=1
        ORDER BY id
      `).all(
        restaurantId
      );

    res.json(menu);
  }
);

/* =====================================================
   CREATE ORDER
===================================================== */

app.post(
  "/api/orders",
  requireLogin,
  requireRole("customer"),
  (req, res) => {
    const restaurantId =
      Number(
        req.body.restaurant_id
      );

    const address =
      String(
        req.body.address || ""
      ).trim();

    const items =
      Array.isArray(
        req.body.items
      )
        ? req.body.items
        : [];

    if (!restaurantId) {
      return res.status(400).json({
        error:
          "Restaurant নির্বাচন করুন"
      });
    }

    if (!address) {
      return res.status(400).json({
        error:
          "Delivery address দিন"
      });
    }

    if (!items.length) {
      return res.status(400).json({
        error:
          "Cart empty"
      });
    }

    const restaurant =
      db.prepare(`
        SELECT *
        FROM restaurants
        WHERE id=?
        AND approved=1
      `).get(
        restaurantId
      );

    if (!restaurant) {
      return res.status(404).json({
        error:
          "Restaurant পাওয়া যায়নি"
      });
    }

    let total = 0;
    const finalItems = [];

    for (const item of items) {
      const menuId =
        Number(item.menu_id);

      const qty =
        Math.max(
          1,
          Number(item.qty) || 1
        );

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
        return res.status(400).json({
          error:
            "Invalid menu item"
        });
      }

      total +=
        Number(menu.price) *
        qty;

      finalItems.push({
        menu_id: menu.id,
        name: menu.name,
        price: menu.price,
        qty
      });
    }

    const transaction =
      db.transaction(() => {

        const order =
          db.prepare(`
            INSERT INTO orders
            (
              customer_id,
              restaurant_id,
              total,
              address,
              status
            )
            VALUES (?, ?, ?, ?, 'Pending')
          `).run(
            req.session.user.id,
            restaurantId,
            total,
            address
          );

        const orderId =
          order.lastInsertRowid;

        const insertItem =
          db.prepare(`
            INSERT INTO order_items
            (
              order_id,
              menu_id,
              name,
              price,
              qty
            )
            VALUES (?, ?, ?, ?, ?)
          `);

        for (
          const item of finalItems
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
      transaction();

    res.json({
      ok: true,
      orderId,
      total
    });
  }
);

/* =====================================================
   ORDERS
===================================================== */

app.get(
  "/api/orders",
  requireLogin,
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
            r.name AS restaurant,
            u.name AS customer
          FROM orders o
          JOIN restaurants r
            ON r.id=o.restaurant_id
          JOIN users u
            ON u.id=o.customer_id
          WHERE o.customer_id=?
          ORDER BY o.id DESC
        `).all(
          req.session.user.id
        );

    } else {

      orders =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant,
            u.name AS customer,
            u.phone AS customer_phone
          FROM orders o
          JOIN restaurants r
            ON r.id=o.restaurant_id
          JOIN users u
            ON u.id=o.customer_id
          ORDER BY o.id DESC
        `).all();
    }

    res.json(orders);
  }
);

/* =====================================================
   ORDER ITEMS
===================================================== */

app.get(
  "/api/orders/:id/items",
  requireLogin,
  (req, res) => {

    const orderId =
      Number(req.params.id);

    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `).get(orderId);

    if (!order) {
      return res.status(404).json({
        error:
          "Order not found"
      });
    }

    const isOwner =
      order.customer_id ===
      req.session.user.id;

    const staff =
      req.session.user.role ===
        "admin" ||
      req.session.user.role ===
        "rider";

    if (!isOwner && !staff) {
      return res.status(403).json({
        error:
          "Access denied"
      });
    }

    const items =
      db.prepare(`
        SELECT *
        FROM order_items
        WHERE order_id=?
      `).all(orderId);

    res.json(items);
  }
);

/* =====================================================
   UPDATE ORDER STATUS
===================================================== */

app.patch(
  "/api/orders/:id/status",
  requireLogin,
  requireRole(
    "admin",
    "rider"
  ),
  (req, res) => {

    const orderId =
      Number(req.params.id);

    const status =
      String(
        req.body.status || ""
      );

    const allowed = [
      "Pending",
      "Preparing",
      "Picked up",
      "Delivered",
      "Cancelled"
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error:
          "Invalid status"
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
          "Order not found"
      });
    }

    if (
      req.session.user.role ===
      "rider"
    ) {
      if (
        order.delivery_id !==
        req.session.user.id
      ) {
        return res.status(403).json({
          error:
            "Order is not assigned to you"
        });
      }
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

/* =====================================================
   RIDER CLAIM
===================================================== */

app.post(
  "/api/delivery/claim/:id",
  requireLogin,
  requireRole("rider"),
  (req, res) => {

    const orderId =
      Number(req.params.id);

    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `).get(orderId);

    if (!order) {
      return res.status(404).json({
        error:
          "Order not found"
      });
    }

    if (order.delivery_id) {
      return res.status(400).json({
        error:
          "Order already assigned"
      });
    }

    db.prepare(`
      UPDATE orders
      SET
        delivery_id=?,
        status='Picked up'
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

/* =====================================================
   ADMIN STATS
===================================================== */

app.get(
  "/api/admin/stats",
  requireLogin,
  requireRole("admin"),
  (req, res) => {

    const restaurants =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM restaurants
      `).get().c;

    const customers =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM users
        WHERE role='customer'
      `).get().c;

    const riders =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM users
        WHERE role='rider'
      `).get().c;

    const orders =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM orders
      `).get().c;

    const revenue =
      db.prepare(`
        SELECT COALESCE(
          SUM(total),
          0
        ) AS total
        FROM orders
        WHERE status != 'Cancelled'
      `).get().total;

    res.json({
      restaurants,
      customers,
      riders,
      orders,
      revenue
    });
  }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "Haroa Eats",
      otp:
        Boolean(
          MSG91_AUTHKEY &&
          MSG91_TEMPLATE_ID
        )
    });
  }
);

/* =====================================================
   START
===================================================== */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Haroa Eats running on port ${PORT}`
    );

    console.log(
      "MSG91 OTP enabled:",
      Boolean(
        MSG91_AUTHKEY &&
        MSG91_TEMPLATE_ID
      )
    );
  }
);
