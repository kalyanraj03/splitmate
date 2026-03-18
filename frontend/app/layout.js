export const metadata = { title: 'SplitMate', description: 'Bachelor Expense Manager' }
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </head>
      <body style={{ background: '#0e0e10' }}>{children}</body>
    </html>
  )
}
