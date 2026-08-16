```javascript
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

/* =========================================================
   DATABASE
========================================================= */

const db = new Database("haroa_eats.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* =========================================================
   APP CONFIG
========================================================= */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "haroa-eats-change-this-secret",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",

      secure:
        process.env.NODE_ENV === "production",

      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   DATABASE TABLES
========================================================= */

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

/* =========================================================
   INDEXES
========================================================= */

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users(phone);

  CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);

  CREATE INDEX IF NOT EXISTS idx_menu_restaurant
  ON menu(restaurant_id);

  CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON orders(customer_id);

  CREATE INDEX IF NOT EXISTS idx_orders_delivery
  ON orders(delivery_id);

  CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status);

  CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items(order_id);
`);

/* =========================================================
   DATABASE MIGRATION / SAFETY
========================================================= */

function ensureColumn(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  const exists = columns.some(
    c => c.name === column
  );

  if (!exists) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

/*
  Existing haroa_eats.db থাকলে নতুন column দরকার হলে
  automatically add হবে।
*/

ensureColumn(
  "users",
  "password",
  "TEXT"
);

ensureColumn(
  "users",
  "role",
  "TEXT NOT NULL DEFAULT 'customer'"
);

ensureColumn(
  "restaurants",
  "approved",
  "INTEGER DEFAULT 0"
);

ensureColumn(
  "orders",
  "delivery_id",
  "INTEGER"
);

ensureColumn(
  "orders",
  "created_at",
  "TEXT DEFAULT CURRENT_TIMESTAMP"
);

/* =========================================================
   DEMO / DEFAULT DATA
========================================================= */

function seed() {
  /* -------------------------
     ADMIN
  ------------------------- */

  const admin = db
    .prepare(
      "SELECT id FROM users WHERE phone=?"
    )
    .get("9999999999");

  if (!admin) {
    const adminPassword =
      bcrypt.hashSync("admin123", 10);

    db.prepare(`
      INSERT INTO users(
        name,
        phone,
        password,
        role
      )
      VALUES(?,?,?,'admin')
    `).run(
      "Haroa Eats Admin",
      "9999999999",
      adminPassword
    );
  }

  /* -------------------------
     RIDER
  ------------------------- */

  const rider = db
    .prepare(
      "SELECT id FROM users WHERE phone=?"
    )
    .get("8888888888");

  if (!rider) {
    const riderPassword =
      bcrypt.hashSync("rider123", 10);

    db.prepare(`
      INSERT INTO users(
        name,
        phone,
        password,
        role
      )
      VALUES(?,?,?,'rider')
    `).run(
      "Haroa Rider",
      "8888888888",
      riderPassword
    );
  }

  /* -------------------------
     RESTAURANTS
  ------------------------- */

  const restaurantCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM restaurants"
    )
    .get().c;

  if (restaurantCount === 0) {
    const insertRestaurant =
      db.prepare(`
        INSERT INTO restaurants(
          name,
          area,
          phone,
          approved
        )
        VALUES(?,?,?,1)
      `);

    const swagatam =
      insertRestaurant.run(
        "Swagatam Restaurant",
        "Haroa",
        ""
      ).lastInsertRowid;

    const fryNation =
      insertRestaurant.run(
        "Fry Nation",
        "Haroa",
        ""
      ).lastInsertRowid;

    const biryani =
      insertRestaurant.run(
        "A1 Haji Biryani",
        "Haroa",
        ""
      ).lastInsertRowid;

    const insertMenu =
      db.prepare(`
        INSERT INTO menu(
          restaurant_id,
          name,
          price,
          available
        )
        VALUES(?,?,?,1)
      `);

    [
      ["Chicken Biryani", 160],
      ["Egg Roll", 70],
      ["Chicken Roll", 100],
      ["Fried Rice", 120]
    ].forEach(item => {
      insertMenu.run(
        swagatam,
        item[0],
        item[1]
      );
    });

    [
      ["Chicken Fry", 140],
      ["French Fries", 80],
      ["Chicken Burger", 130],
      ["Momo", 100]
    ].forEach(item => {
      insertMenu.run(
        fryNation,
        item[0],
        item[1]
      );
    });

    [
      ["Chicken Biryani", 150],
      ["Mutton Biryani", 220],
      ["Chicken Chaap", 140]
    ].forEach(item => {
      insertMenu.run(
        biryani,
        item[0],
        item[1]
      );
    });
  }
}

