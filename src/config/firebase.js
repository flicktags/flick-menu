import admin from "firebase-admin";
// import serviceAccount from "./firebaseServiceAccount.json" with { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : serviceAccount),
});


export default admin;
 