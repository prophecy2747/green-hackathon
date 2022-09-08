
const fs = require("fs");
const path = require("path");
const fastify = require("fastify")({logger: false,});

const utils = require("./utils");


fastify.register(require("@fastify/static"), {root: path.join(__dirname, "public"),prefix: "/",});
fastify.register(require("@fastify/formbody"));
fastify.register(require("@fastify/view"), {
  engine: {handlebars: require("handlebars"),},
  options: {
    partials:{
      head: "/src/partials/head.handlebars",
      navbar: "/src/partials/navbar.handlebars",
      sidebar: "/src/partials/sidebar.handlebars",
    }
  },
});

// Load and parse SEO data
const seo = require("./src/seo.json");
if (seo.url === "glitch-default") {seo.url = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;}
const data = require("./src/data.json");
const db = require("./src/" + data.database);



fastify.register(require('@fastify/cookie'), {
  secret: process.env.COOKIE_SECRET, // for cookies signature
  parseOptions: {}     // options for parsing cookies
})
fastify.register(require("@fastify/session"), {
  secret: process.env.SESSION_SECRET,
  saveUninitialized: true, 
  cookie: {
    secure:false, 
    httpOnly: true, 
    sameSite: false, 
    maxAge: 1000 * 60 * 60 * 24 * 30 * 12 // a year
  }
});
fastify.addHook('preHandler', (request, reply, next) => {
  console.log("preHandler:",request.session.sessionId);
  next()
})

fastify.addHook("onRequest", (request, reply, next) => {
  const protocol = request.raw.headers["x-forwarded-proto"].split(",")[0];
  if (protocol === "http") {reply.redirect("https://" + request.hostname + request.url);}

  console.log("onRequest:",request.url);
  const sid = request.session.sessionId;
  // console.log("sid:",sid);
  
  const valid_urls = ["/login","/signup","/leaderboards","/css/style.css","/manifest.json","/users"];
  const valid_prefix_urls = []
  if( request.session.isAuthenticated === undefined && valid_urls.indexOf(request.url) == -1 && !request.url.startsWith("/css/") ){
    reply.redirect("/login");
  }
  next();
});

fastify.get("/", async (request, reply) => {
  return reply.view("/src/pages/index.hbs", {});
});
fastify.get("/map", async (request, reply) => {
  const user = request.session.user;
  const data = await db.runQuery1(`SELECT * FROM Users WHERE uid=${user.uid}`)
  
  const User = {
    username:data[0].username,
    points:data[0].points
  }
return reply.view("/src/pages/map.hbs", { user: User });
});
fastify.get("/serviceworker.js", async (req,reply)=>{
  const buffer = fs.readFileSync('serviceworker.js');
  return reply.type('application/javascript').send(buffer);
})
fastify.get("/manifest.json", async (req,reply)=>{
  const buffer = fs.readFileSync(__dirname+'/public/manifest.json');
  return reply.type('json').send(buffer);
})

fastify.get("/login", async (request, reply) => {
  console.log("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  console.log("sid:",request.session.sessionId);
  const data = await db.runQuery1(`SELECT session_id FROM Users`);
  console.log(data);
  
  if( request.session.isAuthenticated ){
    return reply.redirect("/map");
  }else{
    return reply.view("/src/pages/login.hbs", {});
  }
});
fastify.post("/login", async (request, reply) => {
  console.log("==================================")
  const userdata = request.body.userdata;
  const password = request.body.password;
  // console.log(username,password);
  const user = await db.runQuery1(`SELECT * FROM Users WHERE username='${userdata}' AND password='${password}'`);
  // const user = await db.runQuery1(`SELECT * FROM Users WHERE email='${userdata}' AND password='${password}'`);
  if( user.length > 0 ){
    // user exists
    request.session.user = { uid: user[0].uid, username: user[0].username };
    request.session.isAuthenticated = true;
    const sid = request.session.sessionId;
    await db.runQuery2(`UPDATE Users SET session_id='${sid}' WHERE uid='${user[0].uid}'`);
    
  }else{
    // user does not exist
    return reply.view("/src/pages/login.hbs", {err:"User does not exist!"});
  }
  return reply.redirect("/map");
  // return reply.type("json").send(user);
});
fastify.get("/logout", async (request, reply) => {
  console.log(request.session.isAuthenticated);
  if(request.session.isAuthenticated){
    const uid = request.session.uid;
    request.session.destroy();
    await db.runQuery2(`UPDATE Users SET session_id=null WHERE uid='${uid}'`);
    return reply.redirect("/login");
  }else{
    return reply.type("json").send({error:"user not found to logout"});
  }
});

fastify.get("/signup", async (request, reply) => {
  return reply.view("/src/pages/signup.hbs", {err:""});
});
fastify.post("/signup", async (request, reply) => {
  let email = request.body.email;
  let username = request.body.username;
  const password = request.body.password;
  
  const findEmail = await db.runQuery1(`SELECT * FROM Users WHERE email='${email}'`);
  const findUsername = await db.runQuery1(`SELECT * FROM Users WHERE username='${username}'`);
  // console.log(email,username,password);
  
  let msg;
  if( findEmail.length > 0 ){
    msg = "Email already exists!";
    email = "";
  }else if( findUsername.length > 0 ){
    msg = "Username already exists";
    username = "";
  }else{
    // new user
    console.log("new user details");
    await db.runQuery2(`INSERT INTO Users (email,username,password,session_id,points,collected,lat,long) VALUES ('${email}','${username}','${password}',null,0, 0,null,null)`);
    return reply.view("/src/pages/login.hbs", {msg:""});
  }
  
  // return reply.send("post");
  return reply.view("/src/pages/signup.hbs", {err:msg, username: username, email:email});
});


fastify.get("/inventory", async (request, reply) => {
  const params = request.query.raw ? {}: {};
  console.log(params);
  
  const user = request.session.user;
  const data = await db.runQuery1(`SELECT username,points FROM Users WHERE uid=${user.uid}`);
  params.user = data[0];
  params.unlocked = await db.runQuery1(`SELECT Inventory.tree_name,Atreebutes.url FROM Inventory,Atreebutes WHERE Inventory.uid=${user.uid} AND Inventory.tree_name=Atreebutes.tree_name`)
  params.locked = await db.runQuery1(`SELECT tree_name,url FROM Atreebutes WHERE tree_name NOT IN (SELECT tree_name FROM Inventory WHERE uid=${user.uid})`);
  
  return request.query.raw
    ? reply.send(params)
    : reply.view("/src/pages/inventory.hbs", params );
});

fastify.get("/leaderboards", async (request, reply) => {
  const data1 = await db.runQuery1(`SELECT username,points FROM Users ORDER BY points DESC`);
  const data2 = await db.runQuery1(`SELECT username,collected FROM Users ORDER BY collected DESC`);
  return reply.view("/src/pages/leaderboards.hbs", { points: data1, collected: data2 } );
  // return reply.type("json").send({ points: data1, collected: data2 });
});


fastify.get("/repository", async (request, reply) => {
  const data = await db.runQuery1("");
  return reply.view("/src/pages/repository.hbs", { trees: data } );
});












fastify.get("/check", async (request, reply) => {
  return reply.send("check");
});



fastify.get("/users", async (request, reply) => {
  const users = await db.runQuery1("SELECT * FROM Users");
  return reply.type("json").send(users);
});












fastify.listen(
  { port: process.env.PORT, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
    fastify.log.info(`server listening on ${address}`);
  }
);