seed();

/* =========================================================
   HELPERS
========================================================= */

function cleanPhone(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function cleanText(value) {
  return String(value || "").trim();
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role
  };
}

function validPhone(phone) {
  return /^\d{10}$/.test(phone);
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 6 &&
    password.length <= 100
  );
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function auth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      ok: false,
      error: "Login required"
    });
  }

  next();
}

function role(...roles) {
  return (req, res, next) => {
    if (
      !req.session.user ||
      !roles.includes(
        req.session.user.role
      )
    ) {
      return res.status(403).json({
        ok: false,
        error: "Not allowed"
      });
    }

    next();
  };
}

/* =========================================================
   REGISTER
========================================================= */

app.post(
  "/api/register",
  async (req, res) => {
    try {
      const name = cleanText(
        req.body.name
      );

      const phone = cleanPhone(
        req.body.phone
      );

      const password = String(
        req.body.password || ""
      );

      if (!name || !phone || !password) {
        return res.status(400).json({
          ok: false,
          error: "সব তথ্য দিন"
        });
      }

      if (name.length < 2) {
        return res.status(400).json({
          ok: false,
          error: "সঠিক নাম দিন"
        });
      }

      if (name.length > 100) {
        return res.status(400).json({
          ok: false,
          error: "নাম খুব বড়"
        });
      }

      if (!validPhone(phone)) {
        return res.status(400).json({
          ok: false,
          error:
            "সঠিক 10 digit mobile number দিন"
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          ok: false,
          error:
            "Password কমপক্ষে 6 character হতে হবে"
        });
      }

      const existing = db
        .prepare(
          "SELECT id FROM users WHERE phone=?"
        )
        .get(phone);

      if (existing) {
        return res.status(409).json({
          ok: false,
          error:
            "এই মোবাইল নম্বর আগে ব্যবহার হয়েছে"
        });
      }

      const hash =
        await bcrypt.hash(password, 10);

      const info = db
        .prepare(`
          INSERT INTO users(
            name,
            phone,
            password,
            role
          )
          VALUES(?,?,?,'customer')
        `)
        .run(
          name,
          phone,
          hash
        );

      req.session.user = {
        id: Number(
          info.lastInsertRowid
        ),
        name,
        phone,
        role: "customer"
      };

      return res.json({
        ok: true,
        user: req.session.user
      });

    } catch (error) {
      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Registration করা যায়নি"
      });
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const phone = cleanPhone(
        req.body.phone
      );

      const password = String(
        req.body.password || ""
      );

      if (!validPhone(phone)) {
        return res.status(400).json({
          ok: false,
          error:
            "সঠিক 10 digit mobile number দিন"
        });
      }

      if (!password) {
        return res.status(400).json({
          ok: false,
          error: "Password দিন"
        });
      }

      const user = db
        .prepare(
          "SELECT * FROM users WHERE phone=?"
        )
        .get(phone);

      if (
        !user ||
        !user.password
      ) {
        return res.status(401).json({
          ok: false,
          error:
            "মোবাইল বা password ভুল"
        });
      }

      const matched =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!matched) {
        return res.status(401).json({
          ok: false,
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

      return res.json({
        ok: true,
        user: req.session.user
      });

    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "Login করা যায়নি"
      });
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        return res.status(500).json({
          ok: false,
          error: "Logout failed"
        });
      }

      res.clearCookie("connect.sid");

      return res.json({
        ok: true
      });
    });
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  (req, res) => {
    return res.json({
      user:
        req.session.user || null
    });
  }
);

/* =========================================================
   RESTAURANTS
========================================================= */

