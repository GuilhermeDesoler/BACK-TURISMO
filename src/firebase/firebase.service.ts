import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { Environment } from '../common/config/environment';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App;
  private db: admin.firestore.Firestore;
  private auth: admin.auth.Auth;
  private storage: admin.storage.Storage;

  onModuleInit() {
    const privateKey = Environment.getVar('FIREBASE_PRIVATE_KEY');

    this.app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: Environment.getVar('FIREBASE_PROJECT_ID'),
        privateKey: privateKey.replace(/\\n/g, '\n'),
        clientEmail: Environment.getVar('FIREBASE_CLIENT_EMAIL'),
      }),
      storageBucket: `${Environment.getVar('FIREBASE_PROJECT_ID')}.appspot.com`,
    });

    const databaseId = process.env['FIRESTORE_DATABASE_ID'] || '(default)';
    this.db = getFirestore(this.app, databaseId);
    this.auth = admin.auth();
    this.storage = admin.storage();

    this.logger.log('Firebase inicializado');
  }

  getFirestore(): admin.firestore.Firestore {
    return this.db;
  }

  getAuth(): admin.auth.Auth {
    return this.auth;
  }

  getStorage(): admin.storage.Storage {
    return this.storage;
  }

  getApp(): admin.app.App {
    return this.app;
  }
}
