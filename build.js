import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

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

    // 3-1. app.js + component/*.js를 하나로 번들링하고 트랜스파일/압축한다.
    // three/three-addons는 npm 패키지가 아니라 index.html의 importmap으로 CDN에서
    // 불러오는 방식이라, 번들에 포함하지 않고 external로 남겨 런타임에 그대로 resolve되게 한다.
    console.log('Bundling & minifying public/app.js...');
    await esbuild.build({
      entryPoints: [path.join(publicSrc, 'app.js')],
      outfile: path.join(publicDist, 'app.js'),
      bundle: true,
      minify: true,
      sourcemap: true,
      format: 'esm',
      target: ['es2020'],
      external: ['three', 'three/addons/*'],
      allowOverwrite: true
    });

    // 번들에 합쳐진 컴포넌트/이펙트/베이스/믹스인 소스는 dist에 따로 둘 필요가 없으니 정리한다.
    fs.rmSync(path.join(publicDist, 'component'), { recursive: true, force: true });
    fs.rmSync(path.join(publicDist, 'effect'), { recursive: true, force: true });
    fs.rmSync(path.join(publicDist, 'base'), { recursive: true, force: true });
    fs.rmSync(path.join(publicDist, 'mixin'), { recursive: true, force: true });

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
