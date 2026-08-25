// Server component that emits one <script type="application/ld+json"> block.
//
// SECURITY: venue names and descriptions are OWNER-SUPPLIED text, so a value
// containing "</script>" would otherwise break out of the script element and
// inject markup into the page. Escaping the three HTML-significant characters
// closes that hole while leaving the JSON valid — a JSON parser reads
// < exactly as "<".
//
// (U+2028/U+2029 need no handling here: they are only hazardous when a payload
// is parsed as JavaScript, and application/ld+json is parsed as JSON, where
// both characters are legal inside a string.)
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
