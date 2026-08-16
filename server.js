const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

/* =====================================================
   HAROA EATS SERVER
   ===================================================== */

const app = express();

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || "haroa_eats.db";

const db = new Database(DB_FILE);

/* SQLite performance / safety */
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* =====================================================
   EXPRESS MIDDLEWARE
   ===================================================== */

app.disable("x-powered-by");

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

      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

/* Serve frontend */
app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =====================================================
   DATABASE
   ===================================================== */

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

/* =====================================================
   DATABASE MIGRATION
   ===================================================== */

function getColumns(tableName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map(column => column.name);
}

function addColumnIfMissing(
  tableName,
  columnName,
  definition
) {
  const columns = getColumns(tableName);

  if (!columns.includes(columnName)) {
    db.exec(
      `ALTER TABLE ${tableName}
       ADD COLUMN ${columnName} ${definition}`
    );

    console.log(
      `Added missing column: ${tableName}.${columnName}`
    );
  }
}

/*
  Older Haroa Eats databases may not contain these columns.
*/
addColumnIfMissing(
  "users",
  "password",
  "TEXT"
);

addColumnIfMissing(
  "users",
  "role",
  "TEXT DEFAULT 'customer'"
);

addColumnIfMissing(
  "restaurants",
  "approved",
  "INTEGER DEFAULT 0"
);

addColumnIfMissing(
  "orders",
  "status",
  "TEXT DEFAULT 'Pending'"
);

addColumnIfMissing(
  "orders",
  "delivery_id",
  "INTEGER"
);

addColumnIfMissing(
  "orders",
  "created_at",
  "TEXT DEFAULT CURRENT_TIMESTAMP"
);

addColumnIfMissing(
  "menu",
  "available",
  "INTEGER DEFAULT 1"
);

/* =====================================================
   CONSTANTS
   ===================================================== */

const ORDER_STATUSES = [
  "Pending",
  "Accepted",
  "Preparing",
  "Picked up",
  "Delivered",
  "Cancelled"
];

const ROLES = [
  "customer",
  "rider",
  "admin"
];

/* =====================================================
   HELPERS
   ===================================================== */

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizePhone(value) {
  return cleanString(value).replace(/\s+/g, "");
}

function validPhone(phone) {
  return /^\d{10}$/.test(phone);
}

function validPassword(password) {
  return password.length >= 6;
}

function getUserById(id) {
  return db
    .prepare(`
      SELECT
        id,
        name,
        phone,
        role
      FROM users
      WHERE id=?
    `)
    .get(id);
}

function getOrderById(id) {
  return db
    .prepare(`
      SELECT *
      FROM orders
      WHERE id=?
    `)
    .get(id);
}

function getOrderItems(orderId) {
  return db
    .prepare(`
      SELECT
        id,
        menu_id AS menuId,
        name,
        price,
        qty
      FROM order_items
      WHERE order_id=?
      ORDER BY id
    `)
    .all(orderId);
}

function attachItems(orders) {
  return orders.map(order => {
    order.items = getOrderItems(order.id);
    return order;
  });
}

/* =====================================================
   SEED DEMO DATA
   ===================================================== */

