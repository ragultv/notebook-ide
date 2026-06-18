const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, 'assets', 'icon.png');
const icoPath = path.join(__dirname, 'assets', 'icon.ico');

if (!fs.existsSync(pngPath)) {
  console.error('Source icon.png not found at', pngPath);
  process.exit(1);
}

const pngBuffer = fs.readFileSync(pngPath);

// Create ICO header
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // Reserved
icoHeader.writeUInt16LE(1, 2); // Type: 1 = ICO
icoHeader.writeUInt16LE(1, 4); // Number of images (1)

// Create ICO directory entry
const icoDirectory = Buffer.alloc(16);
icoDirectory.writeUInt8(0, 0); // Width: 0 means 256
icoDirectory.writeUInt8(0, 1); // Height: 0 means 256
icoDirectory.writeUInt8(0, 2); // Color palette (0 = no palette)
icoDirectory.writeUInt8(0, 3); // Reserved
icoDirectory.writeUInt16LE(1, 4); // Color planes (1)
icoDirectory.writeUInt16LE(32, 6); // Bits per pixel (32)
icoDirectory.writeUInt32LE(pngBuffer.length, 8); // Size of PNG data in bytes
icoDirectory.writeUInt32LE(22, 12); // Offset where PNG data starts (6 + 16 = 22)

const icoFile = Buffer.concat([icoHeader, icoDirectory, pngBuffer]);
fs.writeFileSync(icoPath, icoFile);
console.log('Successfully generated high-fidelity icon.ico from icon.png');
