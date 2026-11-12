import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCXeMq_bJ2IxXqoAT1Z4azf-rqxuJIPdYU",
  authDomain: "event-cinema.firebaseapp.com",
  databaseURL: "https://event-cinema-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "event-cinema",
  storageBucket: "event-cinema.firebasestorage.app",
  messagingSenderId: "670709095482",
  appId: "1:670709095482:web:67e6fee858f2577395a903",
  measurementId: "G-NXGBNFJDF8"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
