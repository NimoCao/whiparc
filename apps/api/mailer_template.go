package main

import (
	"html"
	"os"
	"strconv"
	"strings"
	"time"
)

// The shared HTML layout for every email the Resend transport sends. It
// mirrors the web app's blueprint design system (product-memory 05.6):
// square corners, hairline borders, a mono uppercase kicker, display-font
// headings, and the brand orange button with ink text (the AA-safe pair).
//
// Email is not the web, and three constraints shape the markup:
//   - No CSS variables and no external stylesheets, so every colour is an
//     inline hex taken from the design tokens, and layout is nested tables.
//   - Web fonts are not loaded. Each stack names the brand font first so
//     clients that already have it (or support @font-face) use it, then falls
//     back to a system face. The wordmark is live text for the same reason
//     BrandLogo is on the web: it renders without an image.
//   - Dark mode is progressive. The inline colours are the light theme, which
//     every client renders correctly; clients that honour
//     prefers-color-scheme (Apple Mail, many mobile apps) get the dark tokens
//     from the <style> block. Gmail on the web ignores it and shows light.

const (
	emailDisplayFont   = `'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif`
	emailBodyFont      = `'Barlow','Segoe UI',Helvetica,Arial,sans-serif`
	emailMonoFont      = `'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace`
	emailWordmarkFont  = `'Barlow Condensed','Arial Narrow',Arial,sans-serif`
	emailDefaultAssets = "https://whiparc.com"
)

// brandedEmail is the content of one message. Every string is untrusted or
// at least unescaped: renderBrandedEmail escapes all of it, so callers pass
// raw text.
type brandedEmail struct {
	Kicker      string // small mono label above the title, e.g. "Account / Verify email"
	Title       string
	Paragraphs  []string // body copy, one <p> each
	DetailLabel string   // optional boxed value (e.g. the new address), with its label
	DetailValue string
	CTALabel    string // optional button; CTALink must be set too
	CTALink     string
	Footer      string // small print under the divider
	Warn        bool   // security notices use amber instead of orange
}

// emailAssetBase is where the logo image is fetched from by the recipient's
// mail client. It must be publicly reachable, so a localhost FRONTEND_URL is
// ignored (the image would 404 in the recipient's inbox) in favour of the
// production site.
func emailAssetBase() string {
	if v := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/"); strings.HasPrefix(v, "https://") {
		return v
	}
	return emailDefaultAssets
}

const emailDarkStyles = `
    @media (prefers-color-scheme: dark) {
      .wp-bg { background-color: #101114 !important; }
      .wp-panel { background-color: #17181C !important; border-left-color: #2A2C33 !important; border-right-color: #2A2C33 !important; border-bottom-color: #2A2C33 !important; }
      .wp-detail { background-color: #101114 !important; border-color: #2A2C33 !important; }
      .wp-rule { border-color: #2A2C33 !important; }
      .wp-ink { color: #F5F5F6 !important; }
      .wp-ink2 { color: #A3A6AF !important; }
      .wp-ink3 { color: #9A9DA6 !important; }
      .wp-kicker { color: #FF8A63 !important; }
      .wp-kicker-warn { color: #F59E0B !important; }
      .wp-link { color: #FF8A63 !important; }
    }
    @media only screen and (max-width: 600px) {
      .wp-card-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .wp-outer-pad { padding: 16px 10px !important; }
    }`

