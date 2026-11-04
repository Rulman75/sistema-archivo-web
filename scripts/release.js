/**
 * Script de Versionado Semántico (SemVer) automatizado con Git
 * Uso:
 *   node scripts/release.js patch   -> 1.1.0 -> 1.1.1 (Correcciones de errores / bugs)
 *   node scripts/release.js minor   -> 1.0.0 -> 1.1.0 (Nuevas funcionalidades compatibles)
 *   node scripts/release.js major   -> 1.1.0 -> 2.0.0 (Cambios estructurales mayores)
 *   node scripts/release.js 1.2.0   -> Define versión explícita
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const frontendPkgPath = path.join(rootDir, 'frontend', 'package.json');
const backendPkgPath = path.join(rootDir, 'backend', 'package.json');

const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));

const currentVersion = frontendPkg.version || '1.0.0';
const [maj, min, pat] = currentVersion.split('.').map(n => parseInt(n, 10) || 0);

const bumpType = (process.argv[2] || 'patch').toLowerCase().trim();
let nextVersion = currentVersion;

if (bumpType === 'patch') {
  nextVersion = `${maj}.${min}.${pat + 1}`;
} else if (bumpType === 'minor') {
  nextVersion = `${maj}.${min + 1}.0`;
} else if (bumpType === 'major') {
  nextVersion = `${maj + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(bumpType)) {
  nextVersion = bumpType;
} else {
  console.error('Uso inválido. Use: node scripts/release.js [patch|minor|major|X.Y.Z]');
  process.exit(1);
}

console.log(`Actualizando versión SemVer: v${currentVersion} -> v${nextVersion}...`);

frontendPkg.version = nextVersion;
backendPkg.version = nextVersion;

fs.writeFileSync(frontendPkgPath, JSON.stringify(frontendPkg, null, 2) + '\n', 'utf8');
fs.writeFileSync(backendPkgPath, JSON.stringify(backendPkg, null, 2) + '\n', 'utf8');

console.log('Compilando frontend con la nueva versión...');
execSync('npm run build', { cwd: path.join(rootDir, 'frontend'), stdio: 'inherit' });

// Copiar dist a backend/public
const distDir = path.join(rootDir, 'frontend', 'dist');
const publicDir = path.join(rootDir, 'backend', 'public');
fs.cpSync(distDir, publicDir, { recursive: true, force: true });

console.log(`Creando commit y tag Git v${nextVersion}...`);
execSync('git add frontend/package.json backend/package.json backend/public/ frontend/src/ frontend/vite.config.ts backend/server.js scripts/release.js', { cwd: rootDir, stdio: 'inherit' });
execSync(`git commit -m "chore(release): v${nextVersion}"`, { cwd: rootDir, stdio: 'inherit' });
execSync(`git tag -a v${nextVersion} -m "Release v${nextVersion}"`, { cwd: rootDir, stdio: 'inherit' });
execSync('git push origin main --follow-tags', { cwd: rootDir, stdio: 'inherit' });

console.log(`¡Versión v${nextVersion} publicada exitosamente en GitHub!`);
