const { app, validateEnvironment } = require("./server");
const { connectDatabase } = require("./src/database");

module.exports = async function handler(req, res) {
  validateEnvironment();
  await connectDatabase();
  return app(req, res);
};
