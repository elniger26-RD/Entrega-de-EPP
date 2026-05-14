import {
  auth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithLocalAdmin,
  signOut,
} from './localSQLite/auth';
import { getSQLiteDatabase } from './localSQLite/sqliteStore';

export const db = getSQLiteDatabase();
export { auth, signInWithEmailAndPassword, sendPasswordResetEmail };

export const loginAsLocalAdmin = () => signInWithLocalAdmin();
export const logout = () => signOut();

export const createSecondaryUser = async (email: string, password: string) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};