function seed() {
  /* -------------------------
     ADMIN
  ------------------------- */

  const admin = db
    .prepare(`
      SELECT id
      FROM users
      WHERE phone=?
    `)
    .get("9999999999");

  if (!admin) {
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
      bcrypt.hashSync(
        "admin123",
        10
      )
    );

    console.log(
      "Demo admin created"
    );
  }

  /* -------------------------
     RIDER
  ------------------------- */

  const rider = db
    .prepare(`
      SELECT id
      FROM users
      WHERE phone=?
    `)
    .get("8888888888");

  if (!rider) {
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
      bcrypt.hashSync(
        "rider123",
        10
      )
    );

    console.log(
      "Demo rider created"
    );
  }

  /* -------------------------
     RESTAURANTS
  ------------------------- */

  const restaurantCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM restaurants
    `)
    .get().count;

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

    const haji =
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
      [
        swagatam,
        "Chicken Biryani",
        160
      ],
      [
        swagatam,
        "Egg Roll",
        70
      ],
      [
        swagatam,
        "Chicken Roll",
        100
      ],
      [
        swagatam,
        "Fried Rice",
        120
      ],

      [
        fryNation,
        "Chicken Fry",
        140
      ],
      [
        fryNation,
        "French Fries",
        80
      ],
      [
        fryNation,
        "Chicken Burger",
        130
      ],
      [
        fryNation,
        "Momo",
        100
      ],

      [
        haji,
        "Chicken Biryani",
        150
      ],
      [
        haji,
        "Mutton Biryani",
        220
      ],
      [
        haji,
        "Chicken Chaap",
        140
      ]
    ].forEach(item => {
      insertMenu.run(...item);
    });

    console.log(
      "Demo restaurants and menu created"
    );
  }
}

seed();

/* =====================================================
   AUTH MIDDLEWARE
   ===================================================== */

function auth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      ok: false,
      error: "Login required"
    });
  }

  next();
}

function role(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({
        ok: false,
        error: "Login required"
      });
    }

    if (
      !allowedRoles.includes(
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

/* =====================================================
   HEALTH CHECK
   ===================================================== */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Haroa Eats",
    status: "running",
    time: new Date().toISOString()
  });
});

/* =====================================================
   REGISTER
   ===================================================== */

app.post(
  "/api/register",
  async (req, res) => {
    const name =
      cleanString(req.body.name);

    const phone =
      normalizePhone(req.body.phone);

    const password =
      String(req.body.password || "");

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

    const existing =
      db.prepare(`
        SELECT id
        FROM users
        WHERE phone=?
      `).get(phone);

    if (existing) {
      return res.status(409).json({
        ok: false,
        error:
          "এই মোবাইল নম্বর আগে ব্যবহার হয়েছে"
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
        "Register error:",
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

/* =====================================================
   LOGIN
   ===================================================== */

app.post(
  "/api/login",
  async (req, res) => {
    const phone =
      normalizePhone(req.body.phone);

    const password =
      String(req.body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        ok: false,
        error:
          "Mobile এবং password দিন"
      });
    }

    const user =
      db.prepare(`
        SELECT
          id,
          name,
          phone,
          password,
          role
        FROM users
        WHERE phone=?
      `).get(phone);

    if (!user || !user.password) {
      return res.status(401).json({
        ok: false,
        error:
          "মোবাইল বা password ভুল"
      });
    }

    let passwordMatch = false;

    try {
      passwordMatch =
        await bcrypt.compare(
          password,
          user.password
        );
    } catch (error) {
      passwordMatch = false;
    }

    if (!passwordMatch) {
      return res.status(401).json({
        ok: false,
        error:
          "মোবাইল বা password ভুল"
      });
    }

    if (!ROLES.includes(user.role)) {
      return res.status(403).json({
        ok: false,
        error:
          "এই account-এর role সঠিক নয়"
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
  }
);

/* =====================================================
   LOGOUT
   ===================================================== */

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        console.error(
          "Logout error:",
          error
        );

        return res.status(500).json({
          ok: false,
          error:
            "Logout করা যায়নি"
        });
      }

      res.clearCookie("connect.sid");

      return res.json({
        ok: true
      });
    });
  }
);

/* =====================================================
   CURRENT USER
   ===================================================== */

app.get(
  "/api/me",
  (req, res) => {
    res.json({
      ok: true,
      user:
        req.session.user || null
    });
  }
);

/* =====================================================
   RESTAURANTS
   ===================================================== */

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
            price
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
        "Restaurants error:",
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

/* =====================================================
   SINGLE RESTAURANT
   ===================================================== */

app.get(
  "/api/restaurants/:id",
  (req, res) => {
    const id =
      Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid restaurant id"
      });
    }

    const restaurant =
      db.prepare(`
        SELECT
          id,
          name,
          area,
          phone,
          approved
        FROM restaurants
        WHERE id=?
      `).get(id);

    if (
      !restaurant ||
      !restaurant.approved
    ) {
      return res.status(404).json({
        ok: false,
        error:
          "Restaurant not found"
      });
    }

    restaurant.menu =
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
      `).all(id);

    res.json(restaurant);
  }
);

