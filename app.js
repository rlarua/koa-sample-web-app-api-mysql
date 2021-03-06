/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */
/* Simple app to explore Node.js + Koa + MySQL basics for CRUD admin + API                        */
/*                                                                                                */
/* App comprises three (composed) sub-apps:                                                       */
/*  - www.   (public website pages)                                                               */
/*  - admin. (pages for interactively managing data)                                              */
/*  - api.   (RESTful CRUD API)                                                                   */
/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */

'use strict';
/* eslint no-shadow:off *//* app is already declared in the upper scope */

const Koa      = require('koa');            // Koa framework
const body     = require('koa-body');       // body parser
const compose  = require('koa-compose');    // middleware composer
const compress = require('koa-compress');   // HTTP compression
const session  = require('koa-session');    // session for flash messages
const mysql    = require('mysql2/promise'); // fast mysql driver
const MongoDB  = require('mongodb');        // MongoDB driver for Node.js
const debug    = require('debug')('app');   // small debugging utility

const MongoClient = MongoDB.MongoClient;

const app = new Koa();


/* set up middleware which will be applied to each request - - - - - - - - - - - - - - - - - - -  */


// return response time in X-Response-Time header
app.use(async function responseTime(ctx, next) {
    const t1 = Date.now();
    await next();
    const t2 = Date.now();
    ctx.set('X-Response-Time', Math.ceil(t2-t1)+'ms');
});


// HTTP compression
app.use(compress({}));


// only search-index www subdomain
app.use(async function robots(ctx, next) {
    await next();
    if (ctx.hostname.slice(0, 3) != 'www') ctx.response.set('X-Robots-Tag', 'noindex, nofollow');
});


// parse request body into ctx.request.body
// - multipart allows parsing of enctype=multipart/form-data
app.use(body({ multipart: true }));


// set signed cookie keys for JWT cookie & session cookie
app.keys = [ 'koa-sample-app' ];

// session for flash messages (uses signed session cookies, with no server storage)
app.use(session(app));


// sometimes useful to be able to track each request...
app.use(async function(ctx, next) {
    debug(ctx.method + ' ' + ctx.url);
    await next();
});


// select sub-app (admin/api) according to host subdomain (could also be by analysing request.url);
// separate sub-apps can be used for modularisation of a large system, for different login/access
// rights for public/protected elements, and also for different functionality between api & web
// pages (content negotiation, error handling, handlebars templating, etc).

app.use(async function subApp(ctx, next) {
    // use subdomain to determine which app to serve: www. as default, or admin. or api
    ctx.state.subapp = ctx.hostname.split('.')[0]; // subdomain = part before first '.' of hostname
    // note: could use root part of path instead of sub-domains e.g. ctx.request.url.split('/')[1]
    await next();
});

app.use(async function composeSubapp(ctx) { // note no 'next' after composed subapp
    switch (ctx.state.subapp) {
        case 'admin': await compose(require('./app-admin/app-admin.js').middleware)(ctx); break;
        case 'api':   await compose(require('./app-api/app-api.js').middleware)(ctx);     break;
        case 'www':   await compose(require('./app-www/app-www.js').middleware)(ctx);     break;
        default: // no (recognised) subdomain? canonicalise host to www.host
            // note switch must include all registered subdomains to avoid potential redirect loop
            ctx.redirect(ctx.protocol+'://'+'www.'+ctx.host+ctx.path+ctx.search);
            break;
    }
});


/* create server - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */


app.on('mongodbReady', function() {
    app.listen(process.env.PORT||3000);
    console.info(`${process.version} listening on port ${process.env.PORT||3000} (${app.env}/${dbConfig.database})`);
});


/* database connections - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - */


// MySQL connection pool (set up on app initialisation)
const dbConfigKeyVal = process.env.DB_CONNECTION.split(';').map(v => v.trim().split('='));
const dbConfig = dbConfigKeyVal.reduce((config, v) => { config[v[0].toLowerCase()] = v[1]; return config; }, {});
global.connectionPool = mysql.createPool(dbConfig); // put in global to pass to sub-apps


// MongoDB connection pool (set up on app initialisation) - mongo has no synchronous connect, so emit
// 'mongodbReady' when connected (note mongodbReady lister has to be set before event is emitted)
MongoClient.connect(process.env.DB_MONGO, { useNewUrlParser: true })
    .then(client => {
        global.mongoDb = client.db(client.s.options.dbName);
        // if empty db, create capped collections for logs (if not createCollection() calls do nothing)
        global.mongoDb.createCollection('log-access', { capped: true, size: 100*1e3, max: 100 });
        global.mongoDb.createCollection('log-error',  { capped: true, size: 100*4e3, max: 100 });
    })
    .then(() => {
        app.emit('mongodbReady');
    })
    .catch(err => {
        console.error(`Mongo connection error: ${err.message}`);
        process.exit(1);
    });


/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */

module.exports = app;
