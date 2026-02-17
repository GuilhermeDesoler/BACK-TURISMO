/**
 * Script para promover um usuario a ADMIN via email.
 *
 * Uso: npx ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts <email>
 * Ou:  npm run seed:admin -- <email>
 */
import * as admin from 'firebase-admin';

// Desabilitar validacao de env vars (nao usa Environment class aqui)
process.env['APP_ENV'] = process.env['APP_ENV'] || 'local';

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('Uso: npm run seed:admin -- <email>');
    process.exit(1);
  }

  // Inicializar Firebase Admin
  const projectId = process.env['FIREBASE_PROJECT_ID'];
  const clientEmail = process.env['FIREBASE_CLIENT_EMAIL'];
  const privateKey = process.env['FIREBASE_PRIVATE_KEY']?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY no .env',
    );
    process.exit(1);
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });

  const databaseId = process.env['FIRESTORE_DATABASE_ID'] || '(default)';
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(app, databaseId);

  // Buscar usuario pelo email no Firebase Auth
  let uid: string;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    uid = userRecord.uid;
    console.log(`Usuario encontrado no Auth: ${uid}`);
  } catch {
    console.error(
      `Usuario com email "${email}" nao encontrado no Firebase Auth.`,
    );
    console.log('\nPasso 1: Crie a conta primeiro pelo frontend (Register)');
    console.log('Passo 2: Depois rode este script novamente');
    process.exit(1);
  }

  // Verificar se existe no Firestore
  const userDoc = await db.collection('users').doc(uid).get();

  if (!userDoc.exists) {
    // Criar documento no Firestore se nao existe
    await db.collection('users').doc(uid).set({
      email,
      name: 'Admin',
      phone: '',
      cpf: '',
      role: 'ADMIN',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Documento criado no Firestore com role ADMIN`);
  } else {
    // Atualizar role para ADMIN
    await db.collection('users').doc(uid).update({
      role: 'ADMIN',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Role atualizado para ADMIN`);
  }

  console.log(`\n✅ ${email} agora e ADMIN!`);
  console.log('Faca login no frontend e acesse /admin');

  process.exit(0);
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
