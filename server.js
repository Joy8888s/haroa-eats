const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("haroa_eats.db");

const PORT = process.env.PORT || 3000;

/* =========================
   BASIC MIDDLEWARE
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "haroa-eats-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

/*
  public folder-এর index.html, CSS, JS, image ইত্যাদি serve করবে।
*/
app.use(express.static(path.join(__dirname, "public")));


/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  otp_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
   SEED DATA
========================= */

function seed() {

  /* ADMIN */

  const admin = db
    .prepare("SELECT id FROM users WHERE phone = ?")
    .get("9999999999");

  if (!admin) {

    db.prepare(`
      INSERT INTO users
      (name, phone, password, role, otp_verified)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "Haroa Eats Admin",
      "9999999999",
      bcrypt.hashSync("admin123", 10),
      "admin",
      1
    );
  }


  /* RIDER */

  const rider = db
    .prepare("SELECT id FROM users WHERE phone = ?")
    .get("8888888888");

  if (!rider) {

    db.prepare(`
      INSERT INTO users
      (name, phone, password, role, otp_verified)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "Haroa Rider",
      "8888888888",
      bcrypt.hashSync("rider123", 10),
      "rider",
      1
    );
  }


  /* RESTAURANTS */

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM restaurants")
    .get().c;

  if (!count) {

    const restaurantStmt = db.prepare(`
      INSERT INTO restaurants
      (name, area, phone, approved)
      VALUES (?, ?, ?, 1)
    `);

    const a = restaurantStmt.run(
      "Swagatam Restaurant",
      "Haroa",
      ""
    ).lastInsertRowid;

    const b = restaurantStmt.run(
      "Fry Nation",
      "Haroa",
      ""
    ).lastInsertRowid;

    const c = restaurantStmt.run(
      "A1 Haji Biryani",
      "Haroa",
      ""
    ).lastInsertRowid;


    const menuStmt = db.prepare(`
      INSERT INTO menu
      (restaurant_id, name, price)
      VALUES (?, ?, ?)
    `);


    [
      ["Chicken Biryani", 160],
      ["Egg Roll", 70],
      ["Chicken Roll", 100],
      ["Fried Rice", 120]
    ].forEach(item => {
      menuStmt.run(a, item[0], item[1]);
    });


    [
      ["Chicken Fry", 140],
      ["French Fries", 80],
      ["Chicken Burger", 130],
      ["Momo", 100]
    ].forEach(item => {
      menuStmt.run(b, item[0], item[1]);
    });


    [
      ["Chicken Biryani", 150],
      ["Mutton Biryani", 220],
      ["Chicken Chaap", 140]
    ].forEach(item => {
      menuStmt.run(c, item[0], item[1]);
    });
  }
}

seed();


/* =========================
   AUTH MIDDLEWARE
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


/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {

  try {

    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").replace(/\D/g, "");
    const password = String(req.body.password || "");

    if (!name || !phone || !password) {

      return res.status(400).json({
        error: "সব তথ্য দিন"
      });
    }


    if (phone.length !== 10) {

      return res.status(400).json({
        error: "সঠিক 10 digit mobile number দিন"
      });
    }


    if (password.length < 6) {

      return res.status(400).json({
        error: "Password কমপক্ষে 6 characters হতে হবে"
      });
    }


    const existing = db
      .prepare("SELECT id FROM users WHERE phone = ?")
      .get(phone);


    if (existing) {

      return res.status(400).json({
        error: "এই মোবাইল নম্বর আগে ব্যবহার হয়েছে"
      });
    }


    const hash = await bcrypt.hash(password, 10);


    const info = db.prepare(`
      INSERT INTO users
      (name, phone, password, role, otp_verified)
      VALUES (?, ?, ?, 'customer', 0)
    `).run(
      name,
      phone,
      hash
    );


    /*
      OTP verification-এর পরে frontend থেকে
      /api/otp/verified call করা যাবে।
    */

    res.json({
      ok: true,
      message: "Account তৈরি হয়েছে। OTP দিয়ে verify করুন।",
      user: {
        id: info.lastInsertRowid,
        name,
        phone,
        role: "customer",
        otpVerified: false
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Registration failed"
    });
  }
});


