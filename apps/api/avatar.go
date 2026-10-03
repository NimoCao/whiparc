package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"net/http"
	"regexp"
)

// Avatar uploads replace the old "paste any image URL" field. A user-supplied
// URL meant every collaborator's browser fetched an attacker-chosen host
// (IP/tracking leak, mixed content, and a stored-content vector), so avatars
// are now uploaded bytes that the server decodes, center-crops, resizes and
// re-encodes itself. Re-encoding discards EXIF/GPS metadata and any polyglot
// payload appended to the original file: what gets stored and served is
// always a freshly encoded PNG that this process produced.
const (
	avatarSize           = 256             // stored avatars are exactly avatarSize x avatarSize
	avatarMaxUploadBytes = 2 << 20         // 2 MiB of request body; the client crops to 256px first so real uploads are tiny
	avatarMaxSourceDim   = 4096            // reject anything larger before decoding (decompression-bomb guard)
	avatarMinSourceDim   = 32              // reject images too small to be a usable avatar
	avatarURLPrefix      = "/api/avatars/" // value stored in users.avatar_url
)

var avatarKeyPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// avatarRejection is a user-facing validation failure (as opposed to an
// internal error), safe to return verbatim in a 400 response.
type avatarRejection string

func (e avatarRejection) Error() string { return string(e) }

// normalizeAvatar validates raw upload bytes and returns a square
// avatarSize x avatarSize PNG. Only JPEG and PNG are accepted, decided from
// the file's magic bytes, never from the client-supplied filename or
// Content-Type.
func normalizeAvatar(raw []byte) ([]byte, error) {
	mime := http.DetectContentType(raw)
	if mime != "image/jpeg" && mime != "image/png" {
		return nil, avatarRejection("Only .jpg and .png images are allowed")
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, avatarRejection("That file is not a valid image")
	}
	if cfg.Width > avatarMaxSourceDim || cfg.Height > avatarMaxSourceDim {
		return nil, avatarRejection("Image dimensions are too large (4096px max per side)")
	}
	if cfg.Width < avatarMinSourceDim || cfg.Height < avatarMinSourceDim {
		return nil, avatarRejection("Image is too small (32px minimum per side)")
	}

	var src image.Image
	if mime == "image/jpeg" {
		src, err = jpeg.Decode(bytes.NewReader(raw))
	} else {
		src, err = png.Decode(bytes.NewReader(raw))
	}
	if err != nil {
		return nil, avatarRejection("That file is not a valid image")
	}

	var out bytes.Buffer
	if err := png.Encode(&out, resizeSquare(src, avatarSize)); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// resizeSquare center-crops src to a square and scales it to size x size
// with bilinear sampling over a box-filtered source, flattening any alpha
// onto white so transparent PNGs have a predictable look.
func resizeSquare(src image.Image, size int) *image.RGBA {
	b := src.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	x0 := b.Min.X + (b.Dx()-side)/2
	y0 := b.Min.Y + (b.Dy()-side)/2

	// Composite onto white first so alpha is flattened before averaging.
	flat := image.NewRGBA(image.Rect(0, 0, side, side))
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), src, image.Point{X: x0, Y: y0}, draw.Over)

	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	scale := float64(side) / float64(size)
	for y := 0; y < size; y++ {
		sy0 := int(float64(y) * scale)
		sy1 := int(float64(y+1) * scale)
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		if sy1 > side {
			sy1 = side
		}
		for x := 0; x < size; x++ {
			sx0 := int(float64(x) * scale)
			sx1 := int(float64(x+1) * scale)
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			if sx1 > side {
				sx1 = side
			}
			var r, g, bl, n uint32
			for yy := sy0; yy < sy1; yy++ {
				row := flat.Pix[yy*flat.Stride:]
				for xx := sx0; xx < sx1; xx++ {
					p := row[xx*4:]
					r += uint32(p[0])
					g += uint32(p[1])
					bl += uint32(p[2])
					n++
				}
			}
			o := dst.Pix[y*dst.Stride+x*4:]
			o[0] = uint8(r / n)
			o[1] = uint8(g / n)
			o[2] = uint8(bl / n)
			o[3] = 0xff
		}
	}
	return dst
}

