import "./globals.css";

export const metadata = {
  title: "MTG Deck Analyzer",
  description: "Commander deck analysis using Scryfall card data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
