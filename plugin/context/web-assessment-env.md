# Isolated Web Assessment Environment Setup

## OpSec Principle: Zero Workstation Trust Store Mutation
Per Arsenal Constitution and Contracts, the host workstation operating system certificate trust store must NEVER be modified. Upstream proxies (e.g. Burp Suite CA) must be isolated exclusively inside containerized assessment environments or operator-scoped browser profiles.

## 1. Container CA Certificate Installation (NSS Database)
Inside an isolated Docker / Kali assessment container:
```bash
# 1. Export Burp Suite CA certificate in DER format: cacert.der
# 2. Convert to PEM format
openssl x509 -inform DER -in cacert.der -out burp-ca.crt

# 3. Import into user Chromium NSS database
mkdir -p $HOME/.pki/nssdb
certutil -d sql:$HOME/.pki/nssdb -N --empty-password
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Burp Engagement CA" -i burp-ca.crt

# 4. Verify installation
certutil -d sql:$HOME/.pki/nssdb -L
```

## 2. Container Proxy Environment Variables
Route command-line tools and Python HTTP scripts strictly through the container proxy:
```bash
export http_proxy="http://127.0.0.1:8080"
export https_proxy="http://127.0.0.1:8080"
export HTTP_PROXY="http://127.0.0.1:8080"
export HTTPS_PROXY="http://127.0.0.1:8080"

# TLS CA bundles for Python requests and OpenSSL
export REQUESTS_CA_BUNDLE="/path/to/burp-ca.crt"
export SSL_CERT_FILE="/path/to/burp-ca.crt"
export CURL_CA_BUNDLE="/path/to/burp-ca.crt"
```
