#!/usr/bin/env bash
# Generates a throwaway test PKI for signing tests. NEVER use these keys for anything real.
set -euo pipefail
OUT="$(dirname "$0")/../tests/fixtures/certs"
mkdir -p "$OUT" && cd "$OUT"
export MSYS_NO_PATHCONV=1
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
  -subj "/CN=PDF Editor Test Root CA/O=Test" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -nodes -keyout signer.key -out signer.csr -subj "/CN=Jan Kowalski/O=Test Org/C=PL/emailAddress=jan@example.test"
cat > signer.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
extendedKeyUsage=emailProtection
EXT
openssl x509 -req -in signer.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out signer.crt -days 3650 -extfile signer.ext
# Modern (AES/PBKDF2) and legacy (3DES, typical of Windows exports) PKCS#12 variants. Password: test
openssl pkcs12 -export -inkey signer.key -in signer.crt -certfile ca.crt -out signer.p12 -passout pass:test -name "Jan Kowalski"
openssl pkcs12 -export -legacy -inkey signer.key -in signer.crt -certfile ca.crt -out signer-legacy.p12 -passout pass:test -name "Jan Kowalski" 2>/dev/null \
  || openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -inkey signer.key -in signer.crt -certfile ca.crt -out signer-legacy.p12 -passout pass:test
rm -f signer.csr signer.ext ca.srl
echo "Test certs written to $OUT"