/* =====================================================
   CREATE ORDER
   ===================================================== */

app.post(
  "/api/orders",
  auth,
  (req, res) => {
    if (
      req.session.user.role !==
      "customer"
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Customer only"
      });
    }

    const restaurantId =
      Number(
        req.body.restaurantId
      );

    const address =
      cleanString(
        req.body.address
      );

    const items =
      req.body.items;

    if (
      !Number.isInteger(
        restaurantId
      ) ||
      restaurantId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid restaurant"
      });
    }

    if (!address) {
      return res.status(400).json({
        ok: false,
        error:
          "Delivery address দিন"
      });
    }

    if (address.length < 5) {
      return res.status(400).json({
        ok: false,
        error:
          "সঠিক delivery address দিন"
      });
    }

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Cart খালি"
      });
    }

    /* -------------------------
       RESTAURANT CHECK
    ------------------------- */

    const restaurant =
      db.prepare(`
        SELECT
          id,
          name
        FROM restaurants
        WHERE id=?
        AND approved=1
      `).get(restaurantId);

    if (!restaurant) {
      return res.status(400).json({
        ok: false,
        error:
          "Restaurant available নয়"
      });
    }

    /* -------------------------
       NORMALIZE CART
    ------------------------- */

    const quantityMap =
      new Map();

    for (const item of items) {
      const menuId =
        Number(item.menuId);

      const qty =
        Number(item.qty);

      if (
        !Number.isInteger(menuId) ||
        menuId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid menu item"
        });
      }

      const safeQty =
        Math.max(
          1,
          Math.min(
            20,
            Number.isFinite(qty)
              ? Math.floor(qty)
              : 1
          )
        );

      const previous =
        quantityMap.get(menuId) || 0;

      quantityMap.set(
        menuId,
        Math.min(
          20,
          previous + safeQty
        )
      );
    }

    const ids =
      Array.from(
        quantityMap.keys()
      );

    if (!ids.length) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid menu"
      });
    }

    /* -------------------------
       LOAD MENU
    ------------------------- */

    const placeholders =
      ids.map(
        () => "?"
      ).join(",");

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
        ...ids,
        restaurantId
      );

    if (
      menus.length !==
      ids.length
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Cart-এর কোনো menu আর available নেই"
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

        const price =
          Number(menu.price);

        total +=
          price * qty;

        return {
          id: menu.id,
          name: menu.name,
          price,
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
       CREATE ORDER TRANSACTION
    ------------------------- */

    try {
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
        "Create order error:",
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

/* =====================================================
   GET ORDERS
   ===================================================== */

app.get(
  "/api/orders",
  auth,
  (req, res) => {
    const user =
      req.session.user;

    try {
      let orders = [];

      /* -------------------------
         CUSTOMER
      ------------------------- */

      if (
        user.role ===
        "customer"
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
          `).all(user.id);
      }

      /* -------------------------
         ADMIN
      ------------------------- */

      else if (
        user.role ===
        "admin"
      ) {
        orders =
          db.prepare(`
            SELECT
              o.*,
              r.name AS restaurant,
              u.name AS customer,
              u.phone AS customer_phone,
              d.name AS rider,
              d.phone AS rider_phone
            FROM orders o

            JOIN restaurants r
              ON r.id=o.restaurant_id

            JOIN users u
              ON u.id=o.customer_id

            LEFT JOIN users d
              ON d.id=o.delivery_id

            ORDER BY o.id DESC
          `).all();
      }

      /* -------------------------
         RIDER
      ------------------------- */

      else if (
        user.role ===
        "rider"
      ) {
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

            WHERE
              (
                o.delivery_id=?
              )
              OR
              (
                o.delivery_id IS NULL
                AND o.status='Pending'
              )

            ORDER BY o.id DESC
          `).all(user.id);
      }

      orders =
        attachItems(orders);

      return res.json(orders);
    } catch (error) {
      console.error(
        "Get orders error:",
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

/* =====================================================
   GET SINGLE ORDER
   ===================================================== */

app.get(
  "/api/orders/:id",
  auth,
  (req, res) => {
    const orderId =
      Number(req.params.id);

    if (
      !Number.isInteger(
        orderId
      ) ||
      orderId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid order id"
      });
    }

    const order =
      db.prepare(`
        SELECT
          o.*,
          r.name AS restaurant,
          u.name AS customer,
          u.phone AS customer_phone,
          d.name AS rider,
          d.phone AS rider_phone
        FROM orders o

        JOIN restaurants r
          ON r.id=o.restaurant_id

        JOIN users u
          ON u.id=o.customer_id

        LEFT JOIN users d
          ON d.id=o.delivery_id

        WHERE o.id=?
      `).get(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error:
          "Order not found"
      });
    }

    const user =
      req.session.user;

    const allowed =
      user.role === "admin" ||
      (
        user.role ===
        "customer" &&
        Number(
          order.customer_id
        ) === Number(user.id)
      ) ||
      (
        user.role ===
        "rider" &&
        (
          !order.delivery_id ||
          Number(
            order.delivery_id
          ) === Number(user.id)
        )
      );

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error:
          "Not allowed"
      });
    }

    order.items =
      getOrderItems(
        order.id
      );

    res.json(order);
  }
);

