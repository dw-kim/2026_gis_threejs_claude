import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');

async function build() {
  console.log('Building project to /dist directory...');

  try {
    // 1. Clean existing dist directory
    if (fs.existsSync(distDir)) {
      console.log('Cleaning existing dist/ folder...');
      fs.rmSync(distDir, { recursive: true, force: true });
    }

    // 2. Create dist directory
    fs.mkdirSync(distDir, { recursive: true });

    // 3. Copy public folder to dist/public
    console.log('Copying static assets (public/)...');
    const publicSrc = path.join(srcDir, 'public');
    const publicDist = path.join(distDir, 'public');
    fs.cpSync(publicSrc, publicDist, { recursive: true });

    // 4. Copy server.js to dist/server.js
    console.log('Copying server.js...');
    fs.copyFileSync(path.join(srcDir, 'server.js'), path.join(distDir, 'server.js'));

    // 5. Generate production package.json in dist/
    console.log('Generating production package.json...');
    const originalPkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    
    const prodPkg = {
      name: originalPkg.name,
      version: originalPkg.version,
      description: originalPkg.description,
      type: originalPkg.type,
      main: originalPkg.main,
      scripts: {
        start: 'node server.js'
      },
      dependencies: originalPkg.dependencies
    };

    fs.writeFileSync(
      path.join(distDir, 'package.json'),
      JSON.stringify(prodPkg, null, 2),
      'utf-8'
    );

    console.log('\n=============================================');
    console.log('Build completed successfully!');
    console.log('Output directory: /dist');
    console.log('=============================================');
    console.log('To run from dist:');
    console.log('  1. cd dist');
    console.log('  2. npm install --omit=dev');
    console.log('  3. npm start');
    console.log('=============================================\n');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

build();
