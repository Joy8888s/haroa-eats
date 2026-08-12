const express=require("express"), session=require("express-session"), bcrypt=require("bcryptjs"), Database=require("better-sqlite3"), path=require("path");
const app=express(), db=new Database("haroa_eats.db");
app.use(express.json()); app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"change-this-secret",resave:false,saveUninitialized:false,cookie:{httpOnly:true}}));
app.use(express.static(path.join(__dirname,"public")));

db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS restaurants(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,area TEXT NOT NULL,phone TEXT,approved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS menu(id INTEGER PRIMARY KEY AUTOINCREMENT,restaurant_id INTEGER NOT NULL,name TEXT NOT NULL,price REAL NOT NULL,available INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL,restaurant_id INTEGER NOT NULL,total REAL NOT NULL,address TEXT NOT NULL,status TEXT DEFAULT 'Pending',delivery_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,menu_id INTEGER NOT NULL,name TEXT NOT NULL,price REAL NOT NULL,qty INTEGER NOT NULL);`);

function seed(){
 const admin=db.prepare("SELECT id FROM users WHERE phone=?").get("9999999999");
 if(!admin) db.prepare("INSERT INTO users(name,phone,password,role) VALUES(?,?,?,?)").run("Haroa Eats Admin","9999999999",bcrypt.hashSync("admin123",10),"admin");
 const count=db.prepare("SELECT COUNT(*) c FROM restaurants").get().c;
 if(!count){
   const rs=db.prepare("INSERT INTO restaurants(name,area,phone,approved) VALUES(?,?,?,1)");
   const a=rs.run("Swagatam Restaurant","Haroa","").lastInsertRowid;
   const b=rs.run("Fry Nation","Haroa","").lastInsertRowid;
   const c=rs.run("A1 Haji Biryani","Haroa","").lastInsertRowid;
   const m=db.prepare("INSERT INTO menu(restaurant_id,name,price) VALUES(?,?,?)");
   [["Chicken Biryani",160],["Egg Roll",70],["Chicken Roll",100],["Fried Rice",120]].forEach(x=>m.run(a,...x));
   [["Chicken Fry",140],["French Fries",80],["Chicken Burger",130],["Momo",100]].forEach(x=>m.run(b,...x));
   [["Chicken Biryani",150],["Mutton Biryani",220],["Chicken Chaap",140]].forEach(x=>m.run(c,...x));
 }
} seed();

function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:"Login required"});next()}
function role(...roles){return (req,res,next)=>{if(!req.session.user||!roles.includes(req.session.user.role))return res.status(403).json({error:"Not allowed"});next()}}

app.post("/api/register",async(req,res)=>{
 const {name,phone,password}=req.body;if(!name||!phone||!password)return res.status(400).json({error:"সব তথ্য দিন"});
 try{const hash=await bcrypt.hash(password,10);const info=db.prepare("INSERT INTO users(name,phone,password,role) VALUES(?,?,?,'customer')").run(name,phone,hash);req.session.user={id:info.lastInsertRowid,name,phone,role:"customer"};res.json({ok:true,user:req.session.user})}
 catch(e){res.status(400).json({error:"এই মোবাইল নম্বর আগে ব্যবহার হয়েছে"})}
});
app.post("/api/login",async(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE phone=?").get(req.body.phone);if(!u||!await bcrypt.compare(req.body.password||"",u.password))return res.status(401).json({error:"মোবাইল বা password ভুল"});
 req.session.user={id:u.id,name:u.name,phone:u.phone,role:u.role};res.json({ok:true,user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));

app.get("/api/restaurants",(req,res)=>{
 const rows=db.prepare("SELECT id,name,area FROM restaurants WHERE approved=1 ORDER BY name").all();
 rows.forEach(r=>r.menu=db.prepare("SELECT id,name,price FROM menu WHERE restaurant_id=? AND available=1").all(r.id));
 res.json(rows);
});
app.post("/api/orders",auth,(req,res)=>{
 if(req.session.user.role!=="customer")return res.status(403).json({error:"Customer only"});
 const {restaurantId,address,items}=req.body;if(!restaurantId||!address||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Order তথ্য অসম্পূর্ণ"});
 const ids=items.map(x=>Number(x.menuId));const qs=ids.map(()=>"?").join(",");
 const menus=db.prepare(`SELECT id,name,price,restaurant_id FROM menu WHERE id IN (${qs}) AND available=1`).all(...ids);
 if(menus.length!==ids.length||menus.some(m=>m.restaurant_id!=restaurantId))return res.status(400).json({error:"Invalid menu"});
 let total=0; const normalized=items.map(x=>{const m=menus.find(z=>z.id==x.menuId);const qty=Math.max(1,Math.min(20,Number(x.qty)||1));total+=m.price*qty;return {...m,qty}});
 const tx=db.transaction(()=>{const o=db.prepare("INSERT INTO orders(customer_id,restaurant_id,total,address) VALUES(?,?,?,?)").run(req.session.user.id,restaurantId,total,address);const im=db.prepare("INSERT INTO order_items(order_id,menu_id,name,price,qty) VALUES(?,?,?,?,?)");normalized.forEach(x=>im.run(o.lastInsertRowid,x.id,x.name,x.price,x.qty));return o.lastInsertRowid});res.json({ok:true,orderId:tx(),total});
});
app.get("/api/orders",auth,(req,res)=>{
 let rows;if(req.session.user.role==="customer")rows=db.prepare(`SELECT o.*,r.name restaurant FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE customer_id=? ORDER BY o.id DESC`).all(req.session.user.id);
 else if(req.session.user.role==="admin")rows=db.prepare(`SELECT o.*,r.name restaurant,u.name customer,u.phone FROM orders o JOIN restaurants r ON r.id=o.restaurant_id JOIN users u ON u.id=o.customer_id ORDER BY o.id DESC`).all();
 else rows=db.prepare(`SELECT o.*,r.name restaurant FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE delivery_id=? OR (delivery_id IS NULL AND status='Pending') ORDER BY o.id DESC`).all(req.session.user.id);
 rows.forEach(o=>o.items=db.prepare("SELECT name,price,qty FROM order_items WHERE order_id=?").all(o.id));res.json(rows);
});
app.patch("/api/orders/:id/status",auth,(req,res)=>{
 const allowed=["Accepted","Preparing","Picked up","Delivered","Cancelled"];if(!allowed.includes(req.body.status))return res.status(400).json({error:"Invalid status"});
 const o=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);if(!o)return res.status(404).json({error:"Order not found"});
 if(req.session.user.role==="admin"||req.session.user.role==="delivery"||(req.session.user.role==="customer"&&o.customer_id===req.session.user.id)){
   db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,o.id);return res.json({ok:true});
 }res.status(403).json({error:"Not allowed"});
});
app.post("/api/delivery/claim/:id",auth,role("delivery"),(req,res)=>{const o=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);if(!o)return res.status(404).json({error:"Not found"});db.prepare("UPDATE orders SET delivery_id=?,status='Accepted' WHERE id=? AND delivery_id IS NULL").run(req.session.user.id,o.id);res.json({ok:true})});

app.post("/api/restaurants",auth,role("admin"),(req,res)=>{const x=req.body;const id=db.prepare("INSERT INTO restaurants(name,area,phone,approved) VALUES(?,?,?,1)").run(x.name,x.area,x.phone||"").lastInsertRowid;res.json({id})});
app.post("/api/menu",auth,role("admin"),(req,res)=>{const x=req.body;const id=db.prepare("INSERT INTO menu(restaurant_id,name,price) VALUES(?,?,?)").run(x.restaurantId,x.name,x.price).lastInsertRowid;res.json({id})});
app.get("/api/admin/stats",auth,role("admin"),(req,res)=>res.json({restaurants:db.prepare("SELECT COUNT(*) c FROM restaurants").get().c,customers:db.prepare("SELECT COUNT(*) c FROM users WHERE role='customer'").get().c,delivery:db.prepare("SELECT COUNT(*) c FROM users WHERE role='delivery'").get().c,orders:db.prepare("SELECT COUNT(*) c FROM orders").get().c,revenue:db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status!='Cancelled'").get().s}));
app.listen(process.env.PORT||3000,()=>console.log("Haroa Eats running on http://localhost:"+(process.env.PORT||3000)));