/* =========================
   PASSWORD LOGIN
========================= */

app.post("/api/login", async (req, res) => {

  try {

    const phone = String(req.body.phone || "")
      .replace(/\D/g, "");

    const password = String(req.body.password || "");


    const user = db
      .prepare("SELECT * FROM users WHERE phone = ?")
      .get(phone);


    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(password, user.password))
    ) {

      return res.status(401).json({
        error: "মোবাইল বা password ভুল"
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

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Login failed"
    });
  }
});


/* =========================
   OTP VERIFIED SESSION
========================= */

/*
  MSG91 Widget OTP verification successful হওয়ার পরে
  frontend এই endpoint-এ verified phone পাঠাবে।

  IMPORTANT:
  Production-এ MSG91 access-token server-side verify করে
  তারপর এই session তৈরি করা উচিত।
*/

app.post("/api/otp/verified", async (req, res) => {

  try {

    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").replace(/\D/g, "");

    if (!phone || phone.length !== 10) {

      return res.status(400).json({
        error: "সঠিক mobile number দিন"
      });
    }


    let user = db
      .prepare("SELECT * FROM users WHERE phone = ?")
      .get(phone);


    /*
      User না থাকলে OTP signup-এর জন্য
      নতুন customer তৈরি হবে।
    */

    if (!user) {

      const info = db.prepare(`
        INSERT INTO users
        (name, phone, password, role, otp_verified)
        VALUES (?, ?, NULL, 'customer', 1)
      `).run(
        name || "Haroa Customer",
        phone
      );


      user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(info.lastInsertRowid);

    } else {

      db.prepare(`
        UPDATE users
        SET otp_verified = 1
        WHERE id = ?
      `).run(user.id);

      user = db
        .prepare("SELECT * FROM users WHERE id = ?")
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
      message: "OTP verified successfully",
      user: req.session.user
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "OTP verification failed"
    });
  }
});


/* =========================
   LOGOUT
========================= */

app.post("/api/logout", (req, res) => {

  req.session.destroy(() => {

    res.json({
      ok: true
    });
  });
});


/* =========================
   CURRENT USER
========================= */

app.get("/api/me", (req, res) => {

  res.json({
    user: req.session.user || null
  });
});


/* =========================
   RESTAURANTS
========================= */

app.get("/api/restaurants", (req, res) => {

  try {

    const restaurants = db.prepare(`
      SELECT id, name, area, phone
      FROM restaurants
      WHERE approved = 1
      ORDER BY name
    `).all();


    restaurants.forEach(restaurant => {

      restaurant.menu = db.prepare(`
        SELECT id, name, price
        FROM menu
        WHERE restaurant_id = ?
        AND available = 1
        ORDER BY id
      `).all(restaurant.id);

    });


    res.json(restaurants);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Restaurant loading failed"
    });
  }
});


/* =========================
   CREATE ORDER
========================= */

