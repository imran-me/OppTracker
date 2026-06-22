/* ============================================================
   OppTrack — Firebase project configuration + initialization
   File: assets/js/firebase-config.js
   ------------------------------------------------------------
   Loads BEFORE security.js and app.js on every page. Uses the
   Firebase "compat" SDK so it works with plain <script> tags —
   no build step, matching the rest of the project.

   These config values are SAFE to be public (they ship in every
   Firebase web app). They only identify the project; they grant
   no edit power on their own. The real protection is the
   Firestore *security rules* (public read, owner-only write).
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyClTtpsTJQYtqy2MOfsB9ZMJGRl7MKtOIM",
  authDomain: "meimran.firebaseapp.com",
  projectId: "meimran",
  storageBucket: "meimran.firebasestorage.app",
  messagingSenderId: "91499371076",
  appId: "1:91499371076:web:f93e5f7c11044d1478fa11",
  measurementId: "G-LDMEJ4BQGC"
};

/* The single Google/email account allowed to add, edit or delete.
   Everyone else is a read-only viewer. This MUST match both the
   user you created in Firebase Authentication and the email in
   your Firestore security rule. */
const OWNER_EMAIL = 'me.imran.personal@gmail.com';

/* Initialize Firebase once (guarded so a double-include can't throw). */
let fbAuth, fbDB, CLOUD_DOC;
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    fbAuth = firebase.auth();
    fbDB = firebase.firestore();

    /* Keep the owner signed in across reloads and devices. */
    fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    /* The whole dataset lives in ONE Firestore document:
       collection "opptrack" → document "data". */
    CLOUD_DOC = fbDB.collection('opptrack').doc('data');
  } else {
    console.error('Firebase SDK failed to load — the site will run offline from local cache only.');
  }
} catch (e) {
  console.error('Firebase init error:', e);
}
