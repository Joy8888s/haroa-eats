const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const db = new Database(
  path.join(__dirname, "haroa_eats.db")
);


/* =========================
   MIDDLEWARE
========================= */

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-secret",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    }
  })
);


/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================
   DATABASE
========================= */

db.prepare(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT,
    role TEXT NOT NULL
  )
`).run();


db.prepare(`
  CREATE TABLE IF NOT EXISTS restaurants(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    phone TEXT,
    approved INTEGER DEFAULT 0
  )
`).run();


db.prepare(`
  CREATE TABLE IF NOT EXISTS menu(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    available INTEGER DEFAULT 1
  )
`).run();


db.prepare(`
  CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    restaurant_id INTEGER NOT NULL,
    total REAL NOT NULL,
    address TEXT NOT NULL,
    status TEXT DEFAULT 'Pending',
    delivery_id INTEGER
  )
`).run();


db.prepare(`
  CREATE TABLE IF NOT EXISTS order_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    price REAL NOT NULL
  )
`).run();


/* =========================
   HELPERS
========================= */

function normalizePhone(phone){

  let value =
    String(phone || "")
      .replace(/\D/g, "");

  if(
    value.length === 10
  ){

    return "91" + value;

  }

  if(
    value.length === 12 &&
    value.startsWith("91")
  ){

    return value;

  }

  return "";

}


function auth(
  req,
  res,
  next
){

  if(
    !req.session.user
  ){

    return res.status(401).json({
      error:
        "Login required"
    });

  }

  next();

}


function role(
  requiredRole
){

  return (
    req,
    res,
    next
  ) => {

    if(
      !req.session.user ||
      req.session.user.role !==
        requiredRole
    ){

      return res.status(403).json({
        error:
          "Access denied"
      });

    }

    next();

  };

}


/* =========================
   MSG91 CONFIG
========================= */

app.get(
  "/api/otp/config",
  (req, res) => {

    const widgetId =
      process.env.MSG91_WIDGET_ID ||
      "";

    const widgetToken =
      process.env.MSG91_WIDGET_TOKEN ||
      "";

    if(
      !widgetId ||
      !widgetToken
    ){

      return res.status(500).json({
        error:
          "MSG91 Widget configuration missing"
      });

    }

    res.json({

      widgetId,

      tokenAuth:
        widgetToken

    });

  }
);


/* =========================
   MSG91 VERIFY ACCESS TOKEN
========================= */

async function verifyMsg91AccessToken(
  accessToken
){

  const authKey =
    process.env.MSG91_AUTHKEY;

  if(
    !authKey
  ){

    throw new Error(
      "MSG91_AUTHKEY is not configured"
    );

  }

  if(
    !accessToken
  ){

    throw new Error(
      "MSG91 access token missing"
    );

  }


  const response =
    await fetch(
      "https://control.msg91.com/api/v5/widget/verifyAccessToken",
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "authkey":
            authKey

        },

        body:
          JSON.stringify({

            accessToken

          })

      }
    );


  const data =
    await response.json()
      .catch(
        () => ({})
      );


  if(
    !response.ok
  ){

    throw new Error(
      data.message ||
      data.error ||
      "MSG91 token verification failed"
    );

  }


  return data;

}


/* =========================
   MSG91 OTP LOGIN
========================= */

app.post(
  "/api/otp/login",
  async (
    req,
    res
  ) => {

    try{

      const phone =
        normalizePhone(
          req.body.phone
        );

      const accessToken =
        String(
          req.body.accessToken ||
          ""
        ).trim();


      if(
        !phone
      ){

        return res.status(400).json({
          error:
            "Valid mobile number required"
        });

      }


      if(
        !accessToken
      ){

        return res.status(400).json({
          error:
            "MSG91 access token missing"
        });

      }


      await verifyMsg91AccessToken(
        accessToken
      );


      const user =
        db.prepare(`
          SELECT
            id,
            name,
            phone,
            role
          FROM users
          WHERE phone=?
        `).get(
          phone
        );


      if(
        !user
      ){

        return res.status(404).json({
          error:
            "এই mobile number দিয়ে account পাওয়া যায়নি। OTP Signup করুন।"
        });

      }


      req.session.user =
        user;


      res.json({

        ok: true,

        user

      });

    }catch(error){

      console.error(
        "OTP LOGIN ERROR:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "OTP login failed"
      });

    }

  }
);


/* =========================
   MSG91 OTP SIGNUP
========================= */

app.post(
  "/api/otp/signup",
  async (
    req,
    res
  ) => {

    try{

      const name =
        String(
          req.body.name ||
          ""
        ).trim();

      const phone =
        normalizePhone(
          req.body.phone
        );

      const accessToken =
        String(
          req.body.accessToken ||
          ""
        ).trim();


      if(
        !name
      ){

        return res.status(400).json({
          error:
            "Name required"
        });

      }


      if(
        !phone
      ){

        return res.status(400).json({
          error:
            "Valid mobile number required"
        });

      }


      if(
        !accessToken
      ){

        return res.status(400).json({
          error:
            "MSG91 access token missing"
        });

      }


      await verifyMsg91AccessToken(
        accessToken
      );


      const existing =
        db.prepare(`
          SELECT *
          FROM users
          WHERE phone=?
        `).get(
          phone
        );


      if(
        existing
      ){

        req.session.user = {

          id:
            existing.id,

          name:
            existing.name,

          phone:
            existing.phone,

          role:
            existing.role

        };


        return res.json({

          ok: true,

          existing: true,

          user:
            req.session.user

        });

      }


      const result =
        db.prepare(`
          INSERT INTO users(
            name,
            phone,
            password,
            role
          )
          VALUES(
            ?,
            ?,
            ?,
            ?
          )
        `).run(

          name,

          phone,

          null,

          "customer"

        );


      const user = {

        id:
          result.lastInsertRowid,

        name,

        phone,

        role:
          "customer"

      };


      req.session.user =
        user;


      res.json({

        ok: true,

        existing: false,

        user

      });

    }catch(error){

      console.error(
        "OTP SIGNUP ERROR:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "OTP signup failed"
      });

    }

  }
);


/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  (
    req,
    res
  ) => {

    res.json({

      user:
        req.session.user ||
        null

    });

  }
);


/* =========================
   LOGOUT
========================= */

app.post(
  "/api/logout",
  (
    req,
    res
  ) => {

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
   RESTAURANTS
========================= */

app.get(
  "/api/restaurants",
  (
    req,
    res
  ) => {

    const restaurants =
      db.prepare(`
        SELECT *
        FROM restaurants
        WHERE approved=1
        ORDER BY id DESC
      `).all();


    const result =
      restaurants.map(
        restaurant => {

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
              ORDER BY id DESC
            `).all(
              restaurant.id
            );


          return {

            ...restaurant,

            menu

          };

        }
      );


    res.json(
      result
    );

  }
);


