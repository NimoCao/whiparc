package main

import (
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// testCredentialConnection is product-memory 08.5 item D3: a real,
// read-only "does this credential actually authenticate" check per
// provider, dispatched from handleTestProjectCredential. No third-party
// cloud SDK is used (none was already a dependency) — AWS is verified with
// a hand-rolled SigV4-signed call to STS, GCP with a hand-rolled JWT
// bearer-token exchange, both using only stdlib crypto/net packages.
// Returns a human-readable message either way; never returns the decrypted
// secret itself.
func testCredentialConnection(provider string, decrypted []byte) (bool, string) {
	switch provider {
	case "AWS":
		return testAWSCredential(decrypted)
	case "GCP":
		return testGCPCredential(decrypted)
	case "GITHUB":
		return testGitHubCredential(decrypted)
	case "SSH":
		return testSSHCredential(decrypted)
	default:
		return false, "Unknown credential provider."
	}
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

// testAWSCredential signs a GetCallerIdentity request with AWS Signature
// Version 4 (the same algorithm the AWS CLI/SDKs use) and calls STS
// directly over HTTPS — the lightest-weight way to prove an access key
// pair actually authenticates, without pulling in aws-sdk-go.
func testAWSCredential(rawData []byte) (bool, string) {
	var creds struct {
		AccessKeyID     string `json:"accessKeyId"`
		SecretAccessKey string `json:"secretAccessKey"`
		Region          string `json:"region"`
	}
	if err := json.Unmarshal(rawData, &creds); err != nil || creds.AccessKeyID == "" || creds.SecretAccessKey == "" {
		return false, "Stored value is not a valid AWS credential (expected accessKeyId/secretAccessKey)."
	}

	region := creds.Region
	if region == "" {
		region = "us-east-1"
	}
	host := fmt.Sprintf("sts.%s.amazonaws.com", region)
	endpoint := "https://" + host + "/"

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	payload := "Action=GetCallerIdentity&Version=2011-06-15"
	canonicalHeaders := fmt.Sprintf("content-type:application/x-www-form-urlencoded\nhost:%s\nx-amz-date:%s\n", host, amzDate)
	signedHeaders := "content-type;host;x-amz-date"
	canonicalRequest := strings.Join([]string{
		"POST", "/", "", canonicalHeaders, signedHeaders, sha256Hex([]byte(payload)),
	}, "\n")

	credentialScope := fmt.Sprintf("%s/%s/sts/aws4_request", dateStamp, region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+creds.SecretAccessKey), dateStamp), region), "sts"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))

	authHeader := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		creds.AccessKeyID, credentialScope, signedHeaders, signature)

	req, err := http.NewRequest("POST", endpoint, strings.NewReader(payload))
	if err != nil {
		return false, "Failed to build AWS STS request: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Authorization", authHeader)

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "Could not reach AWS STS: " + err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusOK {
		var result struct {
			XMLName xml.Name `xml:"GetCallerIdentityResponse"`
			Result  struct {
				Arn     string `xml:"Arn"`
				Account string `xml:"Account"`
			} `xml:"GetCallerIdentityResult"`
		}
		if err := xml.Unmarshal(body, &result); err == nil && result.Result.Arn != "" {
			return true, fmt.Sprintf("Verified — authenticated as %s (account %s).", result.Result.Arn, result.Result.Account)
		}
		return true, "Verified — AWS STS accepted the credential."
	}

	var errResp struct {
		XMLName xml.Name `xml:"ErrorResponse"`
		Error   struct {
			Code    string `xml:"Code"`
			Message string `xml:"Message"`
		} `xml:"Error"`
	}
	if err := xml.Unmarshal(body, &errResp); err == nil && errResp.Error.Message != "" {
		return false, "AWS rejected the credential: " + errResp.Error.Message
	}
	return false, fmt.Sprintf("AWS STS returned HTTP %d.", resp.StatusCode)
}

