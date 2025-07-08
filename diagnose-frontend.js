#!/usr/bin/env node

// Frontend Socket Connection Diagnostic Tool
// This script helps identify what's causing the socket connection storm

const fs = require("fs");
const path = require("path");

console.log("🔍 Frontend Socket Connection Diagnostic");
console.log("=======================================");

// Common patterns that cause socket storms
const problematicPatterns = [
  {
    name: "Multiple socket connections in useEffect",
    pattern: /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?io\s*\([\s\S]*?\}/g,
    description: "Creating new socket connections in useEffect without cleanup",
  },
  {
    name: "Socket connection in render/component body",
    pattern: /const\s+socket\s*=\s*io\s*\(/g,
    description:
      "Creating socket connections in component body (runs on every render)",
  },
  {
    name: "Missing socket cleanup",
    pattern:
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?io\s*\([^}]*\}\s*\)\s*$/gm,
    description: "useEffect without cleanup function",
  },
  {
    name: "Socket connection in event handlers",
    pattern: /onClick.*io\s*\(|onSubmit.*io\s*\(|onChange.*io\s*\(/g,
    description: "Creating socket connections in event handlers",
  },
  {
    name: "Multiple socket instances",
    pattern: /const\s+.*socket.*=\s*io\s*\(/g,
    description: "Multiple socket variable declarations",
  },
];

// Check if frontend directory exists
const frontendPath = path.join(__dirname, "..", "habibi-frontend");
if (!fs.existsSync(frontendPath)) {
  console.log("❌ Frontend directory not found at:", frontendPath);
  console.log("   Please run this script from the backend directory");
  process.exit(1);
}

console.log("✅ Frontend directory found:", frontendPath);

// Search for socket.io usage in frontend
function searchForSocketUsage(
  dir,
  fileExtensions = [".js", ".jsx", ".ts", ".tsx"]
) {
  const results = [];

  function walkDir(currentPath) {
    const files = fs.readdirSync(currentPath);

    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stat = fs.statSync(filePath);

      if (
        stat.isDirectory() &&
        !file.startsWith(".") &&
        file !== "node_modules"
      ) {
        walkDir(filePath);
      } else if (fileExtensions.some((ext) => file.endsWith(ext))) {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const relativePath = path.relative(frontendPath, filePath);

          // Check for socket.io imports
          if (content.includes("socket.io") || content.includes("io(")) {
            results.push({
              file: relativePath,
              content: content,
              lines: content.split("\n"),
            });
          }
        } catch (error) {
          console.log(`⚠️ Could not read file: ${filePath}`);
        }
      }
    }
  }

  walkDir(dir);
  return results;
}

console.log("\n🔍 Scanning frontend for socket.io usage...");
const socketFiles = searchForSocketUsage(frontendPath);

if (socketFiles.length === 0) {
  console.log("✅ No socket.io usage found in frontend");
  console.log("   The connection storm might be coming from:");
  console.log("   - A browser extension");
  console.log("   - A development tool");
  console.log("   - An external script");
} else {
  console.log(`📁 Found ${socketFiles.length} files with socket.io usage:`);

  socketFiles.forEach((file, index) => {
    console.log(`\n${index + 1}. ${file.file}`);

    // Check for problematic patterns
    const issues = [];
    problematicPatterns.forEach((pattern) => {
      const matches = file.content.match(pattern.pattern);
      if (matches) {
        issues.push({
          type: pattern.name,
          description: pattern.description,
          count: matches.length,
        });
      }
    });

    if (issues.length > 0) {
      console.log("   ❌ Issues found:");
      issues.forEach((issue) => {
        console.log(
          `      - ${issue.type}: ${issue.description} (${issue.count} instances)`
        );
      });
    } else {
      console.log("   ✅ No obvious issues found");
    }

    // Show relevant code snippets
    const lines = file.lines;
    const socketLines = [];

    lines.forEach((line, lineNum) => {
      if (line.includes("io(") || line.includes("socket.io")) {
        socketLines.push({
          line: lineNum + 1,
          content: line.trim(),
        });
      }
    });

    if (socketLines.length > 0) {
      console.log("   📝 Socket-related code:");
      socketLines.slice(0, 5).forEach((socketLine) => {
        console.log(`      Line ${socketLine.line}: ${socketLine.content}`);
      });
      if (socketLines.length > 5) {
        console.log(`      ... and ${socketLines.length - 5} more lines`);
      }
    }
  });
}

console.log("\n💡 Recommendations:");
console.log("1. Use a single socket instance per user session");
console.log("2. Implement proper cleanup in useEffect");
console.log("3. Don't create sockets in render functions");
console.log("4. Use socket connection pooling");
console.log("5. Add error handling and reconnection logic");

console.log("\n🔧 Example of correct socket usage:");
console.log(`
// ✅ GOOD - Single socket instance
const [socket, setSocket] = useState(null);

useEffect(() => {
  if (!socket) {
    const newSocket = io('http://localhost:5000', { 
      auth: { token: userToken },
      transports: ['websocket', 'polling']
    });
    setSocket(newSocket);
  }
  
  return () => {
    if (socket) {
      socket.disconnect();
    }
  };
}, [socket, userToken]);

// ❌ BAD - Creates new socket every render
useEffect(() => {
  const socket = io('http://localhost:5000');
  // No cleanup!
}, []);
`);

console.log("\n🚨 IMMEDIATE ACTIONS:");
console.log("1. Stop all server instances");
console.log("2. Check your frontend code for the patterns above");
console.log("3. Fix any socket connection issues");
console.log("4. Restart server with the new protections");
console.log("5. Monitor connection logs");
