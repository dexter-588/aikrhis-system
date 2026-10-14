'use strict';

// Vercel invokes this function for every route. Keeping one server per warm
// function instance lets the PostgreSQL pool be reused safely.
const { createServer } = require('../app');

let server;

module.exports = (req, res) => {
  server ||= createServer();
  server.emit('request', req, res);
};
