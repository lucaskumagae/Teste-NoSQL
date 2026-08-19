import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";

import { getAuth } from
    "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

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