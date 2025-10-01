import admin from "firebase-admin"; //

let serviceAccount;

if (process.env.FIREBASE_CONFIG) {
  // Running on Vercel (env var)
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  // Running locally (fallback to local file or local env var)
  serviceAccount = JSON.parse(
    JSON.stringify({
      type: "service_account",
      project_id: "flickmenu-5ffe7",
      private_key_id: "65e297a743d116df1f051032a1749b941bb9dd53",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC21nqz6xExeBn6\n/eGuJtXKzEyB1ZvNb9h5N7JOAvZAS8CgLoOIdP8/acdDgYO7Jb8qck5H4XU0EQa4\n7KghPxryxyHFrk2o1oSnZdgR8sAmLIwtKor8PJ4KBz5SnZiJSlp4WmKYXyvoj/+i\ni8ADunyWz6ycxOXuu+x9iYOogZdU6xbCUOhedN/P9n3+QKN1bsM2XFI7Xs3bVXfk\n5EvAb0veO2eJD0RWkM2efKwfPn3ljwjkDQrEFJ4uClbp9iQsntTf/CWemrAeF4bk\n2u0Muq9QaqJniVgG87LzlPrwjd5BhSPXYPc/7m4ciL9BC3PpVDMQbGYlTXRdo6VG\nAINcxbIJAgMBAAECggEAEfComIfLp5V3wyNvJfXki2IRbbnmcDl1vasj4Ti0Leng\n7Da0LEsCkpfP+AU4xj+1arZNjQsHw4SaKsH5201EWScF3s40C4mE+aHqGhS+GuDL\nHlFq0sYl4akFSfjxsyLrDp0byISqG8cpV6sru5HsUKXu83D0eMDSuxynoPyaOzgt\ndNBDpaHxVh79P0fSAYhCcvK79Xx/TcONFxQ84a3T/UXDOVSnwl1yUI4kWVE7ExoE\nDFiSZOHBwET3I19h4VZawxQo4ab2WhrYu6bHEePgbeXourOveaV7zwLg1GTxKyvX\ndFqcawXhAxv+PbzUhzz25xBeX6fi7iuZWwi7Kv4YwQKBgQDnmpcfNzY6XqYN0ska\nNXg5R3IomtkgWKmQqqqC3K7cEtfxJwge3ePCv7xwy1VTSDNSW0jh2CS57Rsl+iAR\nlCrJs8iJASRQfA1i9b8jiskbXWdcRvACqI6Cpjia3raq6ACe/Dyz2ke7S1p3krkC\n3T95UQ/GOFURrf76RrPEjl3BEQKBgQDKGN4iVRpCykwQdIQf6vAH0zMPFa+Bv6B2\nrbjhb53lAwiEGAaBffZn2NImcut60bSGFzPguj9yeY5L70cu+LSIR3RxxE21CxI1\nWeEZFOfKsobNUZGptqgDE/JtMjxBqC6u2RvVIx3KIGIUQbyVyhNn/vfEke8G0lYz\na/p4J25heQKBgG6WbUR1e4pBeW6uUGIYV/CZwdPLpJOCYmz2YPadY00oHj5C0ejT\nMJbkMJl3LaXXmtHfTpywNVEl+0mV9kwOgKPRGZb5mZposYeoKf1RnpdXcSwpnx7V\n1z5hGjQw1e4jW3COpnmGZ6vx3h+sSnUoqc9Guo5+hXgsqcxdiCb5h6DRAoGBALIB\nDUa4JpVFkZG8ztM+H4UE5SgYNanWmwNtKDaIFU6tSUbv0mskA3CcbR0og3h+VL72\nmN8LrO6rWkZPzyb0MC8IoOvDt54KzlLng3iQDUlfzZPykJYnJ/zuCM1dPe2msNeY\nqwckEw0BUOH+tJhKkKU80gb1cs9TXFGWfdpvAK4hAoGBANJ+gHEKYVyiQGV5ZTGP\nP9hIa2Xl240WDlCbeq8sGWG2NThxg0Cff6vKcPYGu5eh0HYjatRFsUJfvi71pDdw\ndJSDcC3PB+ZJJI6zr63qZRF8uPrvxP19sXRDQuv1Ivzc18v8eR8ZEaY0LGbB+9bD\n4/2KH0iaBvUKTaqXBjazUqM0\n-----END PRIVATE KEY-----\n",
      client_email: "firebase-adminsdk-fbsvc@flickmenu-5ffe7.iam.gserviceaccount.com",
      client_id: "102559058507476962000",
    })
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;
