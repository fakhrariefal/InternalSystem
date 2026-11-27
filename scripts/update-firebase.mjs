#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
};

const shouldPull = hasFlag('pull');
const shouldInstall = hasFlag('install');
const skipTests = hasFlag('skip-tests');
const cleanOldData = hasFlag('clean-old-data');
const resetAllDb = hasFlag('reset-all-db');
const dryRun = hasFlag('dry-run');
const onlyTarget = getArgValue('only') || 'all'; // 'all' | 'hosting' | 'rules'

if (!['all', 'hosting', 'rules'].includes(onlyTarget)) {
  console.error(`Target --only="${onlyTarget}" tidak valid. Gunakan: all, hosting, atau rules.`);
  process.exit(1);
}

const OLD_DATA_COLLECTIONS = [
  'products',
  'suppliers',
  'customers',
  'warehouses',
  'categories',
  'uoms',
  'purchaseOrders',
  'salesOrders',
  'salesQuotations',
  'vendorRfqs',
  'goodsReturns',
  'inventoryBatches',
  'periodClosings',
  'budgets',
  'stockMovements',
  'invoices',
  'chartOfAccounts',
  'journalEntries',
  'auditLogs',
  'notifications',
];

function logStep(step, message) {
  console.log(`\n[${step}] ${message}`);
}

function runCommand(cmd, cmdArgs, options = {}) {
  const display = `${cmd} ${cmdArgs.join(' ')}`.trim();
  console.log(`> ${display}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Perintah gagal (exit code ${result.status}): ${display}`);
  }
}

