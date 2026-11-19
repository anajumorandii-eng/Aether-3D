import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, GoogleAuthProvider, setPersistence, signInWithPopup, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { firebaseConfig } from './config';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(database, '127.0.0.1', 9000);
}
// Auth's browser default already persists sessions; explicitly set it before login.
const persistence = setPersistence(auth, browserLocalPersistence);
export async function loginGoogle() {
  await persistence;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}
export async function logoutAccount() { await signOut(auth); }