app.post("/api/orders", auth, (req, res) => {

  try {

    if (req.session.user.role !== "customer") {

      return res.status(403).json({
        error: "Customer only"
      });
    }


    const restaurantId = Number(req.body.restaurantId);
    const address = String(req.body.address || "").trim();
    const items = req.body.items;


    if (
      !restaurantId ||
      !address ||
      !Array.isArray(items) ||
      !items.length
    ) {

      return res.status(400).json({
        error: "Order তথ্য অসম্পূর্ণ"
      });
    }


    const ids = items
      .map(item => Number(item.menuId))
      .filter(Boolean);


    if (!ids.length) {

      return res.status(400).json({
        error: "No menu item selected"
      });
    }


    const placeholders = ids
      .map(() => "?")
      .join(",");


    const menus = db.prepare(`
      SELECT id, name, price, restaurant_id
      FROM menu
      WHERE id IN (${placeholders})
      AND available = 1
    `).all(...ids);


    if (
      menus.length !== ids.length ||
      menus.some(menu => Number(menu.restaurant_id) !== restaurantId)
    ) {

      return res.status(400).json({
        error: "Invalid menu"
      });
    }


    let total = 0;


    const normalized = items.map(item => {

      const menu = menus.find(
        m => Number(m.id) === Number(item.menuId)
      );


      const qty = Math.max(
        1,
        Math.min(
          20,
          Number(item.qty) || 1
        )
      );


      total += menu.price * qty;


      return {
        id: menu.id,
        name: menu.name,
        price: menu.price,
        qty
      };
    });


    const transaction = db.transaction(() => {

      const order = db.prepare(`
        INSERT INTO orders
        (customer_id, restaurant_id, total, address)
        VALUES (?, ?, ?, ?)
      `).run(
        req.session.user.id,
        restaurantId,
        total,
        address
      );


      const itemStmt = db.prepare(`
        INSERT INTO order_items
        (order_id, menu_id, name, price, qty)
        VALUES (?, ?, ?, ?, ?)
      `);


      normalized.forEach(item => {

        itemStmt.run(
          order.lastInsertRowid,
          item.id,
          item.name,
          item.price,
          item.qty
        );

      });


      return order.lastInsertRowid;
    });


    const orderId = transaction();


    res.json({
      ok: true,
      orderId,
      total
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Order create failed"
    });
  }
});


/* =========================
   ORDERS
========================= */

app.get("/api/orders", auth, (req, res) => {

  try {

    let rows;


    if (req.session.user.role === "customer") {

      rows = db.prepare(`
        SELECT
          o.*,
          r.name AS restaurant
        FROM orders o
        JOIN restaurants r
          ON r.id = o.restaurant_id
        WHERE o.customer_id = ?
        ORDER BY o.id DESC
      `).all(req.session.user.id);

    }

    else if (req.session.user.role === "admin") {

      rows = db.prepare(`
        SELECT
          o.*,
          r.name AS restaurant,
          u.name AS customer,
          u.phone
        FROM orders o
        JOIN restaurants r
          ON r.id = o.restaurant_id
        JOIN users u
          ON u.id = o.customer_id
        ORDER BY o.id DESC
      `).all();

    }

    else {

      rows = db.prepare(`
        SELECT
          o.*,
          r.name AS restaurant
        FROM orders o
        JOIN restaurants r
          ON r.id = o.restaurant_id
        WHERE o.delivery_id = ?
        OR (
          o.delivery_id IS NULL
          AND o.status = 'Pending'
        )
        ORDER BY o.id DESC
      `).all(req.session.user.id);

    }


    rows.forEach(order => {

      order.items = db.prepare(`
        SELECT
          name,
          price,
          qty
        FROM order_items
        WHERE order_id = ?
      `).all(order.id);

    });


    res.json(rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Orders loading failed"
    });
  }
});


/* =========================
   ORDER STATUS
========================= */