function commandExists(cmd) {
  const probe = spawnSync(cmd, ['--version'], {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0;
}

function runFirebaseCli(cliArgs) {
  const useGlobalFirebase = commandExists('firebase');
  if (useGlobalFirebase) {
    runCommand('firebase', cliArgs);
  } else {
    runCommand('npx', ['--yes', 'firebase-tools', ...cliArgs]);
  }
}

function readJson(relPath) {
  const absPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File wajib tidak ditemukan: ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

async function main() {
  console.log('=======================================================');
  console.log(' Domestiq Hub System — Script Update & Deploy Firebase');
  console.log('=======================================================');

  logStep('1/8', 'Memvalidasi konfigurasi Firebase & file proyek...');
  const appletConfig = readJson('firebase-applet-config.json');
  const firebaseConfig = readJson('firebase.json');
  const projectId = getArgValue('project') || appletConfig.projectId;
  const firestoreDb = appletConfig.firestoreDatabaseId || firebaseConfig?.firestore?.database || '(default)';

  if (!projectId) {
    throw new Error('projectId tidak ditemukan di firebase-applet-config.json');
  }
  if (!fs.existsSync(path.join(ROOT_DIR, 'firestore.rules'))) {
    throw new Error('File firestore.rules tidak ditemukan.');
  }
  console.log(`  Project ID   : ${projectId}`);
  console.log(`  Firestore DB : ${firestoreDb}`);
  console.log(`  Target       : ${onlyTarget}`);
  if (cleanOldData) console.log('  Hapus Lama   : YA (hapus data master & transaksi lama, pertahankan users & settings)');
  if (resetAllDb) console.log('  Reset Total  : YA (hapus SEMUA koleksi Firestore)');
  if (dryRun) console.log('  Mode         : DRY RUN (simulasi tanpa mengubah Firebase jarak jauh)');

  if (shouldPull) {
    logStep('2/8', 'Menarik update kode terbaru dari Git (--pull)...');
    runCommand('git', ['pull', '--ff-only']);
  } else {
    logStep('2/8', 'Melewati git pull (gunakan --pull jika ingin tarik repo otomatis).');
  }

  const hasNodeModules = fs.existsSync(path.join(ROOT_DIR, 'node_modules'));
  if (shouldInstall || !hasNodeModules) {
    logStep('3/8', 'Menginstal dependensi npm (--legacy-peer-deps)...');
    runCommand('npm', ['install', '--legacy-peer-deps']);
  } else {
    logStep('3/8', 'Dependensi node_modules tersedia.');
  }

  logStep('4/8', 'Menjalankan pemeriksaan TypeScript (npm run lint)...');
  runCommand('npm', ['run', 'lint']);

  if (!skipTests) {
    logStep('5/8', 'Menjalankan unit test ERP (npm test)...');
    runCommand('npm', ['test']);
  } else {
    logStep('5/8', 'Unit test dilewati (--skip-tests).');
  }

  if (onlyTarget === 'all' || onlyTarget === 'rules') {
    logStep('6/8', 'Memvalidasi keamanan Firestore Rules (eslint firestore.rules)...');
    runCommand('npx', ['eslint', 'firestore.rules']);
  } else {
    logStep('6/8', 'Validasi Firestore Rules dilewati (--only=hosting).');
  }

  if (onlyTarget === 'all' || onlyTarget === 'hosting') {
    logStep('7/8', 'Menghapus folder build lama (dist/) & membangun bundle baru...');
    const distDir = path.join(ROOT_DIR, 'dist');
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
      console.log('  Folder dist/ lama dihapus agar tidak ada file usang ikut ter-upload.');
    }
    runCommand('npm', ['run', 'build']);
    const indexHtml = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtml)) {
      throw new Error('Build gagal: dist/index.html tidak ditemukan.');
    }
  } else {
    logStep('7/8', 'Build frontend dilewati (--only=rules).');
  }

  logStep('8/8', 'Menjalankan pembersihan data lama (jika diminta) & deploy ke Firebase...');
  const nonInteractiveFlags =
    process.env.CI || process.env.FIREBASE_TOKEN || process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? ['--non-interactive']
      : [];

  if (resetAllDb) {
    const deleteAllArgs = [
      'firestore:delete',
      '--all-collections',
      '-f',
      '--project',
      projectId,
      '--database',
      firestoreDb,
      ...nonInteractiveFlags,
    ];
    if (dryRun) {
      console.log(`[DRY-RUN] Akan hapus seluruh DB: firebase ${deleteAllArgs.join(' ')}`);
    } else {
      runFirebaseCli(deleteAllArgs);
    }
  } else if (cleanOldData) {
    for (const col of OLD_DATA_COLLECTIONS) {
      const delColArgs = [
        'firestore:delete',
        col,
        '-r',
        '-f',
        '--project',
        projectId,
        '--database',
        firestoreDb,
        ...nonInteractiveFlags,
      ];
      if (dryRun) {
        console.log(`[DRY-RUN] Akan hapus koleksi lama "${col}": firebase ${delColArgs.join(' ')}`);
      } else {
        runFirebaseCli(delColArgs);
      }
    }
  }

  const firebaseTargets =
    onlyTarget === 'rules'
      ? 'firestore:rules'
      : onlyTarget === 'hosting'
        ? 'hosting'
        : 'firestore:rules,hosting';

  const deployArgs = [
    'deploy',
    '--project',
    projectId,
    '--only',
    firebaseTargets,
    ...nonInteractiveFlags,
  ];

  if (dryRun) {
    console.log(`[DRY-RUN] Akan deploy perubahan terbaru: firebase ${deployArgs.join(' ')}`);
    console.log('[DRY-RUN] Semua validasi, pembersihan build lama, rules audit, dan test SUKSES.');
    return;
  }

  try {
    runFirebaseCli(deployArgs);
  } catch (err) {
    console.error('\n[GAGAL DEPLOY FIREBASE]');
    console.error('Pastikan Anda sudah login Firebase CLI atau menyiapkan token CI:');
    console.error('  1) Login interaktif : npx firebase-tools login');
    console.error('  2) Atau CI/CD token : export FIREBASE_TOKEN="..." (atau GOOGLE_APPLICATION_CREDENTIALS)');
    throw err;
  }

  console.log('\n=======================================================');
  console.log(' UPDATE & DEPLOY FIREBASE SELESAI!');
  console.log(` URL Hosting : https://${projectId}.web.app`);
  console.log(` Console     : https://console.firebase.google.com/project/${projectId}/overview`);
  console.log('=======================================================');
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
