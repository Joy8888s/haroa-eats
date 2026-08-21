```javascript
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const app = express();
const db = new Database("haroa_eats.db");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production"
    }
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =====================================================
   CONFIG
===================================================== */

const MSG91_WIDGET_ID =
  process.env.MSG91_WIDGET_ID ||
  "366870715254333435383332";

/*
  CLIENT TOKEN / tokenAuth
  এটি browser-এ পাঠানো যাবে।
*/
const MSG91_WIDGET_TOKEN =
  process.env.MSG91_WIDGET_TOKEN ||
  "";

/*
  SERVER AUTHKEY
  এটি কখনো index.html-এ বসাবে না।
*/
const MSG91_AUTHKEY =
  process.env.MSG91_AUTHKEY ||
  "";


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
   DEMO DATA
===================================================== */

function seed() {
  const admin = db
    .prepare(
      "SELECT id FROM users WHERE phone=?"
    )
    .get("9999999999");

  const rider = db
    .prepare(
      "SELECT id FROM users WHERE phone=?"
    )
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
  }

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
  }

  const count = db
    .prepare(
      "SELECT COUNT(*) AS c FROM restaurants"
    )
    .get().c;

  if (!count) {
    const restaurant =
      db.prepare(`
        INSERT INTO restaurants(
          name,
          area,
          phone,
          approved
        )
        VALUES(?,?,?,1)
      `);

    const a =
      restaurant.run(
        "Swagatam Restaurant",
        "Haroa",
        ""
      ).lastInsertRowid;

    const b =
      restaurant.run(
        "Fry Nation",
        "Haroa",
        ""
      ).lastInsertRowid;

    const c =
      restaurant.run(
        "A1 Haji Biryani",
        "Haroa",
        ""
      ).lastInsertRowid;

    const menu =
      db.prepare(`
        INSERT INTO menu(
          restaurant_id,
          name,
          price
        )
        VALUES(?,?,?)
      `);

    [
      ["Chicken Biryani", 160],
      ["Egg Roll", 70],
      ["Chicken Roll", 100],
      ["Fried Rice", 120]
    ].forEach(item =>
      menu.run(a, ...item)
    );

    [
      ["Chicken Fry", 140],
      ["French Fries", 80],
      ["Chicken Burger", 130],
      ["Momo", 100]
    ].forEach(item =>
      menu.run(b, ...item)
    );

    [
      ["Chicken Biryani", 150],
      ["Mutton Biryani", 220],
      ["Chicken Chaap", 140]
    ].forEach(item =>
      menu.run(c, ...item)
    );
  }
}

seed();


/* =====================================================
   HELPERS
===================================================== */

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
      !roles.includes(
        req.session.user.role
      )
    ) {
      return res.status(403).json({
        error: "Not allowed"
      });
    }

    next();
  };
}

function normalizeIndianPhone(value) {
  let phone =
    String(value || "")
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
  const value =
    findValueDeep(data, [
      "mobile",
      "mobile_number",
      "phone",
      "phone_number",
      "identifier",
      "number"
    ]);

  return normalizeIndianPhone(value);
}


/* =====================================================
   MSG91 ACCESS TOKEN VERIFICATION
===================================================== */

async function verifyMsg91AccessToken(
  accessToken
) {
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
        "Content-Type":
          "application/json",
        "Accept":
          "application/json"
      },

      body: JSON.stringify({
        authkey:
          MSG91_AUTHKEY,

        "access-token":
          accessToken
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


/* =====================================================
   OTP CONFIG
===================================================== */

app.get(
  "/api/otp/config",
  (req, res) => {
    res.json({
      enabled:
        Boolean(
          MSG91_WIDGET_ID &&
          MSG91_WIDGET_TOKEN
        ),

      widgetId:
        MSG91_WIDGET_ID,

      tokenAuth:
        MSG91_WIDGET_TOKEN || null
    });
  }
);


/* =====================================================
   OTP LOGIN / SIGNUP
===================================================== */

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
        error:
          "OTP access token missing"
      });
    }

    try {

      const verified =
        await verifyMsg91AccessToken(
          accessToken
        );

      const tokenPayload =
        decodeJwtPayload(
          accessToken
        );

      const verifiedPhone =
        extractMsg91Phone(
          verified
        ) ||
        extractMsg91Phone(
          tokenPayload
        );

      if (
        !/^\d{10}$/.test(
          verifiedPhone
        )
      ) {
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
          .get(
            verifiedPhone
          );

      /*
        OTP customer login/signup only.
        Admin এবং Rider password দিয়ে login করবে।
      */

      if (
        user &&
        user.role !== "customer"
      ) {
        return res.status(403).json({
          error:
            "Admin/Rider-এর জন্য password login ব্যবহার করুন"
        });
      }

      if (
        mode === "login" &&
        !user
      ) {
        return res.status(404).json({
          error:
            "এই মোবাইল নম্বরে account নেই। আগে OTP Signup করুন।"
        });
      }

      if (
        mode === "signup" &&
        user
      ) {
        return res.status(409).json({
          error:
            "এই মোবাইল নম্বর আগে থেকেই registered। OTP Login করুন।"
        });
      }

      /*
        CREATE CUSTOMER
      */

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
            .get(
              info.lastInsertRowid
            );

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
        id:
          user.id,

        name:
          user.name,

        phone:
          user.phone,

        role:
          user.role
      };

      res.json({
        ok: true,
        user:
          req.session.user
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


/* =====================================================
   PASSWORD LOGIN
   ONLY FOR ADMIN / RIDER
===================================================== */

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
      !(
        await bcrypt.compare(
          password,
          user.password
        )
      )
    ) {
      return res.status(401).json({
        error:
          "মোবাইল বা password ভুল"
      });
    }

    req.session.user = {
      id:
        user.id,

      name:
        user.name,

      phone:
        user.phone,

      role:
        user.role
    };

    res.json({
      ok: true,
      user:
        req.session.user
    });
  }
);


/* =====================================================
   REGISTER
===================================================== */

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
        error:
          "সব তথ্য দিন"
      });
    }

    if (
      !/^\d{10}$/.test(phone)
    ) {
      return res.status(400).json({
        error:
          "সঠিক 10 digit mobile number দিন"
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
   CURRENT USER
===================================================== */

app.get(
  "/api/me",
  (req, res) => {
    res.json({
      user:
        req.session.user ||
        null
    });
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
          area
        FROM restaurants
        WHERE approved=1
        ORDER BY name
      `).all();

    restaurants.forEach(
      restaurant => {

        restaurant.menu =
          db.prepare(`
            SELECT
              id,
              name,
              price
            FROM menu
            WHERE restaurant_id=?
            AND available=1
            ORDER BY id
          `).all(
            restaurant.id
          );
      }
    );

    res.json(
      restaurants
    );
  }
);


