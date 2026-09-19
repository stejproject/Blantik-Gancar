const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
const midtransClient = require("midtrans-client");

admin.initializeApp();
const db = admin.firestore();

/**
 * Dipanggil dari checkout.html (client) saat pembeli klik "Bayar Sekarang".
 * Server Key TIDAK PERNAH dikirim ke client — hanya dipakai di sini, di server.
 */
exports.createSnapToken = functions.https.onCall(async (data, context) => {
  const { merchantId, itemId, buyerName, buyerEmail } = data || {};

  if (!merchantId || !itemId) {
    throw new functions.https.HttpsError("invalid-argument", "merchantId dan itemId wajib diisi.");
  }

  const [mdtSnap, itemSnap] = await Promise.all([
    db.doc(`merchants/${merchantId}/settings/midtrans`).get(),
    db.doc(`merchants/${merchantId}/items/${itemId}`).get(),
  ]);

  if (!mdtSnap.exists || !mdtSnap.data().enabled) {
    throw new functions.https.HttpsError("failed-precondition", "Midtrans belum diaktifkan oleh merchant ini.");
  }
  if (!itemSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Item tidak ditemukan.");
  }

  const mdt = mdtSnap.data();
  if (!mdt.serverKey || !mdt.clientKey) {
    throw new functions.https.HttpsError("failed-precondition", "Server Key / Client Key Midtrans belum lengkap.");
  }

  const item = itemSnap.data();
  const grossAmount = Number(item.price || 0) + Number(item.fee || 0);
  if (grossAmount <= 0) {
    throw new functions.https.HttpsError("failed-precondition", "Harga item tidak valid.");
  }

  // buat dokumen payment dulu (status pending), lalu dipakai sebagai order_id Midtrans
  const paymentRef = db.collection(`merchants/${merchantId}/payments`).doc();
  const orderId = `MDT-${paymentRef.id}`;

  await paymentRef.set({
    itemId,
    item: item.name || "Item",
    price: Number(item.price || 0),
    fee: Number(item.fee || 0),
    total: grossAmount,
    nominal: grossAmount,
    senderName: buyerName || "-",
    method: "midtrans",
    channel: "midtrans",
    midtransOrderId: orderId,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // index terpisah supaya webhook notifikasi bisa cari merchantId+paymentId hanya dari order_id
  await db.doc(`orderIndex/${orderId}`).set({
    merchantId,
    paymentId: paymentRef.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const snap = new midtransClient.Snap({
    isProduction: mdt.isProduction === true,
    serverKey: mdt.serverKey,
  });

  const nameParts = (buyerName || "Pembeli").trim().split(" ");
  const transaction = await snap.createTransaction({
    transaction_details: { order_id: orderId, gross_amount: grossAmount },
    item_details: [{ id: itemId, name: (item.name || "Item").substring(0, 50), price: grossAmount, quantity: 1 }],
    customer_details: {
      first_name: nameParts[0] || "Pembeli",
      last_name: nameParts.slice(1).join(" ") || "-",
      email: buyerEmail || undefined,
    },
  });

  return {
    token: transaction.token,
    clientKey: mdt.clientKey,
    isProduction: mdt.isProduction === true,
    paymentId: paymentRef.id,
    orderId,
  };
});

/**
 * Webhook yang didaftarkan di Dashboard Midtrans → Settings → Configuration → Payment Notification URL.
 * Contoh: https://REGION-PROJECTID.cloudfunctions.net/midtransNotification
 */
exports.midtransNotification = functions.https.onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const body = req.body || {};
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

    if (!order_id || !status_code || !gross_amount || !signature_key) {
      res.status(400).send("Payload tidak lengkap.");
      return;
    }

    const idxSnap = await db.doc(`orderIndex/${order_id}`).get();
    if (!idxSnap.exists) {
      // order_id tidak dikenal — jangan proses, tapi tetap balas 200 supaya Midtrans tidak retry terus
      res.status(200).send("OK (order tidak dikenal)");
      return;
    }
    const { merchantId, paymentId } = idxSnap.data();

    const mdtSnap = await db.doc(`merchants/${merchantId}/settings/midtrans`).get();
    if (!mdtSnap.exists || !mdtSnap.data().serverKey) {
      res.status(200).send("OK (server key tidak ditemukan)");
      return;
    }
    const serverKey = mdtSnap.data().serverKey;

    // verifikasi signature: SHA512(order_id + status_code + gross_amount + serverKey)
    const expectedSignature = crypto
      .createHash("sha512")
      .update(order_id + status_code + gross_amount + serverKey)
      .digest("hex");

    if (expectedSignature !== signature_key) {
      console.error("Signature tidak cocok untuk order_id:", order_id);
      res.status(403).send("Invalid signature");
      return;
    }

    // map transaction_status Midtrans -> status internal
    let newStatus = "pending";
    if (transaction_status === "capture") {
      newStatus = fraud_status === "accept" ? "capture" : "pending";
    } else if (transaction_status === "settlement") {
      newStatus = "settlement";
    } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
      newStatus = transaction_status; // cancel / deny / expire
    } else if (transaction_status === "pending") {
      newStatus = "pending";
    }

    await db.doc(`merchants/${merchantId}/payments/${paymentId}`).update({
      status: newStatus,
      midtransTransactionStatus: transaction_status,
      midtransFraudStatus: fraud_status || null,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).send("OK");
  } catch (e) {
    console.error("midtransNotification error:", e);
    res.status(500).send("Internal error");
  }
});
