import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAogcT0E_AAyGoLbOEskP07TsqZf489aA0",
  authDomain: "au-ptit-paradis.firebaseapp.com",
  projectId: "au-ptit-paradis",
  storageBucket: "au-ptit-paradis.firebasestorage.app",
  messagingSenderId: "993426404406",
  appId: "1:993426404406:web:1c522f7fdd8f191f355497"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