/* =====================================================
   CREATE ORDER
===================================================== */

app.post(
  "/api/orders",
  auth,
  role("customer"),
  (req, res) => {

    const restaurantId =
      Number(
        req.body.restaurantId
      );

    const address =
      String(
        req.body.address || ""
      ).trim();

    const items =
      req.body.items;

    if (
      !restaurantId ||
      !address ||
      !Array.isArray(items) ||
      !items.length
    ) {
      return res.status(400).json({
        error:
          "Order তথ্য অসম্পূর্ণ"
      });
    }

    const ids =
      items
        .map(
          item =>
            Number(
              item.menuId
            )
        )
        .filter(Boolean);

    if (!ids.length) {
      return res.status(400).json({
        error:
          "Invalid menu"
      });
    }

    const uniqueIds =
      [...new Set(ids)];

    const placeholders =
      uniqueIds
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
        AND available=1
      `).all(
        ...uniqueIds
      );

    if (
      menus.length !==
        uniqueIds.length ||
      menus.some(
        m =>
          Number(
            m.restaurant_id
          ) !==
          restaurantId
      )
    ) {
      return res.status(400).json({
        error:
          "Invalid menu"
      });
    }

    let total = 0;

    const normalized =
      items.map(item => {

        const menu =
          menus.find(
            m =>
              Number(m.id) ===
              Number(item.menuId)
          );

        if (!menu) {
          throw new Error(
            "Invalid menu"
          );
        }

        const qty =
          Math.max(
            1,
            Math.min(
              20,
              Number(item.qty) || 1
            )
          );

        total +=
          Number(menu.price) *
          qty;

        return {
          ...menu,
          qty
        };
      });

    try {

      const transaction =
        db.transaction(() => {

          const order =
            db.prepare(`
              INSERT INTO orders(
                customer_id,
                restaurant_id,
                total,
                address
              )
              VALUES(?,?,?,?)
            `).run(
              req.session.user.id,
              restaurantId,
              total,
              address
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
                order.lastInsertRowid,
                item.id,
                item.name,
                item.price,
                item.qty
              );
            }
          );

          return Number(
            order.lastInsertRowid
          );
        });

      const orderId =
        transaction();

      res.json({
        ok: true,
        orderId,
        total
      });

    } catch (error) {

      console.error(error);

      res.status(400).json({
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

    let orders;

    if (
      req.session.user.role ===
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
        `).all(
          req.session.user.id
        );

    } else if (
      req.session.user.role ===
      "admin"
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

    } else {

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
          req.session.user.id
        );
    }

    orders.forEach(order => {

      order.items =
        db.prepare(`
          SELECT
            name,
            price,
            qty
          FROM order_items
          WHERE order_id=?
        `).all(
          order.id
        );
    });

    res.json(orders);
  }
);


/* =====================================================
   UPDATE ORDER STATUS
===================================================== */

