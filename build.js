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

    // 3. public/(3D 모델, 이미지 등 정적 자산)을 dist/public으로 복사
    console.log('Copying static assets (public/)...');
    const publicSrc = path.join(srcDir, 'public');
    const publicDist = path.join(distDir, 'public');
    fs.cpSync(publicSrc, publicDist, { recursive: true });

    // 3-1. index.html(프로젝트 루트)도 같은 정적 루트(dist/public)로 복사한다.
    // (개발 중엔 index.html/src/public을 각각 서빙하지만, 배포 산출물은 하나의 정적 루트로 합친다)
    console.log('Copying index.html...');
    const srcRoot = path.join(srcDir, 'src');
    fs.copyFileSync(path.join(srcDir, 'index.html'), path.join(publicDist, 'index.html'));

    // 3-2. src/app.js + component/*.js를 하나로 번들링하고 트랜스파일/압축한다.
    // three/three-addons는 npm 패키지가 아니라 index.html의 importmap으로 CDN에서
    // 불러오는 방식이라, 번들에 포함하지 않고 external로 남겨 런타임에 그대로 resolve되게 한다.
    console.log('Bundling & minifying src/app.js...');
    await esbuild.build({
      entryPoints: [path.join(srcRoot, 'app.js')],
      outfile: path.join(publicDist, 'app.js'),
      bundle: true,
      minify: true,
      sourcemap: true,
      format: 'esm',
      target: ['es2020'],
      external: ['three', 'three/addons/*'],
      allowOverwrite: true
    });

    // 4. Copy server.js + router.js to dist/
    // (router.js는 server.js가 './router.js'로 직접 import하므로 반드시 같이 복사해야 한다)
    console.log('Copying server.js & router.js...');
    fs.copyFileSync(path.join(srcDir, 'server.js'), path.join(distDir, 'server.js'));
    fs.copyFileSync(path.join(srcDir, 'router.js'), path.join(distDir, 'router.js'));

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
