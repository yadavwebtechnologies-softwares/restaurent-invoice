
"use strict";

/**
 * Restaurant Billing Software
 * Firebase Admin Authentication Service
 */

(() => {
  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const AUTH_SDK_URL =
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

  let authSDKPromise = null;

  async function getAuthContext() {
    const firebase = window.restaurantFirebase;

    if (!firebase || !firebase.ready) {
      throw new Error("Firebase configuration is unavailable.");
    }

    const initialized = await firebase.ready;

    if (!initialized || !firebase.auth) {
      throw new Error("Firebase initialization failed.");
    }

    if (!authSDKPromise) {
      authSDKPromise = import(AUTH_SDK_URL);
    }

    return {
      auth: firebase.auth,
      authSDK: await authSDKPromise
    };
  }

  async function signIn(email, password) {
    const { auth, authSDK } = await getAuthContext();

    const credential = await authSDK.signInWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );

    if (credential.user.uid !== ADMIN_UID) {
      await authSDK.signOut(auth);

      throw new Error(
        "Access denied. This account is not the authorized administrator."
      );
    }

    return credential.user;
  }

  async function signOut() {
    const { auth, authSDK } = await getAuthContext();

    await authSDK.signOut(auth);
  }

  async function sendPasswordReset(email) {
    const { auth, authSDK } = await getAuthContext();

    await authSDK.sendPasswordResetEmail(auth, email.trim());
  }

  async function watchAuth(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("An authentication callback is required.");
    }

    const { auth, authSDK } = await getAuthContext();

    return authSDK.onAuthStateChanged(auth, (user) => {
      callback(
        user && user.uid === ADMIN_UID ? user : null
      );
    });
  }

  window.restaurantAuth = {
    signIn,
    signOut,
    sendPasswordReset,
    watchAuth
  };
})();