app.get(
  "/api/restaurants",
  (req, res) => {
    try {
      const restaurants =
        db.prepare(`
          SELECT
            id,
            name,
            area,
            phone
          FROM restaurants
          WHERE approved=1
          ORDER BY name COLLATE NOCASE
        `).all();

      const getMenu =
        db.prepare(`
          SELECT
            id,
            name,
            price,
            available
          FROM menu
          WHERE restaurant_id=?
          AND available=1
          ORDER BY id
        `);

      restaurants.forEach(
        restaurant => {
          restaurant.menu =
            getMenu.all(
              restaurant.id
            );
        }
      );

      return res.json(
        restaurants
      );

    } catch (error) {
      console.error(
        "RESTAURANT ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Restaurant load করা যায়নি"
      });
    }
  }
);

/* =========================================================
   CREATE ORDER
========================================================= */

app.post(
  "/api/orders",
  auth,
  role("customer"),
  (req, res) => {
    try {
      const restaurantId =
        Number(
          req.body.restaurantId
        );

      const address =
        cleanText(
          req.body.address
        );

      const items =
        req.body.items;

      if (
        !restaurantId ||
        !address ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Order তথ্য অসম্পূর্ণ"
        });
      }

      if (address.length > 500) {
        return res.status(400).json({
          ok: false,
          error:
            "Address খুব বড়"
        });
      }

      /* -------------------------
         RESTAURANT CHECK
      ------------------------- */

      const restaurant =
        db.prepare(`
          SELECT id
          FROM restaurants
          WHERE id=?
          AND approved=1
        `).get(
          restaurantId
        );

      if (!restaurant) {
        return res.status(404).json({
          ok: false,
          error:
            "Restaurant পাওয়া যায়নি"
        });
      }

      /* -------------------------
         NORMALIZE ITEMS
      ------------------------- */

      const quantityMap =
        new Map();

      for (const item of items) {
        const menuId =
          Number(
            item.menuId
          );

        const qty =
          Math.max(
            1,
            Math.min(
              20,
              Number(item.qty) || 1
            )
          );

        if (!Number.isInteger(menuId)) {
          return res.status(400).json({
            ok: false,
            error:
              "Invalid menu"
          });
        }

        quantityMap.set(
          menuId,
          (quantityMap.get(
            menuId
          ) || 0) + qty
        );
      }

      const menuIds =
        Array.from(
          quantityMap.keys()
        );

      if (
        menuIds.length === 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Order item নেই"
        });
      }

      /* -------------------------
         MENU CHECK
      ------------------------- */

      const placeholders =
        menuIds
          .map(() => "?")
          .join(",");

      const menus =
        db.prepare(`
          SELECT
            id,
            name,
            price,
            restaurant_id
          FROM menu
          WHERE id IN (${placeholders})
          AND restaurant_id=?
          AND available=1
        `).all(
          ...menuIds,
          restaurantId
        );

      if (
        menus.length !==
        menuIds.length
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid menu বা restaurant"
        });
      }

      /* -------------------------
         CALCULATE TOTAL
      ------------------------- */

      let total = 0;

      const normalized =
        menus.map(menu => {
          const qty =
            quantityMap.get(
              Number(menu.id)
            ) || 1;

          total +=
            Number(menu.price) *
            qty;

          return {
            id: menu.id,
            name: menu.name,
            price: Number(
              menu.price
            ),
            qty
          };
        });

      total =
        Math.round(
          total * 100
        ) / 100;

      if (
        !Number.isFinite(total) ||
        total <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order total"
        });
      }

      /* -------------------------
         TRANSACTION
      ------------------------- */

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
              VALUES(
                ?,
                ?,
                ?,
                ?,
                'Pending'
              )
            `).run(
              req.session.user.id,
              restaurantId,
              total,
              address
            );

          const orderId =
            Number(
              order.lastInsertRowid
            );

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

          normalized.forEach(
            item => {
              insertItem.run(
                orderId,
                item.id,
                item.name,
                item.price,
                item.qty
              );
            }
          );

          return orderId;
        });

      const orderId =
        createOrder();

      return res.json({
        ok: true,
        orderId,
        total
      });

    } catch (error) {
      console.error(
        "CREATE ORDER ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Order create করা যায়নি"
      });
    }
  }
);

/* =========================================================
   GET ORDERS
========================================================= */

app.get(
  "/api/orders",
  auth,
  (req, res) => {
    try {
      const user =
        req.session.user;

      let orders = [];

      /* -------------------------
         CUSTOMER
      ------------------------- */

      if (
        user.role === "customer"
      ) {
        orders =
          db.prepare(`
            SELECT
              o.*,
              r.name AS restaurant
            FROM orders o
            JOIN restaurants r
              ON r.id=o.restaurant_id
            WHERE o.customer_id=?
            ORDER BY o.id DESC
          `).all(
            user.id
          );
      }

      /* -------------------------
         ADMIN
      ------------------------- */

      else if (
        user.role === "admin"
      ) {
        orders =
          db.prepare(`
            SELECT
              o.*,
              r.name AS restaurant,
              u.name AS customer,
              u.phone
            FROM orders o
            JOIN restaurants r
              ON r.id=o.restaurant_id
            JOIN users u
              ON u.id=o.customer_id
            ORDER BY o.id DESC
          `).all();
      }

      /* -------------------------
         RIDER
      ------------------------- */

      else if (
        user.role === "rider"
      ) {
        orders =
          db.prepare(`
            SELECT
              o.*,
              r.name AS restaurant
            FROM orders o
            JOIN restaurants r
              ON r.id=o.restaurant_id
            WHERE
              o.delivery_id=?
              OR (
                o.delivery_id IS NULL
                AND o.status='Pending'
              )
            ORDER BY o.id DESC
          `).all(
            user.id
          );
      }

      const getItems =
        db.prepare(`
          SELECT
            name,
            price,
            qty
          FROM order_items
          WHERE order_id=?
          ORDER BY id
        `);

      orders.forEach(
        order => {
          order.items =
            getItems.all(
              order.id
            );
        }
      );

      return res.json(
        orders
      );

    } catch (error) {
      console.error(
        "GET ORDERS ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Orders load করা যায়নি"
      });
    }
  }
);

/* =========================================================
   GET SINGLE ORDER
========================================================= */

app.get(
  "/api/orders/:id",
  auth,
  (req, res) => {
    try {
      const orderId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          orderId
        ) ||
        orderId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order ID"
        });
      }

      const order =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant,
            r.area AS restaurant_area,
            u.name AS customer,
            u.phone AS customer_phone
          FROM orders o
          JOIN restaurants r
            ON r.id=o.restaurant_id
          JOIN users u
            ON u.id=o.customer_id
          WHERE o.id=?
        `).get(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      const user =
        req.session.user;

      /* Customer নিজের order */
      if (
        user.role === "customer" &&
        Number(
          order.customer_id
        ) !== Number(user.id)
      ) {
        return res.status(403).json({
          ok: false,
          error:
            "Not allowed"
        });
      }

      /* Rider assigned order অথবা pending */
      if (
        user.role === "rider" &&
        order.delivery_id !== null &&
        Number(
          order.delivery_id
        ) !== Number(user.id)
      ) {
        return res.status(403).json({
          ok: false,
          error:
            "Not allowed"
        });
      }

      order.items =
        db.prepare(`
          SELECT
            name,
            price,
            qty
          FROM order_items
          WHERE order_id=?
          ORDER BY id
        `).all(
          orderId
        );

      return res.json(
        order
      );

    } catch (error) {
      console.error(
        "SINGLE ORDER ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Order load করা যায়নি"
      });
    }
  }
);

