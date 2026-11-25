require("dotenv").config();

const readline = require("node:readline");
const { StringDecoder } = require("node:string_decoder");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { z } = require("zod");
const { connectDatabase } = require("../src/database");
const { User } = require("../src/models");

function askLine(message) {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    prompt.question(message, (answer) => {
      prompt.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(message) {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal to enter the password securely.");
  }

  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let value = "";
    output.write(message);
    input.setRawMode(true);
    input.resume();

    const finish = (error) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Admin setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };

    input.on("data", onData);
  });
}

function validated(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label}: ${result.error.issues[0].message}`);
  }
  return result.data;
}

async function promptPassword() {
  const password = await askSecret("Admin password (10+ characters): ");
  if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password must be at least 10 characters and no more than 72 UTF-8 bytes.");
  }
  const confirmation = await askSecret("Confirm admin password: ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }
  return password;
}

async function main() {
  const email = validated(
    z.string().email().max(254),
    (await askLine("Admin email: ")).toLowerCase(),
    "Email",
  );

  await connectDatabase();

  const existingUser = await User.findOne({ email });
  let name;
  let username;
  if (existingUser) {
    const confirmation = await askLine(
      "An account with this email exists. Promote it and set a new password? (yes/no): ",
    );
    if (confirmation.toLowerCase() !== "yes") {
      throw new Error("Admin setup cancelled.");
    }
    name = existingUser.name;
    username = existingUser.username;
  } else {
    name = validated(
      z.string().trim().min(2).max(60),
      await askLine("Admin name: "),
      "Name",
    );
    username = validated(
      z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
      await askLine("Admin username: "),
      "Username",
    ).toLowerCase();
  }

  const password = await promptPassword();
  const passwordHash = await bcrypt.hash(password, 12);
  if (existingUser) {
    existingUser.isAdmin = true;
    existingUser.passwordHash = passwordHash;
    await existingUser.save();
  } else {
    await User.create({ name, username, email, passwordHash, isAdmin: true });
  }

  console.log(`Administrator account is ready for ${email}.`);
  console.log(`Sign in at http://localhost:${process.env.PORT || 3000}/admin/login`);
}

main()
  .catch((error) => {
    console.error("Admin setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  });
