"use strict";

/**
 * Restaurant Billing Software
 * Firebase configuration loader
 *
 * Loads public Firebase configuration from Cloudflare Worker.
 * Initializes Firebase Authentication and Realtime Database.
 */

(() => {
  const CONFIG_URL =
    "https://restaurant-billing-config.yadavsubba2003.workers.dev/api/firebase-config";

  const firebaseServices = {
    app: null,
    auth: null,
    db: null,
    error: null,
    ready: null
  };

  window.restaurantFirebase = firebaseServices;

  firebaseServices.ready = (async () => {
    try {
      const response = await fetch(CONFIG_URL, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          `Configuration request failed: HTTP ${response.status}`
        );
      }

      const firebaseConfig = await response.json();

      const [
        appSDK,
        authSDK,
        databaseSDK
      ] = await Promise.all([
        import(
          "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"
        ),
        import(
          "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"
        ),
        import(
          "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"
        )
      ]);

      const app = appSDK.initializeApp(firebaseConfig);
      const auth = authSDK.getAuth(app);
      const db = databaseSDK.getDatabase(app);

      firebaseServices.app = app;
      firebaseServices.auth = auth;
      firebaseServices.db = db;

      console.info("Firebase initialized successfully.");

      window.dispatchEvent(
        new CustomEvent("restaurant-firebase-ready", {
          detail: {
            app,
            auth,
            db
          }
        })
      );

      return firebaseServices;
    } catch (error) {
      firebaseServices.error = error;

      console.error(
        "Firebase initialization failed:",
        error
      );

      window.dispatchEvent(
        new CustomEvent("restaurant-firebase-error", {
          detail: { error }
        })
      );

      return null;
    }
  })();
})();
