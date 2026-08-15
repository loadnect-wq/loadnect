"use client";

// Catches errors thrown in the root layout itself. Renders its own <html>/<body>
// because the root layout has crashed. Keep it dependency-free.

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding:     "4rem 1rem",
          textAlign:   "center",
          background:  "#FAF6EF",
          color:       "#3C3531",
          minHeight:   "100vh",
          margin:      0,
        }}
      >
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>Hallnect is having trouble loading</h1>
        <p style={{ color: "#605954", maxWidth: 480, margin: "0 auto" }}>
          The page failed to load. Please try again in a moment. If this keeps
          happening, contact <strong>hallnect@gmail.com</strong>.
        </p>
        {error.digest && (
          <p style={{ fontSize: 11, color: "#918A86", marginTop: 8 }}>
            Ref: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop:    24,
            background:   "#7A1830",
            color:        "#FAF6EF",
            border:       "none",
            padding:      "10px 20px",
            borderRadius: 12,
            fontWeight:   600,
            cursor:       "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