app.patch("/api/orders/:id/status", auth, (req, res) => {

  try {

    const allowed = [
      "Pending",
      "Accepted",
      "Preparing",
      "Picked up",
      "Delivered",
      "Cancelled"
    ];


    const status = String(req.body.status || "");


    if (!allowed.includes(status)) {

      return res.status(400).json({
        error: "Invalid status"
      });
    }


    const order = db
      .prepare("SELECT * FROM orders WHERE id = ?")
      .get(req.params.id);


    if (!order) {

      return res.status(404).json({
        error: "Order not found"
      });
    }


    const user = req.session.user;


    if (
      user.role === "admin" ||
      user.role === "rider" ||
      (
        user.role === "customer" &&
        Number(order.customer_id) === Number(user.id)
      )
    ) {

      db.prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `).run(
        status,
        order.id
      );


      return res.json({
        ok: true
      });
    }


    res.status(403).json({
      error: "Not allowed"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Status update failed"
    });
  }
});


/* =========================
   RIDER CLAIM ORDER
========================= */

app.post(
  "/api/delivery/claim/:id",
  auth,
  role("rider"),
  (req, res) => {

    try {

      const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(req.params.id);


      if (!order) {

        return res.status(404).json({
          error: "Order not found"
        });
      }


      const result = db.prepare(`
        UPDATE orders
        SET
          delivery_id = ?,
          status = 'Accepted'
        WHERE id = ?
        AND delivery_id IS NULL
        AND status = 'Pending'
      `).run(
        req.session.user.id,
        order.id
      );


      if (!result.changes) {

        return res.status(409).json({
          error: "Order already claimed"
        });
      }


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Unable to claim order"
      });
    }
  }
);


/* =========================
   ADMIN - ADD RESTAURANT
========================= */

app.post(
  "/api/restaurants",
  auth,
  role("admin"),
  (req, res) => {

    try {

      const name = String(req.body.name || "").trim();
      const area = String(req.body.area || "").trim();
      const phone = String(req.body.phone || "").trim();


      if (!name || !area) {

        return res.status(400).json({
          error: "Restaurant name and area required"
        });
      }


      const result = db.prepare(`
        INSERT INTO restaurants
        (name, area, phone, approved)
        VALUES (?, ?, ?, 1)
      `).run(
        name,
        area,
        phone
      );


      res.json({
        ok: true,
        id: result.lastInsertRowid
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Restaurant creation failed"
      });
    }
  }
);


/* =========================
   ADMIN - ADD MENU
========================= */

app.post(
  "/api/menu",
  auth,
  role("admin"),
  (req, res) => {

    try {

      const restaurantId = Number(req.body.restaurantId);
      const name = String(req.body.name || "").trim();
      const price = Number(req.body.price);


      if (
        !restaurantId ||
        !name ||
        !Number.isFinite(price) ||
        price <= 0
      ) {

        return res.status(400).json({
          error: "Invalid menu data"
        });
      }


      const restaurant = db
        .prepare("SELECT id FROM restaurants WHERE id = ?")
        .get(restaurantId);


      if (!restaurant) {

        return res.status(404).json({
          error: "Restaurant not found"
        });
      }


      const result = db.prepare(`
        INSERT INTO menu
        (restaurant_id, name, price, available)
        VALUES (?, ?, ?, 1)
      `).run(
        restaurantId,
        name,
        price
      );


      res.json({
        ok: true,
        id: result.lastInsertRowid
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Menu creation failed"
      });
    }
  }
);


/* =========================
   ADMIN STATS
========================= */

app.get(
  "/api/admin/stats",
  auth,
  role("admin"),
  (req, res) => {

    try {

      const restaurants = db
        .prepare("SELECT COUNT(*) AS c FROM restaurants")
        .get().c;


      const customers = db
        .prepare(`
          SELECT COUNT(*) AS c
          FROM users
          WHERE role = 'customer'
        `)
        .get().c;


      const riders = db
        .prepare(`
          SELECT COUNT(*) AS c
          FROM users
          WHERE role = 'rider'
        `)
        .get().c;


      const orders = db
        .prepare("SELECT COUNT(*) AS c FROM orders")
        .get().c;


      const revenue = db
        .prepare(`
          SELECT COALESCE(SUM(total), 0) AS s
          FROM orders
          WHERE status != 'Cancelled'
        `)
        .get().s;


      res.json({
        restaurants,
        customers,
        riders,
        orders,
        revenue
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Stats loading failed"
      });
    }
  }
);


/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    app: "Haroa Eats",
    status: "running"
  });
});


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {

  console.log(
    `Haroa Eats running on port ${PORT}`
  );

});
