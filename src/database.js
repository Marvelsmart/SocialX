const mongoose = require("mongoose");
const dns = require("node:dns");

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required.");
  }
  if (process.env.MONGODB_DNS_SERVERS) {
    const servers = process.env.MONGODB_DNS_SERVERS
      .split(",")
      .map((server) => server.trim());
    if (!servers.length || servers.some((server) => !server)) {
      throw new Error("MONGODB_DNS_SERVERS must be a comma-separated list of DNS servers.");
    }
    dns.setServers(servers);
  }
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME || "socialx",
  });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  console.log("Connected to MongoDB.");
}

module.exports = { connectDatabase };