func renderBrandedEmail(e brandedEmail) string {
	esc := html.EscapeString

	accent, kickerClass, kickerColor := "#FF6A3D", "wp-kicker", "#C2410C"
	if e.Warn {
		accent, kickerClass, kickerColor = "#F59E0B", "wp-kicker-warn", "#B45309"
	}

	preheader := e.Title
	if len(e.Paragraphs) > 0 {
		preheader = e.Paragraphs[0]
	}
	preheader = truncateRunes(preheader, 120)

	var b strings.Builder
	b.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>`)
	b.WriteString(esc(e.Title))
	b.WriteString(`</title>
  <style>`)
	b.WriteString(emailDarkStyles)
	b.WriteString(`
  </style>
</head>
<body class="wp-bg" style="margin:0;padding:0;background-color:#F5F5F6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">`)
	b.WriteString(esc(preheader))
	b.WriteString(`</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wp-bg" style="background-color:#F5F5F6;">
    <tr>
      <td align="center" class="wp-outer-pad" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="wp-panel" style="width:100%;max-width:560px;background-color:#FFFFFF;border:1px solid #E1E2E6;border-top:3px solid `)
	b.WriteString(accent)
	b.WriteString(`;">
          <tr>
            <td class="wp-card-pad" style="padding:26px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;"><img src="`)
	b.WriteString(esc(emailAssetBase()))
	b.WriteString(`/icons/icon-192.png" width="32" height="32" alt="" style="display:block;border:0;"></td>
                  <td style="vertical-align:middle;padding-left:10px;font-family:`)
	b.WriteString(emailWordmarkFont)
	b.WriteString(`;font-size:26px;font-weight:700;line-height:1;letter-spacing:-0.01em;"><span class="wp-ink" style="color:#101114;">whip</span><span style="color:#FF6A3D;">arc</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="wp-card-pad" style="padding:26px 32px 0 32px;">
              <div class="`)
	b.WriteString(kickerClass)
	b.WriteString(`" style="font-family:`)
	b.WriteString(emailMonoFont)
	b.WriteString(`;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:`)
	b.WriteString(kickerColor)
	b.WriteString(`;">`)
	b.WriteString(esc(e.Kicker))
	b.WriteString(`</div>
              <h1 class="wp-ink" style="margin:12px 0 0 0;font-family:`)
	b.WriteString(emailDisplayFont)
	b.WriteString(`;font-size:28px;font-weight:600;line-height:1.15;letter-spacing:-0.02em;color:#101114;">`)
	b.WriteString(esc(e.Title))
	b.WriteString(`</h1>
`)

	for _, p := range e.Paragraphs {
		b.WriteString(`              <p class="wp-ink2" style="margin:16px 0 0 0;font-family:` + emailBodyFont + `;font-size:15px;line-height:1.6;color:#5A5D66;">`)
		b.WriteString(esc(p))
		b.WriteString(`</p>
`)
	}

	if e.DetailValue != "" {
		b.WriteString(`              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                <tr>
                  <td class="wp-detail" style="background-color:#F5F5F6;border:1px solid #E1E2E6;padding:12px 14px;">
                    <div class="wp-ink3" style="font-family:` + emailMonoFont + `;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6B6E78;">`)
		b.WriteString(esc(e.DetailLabel))
		b.WriteString(`</div>
                    <div class="wp-ink" style="margin-top:4px;font-family:`)
		b.WriteString(emailMonoFont)
		b.WriteString(`;font-size:14px;line-height:1.4;word-break:break-all;color:#101114;">`)
		b.WriteString(esc(e.DetailValue))
		b.WriteString(`</div>
                  </td>
                </tr>
              </table>
`)
	}

	if e.CTALink != "" {
		link := esc(e.CTALink)
		b.WriteString(`              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
                <tr>
                  <td bgcolor="#FF6A3D" style="background-color:#FF6A3D;"><a href="`)
		b.WriteString(link)
		b.WriteString(`" style="display:inline-block;padding:14px 28px;font-family:`)
		b.WriteString(emailDisplayFont)
		b.WriteString(`;font-size:15px;font-weight:600;color:#101114;text-decoration:none;">`)
		b.WriteString(esc(e.CTALabel))
		b.WriteString(`</a></td>
                </tr>
              </table>
              <div class="wp-ink3" style="margin-top:24px;font-family:`)
		b.WriteString(emailMonoFont)
		b.WriteString(`;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6B6E78;">Or paste this link into your browser</div>
              <div style="margin-top:6px;font-family:`)
		b.WriteString(emailMonoFont)
		b.WriteString(`;font-size:12px;line-height:1.5;word-break:break-all;"><a href="`)
		b.WriteString(link)
		b.WriteString(`" class="wp-link" style="color:#C2410C;text-decoration:underline;">`)
		b.WriteString(link)
		b.WriteString(`</a></div>
`)
	}

	b.WriteString(`            </td>
          </tr>
          <tr>
            <td class="wp-card-pad" style="padding:28px 32px 28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="wp-rule" style="border-top:1px solid #E1E2E6;padding-top:16px;">
                    <p class="wp-ink3" style="margin:0;font-family:` + emailBodyFont + `;font-size:12px;line-height:1.6;color:#6B6E78;">`)
	b.WriteString(esc(e.Footer))
	b.WriteString(`</p>
                    <p class="wp-ink3" style="margin:10px 0 0 0;font-family:`)
	b.WriteString(emailMonoFont)
	b.WriteString(`;font-size:10px;letter-spacing:0.1em;color:#6B6E78;">&copy; `)
	b.WriteString(strconv.Itoa(time.Now().Year()))
	b.WriteString(` WHIPARC</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`)
	return b.String()
}
