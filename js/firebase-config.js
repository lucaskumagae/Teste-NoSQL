import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";

import { getAuth, connectAuthEmulator } from
    "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import { getFirestore, connectFirestoreEmulator } from
    "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyACZDndXYoJSnwR0W65wbN-4LzAg_U5BtE",
    authDomain: "estudo-nosql-c92b0.firebaseapp.com",
    projectId: "estudo-nosql-c92b0",
    storageBucket: "estudo-nosql-c92b0.firebasestorage.app",
    messagingSenderId: "400576692052",
    appId: "1:400576692052:web:6781198c193a334862d2c1"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// ─── Desenvolvimento local com emuladores ───
// Em localhost, abra qualquer página com ?emulador=1 para usar os
// emuladores (firebase emulators:start) em vez do projeto real.
// A escolha fica guardada na aba até ela ser fechada; ?emulador=0 desliga.
const ehLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const paramEmulador = new URLSearchParams(location.search).get("emulador");

if (ehLocal && paramEmulador !== null) {
    sessionStorage.setItem("emulador", paramEmulador === "0" ? "" : "1");
}

if (ehLocal && sessionStorage.getItem("emulador")) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    console.info("Firebase: usando emuladores locais.");
}