// saveUserAvatar stores png as the user's avatar under a fresh random key
// (a new key per upload doubles as a cache-buster, so the served image can be
// marked immutable) and points users.avatar_url at it.
func saveUserAvatar(userID string, png []byte) (string, error) {
	key := generateRandomHex(16)
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec("DELETE FROM user_avatars WHERE user_id = ?", userID); err != nil {
		return "", err
	}
	if _, err := tx.Exec("INSERT INTO user_avatars (user_id, key, mime, data) VALUES (?, ?, 'image/png', ?)", userID, key, png); err != nil {
		return "", err
	}
	avatarURL := avatarURLPrefix + key
	if _, err := tx.Exec("UPDATE users SET avatar_url = ? WHERE id = ?", avatarURL, userID); err != nil {
		return "", err
	}
	return avatarURL, tx.Commit()
}

// clearUserAvatar removes the stored avatar and resets users.avatar_url.
func clearUserAvatar(userID string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec("DELETE FROM user_avatars WHERE user_id = ?", userID); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE users SET avatar_url = NULL WHERE id = ?", userID); err != nil {
		return err
	}
	return tx.Commit()
}

// writeProfileResponse mirrors handleUpdateProfile's response shape (fresh
// token plus the user object) so the client can reuse one code path for both
// endpoints, and pushes the change to everyone currently sharing a workspace
// with this user.
func writeProfileResponse(w http.ResponseWriter, userID string) {
	var email, name string
	var emailVerified bool
	var avatarURL sql.NullString
	if err := db.QueryRow("SELECT email, name, email_verified, avatar_url FROM users WHERE id = ?", userID).
		Scan(&email, &name, &emailVerified, &avatarURL); err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	token, err := GenerateToken(userID, email, name, emailVerified)
	if err != nil {
		http.Error(w, "Failed to sign token", http.StatusInternalServerError)
		return
	}
	broadcastProfileUpdate(userID, name, avatarURL.String)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          email,
			"name":           name,
			"plan":           bestPlanForUser(userID),
			"email_verified": emailVerified,
			"avatar_url":     avatarURL.String,
		},
	})
}

// POST /api/auth/avatar — multipart upload, field name "avatar".
func handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if !avatarLimiter.Allow(user.ID) {
		http.Error(w, "Too many avatar uploads. Please wait a few minutes.", http.StatusTooManyRequests)
		return
	}

	// Hard cap on what the server will even read; multipart overhead is small.
	r.Body = http.MaxBytesReader(w, r.Body, avatarMaxUploadBytes+(64<<10))
	file, _, err := r.FormFile("avatar")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "Image is too large (2 MB max)", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Attach an image in the 'avatar' form field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, avatarMaxUploadBytes+1))
	if err != nil {
		http.Error(w, "Failed to read upload", http.StatusBadRequest)
		return
	}
	if len(raw) > avatarMaxUploadBytes {
		http.Error(w, "Image is too large (2 MB max)", http.StatusRequestEntityTooLarge)
		return
	}

	normalized, err := normalizeAvatar(raw)
	if err != nil {
		var rejection avatarRejection
		if errors.As(err, &rejection) {
			http.Error(w, rejection.Error(), http.StatusBadRequest)
			return
		}
		log.Printf("[AVATAR] normalize failed for %s: %v\n", user.ID, err)
		http.Error(w, "Failed to process image", http.StatusInternalServerError)
		return
	}

	if _, err := saveUserAvatar(user.ID, normalized); err != nil {
		log.Printf("[AVATAR] save failed for %s: %v\n", user.ID, err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	writeProfileResponse(w, user.ID)
}

// DELETE /api/auth/avatar
func handleDeleteAvatar(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if err := clearUserAvatar(user.ID); err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	writeProfileResponse(w, user.ID)
}

// GET /api/avatars/{key} — public by design: <img> tags cannot send an
// Authorization header, and the key is a random 128-bit value that rotates
// on every upload, so it is only discoverable by someone who can already see
// the owner's profile. The response is locked down so a browser can never
// treat it as anything but an inert image.
func handleGetAvatar(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !avatarKeyPattern.MatchString(key) {
		http.NotFound(w, r)
		return
	}
	var data []byte
	var mime string
	if err := db.QueryRow("SELECT data, mime FROM user_avatars WHERE key = ?", key).Scan(&data, &mime); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(data)
}