app.patch(
  "/api/orders/:id/status",
  auth,
  (req, res) => {

    const status =
      String(
        req.body.status || ""
      );

    const allowed = [
      "Accepted",
      "Preparing",
      "Picked up",
      "Delivered",
      "Cancelled"
    ];

    if (
      !allowed.includes(status)
    ) {
      return res.status(400).json({
        error:
          "Invalid status"
      });
    }

    const order =
      db
        .prepare(
          "SELECT * FROM orders WHERE id=?"
        )
        .get(
          req.params.id
        );

    if (!order) {
      return res.status(404).json({
        error:
          "Order not found"
      });
    }

    const user =
      req.session.user;

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
        order.id
      );

      return res.json({
        ok: true
      });
    }

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
          error:
            "Rider cannot set this status"
        });
      }

      db.prepare(`
        UPDATE orders
        SET status=?
        WHERE id=?
      `).run(
        status,
        order.id
      );

      return res.json({
        ok: true
      });
    }

    return res.status(403).json({
      error:
        "Customer cannot change order status"
    });
  }
);


/* =====================================================
   RIDER CLAIM ORDER
   দুই URL-ই support করবে
===================================================== */

function claimDelivery(
  req,
  res
) {

  const order =
    db
      .prepare(
        "SELECT * FROM orders WHERE id=?"
      )
      .get(
        req.params.id
      );

  if (!order) {
    return res.status(404).json({
      error:
        "Order not found"
    });
  }

  if (order.delivery_id) {
    return res.status(409).json({
      error:
        "এই order অন্য rider already গ্রহণ করেছে"
    });
  }

  const result =
    db.prepare(`
      UPDATE orders
      SET
        delivery_id=?,
        status='Accepted'
      WHERE
        id=?
        AND delivery_id IS NULL
        AND status='Pending'
    `).run(
      req.session.user.id,
      order.id
    );

  if (!result.changes) {
    return res.status(409).json({
      error:
        "Order আর available নেই"
    });
  }

  res.json({
    ok: true
  });
}

app.post(
  "/api/delivery/:id/claim",
  auth,
  role("rider"),
  claimDelivery
);

app.post(
  "/api/delivery/claim/:id",
  auth,
  role("rider"),
  claimDelivery
);


/* =====================================================
   ADMIN ADD RESTAURANT
===================================================== */

app.post(
  "/api/restaurants",
  auth,
  role("admin"),
  (req, res) => {

    const name =
      String(
        req.body.name || ""
      ).trim();

    const area =
      String(
        req.body.area || ""
      ).trim();

    const phone =
      String(
        req.body.phone || ""
      ).trim();

    if (!name || !area) {
      return res.status(400).json({
        error:
          "Restaurant name এবং area দিন"
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

    res.json({
      ok: true,
      id:
        result.lastInsertRowid
    });
  }
);


/* =====================================================
   ADMIN ADD MENU
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
      String(
        req.body.name || ""
      ).trim();

    const price =
      Number(
        req.body.price
      );

    if (
      !restaurantId ||
      !name ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return res.status(400).json({
        error:
          "Menu তথ্য সঠিক নয়"
      });
    }

    const restaurant =
      db
        .prepare(
          "SELECT id FROM restaurants WHERE id=?"
        )
        .get(
          restaurantId
        );

    if (!restaurant) {
      return res.status(404).json({
        error:
          "Restaurant not found"
      });
    }

    const result =
      db.prepare(`
        INSERT INTO menu(
          restaurant_id,
          name,
          price
        )
        VALUES(?,?,?)
      `).run(
        restaurantId,
        name,
        price
      );

    res.json({
      ok: true,
      id:
        result.lastInsertRowid
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

    res.json({

      restaurants:
        db
          .prepare(
            "SELECT COUNT(*) c FROM restaurants"
          )
          .get().c,

      customers:
        db
          .prepare(`
            SELECT COUNT(*) c
            FROM users
            WHERE role='customer'
          `)
          .get().c,

      riders:
        db
          .prepare(`
            SELECT COUNT(*) c
            FROM users
            WHERE role='rider'
          `)
          .get().c,

      orders:
        db
          .prepare(
            "SELECT COUNT(*) c FROM orders"
          )
          .get().c,

      revenue:
        db
          .prepare(`
            SELECT
              COALESCE(
                SUM(total),
                0
              ) s
            FROM orders
            WHERE status!='Cancelled'
          `)
          .get().s
    });
  }
);


/* =====================================================
   START SERVER
===================================================== */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {

    console.log(
      "Haroa Eats running on port " +
      PORT
    );

    console.log(
      "MSG91 Widget ID:",
      MSG91_WIDGET_ID
        ? "configured"
        : "MISSING"
    );

    console.log(
      "MSG91 Client Token:",
      MSG91_WIDGET_TOKEN
        ? "configured"
        : "MISSING"
    );

    console.log(
      "MSG91 Authkey:",
      MSG91_AUTHKEY
        ? "configured"
        : "MISSING"
    );
  }
);
```