/* =====================================================
   UPDATE ORDER STATUS
   ===================================================== */

app.patch(
  "/api/orders/:id/status",
  auth,
  (req, res) => {
    const orderId =
      Number(req.params.id);

    const status =
      cleanString(
        req.body.status
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
          "Invalid order id"
      });
    }

    if (
      !ORDER_STATUSES.includes(
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
      getOrderById(
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

    /* -------------------------
       ADMIN
    ------------------------- */

    if (
      user.role ===
      "admin"
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
        ok: true,
        status
      });
    }

    /* -------------------------
       RIDER
    ------------------------- */

    if (
      user.role ===
      "rider"
    ) {
      if (
        Number(
          order.delivery_id
        ) !==
        Number(user.id)
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
            "Rider can only set Picked up or Delivered"
        });
      }

      if (
        status ===
        "Picked up" &&
        ![
          "Accepted",
          "Preparing",
          "Picked up"
        ].includes(
          order.status
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Order is not ready for pickup"
        });
      }

      if (
        status ===
        "Delivered" &&
        order.status !==
        "Picked up"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Order must be picked up first"
        });
      }

      db.prepare(`
        UPDATE orders
        SET status=?
        WHERE id=?
        AND delivery_id=?
      `).run(
        status,
        orderId,
        user.id
      );

      return res.json({
        ok: true,
        status
      });
    }

    /* -------------------------
       CUSTOMER
    ------------------------- */

    return res.status(403).json({
      ok: false,
      error:
        "Customer cannot change order status"
    });
  }
);

/* =====================================================
   RIDER - CLAIM ORDER
   ===================================================== */

app.post(
  "/api/delivery/claim/:id",
  auth,
  role("rider"),
  (req, res) => {
    const orderId =
      Number(req.params.id);

    if (
      !Number.isInteger(
        orderId
      ) ||
      orderId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid order id"
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
      const order =
        getOrderById(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      return res.status(409).json({
        ok: false,
        error:
          "Order আর available নেই"
      });
    }

    return res.json({
      ok: true,
      orderId
    });
  }
);

/* =====================================================
   RIDER - MY ORDERS
   ===================================================== */

app.get(
  "/api/delivery/my-orders",
  auth,
  role("rider"),
  (req, res) => {
    try {
      const orders =
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

          WHERE o.delivery_id=?

          ORDER BY o.id DESC
        `).all(
          req.session.user.id
        );

      return res.json(
        attachItems(orders)
      );
    } catch (error) {
      console.error(
        "Rider orders error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Rider orders load করা যায়নি"
      });
    }
  }
);

/* =====================================================
   RIDER - AVAILABLE ORDERS
   ===================================================== */

app.get(
  "/api/delivery/available",
  auth,
  role("rider"),
  (req, res) => {
    try {
      const orders =
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

          WHERE
            o.delivery_id IS NULL
            AND o.status='Pending'

          ORDER BY o.id ASC
        `).all();

      return res.json(
        attachItems(orders)
      );
    } catch (error) {
      console.error(
        "Available orders error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Available orders load করা যায়নি"
      });
    }
  }
);

