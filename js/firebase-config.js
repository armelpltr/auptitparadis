// ============================================================
// CONFIGURATION FIREBASE — Au P'tit Paradis
// ============================================================
// À COMPLÉTER : remplace les valeurs ci-dessous par la config de
// TON projet Firebase (Console Firebase > Paramètres du projet >
// Général > "Vos applications" > application Web > Config SDK).
//
// Voir SETUP-FIREBASE.md pour la marche à suivre complète.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "À_COMPLETER",
  authDomain: "À_COMPLETER.firebaseapp.com",
  projectId: "À_COMPLETER",
  storageBucket: "À_COMPLETER.appspot.com",
  messagingSenderId: "À_COMPLETER",
  appId: "À_COMPLETER"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
