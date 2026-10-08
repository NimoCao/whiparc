package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	// minPasswordLength is counted in characters (runes), not bytes, so a
	// passphrase in any script isn't penalised for its UTF-8 width.
	minPasswordLength = 8

	// maxPasswordBytes is bcrypt's hard input limit. golang.org/x/crypto/bcrypt
	// rejects longer input outright (older versions silently truncated it), so
	// without this check a 73+ byte password surfaces as a 500 from
	// hashPassword instead of a clear 400.
	maxPasswordBytes = 72
)

// commonPasswords is a deliberately small deny-list of the passwords an online
// guesser tries first. Every entry is at least minPasswordLength characters
// long (shorter ones are already rejected by the length rule), lower-case, and
// compared case-insensitively. It is not a substitute for a breach-corpus
// lookup — it only closes the "password123" class of trivially guessable
// choices that pass a bare length check.
var commonPasswords = map[string]struct{}{
	"password": {}, "password1": {}, "password!": {}, "passw0rd1": {}, "p@ssw0rd": {},
	"p@ssword": {}, "pa$$w0rd": {}, "12345678": {}, "123456789": {}, "87654321": {},
	"11111111": {}, "00000000": {}, "12341234": {}, "qwertyui": {}, "qwerty123": {},
	"qwerty12": {}, "asdfghjk": {}, "asdf1234": {}, "zxcvbnm1": {}, "1q2w3e4r": {},
	"1qaz2wsx": {}, "abc12345": {}, "abcd1234": {}, "abcdefgh": {}, "iloveyou": {},
	"iloveyou1": {}, "letmein1": {}, "letmein12": {}, "welcome1": {}, "welcome12": {},
	"admin123": {}, "admin1234": {}, "changeme": {}, "whiparc1": {}, "whiparc12": {},
	"monkey123": {}, "dragon123": {}, "football1": {}, "baseball1": {}, "sunshine1": {},
	"1234567890": {}, "0123456789": {}, "12345678910": {}, "123456789012": {},
	"1q2w3e4r5t": {}, "1q2w3e4r5t6y": {}, "1qaz2wsx3edc": {}, "qazwsxedc123": {},
	"qwertyuiop": {}, "qwertyuiop123": {}, "asdfghjkl1": {}, "asdfghjklqwerty": {},
	"qwerty1234": {}, "qwerty12345": {}, "qwerty123456": {}, "qwertyuiopasdfghjkl": {},
	"password123": {}, "password1234": {}, "password12345": {}, "password123456": {},
	"password1!!": {}, "password123!": {}, "password@123": {}, "passw0rd123": {},
	"mypassword1": {}, "mypassword123": {}, "adminadmin": {}, "admin12345": {},
	"admin123456": {}, "administrator": {}, "welcome123": {}, "welcome1234": {},
	"letmein123": {}, "letmein1234": {}, "iloveyou123": {}, "iloveyou1234": {},
	"iloveyou12": {}, "trustno1234": {}, "changeme123": {}, "changeme1234": {},
	"abcd123456": {}, "abc1234567": {}, "abcdefghij": {}, "abcdefghijk": {},
	"abcdefg123": {}, "1111111111": {}, "0000000000": {}, "9876543210": {},
	"0987654321": {}, "1234512345": {}, "123123123123": {}, "1234567890123": {},
	"monkey1234": {}, "dragon1234": {}, "football123": {}, "baseball123": {},
	"superman123": {}, "princess123": {}, "sunshine123": {}, "whiparc123": {},
	"whiparc1234": {}, "infracanvas": {}, "infracanvas1": {}, "infracanvas123": {},
}

// validatePassword is the single password policy for every path that sets a
// password (signup and password reset/set). email and name are the account's
// own identifying strings; pass "" when unknown (reset has the token's user but
// not their address in the request).
func validatePassword(password, email, name string) error {
	if utf8.RuneCountInString(password) < minPasswordLength {
		return fmt.Errorf("Password must be at least %d characters", minPasswordLength)
	}
	if len(password) > maxPasswordBytes {
		return fmt.Errorf("Password must be at most %d bytes", maxPasswordBytes)
	}

	lower := strings.ToLower(password)
	if _, common := commonPasswords[lower]; common {
		return fmt.Errorf("That password is too common. Please choose a less guessable one")
	}
	if isSingleRepeatedRune(lower) {
		return fmt.Errorf("Password can't be a single repeated character")
	}

	if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
		local, _, _ := strings.Cut(email, "@")
		if lower == email || (local != "" && lower == local) {
			return fmt.Errorf("Password can't be the same as your email address")
		}
	}
	if name = strings.ToLower(strings.TrimSpace(name)); name != "" && lower == name {
		return fmt.Errorf("Password can't be the same as your name")
	}

	return nil
}

func isSingleRepeatedRune(s string) bool {
	first, size := utf8.DecodeRuneInString(s)
	if size == 0 {
		return false
	}
	for _, r := range s[size:] {
		if r != first {
			return false
		}
	}
	return true
}