/* =====================================================
   RIDER STATS
   ===================================================== */

app.get(
  "/api/delivery/stats",
  auth,
  role("rider"),
  (req, res) => {
    const riderId =
      req.session.user.id;

    try {
      const available =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE
            delivery_id IS NULL
            AND status='Pending'
        `).get().c;

      const assigned =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE delivery_id=?
          AND status NOT IN(
            'Delivered',
            'Cancelled'
          )
        `).get(riderId).c;

      const completed =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE delivery_id=?
          AND status='Delivered'
        `).get(riderId).c;

      const earnings =
        db.prepare(`
          SELECT
            COALESCE(
              SUM(total),
              0
            ) AS total
          FROM orders
          WHERE delivery_id=?
          AND status='Delivered'
        `).get(riderId).total;

      return res.json({
        available,
        assigned,
        completed,
        earnings
      });
    } catch (error) {
      console.error(
        "Rider stats error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Rider stats load করা যায়নি"
      });
    }
  }
);

/* =====================================================
   ADMIN - RIDER LIST
   ===================================================== */

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

      return res.json(riders);
    } catch (error) {
      console.error(
        "Rider list error:",
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

/* =====================================================
   ADMIN - ASSIGN RIDER
   ===================================================== */

app.patch(
  "/api/orders/:id/assign",
  auth,
  role("admin"),
  (req, res) => {
    const orderId =
      Number(req.params.id);

    const riderId =
      Number(req.body.riderId);

    if (
      !Number.isInteger(
        orderId
      ) ||
      orderId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid order id"
      });
    }

    if (
      !Number.isInteger(
        riderId
      ) ||
      riderId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid rider id"
      });
    }

    const rider =
      db.prepare(`
        SELECT
          id,
          name,
          phone
        FROM users
        WHERE id=?
        AND role='rider'
      `).get(riderId);

    if (!rider) {
      return res.status(404).json({
        ok: false,
        error:
          "Rider not found"
      });
    }

    const order =
      getOrderById(
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
      order.status ===
      "Delivered"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Delivered order reassign করা যাবে না"
      });
    }

    db.prepare(`
      UPDATE orders
      SET
        delivery_id=?,
        status=
          CASE
            WHEN status='Pending'
            THEN 'Accepted'
            ELSE status
          END
      WHERE id=?
    `).run(
      riderId,
      orderId
    );

    return res.json({
      ok: true,
      orderId,
      rider
    });
  }
);

/* =====================================================
   ADMIN - UNASSIGN RIDER
   ===================================================== */

app.patch(
  "/api/orders/:id/unassign",
  auth,
  role("admin"),
  (req, res) => {
    const orderId =
      Number(req.params.id);

    const order =
      getOrderById(
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
      [
        "Picked up",
        "Delivered"
      ].includes(
        order.status
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Pickup-এর পরে rider unassign করা যাবে না"
      });
    }

    db.prepare(`
      UPDATE orders
      SET
        delivery_id=NULL,
        status='Pending'
      WHERE id=?
    `).run(orderId);

    return res.json({
      ok: true
    });
  }
);

/* =====================================================
   ADMIN - ADD RESTAURANT
   ===================================================== */

app.post(
  "/api/restaurants",
  auth,
  role("admin"),
  (req, res) => {
    const name =
      cleanString(
        req.body.name
      );

    const area =
      cleanString(
        req.body.area
      );

    const phone =
      normalizePhone(
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
          "Restaurant phone number সঠিক নয়"
      });
    }

    try {
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
        "Add restaurant error:",
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

/* =====================================================
   ADMIN - APPROVE RESTAURANT
   ===================================================== */

app.patch(
  "/api/restaurants/:id/approve",
  auth,
  role("admin"),
  (req, res) => {
    const id =
      Number(req.params.id);

    const approved =
      req.body.approved === false
        ? 0
        : 1;

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

    res.json({
      ok: true,
      approved: Boolean(
        approved
      )
    });
  }
);

/* =====================================================
   ADMIN - ADD MENU
   ===================================================== */

app.post(
  "/api/menu",
  auth,
  role("admin"),
  (req, res) => {
    const restaurantId =
      Number(
        req.body.restaurantId
      );

    const name =
      cleanString(
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
      restaurantId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Restaurant select করুন"
      });
    }

    if (!name) {
      return res.status(400).json({
        ok: false,
        error:
          "Menu name দিন"
      });
    }

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "সঠিক menu price দিন"
      });
    }

    const restaurant =
      db.prepare(`
        SELECT
          id
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

    try {
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
        "Add menu error:",
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

/* =====================================================
   ADMIN - UPDATE MENU
   ===================================================== */

app.patch(
  "/api/menu/:id",
  auth,
  role("admin"),
  (req, res) => {
    const menuId =
      Number(req.params.id);

    const name =
      cleanString(
        req.body.name
      );

    const price =
      Number(
        req.body.price
      );

    const available =
      req.body.available === false
        ? 0
        : 1;

    if (
      !Number.isInteger(
        menuId
      ) ||
      menuId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid menu id"
      });
    }

    const existing =
      db.prepare(`
        SELECT id
        FROM menu
        WHERE id=?
      `).get(menuId);

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error:
          "Menu not found"
      });
    }

    if (
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

    db.prepare(`
      UPDATE menu
      SET
        name=?,
        price=?,
        available=?
      WHERE id=?
    `).run(
      name,
      price,
      available,
      menuId
    );

    return res.json({
      ok: true
    });
  }
);