/* =========================================================
   UPDATE ORDER STATUS
========================================================= */

app.patch(
  "/api/orders/:id/status",
  auth,
  (req, res) => {
    try {
      const orderId =
        Number(
          req.params.id
        );

      const status =
        cleanText(
          req.body.status
        );

      const allowed = [
        "Accepted",
        "Preparing",
        "Picked up",
        "Delivered",
        "Cancelled"
      ];

      if (
        !allowed.includes(
          status
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid status"
        });
      }

      const order =
        db.prepare(
          "SELECT * FROM orders WHERE id=?"
        ).get(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      const user =
        req.session.user;

      /* =====================
         ADMIN
      ===================== */

      if (
        user.role === "admin"
      ) {
        db.prepare(`
          UPDATE orders
          SET status=?
          WHERE id=?
        `).run(
          status,
          orderId
        );

        return res.json({
          ok: true
        });
      }

      /* =====================
         RIDER
      ===================== */

      if (
        user.role === "rider"
      ) {
        if (
          Number(
            order.delivery_id
          ) !== Number(user.id)
        ) {
          return res.status(403).json({
            ok: false,
            error:
              "This order is not assigned to you"
          });
        }

        if (
          ![
            "Picked up",
            "Delivered"
          ].includes(status)
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Rider cannot set this status"
          });
        }

        if (
          status === "Delivered" &&
          order.status !== "Picked up"
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Order must be Picked up first"
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

        return res.json({
          ok: true
        });
      }

      /* =====================
         CUSTOMER
      ===================== */

      return res.status(403).json({
        ok: false,
        error:
          "Customer cannot change order status"
      });

    } catch (error) {
      console.error(
        "STATUS UPDATE ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Status update করা যায়নি"
      });
    }
  }
);