// testGCPCredential exchanges the stored service-account key for a real
// access token via Google's OAuth2 JWT-bearer flow (RFC 7523) — the same
// grant type google-auth-library-* SDKs use under the hood — signed
// entirely with stdlib crypto/rsa rather than golang.org/x/oauth2/google.
func testGCPCredential(rawData []byte) (bool, string) {
	var sa struct {
		ProjectID   string `json:"project_id"`
		PrivateKey  string `json:"private_key"`
		ClientEmail string `json:"client_email"`
		TokenURI    string `json:"token_uri"`
	}
	if err := json.Unmarshal(rawData, &sa); err != nil || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return false, "Stored value is not a valid GCP service-account JSON key."
	}

	tokenURI := sa.TokenURI
	if tokenURI == "" {
		tokenURI = "https://oauth2.googleapis.com/token"
	}

	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return false, "GCP service-account private_key is not valid PEM."
	}

	var privKey *rsa.PrivateKey
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rk, ok := key.(*rsa.PrivateKey)
		if !ok {
			return false, "GCP service-account private_key is not an RSA key."
		}
		privKey = rk
	} else if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		privKey = key
	} else {
		return false, "Could not parse GCP service-account private_key: " + err.Error()
	}

	now := time.Now()
	header := map[string]string{"alg": "RS256", "typ": "JWT"}
	claims := map[string]interface{}{
		"iss":   sa.ClientEmail,
		"scope": "https://www.googleapis.com/auth/cloud-platform.read-only",
		"aud":   tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
	headerJSON, _ := json.Marshal(header)
	claimsJSON, _ := json.Marshal(claims)
	signingInput := base64.RawURLEncoding.EncodeToString(headerJSON) + "." + base64.RawURLEncoding.EncodeToString(claimsJSON)
	hashed := sha256.Sum256([]byte(signingInput))

	sig, err := rsa.SignPKCS1v15(rand.Reader, privKey, crypto.SHA256, hashed[:])
	if err != nil {
		return false, "Failed to sign GCP JWT assertion: " + err.Error()
	}
	assertion := signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)

	req, err := http.NewRequest("POST", tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return false, "Failed to build Google token request: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "Could not reach Google's OAuth token endpoint: " + err.Error()
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode == http.StatusOK {
		if _, ok := result["access_token"]; ok {
			return true, fmt.Sprintf("Verified — Google issued an access token for %s (project %s).", sa.ClientEmail, sa.ProjectID)
		}
	}
	if desc, ok := result["error_description"].(string); ok && desc != "" {
		return false, "Google rejected the credential: " + desc
	}
	if errStr, ok := result["error"].(string); ok && errStr != "" {
		return false, "Google rejected the credential: " + errStr
	}
	return false, fmt.Sprintf("Google's token endpoint returned HTTP %d.", resp.StatusCode)
}

// testGitHubCredential calls the authenticated /user endpoint — the
// cheapest real signal that a token is live and what scopes it implies
// (the endpoint itself needs no scopes, so this only proves the token is
// valid, not that it can do anything with it — deploy-time is still the
// real test of write access).
func testGitHubCredential(rawData []byte) (bool, string) {
	var creds struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rawData, &creds); err != nil || creds.Token == "" {
		return false, `Stored value is not a valid GitHub token (expected {"token": "..."}).`
	}

	req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
	if err != nil {
		return false, "Failed to build GitHub API request: " + err.Error()
	}
	req.Header.Set("Authorization", "Bearer "+creds.Token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "Could not reach the GitHub API: " + err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var ghUser struct {
			Login string `json:"login"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&ghUser)
		return true, fmt.Sprintf("Verified — token authenticates as GitHub user %s.", ghUser.Login)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return false, "GitHub rejected the token (invalid, expired, or revoked)."
	}
	return false, fmt.Sprintf("GitHub API returned HTTP %d.", resp.StatusCode)
}

// testSSHCredential has no stored target host to connect to (SSH
// credentials in this schema are provider-agnostic keys, injected as
// TF_VAR_*_ssh_pub_key at deploy time against whatever host Terraform
// provisions) — so "test connection" here means structural validity: does
// this parse as a real private key and can a public key be derived from
// it, reusing the exact parse call extractSecretsAndEnvironment already
// uses at deploy time.
func testSSHCredential(rawData []byte) (bool, string) {
	keyContent := string(rawData)
	var sshPayload struct {
		PrivateKey string `json:"private_key"`
	}
	if err := json.Unmarshal(rawData, &sshPayload); err == nil && sshPayload.PrivateKey != "" {
		keyContent = sshPayload.PrivateKey
	}

	parsedKey, err := ssh.ParseRawPrivateKey([]byte(keyContent))
	if err != nil {
		return false, "Not a valid SSH private key: " + err.Error()
	}
	signer, err := ssh.NewSignerFromKey(parsedKey)
	if err != nil {
		return false, "Key parsed but a public key could not be derived from it: " + err.Error()
	}

	return true, fmt.Sprintf("Valid %s private key. No target host is stored on this credential, so live connectivity can't be tested — this confirms the key itself is usable.", signer.PublicKey().Type())
}