/* =====================================================
   ADMIN - DELETE / DISABLE MENU
   ===================================================== */

app.delete(
  "/api/menu/:id",
  auth,
  role("admin"),
  (req, res) => {
    const menuId =
      Number(req.params.id);

    if (
      !Number.isInteger(
        menuId
      ) ||
      menuId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid menu id"
      });
    }

    const result =
      db.prepare(`
        UPDATE menu
        SET available=0
        WHERE id=?
      `).run(menuId);

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
  }
);

/* =====================================================
   ADMIN STATS
   ===================================================== */

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

      const approvedRestaurants =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM restaurants
          WHERE approved=1
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

      const pendingOrders =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE status='Pending'
        `).get().c;

      const activeOrders =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE status IN(
            'Accepted',
            'Preparing',
            'Picked up'
          )
        `).get().c;

      const deliveredOrders =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE status='Delivered'
        `).get().c;

      const cancelledOrders =
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM orders
          WHERE status='Cancelled'
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
        approvedRestaurants,
        customers,
        riders,
        orders,
        pendingOrders,
        activeOrders,
        deliveredOrders,
        cancelledOrders,
        revenue
      });
    } catch (error) {
      console.error(
        "Admin stats error:",
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

/* =====================================================
   ADMIN - USERS
   ===================================================== */

app.get(
  "/api/admin/users",
  auth,
  role("admin"),
  (req, res) => {
    try {
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

      return res.json(users);
    } catch (error) {
      console.error(
        "Users error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Users load করা যায়নি"
      });
    }
  }
);

/* =====================================================
   API 404
   ===================================================== */

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "API endpoint not found"
    });
  }
);

/* =====================================================
   GLOBAL ERROR HANDLER
   ===================================================== */

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
      ok: false,
      error:
        "Internal server error"
    });
  }
);

/* =====================================================
   START SERVER
   ===================================================== */

const server =
  app.listen(
    PORT,
    () => {
      console.log(
        "================================="
      );

      console.log(
        "🍴 Haroa Eats"
      );

      console.log(
        "Server running on port " +
          PORT
      );

      console.log(
        "Database: " +
          DB_FILE
      );

      console.log(
        "================================="
      );
    }
  );

/* =====================================================
   GRACEFUL SHUTDOWN
   ===================================================== */

function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(() => {
    try {
      db.close();

      console.log(
        "Database closed."
      );

      process.exit(0);
    } catch (error) {
      console.error(
        "Shutdown error:",
        error
      );

      process.exit(1);
    }
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