/* =========================
   ORDERS
========================= */

app.get(
  "/api/orders",
  auth,
  (
    req,
    res
  ) => {

    const user =
      req.session.user;


    let orders = [];


    if(
      user.role ===
      "customer"
    ){

      orders =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant
          FROM orders o
          LEFT JOIN restaurants r
            ON r.id=o.restaurant_id
          WHERE o.customer_id=?
          ORDER BY o.id DESC
        `).all(
          user.id
        );

    }else{

      orders =
        db.prepare(`
          SELECT
            o.*,
            r.name AS restaurant,
            u.name AS customer
          FROM orders o
          LEFT JOIN restaurants r
            ON r.id=o.restaurant_id
          LEFT JOIN users u
            ON u.id=o.customer_id
          ORDER BY o.id DESC
        `).all();

    }


    const result =
      orders.map(
        order => {

          const items =
            db.prepare(`
              SELECT
                oi.*,
                m.name
              FROM order_items oi
              LEFT JOIN menu m
                ON m.id=oi.menu_id
              WHERE oi.order_id=?
            `).all(
              order.id
            );


          return {

            ...order,

            items

          };

        }
      );


    res.json(
      result
    );

  }
);


/* =========================
   CREATE ORDER
========================= */

app.post(
  "/api/orders",
  auth,
  role("customer"),
  (
    req,
    res
  ) => {

    const restaurantId =
      Number(
        req.body.restaurantId
      );

    const address =
      String(
        req.body.address ||
        ""
      ).trim();

    const items =
      Array.isArray(
        req.body.items
      )
      ? req.body.items
      : [];


    if(
      !restaurantId ||
      !address ||
      !items.length
    ){

      return res.status(400).json({
        error:
          "Order information incomplete"
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


    if(
      !restaurant
    ){

      return res.status(404).json({
        error:
          "Restaurant not found"
      });

    }


    let total = 0;

    const finalItems = [];


    for(
      const item of items
    ){

      const menu =
        db.prepare(`
          SELECT *
          FROM menu
          WHERE id=?
          AND restaurant_id=?
          AND available=1
        `).get(
          Number(item.menuId),
          restaurantId
        );


      if(
        !menu
      ){

        return res.status(400).json({
          error:
            "Invalid menu item"
        });

      }


      const qty =
        Math.max(
          1,
          Number(item.qty) || 1
        );


      total +=
        menu.price * qty;


      finalItems.push({

        menuId:
          menu.id,

        qty,

        price:
          menu.price

      });

    }


    const transaction =
      db.transaction(
        () => {

          const orderResult =
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
            orderResult.lastInsertRowid;


          const insertItem =
            db.prepare(`
              INSERT INTO order_items(
                order_id,
                menu_id,
                qty,
                price
              )
              VALUES(
                ?,
                ?,
                ?,
                ?
              )
            `);


          for(
            const item of finalItems
          ){

            insertItem.run(

              orderId,

              item.menuId,

              item.qty,

              item.price

            );

          }


          return orderId;

        }
      );


    const orderId =
      transaction();


    res.json({

      ok: true,

      orderId

    });

  }
);


/* =========================
   ORDER STATUS
========================= */

app.patch(
  "/api/orders/:id/status",
  auth,
  (
    req,
    res
  ) => {

    const status =
      String(
        req.body.status ||
        ""
      );


    const allowed = [

      "Accepted",

      "Preparing",

      "Picked up",

      "Delivered",

      "Cancelled"

    ];


    if(
      !allowed.includes(
        status
      )
    ){

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
      `).get(
        req.params.id
      );


    if(
      !order
    ){

      return res.status(404).json({
        error:
          "Order not found"
      });

    }


    const user =
      req.session.user;


    if(
      user.role ===
      "admin"
    ){

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


    if(
      user.role ===
      "rider"
    ){

      if(
        Number(
          order.delivery_id
        ) !==
        Number(
          user.id
        )
      ){

        return res.status(403).json({
          error:
            "This order is not assigned to you"
        });

      }


      if(
        ![
          "Picked up",
          "Delivered"
        ].includes(
          status
        )
      ){

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


/* =========================
   RIDER CLAIM
========================= */

app.post(
  "/api/delivery/:id/claim",
  auth,
  role("rider"),
  (
    req,
    res
  ) => {

    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `).get(
        req.params.id
      );


    if(
      !order
    ){

      return res.status(404).json({
        error:
          "Order not found"
      });

    }


    if(
      order.delivery_id
    ){

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


    if(
      !result.changes
    ){

      return res.status(409).json({
        error:
          "Order আর available নেই"
      });

    }


    res.json({
      ok: true
    });

  }
);


/* =========================
   ADMIN STATS
========================= */

app.get(
  "/api/admin/stats",
  auth,
  role("admin"),
  (
    req,
    res
  ) => {

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


/* =========================
   ADMIN ADD RESTAURANT
========================= */

app.post(
  "/api/restaurants",
  auth,
  role("admin"),
  (
    req,
    res
  ) => {

    const name =
      String(
        req.body.name ||
        ""
      ).trim();


    const area =
      String(
        req.body.area ||
        ""
      ).trim();


    const phone =
      String(
        req.body.phone ||
        ""
      ).trim();


    if(
      !name ||
      !area
    ){

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
        VALUES(
          ?,
          ?,
          ?,
          1
        )
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


/* =========================
   DEFAULT ADMIN
========================= */

const adminPhone =
  normalizePhone(
    process.env.ADMIN_PHONE ||
    ""
  );


if(
  adminPhone
){

  const existing =
    db.prepare(`
      SELECT *
      FROM users
      WHERE phone=?
    `).get(
      adminPhone
    );


  if(
    !existing
  ){

    db.prepare(`
      INSERT INTO users(
        name,
        phone,
        password,
        role
      )
      VALUES(
        ?,
        ?,
        ?,
        'admin'
      )
    `).run(

      "Admin",

      adminPhone,

      null

    );

  }

}


/* =========================
   START SERVER
========================= */

app.get(
  "*",
  (
    req,
    res
  ) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);


app.listen(
  PORT,
  () => {

    console.log(
      `Haroa Eats server running on port ${PORT}`
    );

  }
);