/* =========================================================
   RIDER CLAIM ORDER
========================================================= */

app.post(
  "/api/delivery/claim/:id",
  auth,
  role("rider"),
  (req, res) => {
    try {
      const orderId =
        Number(
          req.params.id
        );

      const order =
        db.prepare(`
          SELECT *
          FROM orders
          WHERE id=?
        `).get(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      if (
        order.status !== "Pending" ||
        order.delivery_id !== null
      ) {
        return res.status(409).json({
          ok: false,
          error:
            "Order আর available নেই"
        });
      }

      const result =
        db.prepare(`
          UPDATE orders
          SET
            delivery_id=?,
            status='Accepted'
          WHERE id=?
          AND delivery_id IS NULL
          AND status='Pending'
        `).run(
          req.session.user.id,
          orderId
        );

      if (!result.changes) {
        return res.status(409).json({
          ok: false,
          error:
            "Order অন্য rider already গ্রহণ করেছে"
        });
      }

      return res.json({
        ok: true,
        orderId
      });

    } catch (error) {
      console.error(
        "RIDER CLAIM ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Order claim করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN - ASSIGN RIDER
========================================================= */

app.post(
  "/api/admin/orders/:id/assign-rider",
  auth,
  role("admin"),
  (req, res) => {
    try {
      const orderId =
        Number(
          req.params.id
        );

      const riderId =
        Number(
          req.body.riderId
        );

      if (
        !Number.isInteger(
          orderId
        ) ||
        !Number.isInteger(
          riderId
        )
      ) {
        return res.status(400).json({
          ok: false,
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
        `).get(
          riderId
        );

      if (!rider) {
        return res.status(404).json({
          ok: false,
          error:
            "Rider not found"
        });
      }

      const order =
        db.prepare(`
          SELECT *
          FROM orders
          WHERE id=?
        `).get(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
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

      return res.json({
        ok: true,
        orderId,
        riderId
      });

    } catch (error) {
      console.error(
        "ASSIGN RIDER ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Rider assign করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN - RIDERS LIST
========================================================= */

app.get(
  "/api/admin/riders",
  auth,
  role("admin"),
  (req, res) => {
    try {
      const riders =
        db.prepare(`
          SELECT
            id,
            name,
            phone
          FROM users
          WHERE role='rider'
          ORDER BY name COLLATE NOCASE
        `).all();

      return res.json(
        riders
      );

    } catch (error) {
      console.error(
        "RIDERS ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Rider list load করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN - ADD RESTAURANT
========================================================= */

app.post(
  "/api/restaurants",
  auth,
  role("admin"),
  (req, res) => {
    try {
      const name =
        cleanText(
          req.body.name
        );

      const area =
        cleanText(
          req.body.area
        );

      const phone =
        cleanPhone(
          req.body.phone
        );

      if (!name || !area) {
        return res.status(400).json({
          ok: false,
          error:
            "Restaurant name এবং area দিন"
        });
      }

      if (
        phone &&
        !validPhone(phone)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "সঠিক restaurant phone দিন"
        });
      }

      const result =
        db.prepare(`
          INSERT INTO restaurants(
            name,
            area,
            phone,
            approved
          )
          VALUES(?,?,?,1)
        `).run(
          name,
          area,
          phone
        );

      return res.json({
        ok: true,
        id: Number(
          result.lastInsertRowid
        )
      });

    } catch (error) {
      console.error(
        "ADD RESTAURANT ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Restaurant add করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN - UPDATE RESTAURANT APPROVAL
========================================================= */

app.patch(
  "/api/restaurants/:id/approval",
  auth,
  role("admin"),
  (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const approved =
        Number(
          req.body.approved
        );

      if (
        !Number.isInteger(id) ||
        ![0, 1].includes(
          approved
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid data"
        });
      }

      const result =
        db.prepare(`
          UPDATE restaurants
          SET approved=?
          WHERE id=?
        `).run(
          approved,
          id
        );

      if (!result.changes) {
        return res.status(404).json({
          ok: false,
          error:
            "Restaurant not found"
        });
      }

      return res.json({
        ok: true
      });

    } catch (error) {
      console.error(
        "RESTAURANT APPROVAL ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Restaurant status update করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN - ADD MENU
========================================================= */

app.post(
  "/api/menu",
  auth,
  role("admin"),
  (req, res) => {
    try {
      const restaurantId =
        Number(
          req.body.restaurantId
        );

      const name =
        cleanText(
          req.body.name
        );

      const price =
        Number(
          req.body.price
        );

      if (
        !Number.isInteger(
          restaurantId
        ) ||
        restaurantId <= 0 ||
        !name ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Menu তথ্য সঠিক নয়"
        });
      }

      const restaurant =
        db.prepare(`
          SELECT id
          FROM restaurants
          WHERE id=?
        `).get(
          restaurantId
        );

      if (!restaurant) {
        return res.status(404).json({
          ok: false,
          error:
            "Restaurant not found"
        });
      }

      const result =
        db.prepare(`
          INSERT INTO menu(
            restaurant_id,
            name,
            price,
            available
          )
          VALUES(?,?,?,1)
        `).run(
          restaurantId,
          name,
          price
        );

      return res.json({
        ok: true,
        id: Number(
          result.lastInsertRowid
        )
      });

    } catch (error) {
      console.error(
        "ADD MENU ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Menu add করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN - UPDATE MENU AVAILABILITY
========================================================= */

app.patch(
  "/api/menu/:id/availability",
  auth,
  role("admin"),
  (req, res) => {
    try {
      const menuId =
        Number(
          req.params.id
        );

      const available =
        Number(
          req.body.available
        );

      if (
        !Number.isInteger(
          menuId
        ) ||
        ![0, 1].includes(
          available
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid data"
        });
      }

      const result =
        db.prepare(`
          UPDATE menu
          SET available=?
          WHERE id=?
        `).run(
          available,
          menuId
        );

      if (!result.changes) {
        return res.status(404).json({
          ok: false,
          error:
            "Menu not found"
        });
      }

      return res.json({
        ok: true
      });

    } catch (error) {
      console.error(
        "MENU AVAILABILITY ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Menu status update করা যায়নি"
      });
    }
  }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  "/api/admin/stats",
  auth,
  role("admin"),
  (req, res) => {
    try {
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
          SELECT
            COALESCE(
              SUM(total),
              0
            ) AS s
          FROM orders
          WHERE status!='Cancelled'
        `).get().s;

      return res.json({
        restaurants,
        customers,
        riders,
        orders,
        revenue
      });

    } catch (error) {
      console.error(
        "ADMIN STATS ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Admin stats load করা যায়নি"
      });
    }
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    return res.json({
      ok: true,
      app: "Haroa Eats",
      status: "running"
    });
  }
);

/* =========================================================
   API 404
========================================================= */

app.use(
  "/api",
  (req, res) => {
    return res.status(404).json({
      ok: false,
      error:
        "API endpoint not found"
    });
  }
);

/* =========================================================
   GENERAL ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      ok: false,
      error:
        "Server error হয়েছে"
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================="
    );

    console.log(
      "Haroa Eats server running"
    );

    console.log(
      "Port: " + PORT
    );

    console.log(
      "================================="
    );
  }
);
```
