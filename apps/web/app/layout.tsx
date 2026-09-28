import type { Metadata, Viewport } from "next";
import "./globals.css";

const geistSans = { variable: "font-sans" };
const geistMono = { variable: "font-mono" };

const TITLE = "Whiparc - Visual Infrastructure Provisioning";
const DESCRIPTION = "Design and provision infrastructure with a modern visual editor. Generate Ansible playbooks visually.";

export const metadata: Metadata = {
  // Resolves the relative og:image / twitter:image URLs that the
  // opengraph-image and twitter-image file conventions emit. Override per
  // deployment (self-hosted, staging) with NEXT_PUBLIC_SITE_URL.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://whiparc.com"),
  applicationName: "Whiparc",
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: "Whiparc", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Brand near-black (#101114): tints the mobile browser chrome and the PWA
// title bar to match the platform's dark ground.
export const viewport: Viewport = {
  themeColor: "#101114",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  // Parallel route slot for app/@modal — populated by the intercepting route
  // at app/@modal/(.)templates/[id]/page.tsx when a template card is opened
  // via client-side navigation from /templates, empty (app/@modal/default.tsx)
  // otherwise. See product-memory 10.1 for the full "Canva-style popup with a
  // shareable URL" rationale.
  modal: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {modal}
      </body>
    </html>
  );
}
