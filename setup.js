const { execFileSync } = require("child_process");
const path = require("path");

try {
    console.log("\x1b[38;5;214mRunning npm install...");
    let args = ["install", "--prefix", path.resolve(__dirname)];
    execFileSync("npm", args);
    console.log("\x1b[38;5;214mDependencies installed successfully.");
} catch (error) {
    console.error("Error installing dependencies:", error);
    process.exit(1);
}