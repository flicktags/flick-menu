import admin from "firebase-admin"; ///

let serviceAccount;

if (process.env.FIREBASE_CONFIG) {
  // Running on Vercel (env var)
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  // Running locally (fallback to local file or local env var)
  serviceAccount = JSON.parse(
    JSON.stringify({
      "type": "service_account",
      "project_id": "vuedine-d93ba",
      "private_key_id": "ec86f80d06744158547c87dd158fffc304fa254b",
      "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDXkLEbhTiSwVpu\nm89MbKXh7EyepUthb1nKihdgBfmmqah2+9TtGRldPiMwaqOjtrDeZH7jmr52UhAH\nm5SP0JiQ8yMlSm4eAlJH3zUUVC3SnSIEhJ3+JCnGv7sae+5Ms3mc/k47/6jJ1hVn\nLBVrSDoQak6rRLXGJipSor383l8I9tEx97R8iD04Yz6yekrVqb9Y8RasxvzMUvEx\neWd7kkF/HB7apRLNeTWJnxjcrk+gupuZNxmAa7kEPykgOvCKTW7sBbeSkE7Bkt1P\nGEIn8FHWlUlSVBMyL1PGmAt1pjqeGavUOW6DLpSqqAs+SImUjO63S08O30DkQqoi\nDiNnWO6ZAgMBAAECggEAW6mDnfOupDzCsvDfG5zBhslfpUAdRx+9uzGwEd1IlJVk\n9L9OAcnf7rW66d4WmklXeSGbkTXeUlq/xTRjXinxjgVNRxCYtXsAON6RaAUJfRri\n+a/YrNX8y64AphjXslbI2jiK1Nl4EOdPL5FfxEAwrIU/0XUEpG7bJUtdZTa7i4f8\nCzNEr1ksdwZfSFP6AsqiVpzLeMK78RkgiFV4/wy8/7LRMifx4MXXo6MOUISzAfeo\nlpLMmw1wRY7LiAt1rTrJhANESyjr+XNS/TRh7JvdSQ1RbZSzD0eFwAeTRhyGbLVt\ngNhC+Tc5cCi4ntUGJauMIYhepq6GJKjAPSwRYfICFwKBgQD8iuMawhs6XEuF4Ijq\nwdRMRedkO1+UcFt68rysnVOOI5DKpueWBxC1zIS2gfbLqrP+ALqRZLNwCSqR47Ej\nPk3ybh9ow2IZ4diA0vGrZCD4vQOjLmxb7onriNNggDQPo/3yVqEW8h7+xUgzXFH9\natMHwoJqg/ctlxMxitKdndFPZwKBgQDahDTQO/aqWP7+fx3Wry2IC2OX+zOZeIyd\nUJvzOd8uRENgwpO9ZO4Xiv6T32GPCvW/vmK8HQrTazVIuhxi2mef9kisF7DYFYGv\n0FqSu28YPGlnY64X5Tpw+hzOzoQi0T+1xt4N3pnR6nsDjdHPw24W2AIw1tR21Wyb\nZNQy6aMR/wKBgQCK1dvmcQHBAs5uKjN7Q9XvnJqKCu4Pz/kqzVmWV+OAh+Lo1fsJ\nCpdQKsBnCWnhK9ZJ9KKcnczb8d4aWB+g7XayqYHQ+WDsM7HvmIhNnf1WYasnQbVG\nkQv3lcAHFFQKqTBJ0wA6eh86FsELo1xbwieD45YI8sWnpZ9ipBwHlKRmTwKBgQDC\ny+6k33+yNioDR+CavIlzaOu81aQXIT8BEpYjiqipfxMtk+fOg8Y4WKE/w3gd42BW\nMWulVKKM/FqA3eBmQ1rzX8NDHs94oht9VtkXS13rFhfEojjVdnTVuDGsLq/etfj8\nnC7h4Fnxpv1Imsm6U/a1CJVTYn/++52ZHZaJWHwVkwKBgQDOGj+HmF2TZrfDND7r\nsbARcIur/JK09ernIvtORXytv346FJzJzSEvLwi99nfj109eI8J/H7mNbTQWiZd4\nOBuIUcM+YBcmqydHvUkvQy8Cp6p0LLrgqFgF+xDWEv/y8Kyy2nYScSSzcZwy4uEY\n9D+20Typ9jp9o/4ROXzUYBbjWg==\n-----END PRIVATE KEY-----\n",
      "client_email": "firebase-adminsdk-fbsvc@vuedine-d93ba.iam.gserviceaccount.com",
      "client_id": "108526807659102133109",
      // type: "service_account",
      // project_id: "flickmenu-5ffe7",
      // private_key_id: "65e297a743d116df1f051032a1749b941bb9dd53",
      // private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC21nqz6xExeBn6\n/eGuJtXKzEyB1ZvNb9h5N7JOAvZAS8CgLoOIdP8/acdDgYO7Jb8qck5H4XU0EQa4\n7KghPxryxyHFrk2o1oSnZdgR8sAmLIwtKor8PJ4KBz5SnZiJSlp4WmKYXyvoj/+i\ni8ADunyWz6ycxOXuu+x9iYOogZdU6xbCUOhedN/P9n3+QKN1bsM2XFI7Xs3bVXfk\n5EvAb0veO2eJD0RWkM2efKwfPn3ljwjkDQrEFJ4uClbp9iQsntTf/CWemrAeF4bk\n2u0Muq9QaqJniVgG87LzlPrwjd5BhSPXYPc/7m4ciL9BC3PpVDMQbGYlTXRdo6VG\nAINcxbIJAgMBAAECggEAEfComIfLp5V3wyNvJfXki2IRbbnmcDl1vasj4Ti0Leng\n7Da0LEsCkpfP+AU4xj+1arZNjQsHw4SaKsH5201EWScF3s40C4mE+aHqGhS+GuDL\nHlFq0sYl4akFSfjxsyLrDp0byISqG8cpV6sru5HsUKXu83D0eMDSuxynoPyaOzgt\ndNBDpaHxVh79P0fSAYhCcvK79Xx/TcONFxQ84a3T/UXDOVSnwl1yUI4kWVE7ExoE\nDFiSZOHBwET3I19h4VZawxQo4ab2WhrYu6bHEePgbeXourOveaV7zwLg1GTxKyvX\ndFqcawXhAxv+PbzUhzz25xBeX6fi7iuZWwi7Kv4YwQKBgQDnmpcfNzY6XqYN0ska\nNXg5R3IomtkgWKmQqqqC3K7cEtfxJwge3ePCv7xwy1VTSDNSW0jh2CS57Rsl+iAR\nlCrJs8iJASRQfA1i9b8jiskbXWdcRvACqI6Cpjia3raq6ACe/Dyz2ke7S1p3krkC\n3T95UQ/GOFURrf76RrPEjl3BEQKBgQDKGN4iVRpCykwQdIQf6vAH0zMPFa+Bv6B2\nrbjhb53lAwiEGAaBffZn2NImcut60bSGFzPguj9yeY5L70cu+LSIR3RxxE21CxI1\nWeEZFOfKsobNUZGptqgDE/JtMjxBqC6u2RvVIx3KIGIUQbyVyhNn/vfEke8G0lYz\na/p4J25heQKBgG6WbUR1e4pBeW6uUGIYV/CZwdPLpJOCYmz2YPadY00oHj5C0ejT\nMJbkMJl3LaXXmtHfTpywNVEl+0mV9kwOgKPRGZb5mZposYeoKf1RnpdXcSwpnx7V\n1z5hGjQw1e4jW3COpnmGZ6vx3h+sSnUoqc9Guo5+hXgsqcxdiCb5h6DRAoGBALIB\nDUa4JpVFkZG8ztM+H4UE5SgYNanWmwNtKDaIFU6tSUbv0mskA3CcbR0og3h+VL72\nmN8LrO6rWkZPzyb0MC8IoOvDt54KzlLng3iQDUlfzZPykJYnJ/zuCM1dPe2msNeY\nqwckEw0BUOH+tJhKkKU80gb1cs9TXFGWfdpvAK4hAoGBANJ+gHEKYVyiQGV5ZTGP\nP9hIa2Xl240WDlCbeq8sGWG2NThxg0Cff6vKcPYGu5eh0HYjatRFsUJfvi71pDdw\ndJSDcC3PB+ZJJI6zr63qZRF8uPrvxP19sXRDQuv1Ivzc18v8eR8ZEaY0LGbB+9bD\n4/2KH0iaBvUKTaqXBjazUqM0\n-----END PRIVATE KEY-----\n",
      // client_email: "firebase-adminsdk-fbsvc@flickmenu-5ffe7.iam.gserviceaccount.com",
      // client_id: "102559058507476962000",
    })
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;
